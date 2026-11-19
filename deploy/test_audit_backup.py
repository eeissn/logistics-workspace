"""Audit logging and alerts with disposable synthetic archive bytes only."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock

from deploy.audit_backup import audit

NOW=datetime(2026,11,19,12,tzinfo=timezone.utc)


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.root=Path(self.enterContext(TemporaryDirectory()))
        (self.root/'.verified').mkdir()
        self.archive=self.root/'workspace-20261119T030001Z.cms'
        self.data=b'synthetic encrypted bytes'
        self.archive.write_bytes(self.data)
        (self.root/'.verified'/self.archive.with_suffix('.json').name).write_text(json.dumps({
            'size':len(self.data),'sha256':hashlib.sha256(self.data).hexdigest()}))

    def test_success_logs_without_notification_or_modifying_archive(self):
        notify=Mock()
        self.assertEqual(audit(self.root,now=NOW,notify=notify),0)
        self.assertIn('[0] BACKUP OK', (self.root/'backup-audit.log').read_text())
        self.assertEqual(self.archive.read_bytes(),self.data)
        notify.assert_not_called()

    def test_stale_and_corrupt_results_are_logged_and_notify(self):
        for corrupt in (False,True):
            with self.subTest(corrupt=corrupt):
                self.archive.write_bytes(b'corrupt' if corrupt else self.data)
                notify=Mock()
                now=NOW if corrupt else NOW+timedelta(days=3)
                self.assertEqual(audit(self.root,now=now,notify=notify),1)
                self.assertIn('[1] BACKUP ALERT', (self.root/'backup-audit.log').read_text())
                notify.assert_called_once_with()

    def test_rotation_preserves_archive_and_notification_failure_keeps_error(self):
        (self.root/'backup-audit.log').write_text('x'*(1024*1024+1))
        self.assertEqual(audit(self.root,now=NOW,notify=Mock()),0)
        self.assertEqual((self.root/'backup-audit.previous.log').stat().st_size,1024*1024+1)
        self.archive.write_bytes(b'corrupt')
        self.assertEqual(audit(self.root,now=NOW,notify=Mock(side_effect=RuntimeError)),1)
        self.assertEqual(self.archive.read_bytes(),b'corrupt')

    def test_missing_folder_is_failure_even_without_log(self):
        notify=Mock()
        self.assertEqual(audit(self.root/'missing',now=NOW,notify=notify),1)
        notify.assert_called_once_with()
