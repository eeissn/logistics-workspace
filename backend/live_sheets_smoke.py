"""Explicit opt-in live test; hard-bound to the owner's synthetic spreadsheet.

Never runs under unittest discovery. Credentials and temporary SQLite stay outside
the checkout. Two synthetic rows remain as evidence; no cleanup or production I/O.
"""
import argparse
from datetime import date
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from urllib.parse import urlencode

from fastapi.testclient import TestClient

from backend.app import add_user, create_app
from backend.payments_sheet import PaymentsSheetWriter, payment_formulas
from backend.sheets_auth import token_provider

TEST_SPREADSHEET = "1VqmjA3hOEB_9BSn0s4Hdy4DYqAvDKJ8FD1pHK-alq-o"
TEST_TAB = "Workspace API 20261119"
TEST_SHEET_ID = 60261119
ORIGIN = "https://workspace.test"


def run(key_file, run_id):
    if not re.fullmatch(r"[A-Za-z0-9-]{1,24}", run_id):
        raise ValueError("Use a short synthetic run identifier")
    token = token_provider({"service_account_file": str(Path(key_file).resolve())})
    actors = {"first@example.test": "Герман", "second@example.test": "Марина"}
    today = date.today().isoformat()
    with TemporaryDirectory(prefix="workspace-live-sheets-") as folder:
        db = Path(folder) / "synthetic.sqlite3"

        def writer():
            return PaymentsSheetWriter(db, TEST_SPREADSHEET, TEST_TAB, TEST_SHEET_ID,
                                       actors, token, coordinated_writes=True)

        sender = writer()
        app = create_app(db, ORIGIN, sender)
        for email in actors:
            add_user(db, email, "synthetic-only-password")
        rows = []
        for index, (email, actor) in enumerate(actors.items(), 1):
            row = {"number": f"QA-OAUTH-{run_id}-{index}", "title": "=1+1",
                   "amount": "12.50", "requested": today, "promised": today}
            with TestClient(app, base_url=ORIGIN) as client:
                assert client.get("/api/sheet-preview").status_code == 401
                login = client.post("/api/login", headers={"Origin": ORIGIN},
                                    json={"email": email, "password": "synthetic-only-password"})
                assert login.status_code == 200
                headers = {"Origin": ORIGIN, "X-CSRF-Token": login.json()["csrf"]}
                assert client.get("/api/sheet-preview", headers=headers).json() == {"actor": actor, "mode": "live"}
                assert client.post("/api/sheet-preview", headers=headers,
                                   json={**row, "actor": "forged"}).status_code == 422
                assert client.post("/api/sheet-preview", json=row).status_code == 403
                result = client.post("/api/sheet-preview", headers=headers, json=row)
                assert result.status_code == 200, (result.status_code, result.text)
                assert result.json()["actor"] == actor
                retry = client.post("/api/sheet-preview", headers=headers, json=row)
                assert retry.status_code == 200 and retry.json() == {"actor": actor, "duplicate": True}
            # Recreating the writer preserves durable duplicate receipts.
            assert writer()(email, row) == {"actor": actor, "duplicate": True}
            rows.append((email, actor, row))

        remote = sender.read_rows(token(), 1, sender.metadata(token())[0], "U")
        assert remote[0]["values"][18]["userEnteredValue"] == {"stringValue": "QA service sentinel"}
        positions = []
        for email, actor, row in rows:
            found = [(i, item) for i, item in enumerate(remote, 1)
                     if item.get("values", [{}])[0].get("userEnteredValue") == {"stringValue": row["number"]}]
            assert len(found) == 1
            position, item = found[0]
            cells = item["values"]
            assert cells[1]["userEnteredValue"] == {"stringValue": "=1+1"}
            assert cells[2]["userEnteredValue"] == {"numberValue": 12.5}
            assert cells[4]["userEnteredValue"] == {"stringValue": actor}
            for col, formula in payment_formulas(position).items():
                assert cells[col]["userEnteredValue"] == {"formulaValue": formula}
            # Fresh receipt database still detects the exact remote row.
            fresh = PaymentsSheetWriter(Path(folder) / f"fresh-{position}.sqlite3", TEST_SPREADSHEET,
                                        TEST_TAB, TEST_SHEET_ID, actors, token, coordinated_writes=True)
            assert fresh(email, row) == {"actor": actor, "duplicate": True}
            positions.append(position)
        # Inspect real Google-calculated values and copied validation, not mocks.
        params = {"ranges": f"'{TEST_TAB}'!A1:S{max(positions)}", "includeGridData": "true",
                  "fields": "spreadsheetId,sheets(properties(sheetId,title),data(rowData(values(effectiveValue,formattedValue,dataValidation))))"}
        detailed = sender.select_sheet(sender.request_json(sender.document_url + "?" + urlencode(params), token()))
        detail_rows = detailed["data"][0]["rowData"]
        for position in positions:
            cells = detail_rows[position - 1]["values"]
            assert cells[1]["effectiveValue"] == {"stringValue": "=1+1"}
            assert cells[8]["formattedValue"] == date.fromisoformat(today).strftime("%d.%m.%Y")
            assert cells[11]["formattedValue"] == cells[8]["formattedValue"]
            assert cells[4]["dataValidation"]["condition"]["type"] == "ONE_OF_LIST"
            for column in (5, 6, 7):
                assert cells[column]["dataValidation"]["condition"]["type"] == "BOOLEAN"
            for column in (9, 10):
                assert "numberValue" in cells[column]["effectiveValue"]
        print(json.dumps({"ok": True, "test_sheet_id": TEST_SHEET_ID,
                          "rows": positions, "accounts": 2, "duplicate_checks": 6,
                          "production_accessed": False}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--allow-test-writes", required=True, action="store_true")
    args = parser.parse_args()
    run(args.key_file, args.run_id)
