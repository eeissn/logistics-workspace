import { blankOrder } from './domain.mjs';

function demoOrder(today) {
  const schedule = today.split('-').reverse().join('.');
  return {
    ...blankOrder(),
    number: 'ДЕМО-001', date: today, route: 'Казань → Самара',
    customer: 'ООО «Демо Заказчик»', carrier: 'ИП Демо Перевозчик',
    driver: 'Демидов Тест Тестович', passport: '0000 000000 · учебный пример',
    vehicle: 'КАМАЗ · А000АА 000', cargo: 'Одежда · 19 паллет',
    customerAmount: 90000, carrierAmount: 65000, customerTax: '22', carrierTax: '0',
    points: [
      {kind:'Погрузка', address:'Казань', schedule: schedule + ' 09:00–12:00', contacts:[]},
      {kind:'Выгрузка', address:'Самара', schedule: schedule + ' 15:00–18:00', contacts:[]},
    ],
    contacts:[{role:'Водитель',name:'Демидов Тест Тестович',values:['+70000000001']}],
    trip: {stage:'signed'}, etrn: {required:true, number:'ДЕМО-001'},
  };
}

export function demoOrders(today) {
  const first = demoOrder(today);
  const date = today.split('-').reverse().join('.');
  const example = (number, route, stage, pickup, delivery, etrn = {required:true}) => {
    const [from, to] = route.split(' → ');
    return {
      ...blankOrder(), number, date:today, route, trip:{stage}, etrn,
      customer:'ООО «Учебный заказчик»', carrier:'ООО «Учебный перевозчик»',
      points:[
        {kind:'Погрузка', address:from, schedule:pickup ? date + ' ' + pickup : '', contacts:[]},
        {kind:'Выгрузка', address:to, schedule:delivery ? date + ' ' + delivery : '', contacts:[]},
      ],
    };
  };

  return [
    first,
    example('ДЕМО-002', 'Тула → Калуга', 'new', '10:00–12:00', '13:00–15:00'),
    example('ДЕМО-003', 'Рязань → Тамбов', 'loaded', '08:00–10:00', '16:00–18:00', {required:true, created:true}),
    example('ДЕМО-004', 'Владимир → Иваново', 'unloaded', '07:00–09:00', '10:00–12:00', {required:true, created:true}),
    example('ДЕМО-005', 'Пермь → Ижевск', 'new', '', ''),
    example('ДЕМО-006', 'Омск → Тюмень', 'unloaded', '08:00–10:00', '12:00–14:00', {required:false}),
    example('ДЕМО-007', 'Тверь → Ярославль', 'failed', '', ''),
  ];
}
