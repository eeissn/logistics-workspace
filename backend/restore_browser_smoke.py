"""Encrypted synthetic restore -> isolated HTTPS app -> two browser logins.

No environment database, real archives, credentials or VPS connections are used.
The delivery transport is a local fixture; this does not test production SFTP.
"""
from contextlib import closing
from datetime import datetime, timedelta, timezone
import hashlib
from pathlib import Path
import shutil
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import monotonic, sleep
from types import SimpleNamespace

import httpx
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient
from playwright.sync_api import expect, sync_playwright
import uvicorn

from backend.app import COOKIE, SCHEMA_VERSION, add_user, backup, create_app, database
from backend.browser_smoke import PASSWORD, click_workspace_action, create_order, sign_in
from backend.test_app import ORIGIN, order
from backend.test_saved_views import view
from deploy.backup_delivery import publish, retrieve


class LocalOutbox:
    def __init__(self, folder):
        self.folder = folder

    def list_backups(self):
        return [entry.name for entry in self.folder.iterdir()]

    def download(self, name, destination):
        for entry in (self.folder / name).iterdir():
            shutil.copyfile(entry, destination / entry.name)


def seed(path):
    app = create_app(path, ORIGIN)
    copied_sessions = []
    for user in ('first', 'second'):
        email = f'{user}@example.test'
        add_user(path, email, PASSWORD)
        with TestClient(app, base_url=ORIGIN) as client:
            login = client.post('/api/login', headers={'Origin': ORIGIN},
                                json={'email': email, 'password': PASSWORD})
            assert login.status_code == 200
            headers = {'Origin': ORIGIN, 'X-CSRF-Token': login.json()['csrf']}
            item = order('RESTORE-SAME-001')
            item['trip'] = {}
            item['customer'] = f'Synthetic restored {user}'
            saved = client.put('/api/records', headers=headers,
                               json={'revision': 0, 'orders': [item]})
            assert saved.status_code == 200, (saved.status_code, saved.text)
            assert client.put('/api/saved-views', headers=headers,
                              json={'revision': 0, 'views': [view(f'Restored {user} view')]}).status_code == 200
            token = client.cookies.get(COOKIE)
            assert isinstance(token, str) and len(token) == 43
            copied_sessions.append(token)
    return copied_sessions


