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

export function parseLedger(rows, month) {
  const header = rows.findIndex(row => required.every(name => row.map(normalized).includes(name)));
  if (header < 0) throw new Error('Не найдены колонки реестра «Заявки 2026».');
  const indices = Object.fromEntries(rows[header].map((name, index) => [normalized(name), index]));
  const orders = [];
  const seen = new Set();
  for (const row of rows.slice(header + 1)) {
    const value = key => row[indices[key]];
    const number = normalized(value('Номер заявки'));
    const date = formatDate(value('Дата'));
    if (!number || !date.startsWith(month + '-')) continue;
    if (seen.has(number)) throw new Error('В таблице повторяется заявка № ' + number + '.');
    seen.add(number);
    const original = value('Ставка с Заказчиком');
    const carrier = value('Ставка с Перевозчиком');
    const orderForm = checked(value('Заказ-заявка'));
    const etrnCreated = checked(value('ЭТРН'));
    const order = blankOrder();
    const points = [['Загрузка','Погрузка'],['Выгрузка','Выгрузка']]
      .filter(([key]) => schedule(value(key)))
      .map(([key,kind]) => ({kind,address:'',schedule:schedule(value(key)),scheduleSource:'Из Excel',contacts:[]}));
    orders.push({...order, number, date, customer:normalized(value('Заказчик')),
      carrier:normalized(value('Перевозчик')), route:normalized(value('Направление')),
      customerAmount:amount(original), carrierAmount:amount(carrier),
      customerTax:tax(original), carrierTax:tax(carrier),
      ledgerMargin:amount(value('Маржа')), points,
      etrn:{...order.etrn, required:true, orderForm, created:etrnCreated},
    });
  }
  return orders;
}

export function addLedgerOrders(existing, imported) {
  const ids = new Set(existing.map(order => order.number));
  return [...imported.filter(order => !ids.has(order.number)).reverse(), ...existing];
}
