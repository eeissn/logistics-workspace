from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from deploy.check_sqlite_users import assert_unused


class SQLiteUsersTests(unittest.TestCase):
    def test_no_users_and_missing_database(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            proc = root / 'proc'
            proc.mkdir()
            database = root / 'synthetic.sqlite3'
            with self.assertRaises(ValueError):
                assert_unused(database, proc)
            database.write_bytes(b'synthetic')
            assert_unused(database, proc)

    def test_database_wal_shm_open_files_block_migration(self):
        for suffix in ('', '-wal', '-shm'):
            with self.subTest(suffix=suffix), TemporaryDirectory() as folder:
                root = Path(folder)
                database = root / 'synthetic.sqlite3'
                database.write_bytes(b'synthetic')
                target = Path(str(database) + suffix)
                target.touch(exist_ok=True)
                fd = root / 'proc' / '123' / 'fd'
                fd.mkdir(parents=True)
                # Hardlink models the same inode through a process descriptor.
                (fd / '9').hardlink_to(target)
                with self.assertRaisesRegex(ValueError, 'still open'):
                    assert_unused(database, root / 'proc')

    def test_inaccessible_process_fails_closed(self):
        with TemporaryDirectory() as folder:
            database = Path(folder) / 'synthetic.sqlite3'
            database.touch()
            with patch.object(Path, 'iterdir', side_effect=PermissionError('synthetic')):
                with self.assertRaises(PermissionError):
                    assert_unused(database, Path(folder))
