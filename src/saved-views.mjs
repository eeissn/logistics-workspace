import {displayKey} from './registry.mjs';

// Safe saved UI rules; legacy browser copies remain available for explicit migration.
const allowedScopes=new Set(['active','history']);
const allowedViews=new Set(['all','not-unloaded','planned','loaded','completed','failed','pickup','delivery']);
const allowedEtrn=new Set(['','pending','Подписана','Закрыта вручную','Не требуется']);
const allowedFinancial=new Set(['','issues','loss','low','unknown']);
const allowedSort=new Set(['delivery','pickup','date','number','customer','carrier','route','trip','etrn']);

export const userViewsKey = email => displayKey+':custom-views:'+
  encodeURIComponent(String(email||'demo').trim().toLowerCase());
export function parseSavedViews(value) {
  if(!Array.isArray(value))return [];
  const seen=new Set();
  const result=[];
  for(const entry of value.slice(0,25)){
    if(!entry||typeof entry!=='object')continue;
    const name=String(entry.name||'').trim().slice(0,45);
    if(!name||seen.has(name.toLowerCase()) ||
      !allowedScopes.has(entry.scope)||!allowedViews.has(entry.view)||
      !allowedEtrn.has(entry.etrn)||!allowedFinancial.has(entry.financial)||
      !allowedSort.has(entry.sort))continue;
    seen.add(name.toLowerCase());
    result.push({name,scope:entry.scope,view:entry.view,etrn:entry.etrn,
      financial:entry.financial,sort:entry.sort,
      ascending:entry.ascending!==false});
  }
  return result;
}
export function readSavedViews(email) {
  try{return parseSavedViews(JSON.parse(localStorage.getItem(userViewsKey(email))))}
  catch{return [];}
}
export function writeSavedViews(email, views) {
  try{localStorage.setItem(userViewsKey(email),JSON.stringify(parseSavedViews(views)));return true}
  catch{return false;}
}

// Merge only by explicit user action. Existing server names always win.
export function mergeLocalViews(server, local) {
  const current = parseSavedViews(server);
  const incoming = parseSavedViews(local);
  const names = new Set(current.map(item => item.name.toLowerCase()));
  const additions = incoming.filter(item => !names.has(item.name.toLowerCase()));
  return {views:[...current,...additions], added:additions.length,
    duplicates:incoming.length-additions.length, overflow:current.length+additions.length>25};
}
