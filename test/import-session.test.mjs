import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { blankOrder } from '../src/domain.mjs';
import { auth, sessionChangeKey, store } from '../src/storage.mjs';

function deferred() {
  return Promise.withResolvers();
}

function pause() {
  const entered = deferred();
  const result = deferred();
  return {
    entered: entered.promise,
    wait() {
      entered.resolve();
      return result.promise;
    },
    resolve: result.resolve,
    reject: result.reject,
  };
}

class Element {
  value = '';
  textContent = '';
  disabled = false;
  open = false;
  files = [];
  dataset = {};
  children = [];
  handlers = {};
  elements = {email:{value:''}, password:{value:''}};

  addEventListener(type, handler) { this.handlers[type] = handler; }
  fire(type, submitter = this) {
    return this.handlers[type]({currentTarget:this, submitter, preventDefault() {}});
  }
  reset() {}
  setAttribute() {}
  close() { this.open = false; }
  showModal() { this.open = true; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  get text() { return this.textContent + this.children.map(child => child.text).join(''); }
}

let appRun = 0;
async function workspace(t, restore = deferred()) {
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'read-excel-file/browser') {
        return {url:'data:text/javascript,export const readSheet = (file, name) => file.read(name)', shortCircuit:true};
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.endsWith('/style.css')) return {format:'module', source:'', shortCircuit:true};
      if (url.endsWith('/pdf.mjs')) {
        return {format:'module', source:'export const readPdf = file => file.read()', shortCircuit:true};
      }
      return next(url, context);
    },
  });
  t.after(() => { hooks.deregister(); auth.clear(); });
  const elements = new Map();
  const windowEvents = new EventTarget();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  t.mock.method(globalThis, 'setInterval', () => {});
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (url === '/api/me') return restore.promise;
    if (url === '/api/logout') return Response.json({});
    assert.equal(url, '/api/login');
    const {email} = JSON.parse(options.body);
    return Response.json({email, csrf:email});
  });
  for (const [name, value] of Object.entries({
    document: {
      getElementById:get,
      createElement:() => new Element(),
      querySelectorAll:selector => selector === 'dialog[open]'
        ? [...elements].filter(([id, el]) => id.endsWith('-dialog') && el.open).map(([, el]) => el)
        : [],
      addEventListener() {},
    },
    window: windowEvents,
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable:true, value});
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
  let list = () => [];
  let save = orders => orders;
  const writes = [];
  t.mock.method(store, 'list', async () => list());
  t.mock.method(store, 'save', async (orders, base) => {
    writes.push({orders, base});
    return save(orders);
  });
  await import('../src/app.mjs?test=' + ++appRun);
  const login = email => {
    const form = get('sign-in-form');
    form.elements.email.value = email + '@example.test';
    form.elements.password.value = 'synthetic';
    return form.fire('submit', get('login-button'));
  };
  return {
    get, login, writes, restore, windowEvents,
    signOut: () => get('sign-out').fire('click'),
    setList: handler => { list = handler; },
    setSave: handler => { save = handler; },
  };
}

const order = number => ({...blankOrder(), number});
const pdf = (number, customer, performer) =>
  `Заявка № ${number} от 09.11.2026\nИсполнитель: ${performer}\nЗаказчик: ${customer}\nПОГРУЗКА:\nАдрес А`;

function submitPdf(app, number, read = text => text) {
  app.get('import').fire('click');
  app.get('customer-pdf').files = [{size:100, read:() => read(pdf(number, 'Заказчик', 'Экспедитор'))}];
  app.get('carrier-pdf').files = [{size:100, read:() => pdf(number, 'Экспедитор', 'Перевозчик')}];
  return app.get('import-form').fire('submit', app.get('pdf-button'));
}

const ledgerHeader = ['Дата','Номер заявки','Заказчик','Перевозчик','Направление','Ставка с Заказчиком','Ставка с Перевозчиком','Маржа','Загрузка','Выгрузка','Заказ-заявка','ЭТРН'];

