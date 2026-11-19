"""Personal view isolation, optimistic writes, migration and recovery on synthetic SQLite."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import (SCHEMA_VERSION, add_user, backup, create_app, database,
                         initialize)
from backend.saved_views import validate_saved_views
from backend.test_app import ORIGIN, PASSWORD, order


def view(name="My view"):
    return {"name": name, "scope": "history", "view": "all", "etrn": "pending",
            "financial": "low", "sort": "delivery", "ascending": False}


class SavedViewsTests(unittest.TestCase):
    def setUp(self):
        folder = self.enterContext(TemporaryDirectory())
        self.path = Path(folder) / "workspace.sqlite3"
        self.app = create_app(self.path, ORIGIN)
        for owner in ("first", "second"):
            add_user(self.path, owner + "@example.test", PASSWORD)
        self.first = self.enterContext(TestClient(self.app, base_url=ORIGIN))
        self.second = self.enterContext(TestClient(self.app, base_url=ORIGIN))

    def login(self, client, owner="first"):
        response = client.post("/api/login", headers={"Origin": ORIGIN},
                               json={"email": owner + "@example.test", "password": PASSWORD})
        self.assertEqual(response.status_code, 200)
        return {"Origin": ORIGIN, "X-CSRF-Token": response.json()["csrf"]}

    def get(self, client, headers):
        return client.get("/api/saved-views", headers=headers)

    def put(self, client, headers, revision, views):
        return client.put("/api/saved-views", headers={**headers, "Content-Type": "application/json"},
                          content=json.dumps({"revision": revision, "views": views}))

    def test_isolation_other_device_and_independent_registry_revision(self):
        first = self.login(self.first)
        second = self.login(self.second, "second")
        self.assertEqual(self.get(self.first, first).json(), {"revision": 0, "views": []})
        records = self.first.put("/api/records", headers=first,
                                 json={"revision": 0, "orders": [order()]}).json()
        saved = self.put(self.first, first, 0, [view()])
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json(), {"revision": 1, "views": [view()]})
        self.assertEqual(self.first.get("/api/records", headers=first).json(), records)
        self.assertEqual(self.get(self.second, second).json(), {"revision": 0, "views": []})
        other = self.put(self.second, second, 0, [view("Second's view")]).json()
        self.assertEqual(other["revision"], 1)
        self.assertEqual(self.get(self.first, first).json(), saved.json())
        with TestClient(self.app, base_url=ORIGIN) as device:
            headers = self.login(device)
            self.assertEqual(self.get(device, headers).json(), saved.json())
            self.assertEqual(self.put(device, headers, 1, []).json(), {"revision": 2, "views": []})
        self.assertEqual(self.get(self.first, first).json(), {"revision": 2, "views": []})
        self.assertEqual(self.get(self.second, second).json(), other)

    def test_auth_csrf_origin_and_owner_injection(self):
        self.assertEqual(self.first.get("/api/saved-views").status_code, 401)
        self.assertEqual(self.put(self.first, {}, 0, []).status_code, 401)
        headers = self.login(self.first)
        self.assertEqual(self.first.get("/api/saved-views").status_code, 401)
        self.assertEqual(self.put(self.first, {"Origin": ORIGIN}, 0, [view()]).status_code, 403)
        self.assertEqual(self.put(self.first, {**headers, "Origin": "https://foreign.test"}, 0, []).status_code, 403)
        self.assertEqual(self.put(self.first, {**headers, "X-CSRF-Token": "wrong"}, 0, []).status_code, 403)
        result = self.first.put("/api/saved-views", headers=headers,
                                json={"revision": 0, "views": [], "owner": "second@example.test"})
        self.assertEqual(result.status_code, 422)

    def test_validation_and_bounded_body(self):
        headers = self.login(self.first)
        invalid = [None, {}, [None], [view(), view("MY VIEW")],
                   [view(str(index)) for index in range(26)],
                   [{**view(), "name": " "}], [{**view(), "name": "a" * 46}],
                   [{**view(), "name": "bad\nname"}], [{**view(), "name": "\ud800"}],
                   [{**view(), "ascending": 1}], [{**view(), "query": "not allowed"}]]
        for key in ("scope", "view", "etrn", "financial", "sort"):
            invalid.extend([[{**view(), key: "__proto__"}], [{**view(), key: []}]])
        for values in invalid:
            with self.subTest(values=repr(values)):
                self.assertEqual(self.put(self.first, headers, 0, values).status_code, 422)
        for revision in (True, -1, 1.5, "0", 2**63 - 1):
            with self.subTest(revision=revision):
                self.assertEqual(self.put(self.first, headers, revision, []).status_code, 422)
        response = self.first.put("/api/saved-views", headers={**headers, "Content-Type": "application/json"},
                                  content='{"revision":0,"views":[]}' + " " * 16384)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.get(self.first, headers).json(), {"revision": 0, "views": []})
        maximum = [view(str(index)) for index in range(25)]
        self.assertEqual(self.put(self.first, headers, 0, maximum).json()["views"], maximum)

    def test_conflict_concurrent_writes_and_noop(self):
        headers = self.login(self.first)
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda name: self.put(self.first, headers, 0, [view(name)]),
                                        ("Device A", "Device B")))
        self.assertEqual(sorted(response.status_code for response in results), [200, 409])
        current = self.get(self.first, headers).json()
        self.assertEqual(current["revision"], 1)
        self.assertEqual(self.put(self.first, headers, 1, current["views"]).json(), current)
        self.assertEqual(self.put(self.first, headers, 0, []).status_code, 409)

    def test_session_revoked_while_put_is_in_flight(self):
        headers = self.login(self.first)

        def revoke(views):
            validate_saved_views(views)
            with database(self.path, write=True) as db:
                db.execute("DELETE FROM sessions WHERE email=?", ("first@example.test",))

        with patch("backend.app.validate_saved_views", side_effect=revoke):
            self.assertEqual(self.put(self.first, headers, 0, [view()]).status_code, 401)
        with database(self.path) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM saved_views").fetchone()[0], 0)

    def test_version_two_upgrade_preserves_accounts_records_sessions_and_backup(self):
        first = self.login(self.first)
        second = self.login(self.second, "second")
        self.first.put("/api/records", headers=first, json={"revision": 0, "orders": [order()]}).raise_for_status()
        records = self.first.get("/api/records", headers=first).json()
        with database(self.path, write=True) as db:
            before = [tuple(row) for row in db.execute("SELECT * FROM users ORDER BY email")]
            db.execute("DROP TABLE saved_views")
            db.execute("PRAGMA user_version=2")
        initialize(self.path)
        initialize(self.path)
        self.assertEqual(self.first.get("/api/records", headers=first).json(), records)
        self.assertEqual(self.get(self.second, second).json(), {"revision": 0, "views": []})
        self.put(self.first, first, 0, [view()]).raise_for_status()
        self.put(self.second, second, 0, [view("Other")]).raise_for_status()
        restored = self.path.with_name("restored.sqlite3")
        backup(self.path, restored)
        initialize(restored)
        with database(restored) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], SCHEMA_VERSION)
            self.assertEqual([tuple(row) for row in db.execute("SELECT * FROM users ORDER BY email")], before)
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        restored_app = create_app(restored, ORIGIN)
        with TestClient(restored_app, base_url=ORIGIN) as client:
            headers = self.login(client)
            self.assertEqual(self.get(client, headers).json(), {"revision": 1, "views": [view()]})
            self.assertEqual(client.get("/api/records", headers=headers).json(), records)
            headers = self.login(client, "second")
            self.assertEqual(self.get(client, headers).json(), {"revision": 1, "views": [view("Other")]})


if __name__ == "__main__":
    unittest.main()
