import assert from 'node:assert/strict';
import test from 'node:test';
import { auth, localOrders, store } from '../src/storage.mjs';

test('two tab instances serialize cookie changes and publish opaque notifications', async t => {
  const tabA = await import('../src/storage.mjs?tab=a');
  const tabB = await import('../src/storage.mjs?tab=b');
  const started = Promise.withResolvers();
  const late = Promise.withResolvers();
  const events = [];
  let tail = Promise.resolve();
  const navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const localStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'navigator', {configurable:true, value:{locks:{
    request(name, callback) {
      assert.equal(name, tabA.sessionChangeKey);
      const result = tail.then(callback);
      tail = result.catch(() => {});
      return result;
    },
  }}});
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{
    setItem(key, value) { events.push({key, value}); },
  }});
  t.after(() => {
    for (const [key, descriptor] of Object.entries({navigator, localStorage})) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const requests = mockCookieFetch(t, (url, options, cookie) => {
    const {email} = JSON.parse(options.body);
    if (email === 'a@example.test') {
      started.resolve();
      return late.promise;
    }
    assert.equal(cookie, 'session=a@example.test');
    return loginResponse(email);
  });
  const first = tabA.auth.login('a@example.test', 'synthetic');
  await started.promise;
  const second = tabB.auth.login('b@example.test', 'synthetic');
  await new Promise(setImmediate);
  assert.deepEqual(requests, ['/api/login']);
  late.resolve(loginResponse('a@example.test'));
  await Promise.all([first, second]);
  assert.equal(events.length, 2);
  assert.notEqual(events[0].value, events[1].value);
  for (const {key, value} of events) {
    assert.equal(key, tabA.sessionChangeKey);
    assert.match(value, /^[a-f0-9-]{36}$/);
  }
});

const staleSession = error => error.message === 'Сеанс завершён.' && error.status === undefined;

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

test('a snapshot and delayed read cannot cross an account switch', async t => {
  let finishRead;
  let pauseRead = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/login') {
      const {email} = JSON.parse(options.body);
      return Response.json({email, csrf:email});
    }
    assert.equal(options.method, 'GET');
    const orders = [{number:options.headers['X-CSRF-Token']}];
    if (pauseRead) await new Promise(resolve => { finishRead = resolve; });
    return Response.json({revision:0, orders});
  });
  t.after(() => auth.clear());
  await auth.login('first@example.test', 'test-password');
  const old = await store.list();
  pauseRead = true;
  const pending = store.list();
  pauseRead = false;
  await auth.login('second@example.test', 'test-password');
  finishRead();
  await assert.rejects(pending, /Сеанс завершён/);
  await assert.rejects(store.save(old, old), /Обновите реестр/);
  assert.deepEqual(await store.list(), [{number:'second@example.test'}]);
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

function mockCookieFetch(t, respond) {
  let cookie = 'session=';
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(url);
    const response = await respond(url, options, cookie);
    cookie = response.headers.get('Set-Cookie')?.split(';')[0] ?? cookie;
    return response;
  });
  return requests;
}

function loginResponse(email) {
  return Response.json({email, csrf:email}, {headers:{'Set-Cookie':'session=' + email}});
}

for (const status of [200, 401]) {
  test('new login waits for a superseded login (' + status + ')', async t => {
    const started = Promise.withResolvers();
    const late = Promise.withResolvers();
    const requests = mockCookieFetch(t, (url, options, cookie) => {
      if (url === '/api/login') {
        const {email} = JSON.parse(options.body);
        if (email === 'a@example.test') {
          started.resolve();
          return late.promise;
        }
        assert.equal(cookie, status === 200 ? 'session=a@example.test' : 'session=');
        return loginResponse(email);
      }
      assert.equal(url, '/api/records');
      assert.equal(cookie, 'session=b@example.test');
      assert.equal(options.headers['X-CSRF-Token'], 'b@example.test');
      return Response.json({revision:0, orders:[{number:'B'}]});
    });
    t.after(() => auth.clear());
    const oldLogin = auth.login('a@example.test', 'synthetic');
    const rejected = assert.rejects(oldLogin, staleSession);
    await started.promise;
    const newLogin = auth.login('b@example.test', 'synthetic');
    await new Promise(setImmediate);
    assert.deepEqual(requests, ['/api/login']);
    late.resolve(status === 200 ? loginResponse('a@example.test') : Response.json({}, {status}));
    await rejected;
    await newLogin;
    assert.deepEqual(await store.list(), [{number:'B'}]);
  });
}