function submitExcel(app, number, read = rows => rows) {
  app.get('ledger').fire('click');
  app.get('ledger-file').files = [{size:100, read(sheet) {
    assert.equal(sheet, 'Ноябрь');
    return read([ledgerHeader, ['2026-11-09', number, 'Заказчик']]);
  }}];
  return app.get('ledger-form').fire('submit', app.get('excel-button'));
}

test('oversized PDF and Excel are rejected before reading or saving', async t => {
  const app = await workspace(t);
  await app.login('a');
  const read = t.mock.fn();
  app.get('customer-pdf').files = [{size:100, read}];
  app.get('carrier-pdf').files = [{size:20 * 1024 * 1024 + 1, read}];
  await app.get('import-form').fire('submit', app.get('pdf-button'));
  assert.match(app.get('import-error').textContent, /20 МиБ/);
  assert.equal(app.get('pdf-button').disabled, false);

  app.get('ledger-file').files = [{size:10 * 1024 * 1024 + 1, read}];
  await app.get('ledger-form').fire('submit', app.get('excel-button'));
  assert.match(app.get('ledger-error').textContent, /10 МиБ/);
  assert.equal(app.get('excel-button').disabled, false);
  assert.equal(read.mock.callCount(), 0);
  assert.equal(app.writes.length, 0);
});

test('a peer tab change clears the previous registry and discards pending PDF review', async t => {
  const app = await workspace(t);
  app.setList(() => [order('101')]);
  await app.login('a');
  assert.match(app.get('table').text, /101/);
  const late = pause();
  const pending = submitPdf(app, '101', late.wait);
  await late.entered;

  app.windowEvents.dispatchEvent(Object.assign(new Event('storage'), {
    key: sessionChangeKey, newValue: 'opaque-notification',
  }));
  assert.equal(app.get('workspace').hidden, true);
  assert.equal(app.get('account-email').textContent, '');
  assert.doesNotMatch(app.get('table').text, /101/);
  assert.match(app.get('sign-in-error').textContent, /другой вкладке/);

  app.setList(() => [order('202')]);
  await app.login('b');
  late.resolve(pdf('101', 'Заказчик', 'Экспедитор'));
  await pending;
  assert.match(app.get('table').text, /202/);
  assert.equal(app.get('review-dialog').open, false);
  assert.equal(app.writes.length, 0);
});

test('a server session mismatch clears the registry without a tab notification', async t => {
  const app = await workspace(t);
  app.setList(() => [order('101')]);
  await app.login('a');
  app.setList(() => { throw Object.assign(new Error('wrong session'), {status: 403}); });
  await app.get('sync-refresh').fire('click');
  assert.equal(app.get('workspace').hidden, true);
  assert.doesNotMatch(app.get('table').text, /101/);
  assert.match(app.get('sign-in-error').textContent, /Войдите снова/);
});

