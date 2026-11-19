"""No Google network requests or real keys: verify token-provider boundaries."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from backend.sheets_auth import SHEETS_SCOPE, credential_path, token_provider


class SheetsAuthTests(unittest.TestCase):
    def test_file_token_is_reloaded_and_rejects_header_injection_or_oversize(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / 'token'
            provider = token_provider({'token_file':str(path)})
            for expected in ('synthetic-first', 'synthetic-replacement'):
                path.write_text(expected+'\n',encoding='ascii')
                self.assertEqual(provider(),expected)
            for bad in ('', 'abc\r\nInjected: yes', 'x'*16385):
                path.write_text(bad,encoding='ascii')
                with self.assertRaises(ValueError): provider()

    def test_credential_source_is_explicit_absolute_and_outside_git_checkout(self):
        for config in ({}, {'token_file':'a','service_account_file':'b'}, {'token_file':'relative'}):
            with self.assertRaises(ValueError): token_provider(config)
        with self.assertRaises(ValueError):
            credential_path(str(Path(__file__).resolve().parents[1]/'private-token'))

    def test_official_service_account_refresh_is_scoped_cached_and_thread_safe(self):
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request
        credentials=SimpleNamespace(valid=False,token=None)
        refreshed=[]
        def refresh(request):
            refreshed.append(request)
            credentials.token='synthetic-short-lived'; credentials.valid=True
        credentials.refresh=refresh
        with TemporaryDirectory() as folder, patch.object(service_account.Credentials,'from_service_account_file',return_value=credentials) as load, patch('google.auth.transport.requests.Request',return_value=MagicMock(spec=Request)):
            path=Path(folder)/'service-account.json'
            provider=token_provider({'service_account_file':str(path)})
            load.assert_called_once_with(str(path.resolve()),scopes=[SHEETS_SCOPE])
            with ThreadPoolExecutor(max_workers=4) as pool:
                self.assertEqual(list(pool.map(lambda _:provider(),range(8))),['synthetic-short-lived']*8)
            self.assertEqual(len(refreshed),1)
            credentials.valid=False
            self.assertEqual(provider(),'synthetic-short-lived')
            self.assertEqual(len(refreshed),2)
            credentials.valid=False
            credentials.refresh=MagicMock(side_effect=RuntimeError('synthetic OAuth unavailable'))
            with self.assertRaises(RuntimeError): provider()
