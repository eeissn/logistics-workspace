import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePassport, parseLogistor} from '../src/import.mjs';
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