for (const boundary of ['reader', 'list', 'review list', 'review save']) {
  test('PDF drops account A at ' + boundary, async t => {
    const app = await workspace(t);
    await app.login('a');
    const delayed = pause();
    let pending;
    if (boundary.startsWith('review')) {
      await submitPdf(app, '101');
      assert.match(app.get('review-title').textContent, /101/);
      if (boundary === 'review list') app.setList(delayed.wait);
      else app.setSave(delayed.wait);
      pending = app.get('review-save').fire('click');
    } else {
      if (boundary === 'list') app.setList(delayed.wait);
      pending = submitPdf(app, '101', boundary === 'reader' ? delayed.wait : undefined);
    }
    await delayed.entered;
    await app.signOut();
    assert.equal(app.get('review-dialog').open, false);
    assert.equal(app.get('review-card').children.length, 0);
    assert.doesNotMatch(app.get('review-title').textContent, /101/);
    assert.equal(app.get('review-save').disabled, false);
    app.setList(() => [order('202')]);
    app.setSave(orders => orders);
    await app.login('b');

    const next = pause();
    app.setList(next.wait);
    const current = submitPdf(app, '203');
    await next.entered;
    if (boundary === 'reader') delayed.reject(new Error('late PDF error'));
    else delayed.resolve([order('101')]);
    await pending;
    assert.equal(app.get('review-dialog').open, false);
    assert.equal(app.get('import-error').textContent, '');
    assert.equal(app.get('review-error').textContent, '');
    assert.equal(app.get('pdf-button').disabled, true);
    assert.match(app.get('pdf-button').textContent, /Читаем/);
    assert.match(app.get('table').text, /202/);
    assert.doesNotMatch(app.get('table').text, /101/);
    assert.equal(app.writes.length, boundary === 'review save' ? 1 : 0);

    next.resolve([order('202')]);
    await current;
    assert.equal(app.get('review-dialog').open, true);
    assert.match(app.get('review-title').textContent, /203/);
    assert.equal(app.get('pdf-button').disabled, false);
    app.setList(() => [order('202')]);
    await app.get('review-save').fire('click');
    assert.deepEqual(app.writes.at(-1).orders.map(item => item.number).sort(), ['202', '203']);
    assert.equal(app.get('review-dialog').open, false);
  });
}

for (const [boundary, reject] of [['reader', true], ['list', false], ['save', false], ['save', true]]) {
  test(`Excel drops account A at ${boundary} (${reject ? 'failure' : 'success'})`, async t => {
    const app = await workspace(t);
    await app.login('a');
    const delayed = pause();
    if (boundary === 'list') app.setList(delayed.wait);
    if (boundary === 'save') app.setSave(delayed.wait);
    const pending = submitExcel(app, '101', boundary === 'reader' ? delayed.wait : undefined);
    await delayed.entered;
    assert.equal(app.get('excel-button').disabled, true);
    await app.signOut();
    assert.equal(app.get('excel-button').disabled, false);
    const base = [order('202')];
    app.setList(() => base);
    app.setSave(orders => orders);
    await app.login('b');

    const next = pause();
    const current = submitExcel(app, '203', next.wait);
    await next.entered;
    await app.get('ledger-form').fire('submit', new Element());
    if (reject) delayed.reject(new Error('late Excel error'));
    else delayed.resolve([order('101')]);
    await pending;

    assert.equal(app.get('ledger-dialog').open, true);
    assert.equal(app.get('excel-button').disabled, true);
    assert.equal(app.get('ledger-error').textContent, '');
    assert.equal(app.get('notice').textContent, '');
    assert.match(app.get('table').text, /202/);
    assert.doesNotMatch(app.get('table').text, /101/);
    assert.equal(app.writes.length, boundary === 'save' ? 1 : 0);
    next.resolve([ledgerHeader, ['2026-11-09', '203'], ['2026-11-09', '202']]);
    await current;
    assert.equal(app.writes.at(-1).base, base);
    assert.deepEqual(app.writes.at(-1).orders.map(item => item.number), ['203', '202']);
    assert.equal(app.get('ledger-dialog').open, false);
    assert.equal(app.get('excel-button').disabled, false);
    assert.match(app.get('notice').textContent, /Добавлено: 1. Уже в реестре: 1/);
  });
}

for (const status of [200, 401]) {
  test('late restore (' + status + ') leaves the signed-in workspace intact', async t => {
    const app = await workspace(t);
    app.setList(() => [order('202')]);
    await app.login('b');
    app.restore.resolve(Response.json({email:'a@example.test', csrf:'a'}, {status}));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.get('account-email').textContent, 'b@example.test');
    assert.equal(app.get('workspace').hidden, false);
    assert.equal(app.get('sign-in-error').textContent, '');
    assert.match(app.get('table').text, /202/);
  });
}