def business_rows(path):
    with database(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        return {table: [tuple(row) for row in db.execute('SELECT * FROM '+table+' ORDER BY 1,2')]
                for table in ('users', 'registry', 'orders', 'saved_views')}


def serve(root, port):
    # Refuse an accidental path to an ordinary application's database.
    assert root.name.startswith('sputnik-restore-browser-')
    assert (root / 'synthetic-only').read_text() == 'synthetic-only'
    app = create_app(root / 'restored.sqlite3', f'https://127.0.0.1:{port}')
    app.mount('/', StaticFiles(directory='dist', html=True))
    uvicorn.run(app, host='127.0.0.1', port=port, access_log=False,
                ssl_certfile=str(root / 'test.crt'), ssl_keyfile=str(root / 'test.key'))


def browsers(origin, copied_sessions, screenshots=None):
    with httpx.Client(verify=False, trust_env=False, timeout=2) as client:
        for token in copied_sessions:
            assert client.get(origin+'/api/me', headers={'Cookie': f'{COOKIE}={token}'}).status_code == 401
    with sync_playwright() as p:
        for engine, mobile in ((p.chromium, False), (p.webkit, True)):
            with closing(engine.launch()) as browser:
                profile = {**p.devices['iPhone 13'], 'viewport': {'width': 393, 'height': 852}} if mobile else {'viewport': {'width': 1280, 'height': 900}}
                contexts = [browser.new_context(ignore_https_errors=True, **profile) for _ in range(2)]
                pages = [context.new_page() for context in contexts]
                for index, user in enumerate(('first', 'second')):
                    page = pages[index]
                    page.goto(origin, wait_until='domcontentloaded')
                    sign_in(page, user)
                    expect(page.locator('#table')).to_contain_text(f'Synthetic restored {user}')
                    other = 'second' if user == 'first' else 'first'
                    expect(page.locator('#table')).not_to_contain_text(f'Synthetic restored {other}')
                    expect(page.locator('#custom-views')).to_contain_text(f'Restored {user} view')
                    expect(page.locator('#custom-views')).not_to_contain_text(f'Restored {other} view')
                number = f'RESTORE-NEW-{engine.name}'
                create_order(pages[0], number)
                pages[0].reload()
                expect(pages[0].locator('#table')).to_contain_text(number)
                pages[1].reload()
                expect(pages[1].locator('#table')).not_to_contain_text(number)
                if screenshots:
                    screenshots.mkdir(parents=True, exist_ok=True)
                    for index, user in enumerate(('first', 'second')):
                        pages[index].screenshot(path=screenshots/f'restore-{engine.name}-{user}.png')
                # New login after restoring, not just a copied browser session.
                click_workspace_action(pages[0], '#sign-out', mobile)
                sign_in(pages[0], 'first')
                expect(pages[0].locator('#table')).to_contain_text(number)
                for context in contexts:
                    context.close()
                print(f'{engine.name}: restored logins, views, owner isolation and new writes passed', flush=True)


def main():
    import os
    screenshots = Path(os.environ['WORKSPACE_SMOKE_SCREENSHOTS']) if os.environ.get('WORKSPACE_SMOKE_SCREENSHOTS') else None
    with TemporaryDirectory(prefix='sputnik-restore-browser-') as folder:
        root = Path(folder)
        (root / 'synthetic-only').write_text('synthetic-only')
        source, snapshot, restored = (root / name for name in ('source.sqlite3', 'snapshot.sqlite3', 'restored.sqlite3'))
        sessions = seed(source)
        expected = business_rows(source)
        backup(source, snapshot)
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
                        '-keyout', str(root/'test.key'), '-out', str(root/'test.crt')],
                       check=True, capture_output=True)
        outbox = root / 'outbox'
        outbox.mkdir()
        now = datetime.now(timezone.utc).replace(microsecond=0)
        publish(SimpleNamespace(source=snapshot, certificate=root/'test.crt', outbox=outbox,
                                snapshot_utc=now.strftime('%Y%m%dT%H%M%SZ'), openssl='openssl'))
        received = root / 'received'
        name, existing = retrieve(LocalOutbox(outbox), received, now, timedelta(hours=36), timedelta(days=45))
        assert not existing
        subprocess.run(['openssl', 'cms', '-decrypt', '-binary', '-inform', 'DER',
                        '-in', str(received/name), '-recip', str(root/'test.crt'),
                        '-inkey', str(root/'test.key'), '-out', str(restored)], check=True, capture_output=True)
        assert hashlib.sha256(restored.read_bytes()).digest() == hashlib.sha256(snapshot.read_bytes()).digest()
        assert business_rows(restored) == expected
        # Recovery must revoke old sessions on the restored copy only.
        with database(restored, write=True) as db:
            db.execute('DELETE FROM sessions')
            db.execute('DELETE FROM login_attempts')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        origin = f'https://127.0.0.1:{port}'
        server = subprocess.Popen([sys.executable, '-m', 'backend.restore_browser_smoke', '--serve', str(root), str(port)])
        try:
            with httpx.Client(verify=False, timeout=1, trust_env=False) as client:
                deadline = monotonic() + 20
                while True:
                    try:
                        if client.get(origin+'/api/me').status_code == 401:
                            break
                    except httpx.TransportError:
                        pass
                    if server.poll() is not None or monotonic() >= deadline:
                        raise RuntimeError('Isolated restored HTTPS server did not start')
                    sleep(0.2)
            browsers(origin, sessions, screenshots)
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=10)
        assert business_rows(source) == expected
        with database(source) as db:
            assert db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0] == 2
        print('Synthetic CMS restore -> HTTPS browser acceptance complete; source unchanged', flush=True)


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--serve':
        serve(Path(sys.argv[2]), int(sys.argv[3]))
    else:
        main()
