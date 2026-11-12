from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient

from backend.app import MAX_BODY, add_user, backup, create_app, database, initialize

ORIGIN = "https://workspace.test"
PASSWORD = "test-password-unique"


def order(number="7123"):
    return {
        "number": number,
        "customerAmount": 90000, "customerTax": "22",
        "carrierAmount": 65000, "carrierTax": "0",
        "points": [{"kind": "Погрузка", "address": "Тест", "schedule": "10.11.2026", "contacts": ["+70000000001"]}],
        "contacts": [{"role": "Водитель", "values": ["+70000000002"]}],
        "differences": [{"field": "Дата заявки", "carrier": "10.11.2026"}],
        "payment": {"edo": 5}, "trip": {"stage": "unloaded"},
        "etrn": {"number": number, "required": True, "created": True},
    }


class WorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.resources = ExitStack()
        cls.path = Path(cls.resources.enter_context(TemporaryDirectory())) / "workspace.sqlite3"
        cls.app = create_app(cls.path, ORIGIN)
        add_user(cls.path, "first@example.test", PASSWORD)
        add_user(cls.path, "second@example.test", PASSWORD)

    @classmethod
    def tearDownClass(cls):
        cls.resources.close()

    def setUp(self):
        with database(self.path, write=True) as db:
            db.execute("DELETE FROM sessions")
            db.execute("DELETE FROM login_attempts")
            db.execute("DELETE FROM orders")
            db.execute("UPDATE registry SET revision=0")
        self.first = self.enterContext(TestClient(self.app, base_url=ORIGIN))
        self.second = self.enterContext(TestClient(self.app, base_url=ORIGIN))

    def login(self, client, name="first", password=PASSWORD):
        return client.post("/api/login", headers={"Origin": ORIGIN},
                           json={"email": name + "@example.test", "password": password})

    def writer(self, client, name="first"):
        response = self.login(client, name)
        self.assertEqual(response.status_code, 200)
        return {"Origin": ORIGIN, "X-CSRF-Token": response.json()["csrf"]}

    def put(self, client, headers, revision, orders):
        return client.put("/api/records", headers=headers, json={"revision": revision, "orders": orders})

    def test_auth_access_control_and_logout(self):
        for path in ("/api/me", "/api/records"):
            self.assertEqual(self.first.get(path).status_code, 401)
        self.assertEqual(self.put(self.first, {}, 0, [order()]).status_code, 401)
        self.assertEqual(self.first.post("/api/login", json={}).status_code, 403)
        self.assertEqual(self.login(self.first, password="incorrect").status_code, 401)
        response = self.login(self.first)
        self.assertEqual(response.status_code, 200)
        for flag in ("HttpOnly", "Secure", "SameSite=strict", "Path=/"):
            self.assertIn(flag, response.headers["set-cookie"])
        self.assertEqual(response.headers["cache-control"], "no-store")
        profile = self.first.get("/api/me").json()
        self.assertEqual(profile["email"], "first@example.test")
        self.assertEqual(self.put(self.first, {"Origin": ORIGIN}, 0, [order()]).status_code, 403)
        self.assertEqual(self.first.post("/api/logout", headers={"X-CSRF-Token": profile["csrf"]}).status_code, 403)
        cookie = self.first.cookies.get("__Host-logistics")
        self.assertEqual(self.first.post("/api/logout", headers={"Origin": ORIGIN, "X-CSRF-Token": profile["csrf"]}).status_code, 200)
        self.second.cookies.set("__Host-logistics", cookie)
        self.assertEqual(self.second.get("/api/records").status_code, 401)

    def test_accounts_use_salted_hashes_and_are_limited_to_two(self):
        with self.assertRaisesRegex(ValueError, "two accounts"):
            add_user(self.path, "third@example.test", PASSWORD)
        with database(self.path) as db:
            first, second = db.execute("SELECT password FROM users").fetchall()
        self.assertNotEqual(first[0], second[0])

    def test_crud_and_sync_with_two_sessions(self):
        first = self.writer(self.first)
        second = self.writer(self.second, "second")
        self.assertEqual(self.put(self.second, first, 0, [order()]).status_code, 403)
        saved = self.put(self.first, first, 0, [{**order(), "updatedAt": "forged"}]).json()
        record = saved["orders"][0]
        self.assertEqual(saved["revision"], 1)
        self.assertNotEqual(record["updatedAt"], "forged")
        self.assertEqual(self.second.get("/api/records").json(), saved)
        added = self.put(self.second, second, 1, [order("7124"), record]).json()
        self.assertEqual(added["orders"][1]["updatedAt"], record["updatedAt"])
        changed = {**record, "etrn": {**record["etrn"], "allSigned": True}}
        updated = self.put(self.second, second, 2, [changed]).json()
        self.assertNotEqual(updated["orders"][0]["updatedAt"], record["updatedAt"])
        self.assertTrue(self.first.get("/api/records").json()["orders"][0]["etrn"]["allSigned"])
        self.assertEqual(self.put(self.first, first, 3, []).json(), {"revision": 4, "orders": []})

    def test_simultaneous_updates_report_conflict(self):
        first = self.writer(self.first)
        second = self.writer(self.second, "second")
        with ThreadPoolExecutor(2) as pool:
            a = pool.submit(self.put, self.first, first, 0, [order("A")])
            b = pool.submit(self.put, self.second, second, 0, [order("B")])
        self.assertEqual(sorted([a.result().status_code, b.result().status_code]), [200, 409])
        winner = a.result() if a.result().status_code == 200 else b.result()
        self.assertEqual(self.first.get("/api/records").json(), winner.json())

    def test_bad_data_size_and_duplicate_numbers(self):
        headers = self.writer(self.first)
        for invalid in ([order(), order()], [{**order(), "contacts": [{"role": "x", "values": "x"}]}], [{"number": "1"}]):
            self.assertEqual(self.put(self.first, headers, 0, invalid).status_code, 422)
        headers["Content-Type"] = "application/json"
        self.assertEqual(self.first.put("/api/records", headers=headers, content=b" " * (MAX_BODY + 1)).status_code, 413)
        self.assertEqual(self.first.get("/api/records").json(), {"revision": 0, "orders": []})

    def test_rate_limit_and_session_expiry(self):
        self.writer(self.first)
        with database(self.path, write=True) as db:
            db.execute("UPDATE sessions SET expires=0")
            db.execute("INSERT INTO login_attempts VALUES ('testclient', 8, 9999999999)")
        self.assertEqual(self.first.get("/api/me").status_code, 401)
        self.assertEqual(self.login(self.first).status_code, 429)

    def test_schema_backup_and_reopen(self):
        headers = self.writer(self.first)
        self.put(self.first, headers, 0, [order()])
        with TemporaryDirectory() as directory:
            path = Path(directory) / "backup.sqlite3"
            backup(self.path, path)
            initialize(path)
            with database(path) as db:
                self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 1)
                self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                self.assertEqual(db.execute("SELECT number FROM orders").fetchone()[0], "7123")
                self.assertEqual(db.execute("SELECT COUNT(*) FROM users").fetchone()[0], 2)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                backup(self.path, path)


if __name__ == "__main__":
    unittest.main()
