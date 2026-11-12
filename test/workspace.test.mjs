import test from 'node:test';
import assert from 'node:assert/strict';
import { margin, etrnSteps, etrnStatus, etrnProgress, markTrip, mergeImport, upsert, archived, monthReport, scheduledToday } from '../src/domain.mjs';
import { parseLedger, addLedgerOrders } from '../src/ledger.mjs';
import { driverMessage } from '../src/driver.mjs';
import { importPair, phones } from '../src/import.mjs';
import { linesFromItems } from '../src/pdf-lines.mjs';

const client = `Заявка № 1234 от 09.11.2026
Исполнитель: ООО Экспедитор
Контактное лицо: Тел./факс: Диспетчер (89000000001)
Заказчик: ИП Заказчик
Контактное лицо: Тел./факс: Отдел логистики (89000000002)
ПОГРУЗКА:
Адрес А
Контакт: +7 (900) 000-00-03 Алексей
Дата и время: 10.11.2026 c 09:00 до 20:00
ВЫГРУЗКА: РЦ
Адрес Б
Контакт: +7 (900) 000-00-04 Склад
Дата и время: 11.11.2026-12.11.2026 c 01:00 до 23:00
ИНФОРМАЦИЯ О ГРУЗЕ:
ФИО: Водитель Тестовый    Марка тягача: КАМАЗ
Контактный телефон: 89000000005    Номер прицепа:
ОПЛАТА: 90 000 рублей. б/нал с НДС 22%, в течение 5 календарных дней`;
const carrier = `Договор-Заявка № 1234 от 09.11.2026
Исполнитель: ИП Перевозчик
Контактное лицо: Тел./факс: Диспетчер (89000000006)    +79000000007
Заказчик: ООО Экспедитор
Контактное лицо: Тел./факс: Диспетчер (89000000001)
ПОГРУЗКА:
Адрес А
Контакт: +7 (900) 000-00-03 Алексей
Дата и время: 10.11.2026 c 09:00 до 20:00
ВЫГРУЗКА: РЦ
Адрес Б
Контакт:
Дата и время: 11.11.2026 c 01:00 до 23:00 - 12.11.2026 c 01:00 до 14:00
ИНФОРМАЦИЯ О ГРУЗЕ:
ФИО: Водитель Тестовый    Марка тягача: КАМАЗ
Контактный телефон: 89000000005    Номер прицепа:
ОПЛАТА: 65 000 рублей. б/нал без НДС, по оригиналам 6 или по ЭДО 8 банковских дней + ЭТРН
Оплата перевозки производится во вторник и пятницу при наличии полного комплекта документов.`;

test('пара PDF распознаётся в обоих порядках, расхождения сохраняются', () => {
  const order = importPair(client, carrier);
  assert.deepEqual(importPair(carrier, client), order);
  assert.equal(order.points[1].schedule, '11.11.2026 c 01:00 до 23:00 - 12.11.2026 c 01:00 до 14:00');
  assert.equal(order.points[1].scheduleSource, 'Перевозчик');
  assert.equal(order.differences.length, 1);
  assert.equal(order.differences[0].customer, '11.11.2026-12.11.2026 c 01:00 до 23:00');
});

test('сообщение водителя берёт его паспорт, транспорт и телефон из заявки перевозчика', () => {
  const changed = carrier.replace('ФИО: Водитель Тестовый    Марка тягача: КАМАЗ',
    'ФИО: Другой Водитель    Марка тягача: КАМАЗ\nПаспорт: 0000 000000 Учебный пример    Номер тягача: А000АА 000')
    .replace('89000000005','89000000008');
  const order = importPair(client, changed);
  assert.equal(driverMessage(order), [
    'Данные на водителя:', 'ФИО: Другой Водитель', 'Паспорт: 0000 000000 Учебный пример',
    'Транспорт: КАМАЗ А000АА 000', 'Номер телефона: +7900-000-00-08',
  ].join('\n'));
  assert.equal(mergeImport({...order, passport:''}, order).passport, order.passport);
  assert.equal(mergeImport({...order, passport:'', driver:'Новый Водитель'}, order).passport, '');
});

test('импортирует телефоны участников и точек без внутреннего номера', () => {
  const order = importPair(client, carrier);
  assert.deepEqual(order.contacts.map(contact => contact.values.flatMap(phones).length), [1,2,1]);
  assert.ok(!order.contacts.some(contact => contact.values.flatMap(phones).includes('+79000000001')));
  assert.deepEqual(order.points.map(point => point.contacts.flatMap(phones).length), [1,1]);
});

test('архив ждёт выгрузку и завершение ЭТРН, маржа архивных рейсов учитывается', () => {
  const base = {number:'1', date:'2026-11-30', ledgerMargin:700, trip:{stage:'unloaded'},
    etrn:{required:true, created:true, number:'1', allSigned:false}};
  assert.equal(archived(base), false);
  const finished = {...base, etrn:{...base.etrn, allSigned:true}};
  assert.equal(archived(finished), true);
  const failed = {...base, number:'2', trip:{stage:'failed'}};
  assert.equal(archived(failed), true);
  assert.equal(monthReport([finished, failed, {...base, number:'3', date:'2026-12-01'}], '2026-11').total, 700);
});

