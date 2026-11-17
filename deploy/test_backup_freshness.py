from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from deploy.check_backup_freshness import verify_latest


class BackupFreshnessAuditTest(unittest.TestCase):
    def test_reports_fresh_verified_archive_without_modifying_any_files(self):
        with TemporaryDirectory() as temp:
            folder = Path(temp)
            receipts = folder / ".verified"
            receipts.mkdir()
            name = "workspace-20261118T000000Z.cms"
            archive = folder / name
            archive.write_bytes(b"encrypted-test-data")
            manifest = receipts / name.replace(".cms", ".json")
            manifest.write_text(json.dumps({
                "size": archive.stat().st_size,
                "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()
            }), encoding="ascii")
            now = datetime(2026, 11, 18, 6, tzinfo=timezone.utc)
            before = {p.relative_to(folder): p.read_bytes() for p in folder.rglob("*") if p.is_file()}
            self.assertEqual(verify_latest(folder, now)[0], name)
            after = {p.relative_to(folder): p.read_bytes() for p in folder.rglob("*") if p.is_file()}
            self.assertEqual(before, after)
            with self.assertRaisesRegex(ValueError, "stale"):
                verify_latest(folder, now + timedelta(days=3))
            archive.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                verify_latest(folder, now)
            archive.unlink()
            with self.assertRaisesRegex(ValueError, "missing"):
                verify_latest(folder, now)

    def test_missing_receipts_and_future_timestamps_are_rejected(self):
        with TemporaryDirectory() as temp:
            folder = Path(temp)
            now = datetime(2026, 11, 18, tzinfo=timezone.utc)
            with self.assertRaisesRegex(ValueError, "receipt directory"):
                verify_latest(folder, now)
            (folder / ".verified").mkdir()
            with self.assertRaisesRegex(ValueError, "No verified"):
                verify_latest(folder, now)
            (folder / ".verified" / "workspace-20261119T000000Z.json").write_text("{}")
            with self.assertRaisesRegex(ValueError, "future"):
                verify_latest(folder, now)

    def test_latest_archive_cannot_be_hidden_by_older_valid_one(self):
        with TemporaryDirectory() as temp:
            folder = Path(temp)
            receipts = folder / ".verified"
            receipts.mkdir()
            now = datetime(2026, 11, 18, 8, tzinfo=timezone.utc)
            for day in (17, 18):
                name = f"workspace-202611{day:02d}T000000Z"
                archive = folder / f"{name}.cms"
                archive.write_bytes(b"encrypted-test-data")
                digest = hashlib.sha256(archive.read_bytes()).hexdigest()
                (receipts / f"{name}.json").write_text(
                    json.dumps({"size": archive.stat().st_size, "sha256": digest}))
            (folder / "workspace-20261118T000000Z.cms").write_bytes(b"broken")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                verify_latest(folder, now)