test('new login waits for logout to clear the previous cookie', async t => {
  const started = Promise.withResolvers();
  const late = Promise.withResolvers();
  const requests = mockCookieFetch(t, (url, options, cookie) => {
    if (url === '/api/logout') {
      assert.equal(cookie, 'session=a@example.test');
      assert.equal(options.headers['X-CSRF-Token'], 'a@example.test');
      started.resolve();
      return late.promise;
    }
    if (url === '/api/login') {
      assert.equal(cookie, 'session=');
      return loginResponse(JSON.parse(options.body).email);
    }
    assert.equal(url, '/api/records');
    assert.equal(cookie, 'session=b@example.test');
    assert.equal(options.headers['X-CSRF-Token'], 'b@example.test');
    return Response.json({revision:0, orders:[{number:'B'}]});
  });
  t.after(() => auth.clear());
  await auth.login('a@example.test', 'synthetic');
  const rejected = assert.rejects(auth.logout(), staleSession);
  await started.promise;
  const newLogin = auth.login('b@example.test', 'synthetic');
  await new Promise(setImmediate);
  assert.deepEqual(requests, ['/api/login', '/api/logout']);
  late.resolve(Response.json({}, {headers:{'Set-Cookie':'session=; Max-Age=0'}}));
  await rejected;
  await newLogin;
  assert.deepEqual(await store.list(), [{number:'B'}]);
});

test('restore cannot adopt a superseded login cookie while pending or after it lands', async t => {
  const started = Promise.withResolvers();
  const late = Promise.withResolvers();
  const requests = mockCookieFetch(t, (url, options, cookie) => {
    if (url === '/api/me') {
      const email = cookie.slice('session='.length);
      return Response.json({email, csrf:email});
    }
    assert.equal(url, '/api/login');
    const {email} = JSON.parse(options.body);
    if (email === 'a@example.test') {
      started.resolve();
      return late.promise;
    }
    return loginResponse(email);
  });
  t.after(() => auth.clear());
  const rejected = assert.rejects(auth.login('a@example.test', 'synthetic'), staleSession);
  await started.promise;
  auth.clear();
  await assert.rejects(auth.restore(), staleSession);
  late.resolve(loginResponse('a@example.test'));
  await rejected;
  await assert.rejects(auth.restore(), staleSession);
  assert.deepEqual(requests, ['/api/login']);
  await auth.login('b@example.test', 'synthetic');
  assert.equal((await auth.restore()).email, 'b@example.test');
});

for (const method of ['GET', 'PUT']) {
  for (const status of [200, 401, 409]) {
    test(`pending ${method} (${status}) is isolated across a session switch`, async t => {
      const late = Promise.withResolvers();
      const requests = [];
      let delay = false;
      t.mock.method(globalThis, 'fetch', (url, options) => {
        if (url === '/api/login') {
          const {email} = JSON.parse(options.body);
          return Response.json({email, csrf:email});
        }
        assert.equal(url, '/api/records');
        const token = options.headers['X-CSRF-Token'];
        requests.push({method:options.method, token, body:options.body});
        if (delay && token === 'a@example.test') return late.promise;
        const number = token === 'a@example.test' ? 'A' : 'B';
        return Response.json({revision:0, orders:[{number}]});
      });
      t.after(() => auth.clear());
      await auth.login('a@example.test', 'synthetic');
      const base = await store.list();
      delay = true;
      const pending = method === 'GET' ? store.list() : store.save([{number:'A-edit'}], base);
      const rejected = assert.rejects(pending, staleSession);
      assert.equal(requests.at(-1).token, 'a@example.test');
      if (method === 'PUT') {
        assert.deepEqual(JSON.parse(requests.at(-1).body), {revision:0, orders:[{number:'A-edit'}]});
      }
      await auth.login('b@example.test', 'synthetic');
      const current = await store.list();
      late.resolve(Response.json({revision:99, orders:[{number:'A-edit'}]}, {status}));
      await rejected;
      assert.deepEqual(await store.list(), [{number:'B'}]);
      assert.deepEqual(current, [{number:'B'}]);
      await assert.rejects(store.save([{number:'A-edit'}], base), /Обновите реестр/);
      assert.equal(requests.filter(request => request.method === 'PUT').length, method === 'PUT' ? 1 : 0);
    });
  }
}
