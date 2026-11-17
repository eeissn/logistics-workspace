import test from 'node:test';
import assert from 'node:assert/strict';
import {financialFlags, matchesPreset, monthComparison, viewPresets} from '../src/workspace-extras.mjs';
const order=(number,date,amount,extras={})=>({
  number,date,customerAmount:amount,carrierAmount:1000,
  customerTax:'0',carrierTax:'0',points:[],trip:{stage:'unloaded'},
  payment:{},etrn:{required:true,created:false,number:''},...extras,
});
test('approved work views remain read-only and distinguish payment review from debt',()=>{
  assert.equal(new Set(viewPresets.map(item=>item.id)).size,5);
  const item=order('A','2026-11-17',8000);
  assert.ok(matchesPreset(item,'unpaid','2026-11-17'));
  assert.ok(matchesPreset(item,'etrn','2026-11-17'));
  assert.ok(!matchesPreset({...item,payment:{confirmedPaid:true}},'unpaid','2026-11-17'));
  assert.ok(matchesPreset(item,'today','2026-11-17'));
  assert.ok(!matchesPreset({...item,trip:{stage:'failed'}},'unpaid','2026-11-17'));
});
test('margin warnings never recalculate or mutate the underlying invoice amounts',()=>{
  const low=order('L','2026-11-12',2000);
  const loss=order('N','2026-11-12',500);
  const unknown=order('U','2026-11-12',null);
  assert.deepEqual(financialFlags(low).map(item=>item.key),['low']);
  assert.deepEqual(financialFlags(loss).map(item=>item.key),['negative']);
  assert.deepEqual(financialFlags(unknown).map(item=>item.key),['missing']);
  assert.deepEqual(financialFlags({...loss,trip:{stage:'failed'}}),[]);
  assert.equal(low.customerAmount,2000);
});
test('monthly comparison excludes failed trips and unknown margins from averages',()=>{
  const rows=[order('A','2026-10-03',6000,{ledgerMargin:5000}),
    order('B','2026-10-05',11000,{ledgerMargin:10000}),
    order('C','2026-11-03',15000,{ledgerMargin:14000}),
    order('D','2026-11-05',null),
    order('E','2026-11-15',20000,{trip:{stage:'failed'},ledgerMargin:19000})];
  const result=monthComparison(rows,'2026-10','2026-11');
  assert.equal(result.first.count,2);
  assert.equal(result.first.total,15000);
  assert.equal(result.first.median,7500);
  assert.equal(result.second.count,2);
  assert.equal(result.second.known,1);
  assert.equal(result.second.unknown,1);
  assert.equal(result.second.total,14000);
  assert.equal(result.second.average,14000);
  assert.equal(result.delta,-1000);
  assert.throws(()=>monthComparison(rows,'2026-13','2026-11'));
});
