import assert from 'node:assert/strict';
import test from 'node:test';
import { blankOrder } from '../src/domain.mjs';
import { isActionable, monthGroups, scopeOrders } from '../src/order-history.mjs';

const order = (number, date, stage) => ({
  ...blankOrder(), number, date, trip: {stage},
});

test('active queue retains unloaded trips until ETRN is signed or closed manually', () => {
  const orders = [
    order('old-open', '2024-01-01', 'loaded'),
    order('new-open', '2027-01-01', 'new'),
    {...order('unloaded-etrn-open', '2026-11-01', 'unloaded'), etrn:{required:true,orderForm:true,created:true,number:'7372'}},
    {...order('unloaded-no-etrn', '2026-11-01', 'unloaded'), etrn:{required:false}},
    {...order('unloaded-signed', '2026-11-01', 'unloaded'), etrn:{required:true,orderForm:true,created:true,number:'signed',allSigned:true}},
    {...order('unloaded-manual', '2026-11-01', 'unloaded'), etrn:{required:true,manualComplete:true}},
    order('failed', '2026-11-01', 'failed'),
  ];
  assert.deepEqual(scopeOrders(orders).map(x => x.number),
    ['old-open', 'new-open', 'unloaded-etrn-open', 'unloaded-no-etrn']);
  assert.equal(isActionable(orders[2]), true);
  assert.equal(isActionable(orders[4]), false);
  assert.equal(isActionable(orders[5]), false);
  assert.equal(isActionable({...orders[5],trip:{stage:'loaded'}}), true);
  assert.equal(isActionable(orders[6]), false);
  assert.equal(isActionable({...orders[6], trip:{stage:'signed'}}), true);
});

test('history includes all statuses, supports months and all-period search', () => {
  const orders = [
    order('a', '2026-10-13', 'failed'),
    order('b', '2026-11-04', 'unloaded'),
    order('c', '2026-11-18', 'new'),
    order('d', '2025-10-01', 'signed'),
    order('e', '', 'loaded'),
  ];
  assert.deepEqual(monthGroups(orders), [
    {month:'2026-11', count:2}, {month:'2026-10', count:1},
    {month:'2025-10', count:1}, {month:'', count:1},
  ]);
  assert.deepEqual(scopeOrders(orders, {scope:'history', month:'2026-11'}).map(x=>x.number), ['b', 'c']);
  assert.equal(scopeOrders(orders, {scope:'history', month:'2026-11', search:'a'}).length, orders.length);
  assert.equal(scopeOrders(orders, {scope:'history', month:'all'}).length, orders.length);
  assert.deepEqual(scopeOrders(orders, {scope:'history', month:'undated'}).map(x=>x.number), ['e']);
});

test('a large imported year remains accessible without truncation', () => {
  const orders = Array.from({length:515}, (_,i) => ({
    ...order(String(i), i % 2 ? '2026-10-01':'2026-11-14', i % 3 ? 'unloaded':'new'),
    etrn:{required:true,number:String(i),created:true,allSigned:true},
  }));
  assert.equal(scopeOrders(orders, {scope:'history'}).length, 515);
  assert.equal(monthGroups(orders).reduce((n,x)=>n+x.count,0), 515);
  assert.equal(scopeOrders(orders).length, 172);
});

test('515 orders remain searchable across archived months without hiding active old trips', () => {
  const orders = Array.from({length:515}, (_, i) => ({
    ...order(
      'YR-' + String(i).padStart(4, '0'),
      i < 200 ? '2025-12-15' : i < 400 ? '2026-01-15' : '2026-11-15',
      i % 7 === 0 ? 'loaded' : 'unloaded',
    ),
    etrn:{required:true,number:'YR-' + String(i),created:true,allSigned:true},
  }));
  assert.equal(scopeOrders(orders, {scope:'history', month:'2025-12'}).length, 200);
  assert.equal(scopeOrders(orders, {scope:'history', month:'2026-01'}).length, 200);
  assert.equal(scopeOrders(orders, {scope:'history', month:'2026-11'}).length, 115);
  assert.equal(scopeOrders(orders, {scope:'history', month:'all'}).length, 515);
  assert.equal(scopeOrders(orders, {scope:'history', month:'2025-12', search:'YR-0514'}).length, 515);
  assert.equal(scopeOrders(orders).length, 74);
  assert.ok(scopeOrders(orders).some(item => item.number === 'YR-0000'));
  assert.equal(monthGroups(orders).reduce((sum, month) => sum + month.count, 0), 515);
});
