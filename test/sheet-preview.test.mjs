import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetText } from '../src/sheet-preview.mjs';

test('sheet paste fills explicit values and leaves dates without a year empty', () => {
  assert.deepEqual(parseSheetText('Заявка 41002, перевозка оборудования, 35 000,50 рублей, обратились 13 ноября, обещали 18 ноября 2026'), {
    number:'41002', title:'перевозка оборудования', amount:'35000.50', promised:'2026-11-18',
  });
});
