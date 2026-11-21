export const etrnSteps = [
  ['created', 'Создана ЭТРН'],
  ['sender', 'Подписал грузоотправитель · погрузка'],
  ['pickupCarrier', 'Подписал перевозчик · погрузка'],
  ['recipient', 'Подписал грузополучатель · выгрузка'],
  ['deliveryCarrier', 'Подписал перевозчик · выгрузка'],
];

export const tripSteps = [
  ['signed', 'Заявка подписана', 'Подписана'],
  ['loaded', 'Машина загрузилась', 'Загрузилась'],
  ['unloaded', 'Машина выгрузилась', 'Выгрузилась'],
];

export function etrnProgress(etrn) {
  const status = etrnStatus(etrn);
  if (status !== 'В работе') return status;
  const signed = etrnSteps.slice(1).filter(([key]) => etrn[key]).length;
  return signed === 4 ? 'Нужен номер' : signed ? `${signed}/4 подписи` : 'Создана';
}

export function markTrip(order, key, checked) {
  if (!tripSteps.some(([id]) => id === key)) throw new Error('Неизвестный этап рейса.');
  return {...order, trip: {...order.trip, [key]: checked}};
}

export function mergeImport(order, current) {
  if (!current) return order;
  const sameDriver = order.driver && order.driver.toLocaleLowerCase('ru') === current.driver?.toLocaleLowerCase('ru');
  return {
    ...order, trip: current.trip ?? {}, ledgerMargin: current.ledgerMargin,
    passport: order.passport || (sameDriver ? current.passport : '') || '',
    etrn: {...order.etrn, ...current.etrn, required: current.etrn?.required || order.etrn.required},
  };
}

export function margin(customerAmount, customerTax, carrierAmount, carrierTax) {
  const incoming = parseFloat(customerAmount) || 0;
  const outgoing = parseFloat(carrierAmount) || 0;
  const net = (amount, tax) => tax === '22' ? amount / 1.22 : tax === '5' ? amount / 1.05 : amount;
  const deduct = customerTax === '22' && carrierTax !== '0';
  const netCustomer = net(incoming, customerTax);
  const netCarrier = deduct ? net(outgoing, carrierTax) : outgoing;
  const netMargin = netCustomer - netCarrier;
  const taxRate = customerTax === '22' ? 0.25 : 0.15;
  const profitTax = netMargin * taxRate;
  return {
    grossMargin: incoming - outgoing, netMargin, profitTax, taxRate,
    realProfit: netMargin - profitTax,
    vatPayable: incoming - netCustomer - (deduct ? outgoing - netCarrier : 0),
  };
}

export function etrnStatus(etrn) {
  if (etrn?.manualComplete) return 'Закрыта вручную';
  if (!etrn?.required) return 'Не требуется';
  if (etrn.created && etrn.number?.trim() && (etrn.allSigned ?? etrnSteps.every(([id]) => etrn[id]))) return 'Подписана';
  if (etrn.created) return 'В работе';
  if (etrn.orderForm) return 'Заказ-заявка создана';
  return 'К созданию';
}

export const blankOrder = () => ({
  number: '', date: '', route: '', customer: '', carrier: '', driver: '', passport: '', vehicle: '', cargo: '',
  customerAmount: null, carrierAmount: null, customerTax: '', carrierTax: '',
  payment: {originals: null, edo: null, unit: '', conditions: ''},
  points: [], contacts: [], differences: [], trip: {},
  etrn: {required: false, number: '', manualComplete: false},
});

export function upsert(orders, draft, previousNumber = null) {
  const number = draft.number.trim();
  if (!number) throw new Error('Укажите номер заявки.');
  if (orders.some(order => order.number === number && order.number !== previousNumber)) {
    throw new Error('Заявка с этим номером уже есть. Откройте её из реестра.');
  }
  const next = {...draft, number, updatedAt: new Date().toISOString()};
  return previousNumber === null ? [next, ...orders] : orders.map(order => order.number === previousNumber ? next : order);
}

