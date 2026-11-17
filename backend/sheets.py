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


class SheetWriter:
    def __init__(self, path, spreadsheet, tab, headers, actors, token, transport=urlopen):
        if not re.fullmatch(r"[\w-]+", spreadsheet) or not tab or len(headers) != len(FIELDS):
            raise ValueError("Invalid Google Sheets destination")
        if set(headers.values()) != set(FIELDS):
            raise ValueError("Map each Sheets field once using the exact header order")
        self.path, self.actors, self.token, self.transport = path, actors, token, transport
        self.headers = headers
        self.destination = (spreadsheet, tab)
        safe_tab = "'" + tab.replace("'", "''") + "'"
        self.base = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet}/values/"
        self.header_url = self.base + quote(safe_tab + "!A1:F1", safe="")
        self.append_url = self.base + quote(safe_tab + "!A1:F", safe="") + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS"
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS sheets_delivery (digest TEXT PRIMARY KEY, sent INTEGER NOT NULL)")

    def request(self, url, token, values=None):
        body = None if values is None else json.dumps({"values": [values]}).encode()
        request = Request(url, data=body, headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with self.transport(request, timeout=15) as response:
            return json.load(response)

    def __call__(self, email, row):
        actor = self.actors.get(email)
        if not actor:
            raise HTTPException(403, "Account is not enabled for Sheets")
        if row is None:
            return {"actor": actor, "mode": "live"}
        data = {**row, "actor": actor, "amount": float(row["amount"])}
        values = [data[field] for field in self.headers.values()]
        identity = [self.destination, email, [data[key] for key in FIELDS]]
        digest = hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()
        with closing(sqlite3.connect(self.path)) as db, db:
            existing = db.execute("SELECT sent FROM sheets_delivery WHERE digest=?", (digest,)).fetchone()
        if existing:
            return self.existing(actor, existing[0])
        try:
            token = self.token()
            header = self.request(self.header_url, token)
            if header.get("values") != [list(self.headers)]:
                raise HTTPException(503, "Sheets headers changed")
        except (OSError, ValueError, AttributeError) as error:
            raise HTTPException(503, "Sheets preflight failed") from error

        with closing(sqlite3.connect(self.path)) as db, db:
            claimed = db.execute("INSERT OR IGNORE INTO sheets_delivery VALUES (?, 0)", (digest,)).rowcount
            if not claimed:
                sent = db.execute("SELECT sent FROM sheets_delivery WHERE digest=?", (digest,)).fetchone()[0]
                return self.existing(actor, sent)
        try:
            result = self.request(self.append_url, token, values)
            if result.get("spreadsheetId") != self.destination[0] or result.get("updates", {}).get("updatedRows") != 1:
                raise ValueError("Unconfirmed append")
        except (OSError, ValueError, AttributeError) as error:
            # An append can reach Google even when the response is lost.
            raise HTTPException(502, "Sheets delivery requires reconciliation") from error
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE sheets_delivery SET sent=1 WHERE digest=?", (digest,))
        return {"actor": actor, "duplicate": False}

    @staticmethod
    def existing(actor, sent):
        if not sent:
            raise HTTPException(425, "Sheets delivery pending or requires reconciliation")
        return {"actor": actor, "duplicate": True}
