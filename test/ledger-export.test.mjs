import test from 'node:test';
import assert from 'node:assert/strict';
import {readSheet} from 'read-excel-file/node';
import {unzipSync, strFromU8} from 'fflate';
import {blankOrder} from '../src/domain.mjs';
import {exportLedger} from '../src/ledger-export.mjs';

test('XLSX preserves typed dates, amounts and literal input without personal documents', async () => {
  const order = {...blankOrder(), number:'00021', date:'2026-11-14', customer:'=1+1',
    carrier:'Тест & <склад>', customerAmount:1200.25, passport:'PRIVATE-PASSPORT'};
  const bytes = exportLedger([order], {parties:true, money:true});
  const [, row] = await readSheet(Buffer.from(bytes), 'Заявки');
  assert.equal(row[0], '00021');
  assert.equal(row[1].toISOString(), '2026-11-14T00:00:00.000Z');
  assert.deepEqual(row.slice(5,8), ['=1+1','Тест & <склад>',1200.25]);
  const sheet = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
  assert.doesNotMatch(sheet, /<f[ >]|PRIVATE-PASSPORT/);
});
