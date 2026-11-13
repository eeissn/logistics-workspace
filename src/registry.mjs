import { dateRange, etrnStatus, scheduledToday, tripStatus } from './domain.mjs';

export const layoutLabels = {
  table: 'Таблица',
  compact: 'Компактный список',
  kanban: 'Канбан',
  split: 'Список + детали',
};
export const themeLabels = {violet: 'A Violet', sand: 'B Sand'};
export const defaultAccents = {violet:'#6035c6', sand:'#252525'};
export const validAccent = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export const displayKey = 'logistics-workspace:display:v1';

export function readDisplayPreferences() {
  try {
    const saved = JSON.parse(globalThis.localStorage.getItem(displayKey));
    return {
      theme: Object.hasOwn(themeLabels, saved?.theme) ? saved.theme : 'violet',
      layout: Object.hasOwn(layoutLabels, saved?.layout) ? saved.layout : 'table',
      accents: Object.fromEntries(Object.keys(themeLabels)
        .filter(theme => validAccent(saved?.accents?.[theme]))
        .map(theme => [theme, saved.accents[theme]])),
    };
  } catch {
    return {theme:'violet', layout:'table', accents:{}};
  }
}

export const pendingEtrn = order => ['К созданию', 'В работе'].includes(etrnStatus(order.etrn));

export function routeText(order) {
  if (order.route?.trim()) return order.route;
  const places = order.points.map(point => point.address.split(' · ').at(-1).split(',')[0].replace(/\s+(?:д|г|п)\.$/u,'').trim());
  return [...new Set(places.filter(Boolean))].join(' → ');
}

const scheduleKinds = {pickup:'Погрузка', delivery:'Выгрузка'};

function windowStart(order, kind) {
  const starts = [];
  for (const point of order.points) {
    if (point.kind !== kind) continue;
    const date = dateRange(point.schedule, order.date)[0];
    if (!date) continue;
    const instant = new Date(date);
    if (!Number.isFinite(instant.valueOf()) || instant.toISOString().slice(0, 10) !== date) continue;
    const time = point.schedule.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    starts.push(time ? date + 'T' + time[1].padStart(2,'0') + ':' + time[2] : date);
  }
  return starts.sort()[0] ?? '';
}

const sorts = {
  date: order => order.date || '',
  number: order => order.number,
  customer: order => order.customer || '',
  route: routeText,
  trip: tripStatus,
  etrn: order => etrnStatus(order.etrn),
};
const collator = new Intl.Collator('ru', {numeric:true});

export function selectOrders(orders, {query, filter, view, today, sort, ascending}) {
  const search = query.trim().toLocaleLowerCase('ru');
  const kind = scheduleKinds[view];
  const scheduleKind = scheduleKinds[sort];
  const key = scheduleKind ? order => windowStart(order, scheduleKind) : sorts[sort];
  return orders.filter(order => {
    const text = [order.number, order.customer, order.carrier, order.driver, order.etrn?.number,
      routeText(order), ...order.points.map(point => point.address)].join(' ').toLocaleLowerCase('ru');
    const stage = tripStatus(order);
    return text.includes(search)
      && (!kind || scheduledToday(order, kind, today))
      && (view !== 'not-unloaded' || (stage !== 'unloaded' && stage !== 'failed'))
      && (!filter || (filter === 'pending' ? pendingEtrn(order) : etrnStatus(order.etrn) === filter));
  }).map(order => ({order, value:key(order)})).sort((a, b) => {
    if (scheduleKind && Boolean(a.value) !== Boolean(b.value)) return a.value ? -1 : 1;
    return (ascending ? 1 : -1) * collator.compare(a.value, b.value)
      || collator.compare(b.order.date || '', a.order.date || '')
      || collator.compare(b.order.number, a.order.number);
  }).map(({order}) => order);
}
