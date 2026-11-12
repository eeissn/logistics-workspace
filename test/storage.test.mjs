import assert from 'node:assert/strict';
import test from 'node:test';
import { auth, localOrders, store } from '../src/storage.mjs';

test('cloud storage uses the revision of the supplied snapshot and refuses offline writes', async t => {
  let revision = 1;
  let offline = false;
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (offline) throw new TypeError('offline');
    if (url === '/api/login') return Response.json({email:'first@example.test', csrf:'session-token'});
    if (options.method === 'GET') {
      assert.equal(options.headers['X-CSRF-Token'], 'session-token');
      return Response.json({revision, orders:[{number:String(revision)}]});
    }
    const body = JSON.parse(options.body);
    writes.push(body);
    assert.equal(options.headers['X-CSRF-Token'], 'session-token');
    if (body.revision !== revision) return Response.json({}, {status:409});
    return Response.json({revision:++revision, orders:body.orders});
  });
  t.after(() => auth.clear());
  await auth.login('first@example.test', 'test-password');
  const old = await store.list();
  revision = 2;
  const current = await store.list();
  await assert.rejects(store.save([], old), {status:409});
  assert.deepEqual(writes, [{revision:1, orders:[]}]);
  assert.deepEqual(await store.save([{number:'3'}], current), [{number:'3'}]);
  offline = true;
  const last = [{number:'3'}];
  await assert.rejects(store.list(), /Нет связи/);
  await assert.rejects(store.save(last, current), /Нет связи/);
  assert.equal(writes.length, 2);
});

test('legacy storage is read explicitly without altering the local copy', t => {
  const value = {version:1, orders:[{number:'legacy'}]};
  const reads = [];
  const storage = {getItem(key) {
    reads.push(key);
    return JSON.stringify(value);
  }};
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:storage});
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  assert.deepEqual(localOrders(), value.orders);
  assert.deepEqual(reads, ['logistics-workspace:v1']);
});
