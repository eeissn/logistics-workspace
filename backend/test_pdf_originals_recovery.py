"""Synthetic two-account PDF originals through CMS publish/download/decrypt/restore.

This is a recovery acceptance PROTOTYPE, not proof of delivery to a home PC.
Uses disposable files and disposable OpenSSL key/certificate only.
"""
from datetime import datetime, timedelta, timezone
import hashlib
from pathlib import Path
import shutil
import sqlite3
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from backend.app import backup
from deploy.backup_delivery import publish, retrieve


class LocalOutbox:
    def __init__(self, root):
        self.root = root

    def list_backups(self):
        return [entry.name for entry in self.root.iterdir()]

    def download(self, name, destination):
        for path in (self.root / name).iterdir():
            shutil.copyfile(path, destination / path.name)


@unittest.skipUnless(shutil.which("openssl"), "OpenSSL required for CMS recovery")
class OriginalsEncryptedRecoveryTests(unittest.TestCase):
    def test_two_originals_per_owner_survive_encrypted_delivery_and_restore(self):
        with TemporaryDirectory(prefix="lw-originals-cms-test-") as directory:
            root = Path(directory)
            live = root / "synthetic.sqlite3"
            snapshot = root / "snapshot.sqlite3"
            restored = root / "restored.sqlite3"
            cert = root / "test-cert.pem"
            key = root / "test-key.pem"
            outbox, received = root / "outbox", root / "received"
            outbox.mkdir()
            originals = {}
            with sqlite3.connect(live) as db:
                db.execute("""CREATE TABLE originals(
                    owner TEXT NOT NULL, number TEXT NOT NULL,
                    role TEXT NOT NULL, digest TEXT NOT NULL, content BLOB NOT NULL,
                    PRIMARY KEY (owner,number,role))""")
                for owner in ("synthetic-a", "synthetic-b"):
                    for role in ("customer", "carrier"):
                        content = (b"%PDF-1.7\n" +
                                   hashlib.shake_256(f"{owner}:{role}".encode()).digest(2048))
                        digest = hashlib.sha256(content).hexdigest()
                        db.execute("INSERT INTO originals VALUES (?,?,?,?,?)",
                                   (owner, "SAME-001", role, digest, content))
                        originals[(owner, "SAME-001", role)] = digest
            backup(live, snapshot)
            subprocess.run([
                "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                "-subj", "/CN=pdf-originals-synthetic", "-keyout", str(key),
                "-out", str(cert),
            ], check=True, capture_output=True)
            stamp = "20261118T030000Z"
            publish(SimpleNamespace(
                source=snapshot, certificate=cert, outbox=outbox,
                snapshot_utc=stamp, openssl="openssl",
            ))
            name, existing = retrieve(
                LocalOutbox(outbox), received,
                datetime(2026, 11, 18, 8, tzinfo=timezone.utc),
                timedelta(hours=36), timedelta(days=45),
            )
            self.assertFalse(existing)
            self.assertEqual(name, f"workspace-{stamp}.cms")
            subprocess.run([
                "openssl", "cms", "-decrypt", "-binary", "-inform", "DER",
                "-in", str(received / name), "-recip", str(cert),
                "-inkey", str(key), "-out", str(restored),
            ], check=True, capture_output=True)
            self.assertEqual(hashlib.sha256(snapshot.read_bytes()).digest(),
                             hashlib.sha256(restored.read_bytes()).digest())
            with sqlite3.connect(restored) as db:
                self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                rows = db.execute(
                    "SELECT owner,number,role,digest,content FROM originals"
                ).fetchall()
            self.assertEqual(len(rows), 4)
            for owner, number, role, digest, content in rows:
                self.assertEqual(digest, originals[(owner, number, role)])
                self.assertEqual(hashlib.sha256(content).hexdigest(), digest)
            with (outbox / name / name).open("ab") as stream:
                stream.write(b"tamper")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                retrieve(
                    LocalOutbox(outbox), root / "rejected",
                    datetime(2026, 11, 18, 8, tzinfo=timezone.utc),
                    timedelta(hours=36), timedelta(days=45),
                )


if __name__ == "__main__":
    unittest.main()
