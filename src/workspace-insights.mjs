import {archived, etrnStatus, hasMargin, orderMargin, tripStatus} from './domain.mjs';

// UI-only insights: never mutate orders, never infer payment dates from missing data.
export const financialFlags = (order, minimum = 5000) => {
  if (!hasMargin(order)) return ['unknown'];
  const value = orderMargin(order);
  if (value == null || !Number.isFinite(value)) return ['unknown'];
  if (value < 0) return ['loss'];
  if (value < minimum) return ['low'];
  return [];
};
export const flagLabels = Object.freeze({
  unknown:'Не все ставки или ставки НДС заполнены',
  loss:'Отрицательная маржа',
  low:'Маржа ниже выбранного порога',
});
export function monthlyComparison(orders, first, second, threshold = 5000) {
  const aggregate = month => {
    const values = orders.filter(order => order.date?.slice(0,7) === month &&
      tripStatus(order) !== 'failed');
    const margins = values.filter(hasMargin).map(orderMargin)
      .filter(value => value != null && Number.isFinite(value)).sort((a,b) => a-b);
    const total = margins.reduce((sum,value)=>sum+value,0);
    return {
      month, count:values.length, calculated:margins.length, total,
      average:margins.length ? total/margins.length : null,
      median:margins.length ? (margins[Math.floor((margins.length-1)/2)] +
        margins[Math.floor(margins.length/2)])/2 : null,
      issues:values.filter(order => financialFlags(order,threshold).length > 0).length,
    };
  };
  const before = aggregate(first), after = aggregate(second);
  return {before,after,delta:after.total-before.total,
    percent:before.total === 0 ? null : (after.total-before.total)/Math.abs(before.total)*100};
}
export const savedViewPresets = Object.freeze([
  {id:'today-pickup',title:'Загрузка сегодня', view:'pickup',etrn:''},
  {id:'today-delivery',title:'Выгрузка сегодня',view:'delivery',etrn:''},
  {id:'awaiting-etrn',title:'Ждём ЭТРН',view:'all',etrn:'pending'},
  {id:'issues',title:'Проблемные',view:'failed',etrn:''},
  {id:'money-issues',title:'Финансовые риски',view:'all',etrn:'',financial:'issues'},
]);
// Payment deadlines are intentionally not guessed from originals/EDO terms.
// A future "Не оплачено" view requires explicit per-order payment status.
export const tripTimeline = order => {
  const stages = [['signed','Подписана'],['loaded','Загрузился'],['unloaded','Выгрузился']];
  const status = tripStatus(order);
  const index = stages.findIndex(([key])=>key===status);
  return stages.map(([key,title],position)=>({
    key,title, state:status==='failed'?'interrupted':
      index<0?'pending':position<index?'done':position===index?'current':'pending',
  }));
};
export const etrnTimeline = order => {
  const status = etrnStatus(order.etrn);
  return ['К созданию','В работе','Подписана'].map((title,index)=>({
    title,state:status==='Закрыта вручную'?'manual':
      status==='Не требуется'?'not-required':
      title===status?'current':
      ['К созданию','В работе','Подписана'].indexOf(status)>index?'done':'pending',
  }));
};
export const safeRecordText = order => [order.number,order.customer,order.carrier,
  order.route,order.driver].filter(Boolean).join(' ');
