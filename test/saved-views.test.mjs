import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSavedViews,userViewsKey,readSavedViews,writeSavedViews} from '../src/saved-views.mjs';

const item={name:'Мой реестр',scope:'history',view:'all',etrn:'pending',
  financial:'low',sort:'delivery',ascending:false};

test('saved views allow only safe UI rules and reject duplicates or arbitrary filter values',()=>{
  assert.deepEqual(parseSavedViews([item]),[item]);
  assert.equal(parseSavedViews([item,{...item,name:'МОЙ РЕЕСТР'}]).length,1);
  assert.deepEqual(parseSavedViews([{...item,scope:'other'}]),[]);
  assert.deepEqual(parseSavedViews([{...item,view:'__proto__'}]),[]);
  assert.deepEqual(parseSavedViews([{...item,financial:'salary'}]),[]);
  assert.deepEqual(parseSavedViews([{...item,etrn:'secret'}]),[]);
  assert.deepEqual(parseSavedViews(null),[]);
});

test('saved views are private to each browser account namespace',t=>{
  const values=new Map();
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,value),
  }});
  t.after(()=>original?Object.defineProperty(globalThis,'localStorage',original):
    delete globalThis.localStorage);
  assert.notEqual(userViewsKey('first@example.test'),userViewsKey('second@example.test'));
  assert.equal(writeSavedViews('first@example.test',[item]),true);
  assert.deepEqual(readSavedViews('first@example.test'),[item]);
  assert.deepEqual(readSavedViews('second@example.test'),[]);
  assert.ok(!JSON.stringify(values.get(userViewsKey('first@example.test')))
    .includes('ООО Пример'));
});
