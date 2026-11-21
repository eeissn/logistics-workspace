"""Synthetic neutral-result/delete regressions on existing owner-scoped registry API."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient
from backend.app import add_user, create_app
from backend.test_app import ORIGIN, PASSWORD, order


class OrderActionTests(unittest.TestCase):
    def setUp(self):
        self.path = Path(self.enterContext(TemporaryDirectory())) / 'synthetic.sqlite3'
        app = create_app(self.path, ORIGIN)
        self.clients, self.headers = [], []
        for name in ('first', 'second'):
            email = name+'@example.test'
            add_user(self.path, email, PASSWORD)
            client = self.enterContext(TestClient(app, base_url=ORIGIN))
            response = client.post('/api/login', headers={'Origin': ORIGIN},
                                   json={'email': email, 'password': PASSWORD})
            self.assertEqual(response.status_code, 200)
            headers = {'Origin': ORIGIN, 'X-CSRF-Token': response.json()['csrf']}
            items = [{**order(number), 'customer': name, 'ledgerMargin': 250,
                      'trip': {'stage': 'failed'}} for number in ('SAME', 'KEEP')]
            self.assertEqual(client.put('/api/records', headers=headers,
                                        json={'revision': 0, 'orders': items}).status_code, 200)
            self.clients.append(client)
            self.headers.append(headers)

    def snapshot(self, owner):
        response = self.clients[owner].get('/api/records', headers=self.headers[owner])
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_explicit_zero_preserves_all_source_fields_and_other_owner(self):
        original, other = self.snapshot(0), self.snapshot(1)
        orders = original['orders']
        previous = dict(orders[0])
        orders[0] = {**previous, 'ledgerMargin': 0}
        saved = self.clients[0].put('/api/records', headers=self.headers[0],
                                    json={'revision': original['revision'], 'orders': orders})
        self.assertEqual(saved.status_code, 200)
        item = saved.json()['orders'][0]
        self.assertEqual(item['ledgerMargin'], 0)
        self.assertEqual({k:v for k,v in item.items() if k!='updatedAt'},
                         {**{k:v for k,v in previous.items() if k!='updatedAt'}, 'ledgerMargin': 0})
        self.assertEqual(self.snapshot(1), other)

    def test_stale_delete_rejected_then_fresh_delete_only_removes_owned_record(self):
        original, other = self.snapshot(0), self.snapshot(1)
        changed = [{**item, 'ledgerMargin': 123} for item in original['orders']]
        self.assertEqual(self.clients[0].put('/api/records', headers=self.headers[0],
            json={'revision': original['revision'], 'orders': changed}).status_code, 200)
        stale = self.clients[0].put('/api/records', headers=self.headers[0],
            json={'revision': original['revision'], 'orders': original['orders'][1:]})
        self.assertEqual(stale.status_code, 409)
        current = self.snapshot(0)
        self.assertEqual(len(current['orders']), 2)
        deleted = self.clients[0].put('/api/records', headers=self.headers[0],
            json={'revision': current['revision'], 'orders': current['orders'][1:],
                  'owner': 'second@example.test'})
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual([item['number'] for item in self.snapshot(0)['orders']], ['KEEP'])
        self.assertEqual(self.snapshot(1), other)

    def test_destructive_write_requires_current_sessions_csrf_and_origin(self):
        original = self.snapshot(0)
        for headers in ({'Origin': ORIGIN}, self.headers[1],
                        {**self.headers[0], 'Origin': 'https://foreign.test'}):
            response = self.clients[0].put('/api/records', headers=headers,
                json={'revision': original['revision'], 'orders': []})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(self.snapshot(0), original)
