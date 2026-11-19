"""Synthetic-only API rollback/re-upgrade against the pinned previous Git release.

Executes this repository's pinned historical backend in memory, not a production
service. Requires Git history and never reads DATABASE_PATH or external files.
"""
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from types import ModuleType

from fastapi.testclient import TestClient

from backend import app as current
from backend.test_app import ORIGIN, PASSWORD, order
from backend.test_saved_views import view
from deploy.schema_compatibility import inspect, set_schema2_marker

PREVIOUS = "3f2ef13398acb6b4a76f37c24ba0a17b2635414b"


def main():
    repo=Path(__file__).resolve().parents[1]
    source=subprocess.check_output(['git','show',PREVIOUS+':backend/app.py'],cwd=repo).decode('utf-8')
    previous=ModuleType('workspace_previous_release')
    previous.__file__=str(repo/'backend/app.py')
    exec(compile(source, 'pinned-previous-backend', 'exec'),previous.__dict__)
    assert previous.SCHEMA_VERSION == 2
    with TemporaryDirectory(prefix='sputnik-schema-rehearsal-') as folder:
        path=Path(folder)/'synthetic.sqlite3'
        modern=current.create_app(path,ORIGIN)
        owners=('first@example.test','second@example.test')
        for owner in owners: current.add_user(path,owner,PASSWORD)
        identities=[]
        baselines=[]
        for index,owner in enumerate(owners):
            with TestClient(modern,base_url=ORIGIN) as client:
                login=client.post('/api/login',headers={'Origin':ORIGIN},json={'email':owner,'password':PASSWORD})
                assert login.status_code == 200
                headers={'Origin':ORIGIN,'X-CSRF-Token':login.json()['csrf']}
                saved=client.put('/api/records',headers=headers,json={'revision':0,'orders':[order('SAME')]} )
                assert saved.status_code == 200
                views=client.put('/api/saved-views',headers=headers,json={'revision':0,'views':[view(f'Synthetic view {index}')]} )
                assert views.status_code == 200
                baselines.append((saved.json(),views.json()))
                identities.append((dict(client.cookies),headers))
        set_schema2_marker(path)
        legacy=previous.create_app(path,ORIGIN)
        # Both existing sessions survive the marker change and previous startup.
        for index,(cookies,headers) in enumerate(identities):
            with TestClient(legacy,base_url=ORIGIN) as client:
                client.cookies.update(cookies)
                assert client.get('/api/me').json()['email'] == owners[index]
                assert client.get('/api/records',headers=headers).json() == baselines[index][0]
                if index == 0:
                    data=baselines[index][0]
                    response=client.put('/api/records',headers=headers,json={
                        'revision':data['revision'],'orders':[*data['orders'],order('AFTER-ROLLBACK')]})
                    assert response.status_code == 200
        modern=current.create_app(path,ORIGIN)
        for index,(cookies,headers) in enumerate(identities):
            with TestClient(modern,base_url=ORIGIN) as client:
                client.cookies.update(cookies)
                assert client.get('/api/saved-views',headers=headers).json() == baselines[index][1]
                records=client.get('/api/records',headers=headers).json()
                expected=2 if index == 0 else 1
                assert len(records['orders']) == expected
                assert client.get('/api/me').json()['email'] == owners[index]
        result=inspect(path)
        assert result['schema'] == 3 and result['counts']['orders'] == 3
    print('Pinned schema-2 API rollback and schema-3 re-upgrade passed; both accounts, sessions, orders and saved views retained.')


if __name__ == '__main__':
    main()
