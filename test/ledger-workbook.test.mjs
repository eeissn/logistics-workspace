import test from 'node:test';
import assert from 'node:assert/strict';
import { previewLedgerWorkbook } from '../src/ledger.mjs';

test('annual preview handles older headers, template formulas, and duplicates across sheets', () => {
  const columns = ['Номер заявки','Заказчик','Перевозчик','Направление','Ставка с Заказчиком',
    'Ставка с Перевозчиком','Маржа','Загрузка','Выгрузка'];
  const result = previewLedgerWorkbook([
    {sheet:'Ноябрь', data:[['Дата', ...columns], ['2026-11-01','existing'], [null,null,null,null,null,null,null,0]]},
    {sheet:'Май', data:[[0, ...columns], ['2026-05-01','new'], ['2026-05-02','existing'], ['invalid','bad']]},
    {sheet:'Январь', data:[['Дата заявки', ...columns], ['2026-01-01','new'], ['2026-01-02','older']]},
    {sheet:'Сводка', data:[['Итого']]},
  ], [{number:'existing'}]);
  assert.deepEqual(result.orders.map(order => order.number), ['new','older']);
  assert.deepEqual([result.found,result.duplicates,result.invalid], [6,3,1]);
  assert.deepEqual(result.skipped, ['Сводка']);
});
