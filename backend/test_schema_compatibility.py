"""Additive migration round-trip with synthetic accounts and retained business data."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from backend.app import add_user, backup, database, initialize
from backend.saved_views import replace_saved_views
from backend.test_saved_views import view
from deploy.schema_compatibility import inspect, set_schema2_marker


class CompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.root=Path(self.enterContext(TemporaryDirectory()))
        self.path=self.root/'workspace.sqlite3'
        initialize(self.path)
        for owner in ('first@example.test','second@example.test'):
            add_user(self.path,owner,'synthetic-password-unique')
        with database(self.path,write=True) as db:
            for index,owner in enumerate(('first@example.test','second@example.test')):
                db.execute('UPDATE registry SET revision=? WHERE owner=?',(index+5,owner))
                db.execute('INSERT INTO orders VALUES (?,?,?,?,?)',
                           (owner,'SAME',0,'{"number":"SAME","customer":"Synthetic"}','synthetic-stamp'))
            replace_saved_views(db,'first@example.test',0,[view('Retained synthetic view')])

    def snapshot(self):
        with database(self.path) as db:
            return {name:[tuple(row) for row in db.execute('SELECT * FROM '+name+' ORDER BY 1,2')]
                    for name in ('users','sessions','registry','orders','saved_views')}

    def test_inspection_is_read_only_and_rollback_reupgrade_keeps_every_row(self):
        original=self.snapshot()
        self.assertEqual(inspect(self.path)['schema'],3)
        self.assertEqual(self.snapshot(),original)
        self.assertEqual(set_schema2_marker(self.path)['schema'],2)
        self.assertEqual(self.snapshot(),original)
        # Simulate business writes while the previous schema-2 application is running.
        with database(self.path,write=True) as db:
            db.execute('UPDATE registry SET revision=revision+1 WHERE owner=?',('second@example.test',))
        changed=self.snapshot()
        initialize(self.path)
        self.assertEqual(inspect(self.path)['schema'],3)
        self.assertEqual(self.snapshot(),changed)
        initialize(self.path)
        self.assertEqual(self.snapshot(),changed)

    def test_backup_keeps_retained_views_and_both_owners_after_marker_change(self):
        original=self.snapshot()
        set_schema2_marker(self.path)
        restored=self.root/'restored.sqlite3'
        backup(self.path,restored)
        self.assertEqual(inspect(restored)['schema'],2)
        initialize(restored)
        self.path=restored
        self.assertEqual(self.snapshot(),original)

    def test_unknown_schema_and_missing_file_are_never_rewritten(self):
        with database(self.path,write=True) as db:
            db.execute('PRAGMA user_version=4')
        with self.assertRaises(ValueError): set_schema2_marker(self.path)
        with database(self.path) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],4)
        missing=self.root/'missing.sqlite3'
        with self.assertRaises(ValueError): inspect(missing)
        self.assertFalse(missing.exists())

    def test_incompatible_retained_table_blocks_reupgrade_without_data_loss(self):
        set_schema2_marker(self.path)
        with database(self.path,write=True) as db:
            db.execute('ALTER TABLE saved_views ADD COLUMN unknown TEXT')
        before=self.snapshot()
        with self.assertRaises(RuntimeError): initialize(self.path)
        self.assertEqual(self.snapshot(),before)
        with database(self.path) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],2)
