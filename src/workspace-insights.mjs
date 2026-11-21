import {etrnStatus, hasMargin, orderMargin, tripStatus} from './domain.mjs';

// UI-only insights: never mutate orders, never infer payment dates from missing data.
export const financialFlags = (order, minimum = 0.10) => {
  if (tripStatus(order) === 'failed' && order.ledgerMargin === 0) return [];
  if (!hasMargin(order) && !Number.isFinite(order.ledgerMargin)) return ['unknown'];
  const value = orderMargin(order);
  if (value == null || !Number.isFinite(value)) return ['unknown'];
  if (value < 0) return ['loss'];
  if (Number.isFinite(order.carrierAmount) && order.carrierAmount > 0 && value < order.carrierAmount * minimum) return ['low'];
  return [];
};
export const flagLabels = Object.freeze({
  unknown:'Не все ставки или ставки НДС заполнены',
  loss:'Отрицательная маржа',
  low:'Маржа меньше 10% от ставки перевозчика',
});
export function monthlyComparison(orders, first, second, threshold = 0.10) {
  const aggregate = month => {
    const values = orders.filter(order => order.date?.slice(0,7) === month);
    const margins = values.map(orderMargin)
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
  const stages = ['К созданию', 'Заказ-заявка создана', 'В работе', 'Подписана'];
  const currentIndex = stages.indexOf(status);
  return stages.map((title, index) => ({
    title, state:status === 'Закрыта вручную' ? 'manual' :
      status === 'Не требуется' ? 'not-required' :
      index === currentIndex ? 'current' :
      index < currentIndex ? 'done' : 'pending',
  }));
};
export const safeRecordText = order => [order.number,order.customer,order.carrier,
  order.route,order.driver].filter(Boolean).join(' ');
