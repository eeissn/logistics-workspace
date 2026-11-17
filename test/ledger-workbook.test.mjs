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

test('different logistics workbook headers, reordered columns and blank cover rows', () => {
  const headers = ['Клиент', 'Номер рейса', 'Разгрузка', 'ТК', 'Дата создания',
    'Погрузка', 'Стоимость перевозчика', 'Маршрут', 'Доход', 'Прибыль'];
  const result = previewLedgerWorkbook([
    {sheet:'Рейсы', data:[
      ['Учебная книга: альтернативный формат'],
      ['Подготовлена для теста импорта'],
      headers,
      ['ООО Пример', 'ALT-100', '18.11.2026 17:30', 'ИП Тест', '17.11.2026',
        '17.11.2026 09:00', '65000 без НДС', 'Казань → Самара', '90000 НДС 22%', 25000],
      ['ООО Пример', 'ALT-101', '19.11.2026', 'ИП Тест', '18.11.2026',
        '18.11.2026', '41000 без НДС', 'Москва → Тула', '56000 без НДС', 15000]
    ]},
    {sheet:'Инструкция', data:[['Неподходящие заголовки'], ['Это не реестр']]},
  ], []);
  assert.deepEqual(result.orders.map(item => item.number), ['ALT-100', 'ALT-101']);
  assert.equal(result.orders[0].date, '2026-11-17');
  assert.equal(result.orders[0].customerAmount, 90000);
  assert.equal(result.orders[0].carrierAmount, 65000);
  assert.equal(result.orders[0].customerTax, '22');
  assert.equal(result.orders[0].carrierTax, '0');
  assert.equal(result.orders[0].ledgerMargin, 25000);
  assert.deepEqual(result.included, ['Рейсы']);
  assert.deepEqual(result.skipped, ['Инструкция']);
  assert.equal(result.invalid, 0);
});

test('ambiguous aliases or missing essential columns are never silently imported', () => {
  const required = ['Дата', 'Номер заявки', 'Заказчик', 'Перевозчик', 'Направление',
    'Ставка с Заказчиком', 'Ставка с Перевозчиком', 'Маржа', 'Загрузка', 'Выгрузка'];
  assert.throws(() => previewLedgerWorkbook([
    {sheet:'Дубли колонок', data:[[...required, 'Клиент'], ['17.11.2026', 'X']]}
  ], []), /нет листов с колонками/i);
  assert.throws(() => previewLedgerWorkbook([
    {sheet:'Без ставки', data:[required.filter(name => name !== 'Ставка с Перевозчиком')]}
  ], []), /нет листов с колонками/i);
});
