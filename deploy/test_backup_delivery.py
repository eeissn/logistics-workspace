from datetime import datetime, timedelta, timezone
from pathlib import Path
import shutil
import sqlite3
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from deploy.backup_delivery import NAME, publish, retrieve


class LocalOutbox:
    def __init__(self, path):
        self.path = path

    def list_backups(self):
        return [path.name for path in self.path.iterdir()]

    def download(self, name, directory):
        for path in (self.path / name).iterdir():
            shutil.copyfile(path, directory / path.name)


@unittest.skipUnless(shutil.which("openssl"), "OpenSSL is required")
class BackupDeliveryTest(unittest.TestCase):
    def test_encrypted_round_trip_freshness_corruption_and_rotation(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            outbox = root / "outbox"
            outbox.mkdir()
            destination = root / "download"
            certificate = root / "test.pem"
            key = root / "test.key"
            source = root / "snapshot.sqlite3"
            with sqlite3.connect(source) as db:
                db.execute("CREATE TABLE example (value TEXT)")
                db.execute("INSERT INTO example VALUES ('synthetic')")
            db.close()
            subprocess.run(
                ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                 "-subj", "/CN=backup-test", "-keyout", str(key), "-out", str(certificate)],
                check=True, capture_output=True,
            )
            now = datetime(2026, 11, 14, 6, tzinfo=timezone.utc)
            fresh = timedelta(hours=36)
            retention = timedelta(days=45)
            remote = LocalOutbox(outbox)
            args = SimpleNamespace(source=source, certificate=certificate, outbox=outbox,
                                   snapshot_utc="20261113T230000Z", openssl="openssl")
            publish(args)
            with self.assertRaises(FileExistsError):
                publish(args)
            name, existing = retrieve(remote, destination, now, fresh, retention)
            self.assertTrue(NAME.fullmatch(name))
            self.assertFalse(existing)
            self.assertTrue(retrieve(remote, destination, now, fresh, retention)[1])
            restored = root / "restore.sqlite3"
            subprocess.run(
                ["openssl", "cms", "-decrypt", "-binary", "-inform", "DER", "-in", str(destination / name),
                 "-recip", str(certificate), "-inkey", str(key), "-out", str(restored)],
                check=True, capture_output=True,
            )
            with sqlite3.connect(restored) as db:
                self.assertEqual(db.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
                self.assertEqual(db.execute("SELECT value FROM example").fetchall(), [("synthetic",)])
            db.close()
            with self.assertRaisesRegex(ValueError, "freshness"):
                retrieve(remote, destination, now + timedelta(days=2), fresh, retention)
            with self.assertRaisesRegex(ValueError, "freshness"):
                retrieve(remote, destination, now - timedelta(days=2), fresh, retention)
            old = "workspace-20260901T000000Z.cms"
            shutil.copyfile(destination / name, destination / old)
            shutil.copyfile(destination / name, destination / "workspace-20260902T000000Z.cms")
            receipts = destination / ".verified"
            shutil.copyfile(receipts / Path(name).with_suffix(".json"), receipts / Path(old).with_suffix(".json"))
            retrieve(remote, destination, now, fresh, retention)
            self.assertFalse((destination / old).exists())
            self.assertTrue((destination / "workspace-20260902T000000Z.cms").exists())
            with (outbox / name / name).open("ab") as archive:
                archive.write(b"corruption")
            rejected = root / "rejected"
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                retrieve(remote, rejected, now, fresh, retention)
            self.assertFalse((rejected / name).exists())
            self.assertEqual(list(rejected.glob(".download-*")), [])
