import argparse
from contextlib import closing, contextmanager
from datetime import date, datetime, timezone
import getpass
import hashlib
import hmac
import json
import math
import os
import re
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

COOKIE = "__Host-logistics"
SESSION_AGE = 12 * 3600
MAX_BODY = 4 * 1024 * 1024
SCHEMA = (
    "CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, salt BLOB NOT NULL, password BLOB NOT NULL)",
    """CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, email TEXT NOT NULL
       REFERENCES users(email) ON DELETE CASCADE, csrf TEXT NOT NULL, expires INTEGER NOT NULL)""",
    "CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL)",
)
OWNER_SCHEMA = (
    """CREATE TABLE registry (
       owner TEXT PRIMARY KEY NOT NULL REFERENCES users(email) ON DELETE CASCADE,
       revision INTEGER NOT NULL)""",
    """CREATE TABLE orders (
       owner TEXT NOT NULL REFERENCES registry(owner) ON DELETE CASCADE,
       number TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL,
       updated_at TEXT NOT NULL, PRIMARY KEY (owner, number))""",
)
SCHEMA_VERSION = 2


def connect(path):
    db = sqlite3.connect(path, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


@contextmanager
def database(path, *, write=False):
    with closing(connect(path)) as db, db:
        if write:
            db.execute("BEGIN IMMEDIATE")
        yield db


def database_path(value):
    path = Path(value).expanduser().resolve()
    if path.is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError("DATABASE_PATH must be outside the checkout")
    return path


def initialize(path):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.touch(mode=0o600, exist_ok=True)
    with database(path) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("BEGIN IMMEDIATE")
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError("Unsupported SQLite schema")
        if version == 0:
            for statement in SCHEMA:
                db.execute(statement)
        if version == 1:
            db.execute("ALTER TABLE registry RENAME TO legacy_shared_registry")
            db.execute("ALTER TABLE orders RENAME TO legacy_shared_orders")
            db.execute("DELETE FROM sessions")
        if version < SCHEMA_VERSION:
            for statement in OWNER_SCHEMA:
                db.execute(statement)
            db.execute("INSERT INTO registry SELECT email, 0 FROM users")
            db.execute(f"PRAGMA user_version={SCHEMA_VERSION}")


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=32768, r=8, p=1, maxmem=64 * 1024**2)


def add_user(path, email, password):
    email = email.strip().lower()
    if not valid_email(email) or not 12 <= len(password) <= 256:
        raise ValueError("Use a valid email and a password of 12–256 characters")
    salt = secrets.token_bytes(16)
    digest = password_hash(password, salt)
    with database(path, write=True) as db:
        if db.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            raise ValueError("Account already exists")
        if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] >= 2:
            raise ValueError("The two accounts are already provisioned")
        db.execute("INSERT INTO users VALUES (?, ?, ?)", (email, salt, digest))
        db.execute("INSERT INTO registry VALUES (?, 0)", (email,))


def valid_email(email):
    return isinstance(email, str) and len(email) <= 254 and email.count("@") == 1 and all(
        part and not any(char.isspace() or ord(char) < 32 for char in part) for part in email.split("@")
    )


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


async def read_json(request, limit):
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        raise HTTPException(415, "Expected JSON")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > limit:
            raise HTTPException(413, "Request too large")
        body.extend(chunk)
    try:
        value = json.loads(body)
    except (ValueError, RecursionError):
        raise HTTPException(400, "Invalid JSON") from None
    if not isinstance(value, dict):
        raise HTTPException(422, "Expected an object")
    return value


def valid_value(value, depth=0):
    if depth > 8:
        return False
    if isinstance(value, dict):
        return len(value) <= 128 and all(len(key) <= 128 and valid_value(key) and valid_value(item, depth + 1) for key, item in value.items())
    if isinstance(value, list):
        return len(value) <= 512 and all(valid_value(item, depth + 1) for item in value)
    if isinstance(value, str):
        return len(value) <= 16000 and not any(0xD800 <= ord(char) <= 0xDFFF for char in value)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return -1e15 <= value <= 1e15 and math.isfinite(value)
    return value is None or isinstance(value, bool)


def strings(value):
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def validate_orders(orders):
    if not isinstance(orders, list) or len(orders) > 5000:
        raise HTTPException(422, "Invalid order list")
    numbers = set()
    for order in orders:
        if not isinstance(order, dict) or not valid_value(order):
            raise HTTPException(422, "Invalid order")
        number = order.get("number")
        if not isinstance(number, str) or not number or len(number) > 48 or number != number.strip() or number in numbers:
            raise HTTPException(422, "Invalid or duplicate order number")
        numbers.add(number)
        for key in ("date", "route", "customer", "carrier", "driver", "passport", "vehicle", "cargo", "customerTax", "carrierTax"):
            if not isinstance(order.get(key, ""), str):
                raise HTTPException(422, "Invalid order field")
        for key in ("customerAmount", "carrierAmount", "ledgerMargin"):
            value = order.get(key)
            if value is not None and type(value) not in (int, float):
                raise HTTPException(422, "Invalid amount")
        for key in ("points", "contacts", "differences"):
            if not isinstance(order.get(key), list) or not all(isinstance(item, dict) for item in order[key]):
                raise HTTPException(422, "Invalid order details")
        for contact in order["contacts"]:
            if not isinstance(contact.get("role"), str) or not strings(contact.get("values")):
                raise HTTPException(422, "Invalid contact")
        for point in order["points"]:
            if not all(isinstance(point.get(key), str) for key in ("kind", "address", "schedule")) or not strings(point.get("contacts", [])):
                raise HTTPException(422, "Invalid route point")
        for key in ("payment", "trip", "etrn"):
            if not isinstance(order.get(key), dict):
                raise HTTPException(422, "Invalid order details")
        if not isinstance(order["etrn"].get("number", ""), str):
            raise HTTPException(422, "Invalid ETRN number")
        order.pop("updatedAt", None)


