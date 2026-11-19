"""Strict, owner-scoped personal registry views and independent optimistic revisions."""
import json

from fastapi import HTTPException


SAVED_VIEWS_SCHEMA = """CREATE TABLE IF NOT EXISTS saved_views (
    owner TEXT PRIMARY KEY NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    revision INTEGER NOT NULL, payload TEXT NOT NULL)"""
FIELDS = {"name", "scope", "view", "etrn", "financial", "sort", "ascending"}
CHOICES = {
    "scope": {"active", "history"},
    "view": {"all", "not-unloaded", "planned", "loaded", "completed", "failed", "pickup", "delivery"},
    "etrn": {"", "pending", "Подписана", "Закрыта вручную", "Не требуется"},
    "financial": {"", "issues", "loss", "low", "unknown"},
    "sort": {"delivery", "pickup", "date", "number", "customer", "carrier", "route", "trip", "etrn"},
}


def validate_saved_views(views):
    if not isinstance(views, list) or len(views) > 25:
        raise HTTPException(422, "Invalid saved views")
    names = set()
    for view in views:
        if not isinstance(view, dict) or set(view) != FIELDS:
            raise HTTPException(422, "Invalid saved view fields")
        name = view["name"]
        if (not isinstance(name, str) or not 1 <= len(name) <= 45 or
                name != name.strip() or any(ord(c) < 32 or 0xD800 <= ord(c) <= 0xDFFF for c in name) or
                name.lower() in names or type(view["ascending"]) is not bool):
            raise HTTPException(422, "Invalid saved view name or direction")
        names.add(name.lower())
        for field, choices in CHOICES.items():
            if not isinstance(view[field], str) or view[field] not in choices:
                raise HTTPException(422, "Invalid saved view rule")


def saved_views_snapshot(db, owner):
    row = db.execute("SELECT revision, payload FROM saved_views WHERE owner=?", (owner,)).fetchone()
    return {"revision": row["revision"], "views": json.loads(row["payload"])} if row else {
        "revision": 0, "views": []}


def replace_saved_views(db, owner, revision, views):
    current = saved_views_snapshot(db, owner)
    if current["revision"] != revision:
        raise HTTPException(409, "Saved views changed")
    if current["views"] == views:
        return current
    payload = json.dumps(views, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    db.execute("""INSERT INTO saved_views(owner, revision, payload) VALUES (?, ?, ?)
        ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision, payload=excluded.payload""",
               (owner, revision + 1, payload))
    return {"revision": revision + 1, "views": views}


def verify_saved_views_schema(db):
    """Accept the retained additive table during a tested schema-marker rollback."""
    columns = [(row[1], row[2].upper(), row[3], row[5])
               for row in db.execute("PRAGMA table_info(saved_views)")]
    expected = [("owner", "TEXT", 1, 1), ("revision", "INTEGER", 1, 0),
                ("payload", "TEXT", 1, 0)]
    references = list(db.execute("PRAGMA foreign_key_list(saved_views)"))
    if (columns != expected or len(references) != 1 or
            tuple(references[0][2:7]) != ("users", "owner", "email", "NO ACTION", "CASCADE")):
        raise RuntimeError("Unsupported saved views table schema")
