import assert from 'node:assert/strict';
import test from 'node:test';
import { blankOrder } from '../src/domain.mjs';
import { isActionable, monthGroups, scopeOrders } from '../src/order-history.mjs';

const order = (number, date, stage) => ({
  ...blankOrder(), number, date, trip: {stage},
});

test('active queue uses trip state, not delivery date or ETRN/archive status', () => {
  const orders = [
    order('old-open', '2024-01-01', 'loaded'),
    order('new-open', '2027-01-01', 'new'),
    order('unloaded-etrn-open', '2026-11-01', 'unloaded'),
    order('failed', '2026-11-01', 'failed'),
  ];
  assert.deepEqual(scopeOrders(orders).map(x => x.number), ['old-open', 'new-open']);
  assert.equal(isActionable(orders[2]), false);
  assert.equal(isActionable({...orders[3], trip:{stage:'signed'}}), true);
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
  const orders = Array.from({length:515}, (_,i) => order(String(i), i % 2 ? '2026-10-01':'2026-11-14', i % 3 ? 'unloaded':'new'));
  assert.equal(scopeOrders(orders, {scope:'history'}).length, 515);
  assert.equal(monthGroups(orders).reduce((n,x)=>n+x.count,0), 515);
  assert.equal(scopeOrders(orders).length, 172);
});
