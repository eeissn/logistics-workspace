import { tripStatus } from './domain.mjs';

// Keep the operational queue independent of archival and ETRN completion rules.
export function isActionable(order) {
  const stage = tripStatus(order);
  return stage !== 'unloaded' && stage !== 'failed';
}

export function monthOf(order) {
  return /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/.test(order.date || '')
    ? order.date.slice(0, 7) : '';
}

export function monthGroups(orders) {
  const groups = new Map();
  for (const order of orders) {
    const month = monthOf(order);
    groups.set(month, (groups.get(month) || 0) + 1);
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a))
    .map(([month, count]) => ({month, count}));
}

export function scopeOrders(orders, {scope = 'active', month = 'all', search = ''} = {}) {
  if (scope === 'active') return orders.filter(isActionable);
  if (scope !== 'history') throw new Error('Unknown registry scope.');
  // Searching history always searches every month, even when a month is selected.
  if (search.trim() || month === 'all') return orders;
  return orders.filter(order => (monthOf(order) || 'undated') === month);
}