def snapshot(db, owner):
    registry = db.execute("SELECT revision FROM registry WHERE owner=?", (owner,)).fetchone()
    if registry is None:
        raise HTTPException(401, "Sign in required")
    orders = [
        {**json.loads(row["payload"]), "updatedAt": row["updated_at"]}
        for row in db.execute("SELECT payload, updated_at FROM orders WHERE owner=? ORDER BY position", (owner,))
    ]
    return {"revision": registry["revision"], "orders": orders}


def replace_orders(db, owner, revision, orders):
    current = snapshot(db, owner)
    if current["revision"] != revision:
        raise HTTPException(409, "Registry changed")
    existing = {order["number"]: order for order in current["orders"]}
    timestamp = datetime.now(timezone.utc).isoformat(timespec="microseconds")
    rows = []
    for position, order in enumerate(orders):
        previous = existing.pop(order["number"], None)
        payload = json.dumps(order, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        updated = timestamp
        if previous is not None:
            previous_stamp = previous.pop("updatedAt")
            if previous == order:
                updated = previous_stamp
        rows.append((owner, order["number"], position, payload, updated))
    db.executemany("DELETE FROM orders WHERE owner=? AND number=?", [(owner, number) for number in existing])
    db.executemany(
        """INSERT INTO orders VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner, number) DO UPDATE SET
        position=excluded.position, payload=excluded.payload, updated_at=excluded.updated_at
        WHERE position<>excluded.position OR payload<>excluded.payload""",
        rows,
    )
    db.execute("UPDATE registry SET revision=revision+1 WHERE owner=?", (owner,))
    return snapshot(db, owner)


def create_app(path, origin, sheet_preview=None):
    path = database_path(path)
    url = urlsplit(origin)
    if not url.hostname or origin != f"{url.scheme}://{url.netloc}" or url.username or url.password:
        raise ValueError("APP_ORIGIN must be an exact origin, with no trailing slash")
    if url.scheme != "https" and not (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1"}):
        raise ValueError("HTTPS is required outside loopback")
    initialize(path)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    hash_slot = threading.BoundedSemaphore(1)
    dummy_salt = secrets.token_bytes(16)

    @app.middleware("http")
    async def no_cache(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    def check_origin(request):
        if request.headers.get("origin") != origin:
            raise HTTPException(403, "Origin rejected")

    def session(request, *, mutate=False, bind=False):
        token = request.cookies.get(COOKIE, "")
        if len(token) != 43 or not token.isascii():
            raise HTTPException(401, "Sign in required")
        with database(path) as db:
            row = db.execute("SELECT * FROM sessions WHERE token=? AND expires>?", (token_hash(token), int(time.time()))).fetchone()
        if row is None:
            raise HTTPException(401, "Sign in required")
        if mutate:
            check_origin(request)
        if mutate or bind:
            csrf = request.headers.get("x-csrf-token", "")
            if not csrf.isascii() or not secrets.compare_digest(csrf, row["csrf"]):
                raise HTTPException(403 if mutate else 401, "Session token rejected")
        return row

    def authenticate(email, password, ip):
        now = int(time.time())
        with database(path, write=True) as db:
            db.execute("DELETE FROM login_attempts WHERE expires<=?", (now,))
            attempt = db.execute("SELECT attempts FROM login_attempts WHERE ip=?", (ip,)).fetchone()
            if attempt and attempt[0] >= 8:
                raise HTTPException(429, "Too many login attempts", headers={"Retry-After": "900"})
            db.execute("""INSERT INTO login_attempts VALUES (?, 1, ?) ON CONFLICT(ip)
                          DO UPDATE SET attempts=attempts+1""", (ip, now + 900))
            user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if not hash_slot.acquire(blocking=False):
            raise HTTPException(429, "Login busy")
        try:
            digest = password_hash(password, user["salt"] if user else dummy_salt)
        finally:
            hash_slot.release()
        if not user or not hmac.compare_digest(digest, user["password"]):
            raise HTTPException(401, "Invalid credentials")
        with database(path, write=True) as db:
            db.execute("DELETE FROM login_attempts WHERE ip=?", (ip,))
        return user["email"]

    if sheet_preview is not None:
        @app.get("/api/sheet-preview")
        def preview_sheet_capability(request: Request):
            row = session(request, bind=True)
            return sheet_preview(row["email"], None)

        @app.post("/api/sheet-preview")
        async def preview_sheet_row(request: Request):
            session(request, mutate=True)
            data = await read_json(request, 4096)
            keys = ("number", "title", "amount", "requested", "promised")
            if not isinstance(data, dict) or set(data) != set(keys):
                raise HTTPException(422, "Invalid row")
            if not all(isinstance(data[key], str) and 0 < len(data[key].strip()) <= 200 for key in keys):
                raise HTTPException(422, "Invalid row")
            data = {key: value.strip() for key, value in data.items()}
            if len(data["number"]) > 48 or not re.fullmatch(r"[0-9]{1,12}(?:\.[0-9]{1,2})?", data["amount"]):
                raise HTTPException(422, "Invalid amount or order number")
            try:
                for key in ("requested", "promised"):
                    if date.fromisoformat(data[key]).isoformat() != data[key]:
                        raise ValueError
            except ValueError:
                raise HTTPException(422, "Invalid dates") from None
            user = session(request, mutate=True)
            return await run_in_threadpool(sheet_preview, user["email"], data)

    @app.post("/api/login")
    async def login(request: Request, response: Response):
        check_origin(request)
        data = await read_json(request, 4096)
        email, password = data.get("email"), data.get("password")
        if not valid_email(email) or not isinstance(password, str) or not 1 <= len(password) <= 256:
            raise HTTPException(422, "Invalid credentials")
        if any(0xD800 <= ord(char) <= 0xDFFF for char in email + password):
            raise HTTPException(422, "Invalid credentials")
        email = await run_in_threadpool(authenticate, email.strip().lower(), password, request.client.host)
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        now = int(time.time())
        with database(path, write=True) as db:
            db.execute("DELETE FROM sessions WHERE expires<=?", (now,))
            previous = request.cookies.get(COOKIE, "")
            if len(previous) == 43 and previous.isascii():
                db.execute("DELETE FROM sessions WHERE token=?", (token_hash(previous),))
            db.execute("INSERT INTO sessions VALUES (?, ?, ?, ?)", (token_hash(token), email, csrf, now + SESSION_AGE))
        response.set_cookie(COOKIE, token, max_age=SESSION_AGE, secure=True, httponly=True, samesite="strict", path="/")
        return {"email": email, "csrf": csrf}

    @app.get("/api/me")
    def me(request: Request):
        row = session(request)
        return {"email": row["email"], "csrf": row["csrf"]}

    @app.post("/api/logout")
    def logout(request: Request, response: Response):
        row = session(request, mutate=True)
        with database(path, write=True) as db:
            db.execute("DELETE FROM sessions WHERE token=?", (row["token"],))
        response.delete_cookie(COOKIE, secure=True, httponly=True, samesite="strict", path="/")
        return {"ok": True}

    @app.get("/api/records")
    def get_records(request: Request):
        owner = session(request, bind=True)["email"]
        with database(path) as db:
            db.execute("BEGIN")
            return snapshot(db, owner)

    @app.put("/api/records")
    async def put_records(request: Request):
        active = session(request, mutate=True)
        data = await read_json(request, MAX_BODY)
        revision, orders = data.get("revision"), data.get("orders")
        if type(revision) is not int or not 0 <= revision < 2**63 - 1:
            raise HTTPException(422, "Invalid revision")

        def save():
            validate_orders(orders)
            with database(path, write=True) as db:
                # The request body may have been in flight when another tab logged out.
                current = db.execute("SELECT 1 FROM sessions WHERE token=? AND email=? AND expires>?",
                                     (active["token"], active["email"], int(time.time()))).fetchone()
                if current is None:
                    raise HTTPException(401, "Sign in required")
                return replace_orders(db, active["email"], revision, orders)

        return await run_in_threadpool(save)

    return app


def from_env():
    path = os.environ["DATABASE_PATH"]
    writer = None
    if os.getenv("WORKSPACE_SHEETS_ENABLED") == "true":
        from backend.sheets import SheetWriter
        config = json.loads(Path(os.environ["WORKSPACE_SHEETS_CONFIG"]).read_text(encoding="utf-8"))
        token_file = Path(config["token_file"])
        writer = SheetWriter(path, config["spreadsheet"], config["tab"], config["headers"],
                             config["actors"], lambda: token_file.read_text(encoding="utf-8").strip())
    return create_app(path, os.environ["APP_ORIGIN"], writer)


def backup(path, target):
    target = database_path(target)
    if not path.is_file():
        raise ValueError("Database does not exist")
    target.touch(mode=0o600, exist_ok=False)
    try:
        with closing(connect(path)) as source, closing(connect(target)) as destination:
            source.backup(destination)
    except BaseException:
        target.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("add-user").add_argument("email")
    commands.add_parser("backup").add_argument("target")
    args = parser.parse_args()
    path = database_path(os.environ["DATABASE_PATH"])
    if args.command == "add-user":
        initialize(path)
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Repeat password: "):
            parser.error("Passwords differ")
        try:
            add_user(path, args.email, password)
        except ValueError as error:
            parser.error(str(error))
    else:
        backup(path, args.target)
