import test from 'node:test';
import assert from 'node:assert/strict';
import {financialFlags,flagLabels,monthlyComparison,savedViewPresets,tripTimeline,etrnTimeline} from '../src/workspace-insights.mjs';
import {orderMargin} from '../src/domain.mjs';

const sample=(number,date,margin,stage='unloaded')=>({
  number,date,customer:'ООО Пример',carrier:'ИП Тест',
  customerAmount:90000,carrierAmount:65000,customerTax:'22',carrierTax:'0',
  ledgerMargin:margin,trip:{stage},
  points:[],etrn:{required:true,created:true,number},
});

test('finance: compare months with failed compensation and missing values included',()=>{
  const orders=[
    sample('A','2026-09-02',1000),sample('B','2026-09-03',5000),
    sample('C','2026-09-04',3000),sample('D','2026-09-05',40000,'failed'),
    sample('E','2026-10-11',-2000),
    {...sample('F','2026-10-11',3000),customerAmount:null,carrierAmount:null,
      ledgerMargin:null},
  ];
  const result=monthlyComparison(orders,'2026-09','2026-10');
  assert.equal(result.before.count,4);
  assert.equal(result.before.total,49000);
  assert.equal(result.before.median,4000);
  assert.equal(result.before.average,12250);
  assert.equal(result.after.count,2);
  assert.equal(result.after.calculated,1);
  assert.equal(result.after.total,-2000);
  assert.equal(result.after.issues,2);
  assert.equal(result.delta,-51000);
  assert.ok(result.percent<0);
});

test('finance: imported margin is authoritative and alerts never adjust numbers',()=>{
  const order=sample('N','2026-11-11',-4000);
  const original=structuredClone(order);
  assert.deepEqual(financialFlags(order),['loss']);
  assert.deepEqual(financialFlags({...order,ledgerMargin:4000}),['low']);
  assert.deepEqual(financialFlags({...order,ledgerMargin:6500}),[]); // exactly 10%
  assert.deepEqual(financialFlags({...order,ledgerMargin:6499.99}),['low']);
  assert.deepEqual(financialFlags({...order,ledgerMargin:4107,carrierAmount:31000}),[]); // #7379
  assert.deepEqual(financialFlags({...order,ledgerMargin:10000}),[]);
  assert.deepEqual(financialFlags({...order,ledgerMargin:null,
    customerAmount:null}),['unknown']);
  assert.equal(orderMargin(order),-4000);
  assert.deepEqual(order,original);
  assert.ok(flagLabels.unknown && flagLabels.low && flagLabels.loss);
});

test('saved views: stable unique IDs, no guesswork about unpaid requests',()=>{
  assert.equal(new Set(savedViewPresets.map(item=>item.id)).size,savedViewPresets.length);
  assert.ok(savedViewPresets.some(item=>item.id==='awaiting-etrn' && item.etrn==='pending'));
  assert.equal(savedViewPresets.some(item=>item.id==='money-issues'),false);
  assert.equal(savedViewPresets.some(item=>item.id==='unpaid'),false);
});

test('timeline: trip and ETRN are independent and explicit',()=>{
  const order=sample('A','2026-11-11',1000,'loaded');
  const trip=tripTimeline(order);
  const document=etrnTimeline(order);
  assert.deepEqual(trip.map(item=>item.state),['done','current','pending']);
  assert.equal(document.find(item=>item.title==='В работе').state,'current');
  order.etrn.allSigned=true;
  assert.equal(etrnTimeline(order).at(-1).state,'current');
  assert.equal(tripTimeline(order)[1].state,'current');
});

test('ETRN timeline shows the distinct agreement-created stage and all transitions', () => {
  const base=sample('T','2026-11-18',3000);
  const states=etrn=>etrnTimeline({...base,etrn});
  const titles=['К созданию','Заказ-заявка создана','В работе','Подписана'];
  assert.deepEqual(states({required:true}).map(item=>item.title),titles);
  assert.deepEqual(states({required:true}).map(item=>item.state),
    ['current','pending','pending','pending']);
  assert.deepEqual(states({required:true,orderForm:true}).map(item=>item.state),
    ['done','current','pending','pending']);
  assert.deepEqual(states({required:true,orderForm:true,created:true}).map(item=>item.state),
    ['done','done','current','pending']);
  assert.deepEqual(states({required:true,orderForm:true,created:true,number:'T',allSigned:true})
    .map(item=>item.state),['done','done','done','current']);
  assert.deepEqual(states({required:true,manualComplete:true})
    .map(item=>item.state),['manual','manual','manual','manual']);
  assert.deepEqual(states({required:false})
    .map(item=>item.state),['not-required','not-required','not-required','not-required']);
});

test('P0: cancelled trip with custom or calculated margin affects comparison and flags', () => {
  const orders=[
    sample('C1','2026-10-01',7000,'failed'),
    sample('C2','2026-10-02',-2500,'failed'),
    sample('C3','2026-10-03',0,'failed'),
    {...sample('C4','2026-10-04',null,'failed'),
      customerAmount:null,carrierAmount:null,ledgerMargin:null},
    sample('N1','2026-11-01',1000),
  ];
  const {before,after,delta}=monthlyComparison(orders,'2026-10','2026-11');
  assert.equal(before.count,4);
  assert.equal(before.calculated,3);
  assert.equal(before.total,4500);
  assert.equal(before.average,1500);
  assert.equal(before.median,0);
  assert.equal(before.issues,3); // loss, low, unknown: nonfinancial status doesn't hide flags
  assert.equal(after.total,1000);
  assert.equal(delta,-3500);
});
