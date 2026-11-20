import test from 'node:test';
import assert from 'node:assert/strict';
import {readSheet} from 'read-excel-file/node';
import {unzipSync, strFromU8} from 'fflate';
import {blankOrder, orderMargin} from '../src/domain.mjs';
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

test('native Excel presentation preserves money precision and selected columns', async () => {
  const order={...blankOrder(),number:'00021',date:'2026-11-14',customer:'=1+1',
    customerAmount:1200.25,carrierAmount:800,customerTax:'0',carrierTax:'0',passport:'PRIVATE-PASSPORT'};
  for(const parties of [false,true]) {
    for(const money of [false,true]) {
      const bytes=exportLedger([order],{parties,money});
      const [headings,row]=await readSheet(Buffer.from(bytes),'Заявки');
      assert.equal(headings.length,5+(parties?2:0)+(money?3:0));
      assert.equal(row[0],'00021');
      assert.equal(row[1].toISOString(),'2026-11-14T00:00:00.000Z');
      if(money) assert.deepEqual(row.slice(-3),[1200.25,800,orderMargin(order)]);
      const parts=unzipSync(bytes);
      const sheet=strFromU8(parts['xl/worksheets/sheet1.xml']);
      assert.equal((sheet.match(/customWidth="1"/g)||[]).length,headings.length);
      assert.match(sheet,/<col min="2" max="2" width="13" customWidth="1"\/>/);
      assert.doesNotMatch(sheet,/<f[ >]|PRIVATE-PASSPORT/);
      const styles=strFromU8(parts['xl/styles.xml']);
      assert.match(styles,/numFmtId="4"[^>]*applyNumberFormat="1"/);
    }
  }
});