export function hasMargin(order) {
  return order.customerAmount != null && order.carrierAmount != null && order.customerTax !== '' && order.carrierTax !== '';
}

export const tripStatuses = [
  ['new','Новая'], ['signed','Подписана'], ['loaded','Загрузился'],
  ['unloaded','Выгрузился'], ['failed','Срыв заявки'],
];

export function tripStatus(order) {
  const trip = order.trip || {};
  return trip.stage || (trip.unloaded ? 'unloaded' : trip.loaded ? 'loaded' : trip.signed ? 'signed' : 'new');
}

export function archived(order) {
  const stage = tripStatus(order);
  // A delivered trip is complete when ETRN is signed, explicitly closed
  // manually (including trips without ETRN), or not required at all.
  // If ETRN is required but not finished, keep the delivered trip actionable.
  return stage === 'failed' || (stage === 'unloaded' &&
    ['Подписана', 'Закрыта вручную', 'Не требуется'].includes(etrnStatus(order.etrn)));
}

export function dateRange(schedule, reference = '') {
  const fallback = /^\d{4}-/.test(reference) ? Number(reference.slice(0, 4)) : null;
  // Both PDF's DD.MM.YYYY and ISO YYYY-MM-DD / YYYY-MM-DDTHH:MM
  // windows must participate in today's pickup/delivery filters.
  const parts = [...String(schedule || '').matchAll(/\b(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?)(?!\d)/g)]
    .map(([, isoYear, isoMonth, isoDay, day, month, year]) => ({
      day: Number(isoDay || day), month: Number(isoMonth || month),
      year: isoYear || year ? Number(isoYear || year) : null,
    }));
  const dates = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    let year = part.year;
    if (year === null) {
      // A range such as 13.11-14.11.2027 belongs to 2027 even when the
      // order was created in 2026. For 31.12-01.01.2027, infer 2026.
      const following = parts.slice(index + 1).find(item => item.year !== null);
      const previous = [...parts.slice(0, index)].reverse().find(item => item.year !== null);
      if (following) year = following.year - (part.month > following.month ? 1 : 0);
      else if (previous) year = previous.year + (part.month < previous.month ? 1 : 0);
      else if (dates.length) {
        const last = dates.at(-1);
        year = Number(last.slice(0, 4)) + (part.month < parts[index - 1].month ? 1 : 0);
      } else year = fallback;
    }
    if (year === null || year < 1000 || year > 9999 || part.month < 1 || part.month > 12) continue;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (part.day < 1 || part.day > days[part.month - 1]) continue;
    dates.push(`${year}-${String(part.month).padStart(2, '0')}-${String(part.day).padStart(2, '0')}`);
  }
  return dates;
}

export function scheduledToday(order, kind, today) {
  return order.points.some(point => {
    if (point.kind !== kind) return false;
    const dates = dateRange(point.schedule, order.date);
    return dates.length && today >= dates[0] && today <= dates.at(-1);
  });
}

export function orderMargin(order) {
  if (Number.isFinite(order.ledgerMargin)) return order.ledgerMargin;
  return hasMargin(order) ? margin(order.customerAmount, order.customerTax, order.carrierAmount, order.carrierTax).realProfit : null;
}

export function withoutFinancialResult(order) {
  if (tripStatus(order) !== 'failed') throw new Error('Обнуление доступно только для сорванной заявки.');
  return {...order, ledgerMargin:0};
}

// The trip outcome does not erase earned or payable margin (including cancellation compensation).
export function monthSnapshot(orders, month, asOf = month + '-31') {
  const elapsed = orders.filter(order => order.date?.startsWith(month + '-') && order.date <= asOf);
  return {count: elapsed.length, total: monthReport(elapsed, month).total};
}

export function monthReport(orders, month) {
  const rows = orders.filter(order => order.date?.startsWith(month + '-'))
    .sort((a,b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, 'ru', {numeric:true}));
  return {rows, total: rows.reduce((sum, order) => sum + (orderMargin(order) ?? 0), 0)};
}
