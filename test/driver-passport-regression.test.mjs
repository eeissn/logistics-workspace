import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePassport, parseLogistor, importPair} from '../src/import.mjs';
import {driverMessage} from '../src/driver.mjs';

test('passport issue date is retained and trailing subdivision abbreviation is removed', () => {
  assert.equal(
    normalizePassport('4623 343897 ГУ МВД России по Московской области 29.11.2023 к.п.'),
    '4623 343897 ГУ МВД России по Московской области от 29.11.2023'
  );
  assert.equal(
    normalizePassport('3405 804484 Отделом внутренних дел Костромского района Костромской области от 16.06.2006'),
    '3405 804484 Отделом внутренних дел Костромского района Костромской области от 16.06.2006'
  );
});

test('driver message takes name, passport, tractor and trailer from the same order', () => {
  const first = {driver: 'Пугач Алексей Александрович',
    passport: '4623 343897 ГУ МВД России по Московской области 29.11.2023 к.п.',
    vehicle: 'DAF · Н799ЕЕ 790 · ХУ9485 77',
    contacts: [{role:'Водитель',values:['+79154022820']}]};
  const second = {driver:'Гемуев Виталий Борисович',
    passport:'0111 629426 Отделом УФМС России по Алтайскому краю',
    vehicle:'ГАЗ · О 309 ОТ 31',
    contacts:[{role:'Водитель',values:['+79092037272']}]};
  const textA=driverMessage(first);
  const textB=driverMessage(second);
  assert.match(textA,/Паспорт: .* от 29\.11\.2023/);
  assert.match(textA,/Прицеп: ХУ9485 77/);
  assert.doesNotMatch(textB,/Прицеп:|Пугач|29\.11\.2023/);
  assert.match(textB,/Гемуев Виталий Борисович/);
});

test('PDF 7380 layout: two paired Logistor documents preserve passport date and trailer', () => {
  // Structure follows the actual Nov 17 PDF exports; personal data is anonymized.
  const common = [
    'ПОГРУЗКА: Склад',
    'г. Ногинск',
    'Дата и время: 18.11.2026 c 08:00 до 17:00',
    'ВЫГРУЗКА: Ленинградская область',
    'Дата и время: 19.11.2026 c 09:00 до 17:00',
    'ИНФОРМАЦИЯ О ГРУЗЕ:',
    'Данные водителя:                                                   Данные авто:',
    'ФИО: Тестов Алексей Александрович                                  Марка тягача: DAF',
    'Паспорт: 4623 000000 ГУ МВД России по Московской области 29.11.2023 к.п.     Номер тягача: Н000ЕЕ 790',
    'Контактный телефон: +7915-000-00-00                               Номер прицепа: ХУ0000 77',
  ].join('\n');
  const customer = [
    'Заявка № 7380 от 17.11.2026',
    'Исполнитель: ООО СПУТНИК 2',
    'Заказчик: ООО РОСНЕТ',
    common,
    'ОПЛАТА: 63 500 рублей. б/нал с НДС 22%',
  ].join('\n');
  const carrier = [
    'Договор-Заявка № 7380 от 17.11.2026',
    'Исполнитель: ООО ИСТВЕСТЛАЙН+',
    'Заказчик: ООО СПУТНИК 2',
    common,
    'ОПЛАТА: 44 000 рублей. б/нал без НДС, по оригиналам 4 или по ЭДО 6 банковских дней + ЭТРН',
  ].join('\n');
  const parsed = importPair(customer, carrier);
  assert.equal(parsed.number, '7380');
  assert.equal(parsed.passport, '4623 000000 ГУ МВД России по Московской области от 29.11.2023');
  assert.equal(parsed.vehicle, 'DAF · Н000ЕЕ 790 · ХУ0000 77');
  assert.equal(parsed.customerAmount, 63500);
  assert.equal(parsed.carrierAmount, 44000);
  assert.match(driverMessage(parsed), /Прицеп: ХУ0000 77/);
  assert.doesNotMatch(driverMessage(parsed), /к\\.п\\./);
});
