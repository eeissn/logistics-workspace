import {etrnStatus, monthReport, orderMargin, tripStatus} from './domain.mjs';

export const viewPresets = Object.freeze([
  {id:'today', label:'Сегодня'},
  {id:'etrn', label:'Ждём ЭТРН'},
  {id:'unpaid', label:'Проверить оплату'},
  {id:'problems', label:'Проблемные'},
  {id:'margin', label:'Финансовые риски'},
]);

export function financialFlags(order, minimum=5000) {
  if (tripStatus(order) === 'failed') return [];
  const flags=[];
  const value=orderMargin(order);
  if (value === null) flags.push({key:'missing',label:'Маржа не рассчитана'});
  else if (value < 0) flags.push({key:'negative',label:'Отрицательная маржа'});
  else if (value < minimum) flags.push({key:'low',label:'Низкая маржа'});
  return flags;
}
export function matchesPreset(order,preset,day) {
  switch(preset) {
    case 'today': return order.date === day ||
      (order.points || []).some(point => String(point.schedule || '').includes(day) ||
        String(point.schedule || '').includes(day.split('-').reverse().join('.')));
    case 'etrn': return ['К созданию','В работе'].includes(etrnStatus(order.etrn)) &&
      tripStatus(order) !== 'failed';
    // Existing records do not contain authoritative paid/unpaid data.
    // This view is an explicitly labelled review queue, NOT a payment assertion.
    case 'unpaid': return tripStatus(order) === 'unloaded' &&
      !order.payment?.paidAt && !order.payment?.confirmedPaid;
    case 'problems': return tripStatus(order) === 'failed';
    case 'margin': return financialFlags(order).length > 0;
    default: return true;
  }
}
export function monthComparison(orders,left,right) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(left) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(right)) throw new Error('Выберите два месяца.');
  const measure = month => {
    const rows=monthReport(orders,month).rows;
    const known=rows.map(orderMargin).filter(value=>value!==null);
    const sorted=[...known].sort((a,b)=>a-b);
    return {
      month, count:rows.length, known:known.length,
      unknown:rows.length-known.length,
      total:known.reduce((sum,value)=>sum+value,0),
      average:known.length ? known.reduce((sum,value)=>sum+value,0)/known.length : null,
      median:known.length ? (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2 : null,
    };
  };
  const first=measure(left),second=measure(right);
  return {first,second,delta:second.total-first.total,
    changePercent:first.total===0 ? null : (second.total-first.total)/Math.abs(first.total)*100};
}
export const paymentReviewLabel='Требует проверки оплаты — не подтверждает задолженность';
