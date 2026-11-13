import { blankOrder } from './domain.mjs';

const required = ['Дата','Номер заявки','Заказчик','Перевозчик','Направление','Ставка с Заказчиком','Ставка с Перевозчиком','Маржа','Загрузка','Выгрузка','Заказ-заявка','ЭТРН'];
const normalized = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const checked = value => value === true || /^(да|true|✓|✔|1)$/iu.test(normalized(value));

function formatDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0,10);
  const raw = normalized(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return date ? `${date[3]}-${date[2].padStart(2,'0')}-${date[1].padStart(2,'0')}` : '';
}

function schedule(value) {
  const date = formatDate(value);
  return date ? date.split('-').reverse().join('.') : normalized(value);
}

function amount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = normalized(value).match(/^-?\d[\d ]*(?:[,.]\d+)?/);
  return match ? Number(match[0].replace(/ /g,'').replace(',','.')) : null;
}

function tax(value) {
  const text = normalized(value);
  if (/без\s+НДС/i.test(text)) return '0';
  return text.match(/НДС\s*(5|22)\s*%/i)?.[1] ?? '';
}

export function parseLedger(rows, month, diagnostics, colors) {
  const header = rows.findIndex(row => required.every(name => row.map(normalized).includes(name)));
  if (header < 0) throw new Error('Не найдены колонки реестра «Заявки 2026».');
  const indices = Object.fromEntries(rows[header].map((name, index) => [normalized(name), index]));
  const orders = [];
  const seen = new Set();
  for (const [index, row] of rows.slice(header + 1).entries()) {
    const value = key => row[indices[key]];
    const number = normalized(value('Номер заявки'));
    const date = formatDate(value('Дата'));
    if (diagnostics && !row.some(cell => normalized(cell))) continue;
    if (diagnostics) diagnostics.found++;
    if (!number || number.length > 48 || !date || new Date(date + 'T00:00:00Z').toJSON()?.slice(0,10) !== date) {
      if (diagnostics) diagnostics.invalid++;
      continue;
    }
    if (!date.startsWith(month + '-')) continue;
    if (seen.has(number)) {
      if (!diagnostics) throw new Error('В таблице повторяется заявка № ' + number + '.');
      diagnostics.duplicates++;
      continue;
    }
    seen.add(number);
    const original = value('Ставка с Заказчиком');
    const carrier = value('Ставка с Перевозчиком');
    const orderForm = checked(value('Заказ-заявка'));
    const etrnCreated = checked(value('ЭТРН'));
    const order = blankOrder();
    const stage = colors?.get(header + index + 2);
    const points = [['Загрузка','Погрузка'],['Выгрузка','Выгрузка']]
      .filter(([key]) => schedule(value(key)))
      .map(([key,kind]) => ({kind,address:'',schedule:schedule(value(key)),scheduleSource:'Из Excel',contacts:[]}));
    orders.push({...order, number, date, customer:normalized(value('Заказчик')),
      carrier:normalized(value('Перевозчик')), route:normalized(value('Направление')),
      customerAmount:amount(original), carrierAmount:amount(carrier),
      customerTax:tax(original), carrierTax:tax(carrier),
      ledgerMargin:amount(value('Маржа')), points, trip:stage ? {stage} : order.trip,
      etrn:{...order.etrn, required:true, orderForm, created:etrnCreated},
    });
  }
  return orders;
}

export function addLedgerOrders(existing, imported) {
  const ids = new Set(existing.map(order => order.number));
  return [...imported.filter(order => !ids.has(order.number)).reverse(), ...existing];
}

export function previewLedger(rows, month, existing, colors) {
  const diagnostics = {found:0, invalid:0, duplicates:0};
  const imported = parseLedger(rows, month, diagnostics, colors);
  const ids = new Set(existing.map(order => order.number));
  const orders = imported.filter(order => !ids.has(order.number));
  const missing = new Map();
  for (const order of orders) {
    for (const [key, label] of [
      ['customer','Заказчик'], ['carrier','Перевозчик'], ['route','Маршрут'],
      ['customerAmount','Ставка заказчика'], ['carrierAmount','Ставка перевозчика'],
      ['customerTax','НДС заказчика'], ['carrierTax','НДС перевозчика'],
    ]) {
      if (order[key] === '' || order[key] === null) missing.set(label, (missing.get(label) ?? 0) + 1);
    }
  }
  return {...diagnostics, orders, missing, duplicates:diagnostics.duplicates + imported.length - orders.length};
}
