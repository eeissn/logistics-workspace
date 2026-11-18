"""Synthetic-only regression tests for self-service password rotation."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import add_user, create_app, database, password_hash

ORIGIN = "https://workspace.test"
FIRST = "first@example.test"
SECOND = "second@example.test"
OLD = "test-password-unique"
NEW = "new-password-another-unique"


class PasswordRotationTests(unittest.TestCase):
    def setUp(self):
        self.folder = TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / "workspace.sqlite3"
        self.app = create_app(self.path, ORIGIN)
        add_user(self.path, FIRST, OLD)
        add_user(self.path, SECOND, OLD)
        self.first = TestClient(self.app, base_url=ORIGIN)
        self.other_device = TestClient(self.app, base_url=ORIGIN)
        self.second = TestClient(self.app, base_url=ORIGIN)
        for client in (self.first, self.other_device, self.second):
            client.__enter__()
            self.addCleanup(client.__exit__, None, None, None)

    def login(self, client, email=FIRST, password=OLD):
        return client.post("/api/login", headers={"Origin": ORIGIN},
                           json={"email": email, "password": password})

    def headers(self, client, email=FIRST):
        response = self.login(client, email)
        self.assertEqual(response.status_code, 200)
        return {"Origin": ORIGIN, "X-CSRF-Token": response.json()["csrf"]}

    def change(self, client, headers, current=OLD, new=NEW):
        return client.post("/api/password", headers=headers,
                           json={"currentPassword": current, "newPassword": new})

    def test_success_revokes_all_same_owner_sessions_but_not_other_account(self):
        first = self.headers(self.first)
        peer = self.headers(self.other_device)
        second = self.headers(self.second, SECOND)
        self.assertEqual(self.first.put("/api/records", headers=first, json={
            "revision": 0, "orders": [{
                "number": "SAME", "customer": "Owner A", "points": [],
                "contacts": [], "differences": [],
            }],
        }).status_code, 200)
        self.assertEqual(self.second.put("/api/records", headers=second, json={
            "revision": 0, "orders": [{
                "number": "SAME", "customer": "Owner B", "points": [],
                "contacts": [], "differences": [],
            }],
        }).status_code, 200)
        before_b = self.second.get("/api/records", headers=second).json()
        before_a = self.first.get("/api/records", headers=first).json()
        with database(self.path) as db:
            old_hash = db.execute("SELECT password FROM users WHERE email=?", (FIRST,)).fetchone()[0]
        result = self.change(self.first, first)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json(), {"ok": True})
        self.assertIn("Max-Age=0", result.headers["set-cookie"])
        self.assertEqual(self.first.get("/api/me").status_code, 401)
        self.assertEqual(self.other_device.get("/api/me").status_code, 401)
        self.assertEqual(self.other_device.put("/api/records", headers=peer, json={
            "revision": 1, "orders": [],
        }).status_code, 401)
        self.assertEqual(self.login(self.first, password=OLD).status_code, 401)
        self.assertEqual(self.login(self.first, password=NEW).status_code, 200)
        refreshed = self.first.get("/api/records", headers={
            "X-CSRF-Token": self.first.get("/api/me").json()["csrf"]
        })
        self.assertEqual(refreshed.json(), before_a)
        self.assertEqual(self.second.get("/api/records", headers=second).json(), before_b)
        with database(self.path) as db:
            new_hash = db.execute("SELECT password FROM users WHERE email=?", (FIRST,)).fetchone()[0]
            self.assertNotEqual(new_hash, old_hash)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM sessions WHERE email=?", (SECOND,)).fetchone()[0], 1)
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 2)

    def test_csrf_origin_payload_and_password_policy(self):
        self.assertEqual(self.change(self.first, {}).status_code, 401)
        first = self.headers(self.first)
        self.assertEqual(self.change(self.first, {"X-CSRF-Token": first["X-CSRF-Token"]}).status_code, 403)
        self.assertEqual(self.change(self.first, {"Origin": ORIGIN}).status_code, 403)
        for payload in (
            {}, {"currentPassword": OLD}, {"currentPassword": OLD, "newPassword": NEW, "owner": SECOND},
            {"currentPassword": OLD, "newPassword": "short"},
            {"currentPassword": OLD, "newPassword": OLD},
            {"currentPassword": OLD, "newPassword": 13},
            {"currentPassword": OLD, "newPassword": "a" * 257},
        ):
            with self.subTest(payload=payload):
                response = self.first.post("/api/password", headers=first, json=payload)
                self.assertEqual(response.status_code, 422)
        self.assertEqual(self.first.get("/api/me").status_code, 200)
        self.assertEqual(self.login(self.first).status_code, 200)

    def test_wrong_current_password_throttled_and_second_account_untouched(self):
        first = self.headers(self.first)
        second = self.headers(self.second, SECOND)
        for _ in range(5):
            self.assertEqual(self.change(self.first, first, current="wrong-password").status_code, 403)
        response = self.change(self.first, first)
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["retry-after"], "900")
        self.assertEqual(self.second.get("/api/me").status_code, 200)
        self.assertEqual(self.second.get("/api/records", headers=second).status_code, 200)

    def test_in_flight_password_change_cannot_commit_after_logout(self):
        from backend import app as backend_app
        first = self.headers(self.first)
        real_hash = password_hash
        once = {"called": False}

        def revoke_on_hash(password, salt):
            if not once["called"]:
                once["called"] = True
                with database(self.path, write=True) as db:
                    db.execute("DELETE FROM sessions WHERE csrf=?", (first["X-CSRF-Token"],))
            return real_hash(password, salt)

        with patch.object(backend_app, "password_hash", side_effect=revoke_on_hash):
            self.assertEqual(self.change(self.first, first).status_code, 401)
        self.assertEqual(self.login(self.first, password=OLD).status_code, 200)
        self.assertEqual(self.login(self.first, password=NEW).status_code, 401)


if __name__ == "__main__":
    unittest.main()
