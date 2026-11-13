import { etrnStatus, scheduledToday, tripStatus } from './domain.mjs';

export const layoutLabels = {
  table: 'Таблица',
  compact: 'Компактный список',
  kanban: 'Канбан',
  split: 'Список + детали',
};
export const themeLabels = {violet: 'A Violet', sand: 'B Sand'};
export const displayKey = 'logistics-workspace:display:v1';

export function readDisplayPreferences() {
  try {
    const saved = JSON.parse(globalThis.localStorage.getItem(displayKey));
    return {
      theme: Object.hasOwn(themeLabels, saved?.theme) ? saved.theme : 'violet',
      layout: Object.hasOwn(layoutLabels, saved?.layout) ? saved.layout : 'table',
    };
  } catch {
    return {theme:'violet', layout:'table'};
  }
}

export const pendingEtrn = order => ['К созданию', 'В работе'].includes(etrnStatus(order.etrn));

export function routeText(order) {
  if (order.route?.trim()) return order.route;
  const places = order.points.map(point => point.address.split(' · ').at(-1).split(',')[0].replace(/\s+(?:д|г|п)\.$/u,'').trim());
  return [...new Set(places.filter(Boolean))].join(' → ');
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
  const kind = {pickup:'Погрузка', delivery:'Выгрузка'}[view];
  const key = sorts[sort];
  return orders.filter(order => {
    const text = [order.number, order.customer, order.carrier, order.driver, order.etrn?.number,
      routeText(order), ...order.points.map(point => point.address)].join(' ').toLocaleLowerCase('ru');
    const stage = tripStatus(order);
    return text.includes(search)
      && (!kind || scheduledToday(order, kind, today))
      && (view !== 'not-unloaded' || (stage !== 'unloaded' && stage !== 'failed'))
      && (!filter || (filter === 'pending' ? pendingEtrn(order) : etrnStatus(order.etrn) === filter));
  }).sort((a, b) => (ascending ? 1 : -1) * collator.compare(key(a), key(b))
    || collator.compare(b.date || '', a.date || '') || collator.compare(b.number, a.number));
}
