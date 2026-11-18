import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from deploy.check_backup_outbox import main, verify_published


class PublishedBackupAuditTest(unittest.TestCase):
    def published(self, root, stamp="20261118T030000Z", payload=b"synthetic-encrypted-test"):
        name = f"workspace-{stamp}.cms"
        bundle = root / name
        bundle.mkdir()
        (bundle / name).write_bytes(payload)
        (bundle / f"workspace-{stamp}.json").write_text(json.dumps({
            "size": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }), encoding="ascii")
        return bundle, name

    def test_read_only_latest_published_archive(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            older, older_name = self.published(root, "20261117T030000Z")
            latest, name = self.published(root)
            now = datetime(2026, 11, 18, 9, tzinfo=timezone.utc)
            before = {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()}
            self.assertEqual(verify_published(root, now), (name, timedelta(hours=6)))
            self.assertEqual(before, {
                p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()
            })
            with self.assertRaisesRegex(ValueError, "stale"):
                verify_published(root, now + timedelta(days=2))

    def test_latest_corruption_does_not_fall_back_to_older_bundle(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            self.published(root, "20261117T030000Z")
            latest, name = self.published(root)
            now = datetime(2026, 11, 18, 9, tzinfo=timezone.utc)
            (latest / name).write_bytes(b"corrupted")
            with self.assertRaisesRegex(ValueError, "mismatch"):
                verify_published(root, now)
            (latest / name).unlink()
            with self.assertRaisesRegex(ValueError, "Missing"):
                verify_published(root, now)

    def test_missing_bundle_manifest_and_future_timestamp(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            now = datetime(2026, 11, 18, 9, tzinfo=timezone.utc)
            with self.assertRaisesRegex(ValueError, "No published"):
                verify_published(root, now)
            latest, name = self.published(root)
            (latest / name.replace(".cms", ".json")).unlink()
            with self.assertRaisesRegex(ValueError, "Missing"):
                verify_published(root, now)
            self.published(root, "20261119T030000Z")
            with self.assertRaisesRegex(ValueError, "future"):
                verify_published(root, now)

    def test_rejects_symlink_to_external_archive_and_unsafe_outbox(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            actual = root / "actual"
            actual.mkdir()
            archive_dir, name = self.published(actual)
            fake = root / name
            try:
                fake.symlink_to(archive_dir, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("Symlinks unavailable on this runner")
            now = datetime(2026, 11, 18, 9, tzinfo=timezone.utc)
            with self.assertRaisesRegex(ValueError, "No published"):
                verify_published(root, now)
            with self.assertRaisesRegex(ValueError, "missing"):
                verify_published(root / "not-a-directory", now)

    def test_invalid_cli_age(self):
        with self.assertRaises(SystemExit) as exc:
            main(["/does-not-matter", "--max-age-hours", "0"])
        self.assertEqual(exc.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
