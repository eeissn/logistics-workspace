import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync, strFromU8} from 'fflate';
import {labSamples, makeWorkbook} from '../src/excel-lab.mjs';
import {previewLedgerWorkbook} from '../src/ledger.mjs';

test('Excel Lab produces three safe XLSX packages with different layouts', () => {
  for (const [key, sample] of Object.entries(labSamples)) {
    const archive = unzipSync(makeWorkbook(sample.sheets));
    assert.ok(archive['[Content_Types].xml'], key);
    assert.ok(archive['xl/workbook.xml'], key);
    assert.equal(Object.keys(archive).filter(path => /^xl\/worksheets\/sheet\d+\.xml$/.test(path)).length,
      sample.sheets.length);
    const workbook = strFromU8(archive['xl/workbook.xml']);
    assert.ok(workbook.includes(sample.sheets[0].name), key);
  }
});

test('alternative and reordered sample rows match the same import logic', () => {
  for (const key of ['alternate','reordered']) {
    const result = previewLedgerWorkbook(labSamples[key].sheets.map(sheet => ({
      sheet:sheet.name, data:sheet.rows
    })), []);
    assert.equal(result.orders.length, 2, key);
    assert.equal(result.invalid, 0, key);
    assert.equal(result.orders[0].customerAmount > 0, true);
    assert.equal(result.orders[0].carrierAmount > 0, true);
  }
  assert.throws(() => previewLedgerWorkbook(labSamples.invalid.sheets.map(sheet => ({
    sheet:sheet.name, data:sheet.rows
  })), []), /нет листов с колонками/i);
});
