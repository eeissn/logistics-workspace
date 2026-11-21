import test from 'node:test';
import assert from 'node:assert/strict';
import {blankOrder, monthReport, orderMargin, withoutFinancialResult} from '../src/domain.mjs';
import {financialFlags} from '../src/workspace-insights.mjs';

test('explicitly neutral failed trips retain identity, source rates and history but contribute zero',()=>{
  for(const amount of [-7000,7000,0,null]) {
    const order={...blankOrder(),number:'CANCEL-001',date:'2026-11-20',
      customerAmount:90000,carrierAmount:65000,customerTax:'22',carrierTax:'0',
      ledgerMargin:amount,trip:{stage:'failed'},contacts:[{role:'Водитель',values:['synthetic']} ]};
    const original=structuredClone(order);
    const neutral=withoutFinancialResult(order);
    assert.deepEqual(order,original);
    assert.deepEqual(neutral,{...original,ledgerMargin:0});
    assert.equal(orderMargin(neutral),0);
    assert.equal(monthReport([neutral],'2026-11').total,0);
    assert.deepEqual(financialFlags(neutral),[]);
    assert.equal(monthReport([neutral],'2026-11').rows.length,1);
    if(amount!==null) assert.equal(orderMargin(order),amount);
  }
});

test('neutral result requires an explicitly failed trip; other compensation is preserved',()=>{
  assert.throws(()=>withoutFinancialResult({...blankOrder(),trip:{stage:'loaded'}}),/сорванной/);
  const compensation={...blankOrder(),date:'2026-11-20',trip:{stage:'failed'},ledgerMargin:3500};
  assert.equal(monthReport([compensation],'2026-11').total,3500);
});
