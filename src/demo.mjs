import { blankOrder } from './domain.mjs';

export function demoOrder(today) {
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
