import assert from 'node:assert/strict';
import test from 'node:test';
import { blankOrder } from '../src/domain.mjs';
import { displayKey, readDisplayPreferences, selectOrders } from '../src/registry.mjs';

const query = {query:'', filter:'', view:'all', today:'2026-11-13', sort:'date', ascending:false};
const makeOrder = (number, date, trip, etrn = {required:true}) => ({
  ...blankOrder(), number, date, trip, etrn,
});

test('«Не выгружены» uses the trip stage independently of dates and ETRN', () => {
  const orders = [
    makeOrder('прошлый', '2026-11-01', {loaded:true}),
    makeOrder('будущий', '2026-11-23', {}),
    makeOrder('сегодня', '2026-11-13', {stage:'signed'}, {manualComplete:true}),
    makeOrder('выгруженный', '2026-11-13', {stage:'unloaded'}),
    makeOrder('старый выгруженный', '2026-11-02', {unloaded:true}),
    makeOrder('сорванный', '2026-11-13', {stage:'failed'}),
    makeOrder('возобновлённый', '2026-11-03', {stage:'loaded', unloaded:true}),
  ];
  assert.deepEqual(selectOrders(orders, {...query, view:'not-unloaded'}).map(order => order.number),
    ['будущий', 'сегодня', 'возобновлённый', 'прошлый']);
  assert.equal(selectOrders(orders, query).length, orders.length);
});

test('registry filters compose with search and numeric sorting without changing the source', () => {
  const orders = ['10', '2', '1'].map(number => ({
    ...makeOrder(number, '2026-11-13', {stage:'loaded'}, {required:number !== '1'}),
    points:[{kind:'Выгрузка', address:'Москва', schedule:'13.11.2026'}],
  }));
  const result = selectOrders(orders, {
    ...query, view:'delivery', query:'  москва ', filter:'pending', sort:'number', ascending:true,
  });
  assert.deepEqual(result.map(order => order.number), ['2', '10']);
  assert.deepEqual(orders.map(order => order.number), ['10', '2', '1']);
});

test('display settings validate theme and layout independently and handle unreadable storage', t => {
  let stored = null;
  const storage = {getItem(key) {
    assert.equal(key, displayKey);
    return stored;
  }};
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:storage});
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  assert.deepEqual(readDisplayPreferences(), {theme:'violet', layout:'table', accents:{}});
  stored = '{"theme":"sand","layout":"kanban"}';
  assert.deepEqual(readDisplayPreferences(), {theme:'sand', layout:'kanban', accents:{}});
  stored = '{"theme":"constructor","layout":"split"}';
  assert.deepEqual(readDisplayPreferences(), {theme:'violet', layout:'split', accents:{}});
  stored = '{"theme":"sand","accents":{"violet":"#54a080","sand":"invalid"}}';
  assert.deepEqual(readDisplayPreferences(), {theme:'sand', layout:'split', accents:{violet:'#54a080'}});
  stored = '{"theme":"sand","layout":"timeline"}';
  assert.deepEqual(readDisplayPreferences(), {theme:'sand', layout:'split', accents:{}});
  stored = '{"theme":';
  assert.deepEqual(readDisplayPreferences(), {theme:'violet', layout:'table', accents:{}});
});

test('pickup and delivery sort by the earliest valid window and put missing dates last in both directions', () => {
  const records = [
    ['A', ['12.11.2026 09:00'], ['15.11.2026 9:00', '13.11.2026 18:00']],
    ['B', ['14.11.2026'], ['13.11.2026 8:30–11:00']],
    ['C', ['32.11.2026'], ['Без даты']],
    ['D', ['11.11.2026'], ['13.11–14.11.2026 до 23:00']],
    ['E', ['2026-11-12T10:00'], ['2026-11-13T12:15']],
  ].map(([number, pickups, deliveries]) => ({
    ...makeOrder(number, '2026-11-01', {}),
    points:[...pickups.map(schedule => ({kind:'Погрузка', schedule, address:''})),
      ...deliveries.map(schedule => ({kind:'Выгрузка', schedule, address:''}))],
  }));
  const numbers = (sort, ascending) => selectOrders(records, {...query, sort, ascending}).map(order => order.number);
  assert.deepEqual(numbers('delivery', true), ['D', 'B', 'E', 'A', 'C']);
  assert.deepEqual(numbers('delivery', false), ['A', 'E', 'B', 'D', 'C']);
  assert.deepEqual(numbers('pickup', true), ['D', 'A', 'E', 'B', 'C']);
});
