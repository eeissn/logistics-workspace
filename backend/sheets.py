"""Opt-in Sheets append transport and durable duplicate protection."""

from contextlib import closing
import hashlib
import json
import re
import sqlite3
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import HTTPException


FIELDS = ("number", "title", "amount", "actor", "requested", "promised")
MAX_RESPONSE_BYTES = 8 * 1024 * 1024


class SheetWriter:
    def __init__(self, path, spreadsheet, tab, headers, actors, token, transport=urlopen):
        if not re.fullmatch(r"[\w-]+", spreadsheet) or not tab or len(headers) != len(FIELDS):
            raise ValueError("Invalid Google Sheets destination")
        if set(headers.values()) != set(FIELDS):
            raise ValueError("Map each Sheets field once using the exact header order")
        self.path, self.actors, self.token, self.transport = path, actors, token, transport
        self.headers = headers
        self.destination = (spreadsheet, tab)
        self.guard_key = None
        safe_tab = "'" + tab.replace("'", "''") + "'"
        self.base = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet}/values/"
        self.header_url = self.base + quote(safe_tab + "!A1:F1", safe="")
        self.append_url = self.base + quote(safe_tab + "!A1:F", safe="") + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS"
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS sheets_delivery (digest TEXT PRIMARY KEY, sent INTEGER NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS sheets_destination_guard (destination TEXT PRIMARY KEY, digest TEXT NOT NULL)")

    def request(self, url, token, values=None):
        body = None if values is None else json.dumps({"values": [values]}).encode()
        return self.request_json(url, token, body)

    def request_json(self, url, token, body=None):
        """Transport shared by values.append and opt-in structured batch writers."""
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode()
        request = Request(url, data=body, headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with self.transport(request, timeout=15) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("Sheets response exceeds safe size")
        return json.loads(raw)

    def prepare(self, token, data):
        header = self.request(self.header_url, token)
        if header.get("values") != [list(self.headers)]:
            raise HTTPException(503, "Sheets headers changed")
        return [data[field] for field in self.headers.values()]

    def deliver(self, token, plan):
        result = self.request(self.append_url, token, plan)
        if result.get("spreadsheetId") != self.destination[0] or result.get("updates", {}).get("updatedRows") != 1:
            raise ValueError("Unconfirmed append")

    def acquire_guard(self, digest):
        if self.guard_key is None:
            return
        with closing(sqlite3.connect(self.path)) as db, db:
            if not db.execute("INSERT OR IGNORE INTO sheets_destination_guard VALUES (?, ?)",
                              (self.guard_key, digest)).rowcount:
                raise HTTPException(425, "Sheets destination busy or requires reconciliation")

    def release_guard(self, digest):
        if self.guard_key is not None:
            with closing(sqlite3.connect(self.path)) as db, db:
                db.execute("DELETE FROM sheets_destination_guard WHERE destination=? AND digest=?",
                           (self.guard_key, digest))

    def __call__(self, email, row):
        actor = self.actors.get(email)
        if not actor:
            raise HTTPException(403, "Account is not enabled for Sheets")
        if row is None:
            return {"actor": actor, "mode": "live"}
        data = {**row, "actor": actor, "amount": float(row["amount"])}
        identity = [self.destination, email, [data[key] for key in FIELDS]]
        digest = hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()
        with closing(sqlite3.connect(self.path)) as db, db:
            existing = db.execute("SELECT sent FROM sheets_delivery WHERE digest=?", (digest,)).fetchone()
        if existing:
            return self.existing(actor, existing[0])
        self.acquire_guard(digest)
        try:
            token = self.token()
            plan = self.prepare(token, data)
        except HTTPException:
            self.release_guard(digest)
            raise
        except Exception as error:
            self.release_guard(digest)
            raise HTTPException(503, "Sheets preflight failed") from error

        with closing(sqlite3.connect(self.path)) as db, db:
            claimed = db.execute("INSERT OR IGNORE INTO sheets_delivery VALUES (?, 0)", (digest,)).rowcount
            if not claimed:
                sent = db.execute("SELECT sent FROM sheets_delivery WHERE digest=?", (digest,)).fetchone()[0]
        if not claimed:
            self.release_guard(digest)
            return self.existing(actor, sent)
        try:
            # A prepared None means a verified exact row already exists remotely.
            if plan is not None:
                self.deliver(token, plan)
        except Exception as error:
            # An append can reach Google even when the response is lost.
            # Structured writers also retain a destination-wide guard indefinitely.
            raise HTTPException(502, "Sheets delivery requires reconciliation") from error
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE sheets_delivery SET sent=1 WHERE digest=?", (digest,))
            if self.guard_key is not None:
                db.execute("DELETE FROM sheets_destination_guard WHERE destination=? AND digest=?",
                           (self.guard_key, digest))
        return {"actor": actor, "duplicate": plan is None}

    @staticmethod
    def existing(actor, sent):
        if not sent:
            raise HTTPException(425, "Sheets delivery pending or requires reconciliation")
        return {"actor": actor, "duplicate": True}