test('фильтр на сегодня учитывает окна из PDF и диапазоны дат из Excel', () => {
  const order = {date:'2026-11-10', points:[
    {kind:'Погрузка',schedule:'10.11.2026 с 09:00'},
    {kind:'Выгрузка',schedule:'11.11./13.11'},
  ]};
  assert.equal(scheduledToday(order,'Погрузка','2026-11-12'), false);
  assert.equal(scheduledToday(order,'Выгрузка','2026-11-12'), true);
  assert.equal(scheduledToday(order,'Выгрузка','2026-11-14'), false);
});

test('ноябрьский Excel сохраняет исходную маржу, не угадывает НДС и пропускает существующий номер', () => {
  const header = ['Дата','Номер заявки','Заказчик','Перевозчик','Направление','Ставка с Заказчиком','Ставка с Перевозчиком','Маржа','Загрузка','Выгрузка','Заказ-заявка','ЭТРН'];
  const row = [new Date('2026-11-12'),7346,'Заказчик','Перевозчик','А — Б','59 000 с НДС','50 000 с НДС 5%',14754,new Date('2026-11-12'),'12.11/13.11',true,true];
  const [order] = parseLedger([header, row, [null,null], [new Date('2026-10-01'),1]],'2026-11');
  assert.equal(order.number,'7346');
  assert.equal(order.customerTax,'');
  assert.equal(order.carrierTax,'5');
  assert.equal(order.etrn.orderForm,true);
  assert.equal(etrnStatus(order.etrn),'В работе');
  assert.equal(monthReport([order], '2026-11').total,14754);
  assert.deepEqual(addLedgerOrders([{number:'7346',customer:'Уже сохранена'}],[order]),[{number:'7346',customer:'Уже сохранена'}]);
});

test('платёжные сроки берутся только из PDF перевозчика', () => {
  const { payment, etrn } = importPair(client, carrier);
  assert.deepEqual([payment.originals,payment.edo,payment.unit], [6,8,'банковских дней']);
  assert.match(payment.conditions, /вторник и пятницу/);
  assert.doesNotMatch(payment.source, /5 календарных/);
  assert.equal(etrnStatus(etrn), 'К созданию');
});

test('сверяет номер и цепочку сторон', () => {
  assert.throws(() => importPair(client, carrier.replace('1234','1235')), /Номера документов различаются/);
  assert.throws(() => importPair(client, client), /Не удалось определить пару/);
  assert.throws(() => importPair('', carrier), /текстовым слоем/);
});

test('маржа совпадает с формулой калькулятора для ОСНО и УСН', () => {
  const result = margin(90000,'22',65000,'0');
  assert.equal(result.grossMargin, 25000);
  assert.equal(Math.round(result.realProfit), 6578);
  assert.equal(Math.round(result.vatPayable), 16230);
  assert.equal(Math.round(margin(122000,'22',61000,'22').realProfit), 37500);
  assert.equal(Math.round(margin(105000,'5',61000,'22').realProfit), 33150);
  assert.equal(margin(10000,'0',20000,'0').realProfit,-8500);
});

test('ЭТРН требует номер и все подписи, ручное закрытие отдельное', () => {
  const etrn = {required:true, ...Object.fromEntries(etrnSteps.map(([key]) => [key,true]))};
  assert.equal(etrnStatus(etrn), 'В работе');
  assert.equal(etrnStatus({...etrn, number:'TEST'}), 'Подписана');
  assert.equal(etrnStatus({...etrn, number:'TEST', recipient:false}), 'В работе');
  assert.equal(etrnStatus({required:true,manualComplete:true}), 'Закрыта вручную');
  assert.equal(etrnStatus({required:false}), 'Не требуется');
});

test('повторный номер не создаёт дубликат, карточку можно редактировать', () => {
  const orders = upsert([], {number:'1234'});
  assert.throws(() => upsert(orders,{number:'1234'}), /уже есть/);
  assert.equal(upsert(orders,{number:'1234',customer:'Тест'},'1234')[0].customer,'Тест');
});

test('восстанавливает порядок строк и колонок PDF', () => {
  const item = (str,x,y,width) => ({str,transform:[1,0,0,1,x,y],width});
  assert.equal(linesFromItems([item('Б',40,80,5),item('В',0,60,5),item('А',0,80,5)]),'А    Б\nВ');
});

test('этапы рейса независимы, работают на старой карточке и снимаются', () => {
  const order = {number:'1234'};
  const marked = markTrip(markTrip(order, 'signed', true), 'unloaded', true);
  assert.deepEqual(marked.trip, {signed:true,unloaded:true});
  assert.deepEqual(markTrip(marked, 'signed', false).trip, {signed:false,unloaded:true});
  assert.equal(order.trip, undefined);
  assert.throws(() => markTrip(order, 'unknown', true), /Неизвестный этап/);
});

test('повторный импорт сохраняет отметки рейса и прогресс ЭТРН', () => {
  const order = importPair(client, carrier);
  const merged = mergeImport(order, {trip:{loaded:true},etrn:{required:false,created:true,number:'Э-12',sender:true}});
  assert.deepEqual(merged.trip, {loaded:true});
  assert.equal(merged.etrn.number, 'Э-12');
  assert.equal(etrnProgress(merged.etrn), '1/4 подписи');
  assert.equal(etrnProgress({...merged.etrn, pickupCarrier:true, recipient:true, deliveryCarrier:true, number:''}), 'Нужен номер');
});
