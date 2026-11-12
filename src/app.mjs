import './style.css';
import { archived, blankOrder, etrnProgress, etrnStatus, margin, mergeImport, monthReport, orderMargin, scheduledToday, tripStatus, tripStatuses, upsert } from './domain.mjs';
import { importPair, phones } from './import.mjs';
import { addLedgerOrders, parseLedger } from './ledger.mjs';
import { checkImportFile } from './import-files.mjs';
import { auth, demo, localOrders, sessionChangeKey, store } from './storage.mjs';
import { driverMessage } from './driver.mjs';
import { demoOrder } from './demo.mjs';

const $ = id => document.getElementById(id);
const currency = new Intl.NumberFormat('ru', {style:'currency', currency:'RUB', maximumFractionDigits:0});
const money = value => currency.format(value);
const fieldNames = ['number','date','customer','carrier','driver','passport','vehicle','route','cargo','customerAmount','carrierAmount','customerTax','carrierTax'];
const paymentNames = ['originals','edo','unit','conditions'];
const contactRoles = ['Заказчик','Перевозчик','Водитель'];
const etrnKeys = ['required','manualComplete','orderForm','created','allSigned'];
const pending = order => ['К созданию','В работе'].includes(etrnStatus(order.etrn));
const splitLines = text => text.split('\n').map(line => line.trim()).filter(Boolean);
const editor = $('editor');
const form = $('editor-form');
const importDialog = $('import-dialog');
const etrnDialog = $('etrn-dialog');
const etrnForm = $('etrn-form');
let orders = [];
let draft;
let previousNumber;
let etrnOrderNumber;
let reviewOrder;
let reviewPrevious;
let reviewStamp;
let editorStamp;
let etrnStamp;
let signedIn = false;
let signingIn = false;
let refreshing;
let accountGeneration = 0;
const pendingImports = new Map();
let view = 'all';
let driverOrder;
const today = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

function startImport(button, key = button, label) {
  if ((!signedIn && !demo) || pendingImports.has(key)) return;
  const generation = accountGeneration;
  const originalLabel = button.textContent;
  const reset = () => {
    button.disabled = false;
    if (label) button.textContent = originalLabel;
    pendingImports.delete(key);
  };
  pendingImports.set(key, reset);
  button.disabled = true;
  if (label) button.textContent = label;
  const active = () => generation === accountGeneration;
  return {active, finish() { if (active()) reset(); }};
}

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}

function action(text, onClick, className) {
  const button = node('button', text, className);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function assertUnchanged(current, number, stamp) {
  if (number === null) return;
  const order = current.find(item => item.number === number);
  if (!order || order.updatedAt !== stamp) {
    throw new Error('Заявка изменилась. Обновите реестр и откройте её заново.');
  }
}

async function updateOrder(number, stamp, update, generation) {
  const current = await store.list();
  if (generation !== accountGeneration) return;
  assertUnchanged(current, number, stamp);
  const order = current.find(item => item.number === number);
  const saved = await store.save(upsert(current, update(order), number), current);
  if (generation === accountGeneration) orders = saved;
}

function tripControl(order) {
  const select = node('select', null, 'trip-status');
  const initial = tripStatus(order);
  select.setAttribute('aria-label', 'Статус заявки № ' + order.number);
  for (const [key, title] of tripStatuses) {
    const option = node('option', title);
    option.value = key;
    select.append(option);
  }
  select.value = initial;
  select.dataset.stage = initial;
  select.addEventListener('change', async () => {
    const generation = accountGeneration;
    try {
      const stage = select.value;
      const archiveWasOpen = $('archive').open;
      await updateOrder(order.number, order.updatedAt, current => ({...current, trip:{...current.trip, stage}}), generation);
      if (generation !== accountGeneration) return;
      render();
      $('archive').open = archiveWasOpen;
      $('notice').textContent = 'Статус рейса сохранён.';
    } catch (error) {
      if (generation !== accountGeneration) return;
      select.value = initial;
      $('notice').textContent = error.message;
    }
  });
  return select;
}

function routeText(order) {
  if (order.route?.trim()) return order.route;
  const places = order.points.map(point => point.address.split(' · ').at(-1).split(',')[0].replace(/\s+(?:д|г|п)\.$/u,'').trim());
  return [...new Set(places.filter(Boolean))].join(' → ');
}

function routeDates(order) {
  return order.points.filter(point => point.schedule)
    .map(point => point.kind + ' ' + point.schedule).join(' · ');
}

function contactsCell(order) {
  const important = ['Перевозчик','Водитель'].map(role => [role,
    order.contacts.filter(contact => contact.role === role).flatMap(contact => contact.values)]);
  for (const point of order.points) important.push([point.kind, point.contacts]);
  const list = node('details', null, 'row-contacts');
  const entries = important.filter(([,values]) => values.some(value => phones(value).length));
  const count = entries.reduce((sum,[,values]) => sum + new Set(values.flatMap(phones)).size,0);
  list.append(node('summary', count ? 'Контакты · ' + count : 'Контакты'));
  const panel = node('div', null, 'contact-panel');
  for (const [role, values] of entries) {
    const item = node('div', null, 'contact-entry');
    item.append(node('strong', role));
    for (const value of values.filter(value => phones(value).length)) {
      const entry = node('div');
      const name = value.replace(/(?:\+7|8)[ \t(-]*\d{3}[ \t)-]*\d{3}[ \t-]*\d{2}[ \t-]*\d{2}/g,'').replace(/[()]/g,'').trim();
      if (name) entry.append(node('small', name));
      entry.append(phoneLinks(value));
      item.append(entry);
    }
    panel.append(item);
  }
  if (!entries.length) panel.append(node('p', 'В заявке нет телефонов для рейса.'));
  list.append(panel);
  const cell = node('div', null, 'contact-actions');
  cell.append(list, action('Данные водителя', () => openDriver(order), 'driver-link'));
  return cell;
}

function openDriver(order) {
  driverOrder = order;
  $('driver-title').textContent = 'Данные водителя · № ' + order.number;
  $('driver-message').value = driverMessage(order);
  $('driver-copy-status').textContent = '';
  $('driver-dialog').showModal();
}

$('driver-copy').addEventListener('click', async () => {
  const generation = accountGeneration;
  const field = $('driver-message');
  let copied = false;
  try {
    await navigator.clipboard.writeText(field.value);
    copied = true;
  } catch {
    if (generation !== accountGeneration) return;
    field.focus();
    field.select();
    copied = document.execCommand?.('copy') === true;
  }
  if (generation === accountGeneration) {
    $('driver-copy-status').textContent = copied ? 'Текст скопирован.' : 'Текст выделен. Скопируй его вручную.';
  }
});
$('driver-edit').addEventListener('click', () => {
  $('driver-dialog').close();
  openEditor(driverOrder, driverOrder.number);
});

function renderRows(table, rows) {
  table.replaceChildren();
  if (!rows.length) {
    const empty = node('div', null, 'empty');
    empty.append(node('h2', orders.length ? 'Здесь пока нет заявок' : 'Добавь первую заявку'),
      node('p', orders.length ? 'Проверь выбранный раздел или поиск.' : 'Загрузи PDF заказчика и перевозчика или импортируй реестр из Excel.'));
    table.append(empty);
    return;
  }
  const header = node('div', null, 'row table-head');
  for (const title of ['Заявка','Заказчик / перевозчик','Направление','Статус рейса','ЭТРН','Телефоны']) header.append(node('span', title));
  table.append(header);
  for (const order of rows) {
    const row = node('div', null, 'row order');
    const label = node('span', null, 'order-id');
    const open = () => openEditor(orders.find(item => item.number === order.number) ?? order, order.number);
    label.append(action('№ ' + order.number, open, 'order-link'),
      node('small', order.date ? order.date.split('-').reverse().join('.') : 'Дата не указана'));
    const names = node('span', null, 'names');
    names.append(node('strong', order.customer || 'Заказчик не указан'), node('small', order.carrier || 'Перевозчик не указан'));
    const direction = node('span', null, 'destination');
    direction.append(node('strong', routeText(order) || 'Маршрут не указан'));
    if (routeDates(order)) direction.append(node('small', routeDates(order)));
    const etrn = action(etrnProgress(order.etrn), () => openEtrn(order.number), 'etrn-link');
    etrn.dataset.state = pending(order) ? 'pending' : 'regular';
    etrn.setAttribute('aria-label', 'ЭТРН заявки № ' + order.number + ': ' + etrnProgress(order.etrn));
    row.append(label, names, direction, tripControl(order), etrn, contactsCell(order));
    table.append(row);
  }
}

function render() {
  const query = $('search').value.trim().toLocaleLowerCase('ru');
  const filter = $('filter').value;
  const date = today();
  const kind = {pickup:'Погрузка', delivery:'Выгрузка'}[view];
  const matches = orders.filter(order => {
    const matchesText = [order.number, order.customer, order.carrier, order.driver, order.etrn?.number, routeText(order), ...order.points.map(point=>point.address)]
      .join(' ').toLocaleLowerCase('ru').includes(query);
    return matchesText && (!kind || scheduledToday(order, kind, date))
      && (!filter || (filter === 'pending' ? pending(order) : etrnStatus(order.etrn) === filter));
  }).sort((a,b) => (b.date || '').localeCompare(a.date || '') || b.number.localeCompare(a.number,'ru',{numeric:true}));
  const active = matches.filter(order => !archived(order));
  const past = matches.filter(archived);
  renderRows($('table'), active);
  $('archive').hidden = !past.length;
  $('archive-title').textContent = 'Архив · ' + past.length;
  if (past.length) renderRows($('archive-table'), past);
}

function profit(order) {
  return margin(order.customerAmount, order.customerTax, order.carrierAmount, order.carrierTax);
}

function editorPreview() {
  const values = Object.fromEntries(fieldNames.map(name => [name, form.elements[name].value]));
  const canCalculate = ['customerAmount','carrierAmount','customerTax','carrierTax'].every(key => values[key] !== '');
  const detail = $('margin-detail');
  detail.replaceChildren();
  if (canCalculate) {
    const result = profit(values);
    for (const [label, value] of [['После налога',result.realProfit],['Разница ставок',result.grossMargin],['НДС к уплате',result.vatPayable],['Налог на прибыль',result.profitTax]]) {
      const metric = node('div');
      metric.append(node('small', label), node('strong', money(value)));
      detail.append(metric);
    }
  } else detail.append(node('small','Укажи обе ставки и ставки НДС для расчёта.'));
  $('editor-etrn').textContent = etrnProgress(draft.etrn);
}

function readEtrn() {
  return {...Object.fromEntries(etrnKeys.map(key => [key, etrnForm.elements[key].checked])),
    number: etrnForm.elements.etrnNumber.value.trim()};
}

function refreshEtrn() {
  $('etrn-fields').hidden = !etrnForm.elements.required.checked;
}

function openEtrn(number = null) {
  const order = number === null ? draft : orders.find(item => item.number === number);
  if (!order) return;
  etrnOrderNumber = number;
  etrnStamp = order.updatedAt;
  const etrn = order.etrn ?? {};
  const orderNumber = number ?? (form.elements.number.value.trim() || order.number);
  $('etrn-title').textContent = orderNumber ? 'ЭТРН · заявка № ' + orderNumber : 'ЭТРН';
  $('etrn-error').textContent = '';
  $('etrn-save').textContent = number === null ? 'Применить' : 'Сохранить';
  for (const key of etrnKeys) etrnForm.elements[key].checked = Boolean(etrn[key]);
  etrnForm.elements.allSigned.checked = etrn.allSigned ?? (etrnStatus(etrn) === 'Подписана');
  etrnForm.elements.etrnNumber.value = etrn.number || orderNumber;
  refreshEtrn();
  etrnDialog.showModal();
}

function labelInput(label, value, multiline = false) {
  const wrapper = node('label', label);
  const input = node(multiline ? 'textarea' : 'input');
  input.value = value ?? '';
  if (multiline) input.rows = 2;
  wrapper.append(input);
  return [wrapper, input];
}

function phoneLinks(value) {
  const list = node('div', null, 'phones');
  for (const phone of phones(value)) {
    const link = node('a', phone);
    link.href = 'tel:' + phone;
    list.append(link);
  }
  return list;
}

function addPoint(point = {kind:'Погрузка'}) {
  const panel = node('div', null, 'point fields');
  panel.dataset.source = point.scheduleSource || '';
  panel.dataset.schedule = point.schedule || '';
  const kind = node('label','Тип точки');
  const select = node('select');
  for (const option of ['Погрузка','Выгрузка']) select.append(node('option',option));
  select.value = point.kind;
  select.dataset.field = 'kind';
  kind.append(select);
  const remove = node('button','Убрать точку','point-remove');
  remove.type = 'button';
  remove.addEventListener('click', () => panel.remove());
  panel.append(kind, remove);
  for (const [field, label, value] of [['address','Адрес',point.address],['schedule','Даты и время',point.schedule],['contacts','Контакты',point.contacts?.join('\n')]]) {
    const [wrapper, input] = labelInput(label, value, field === 'contacts');
    wrapper.className = 'wide';
    input.dataset.field = field;
    if (field === 'schedule' && point.scheduleSource) wrapper.append(node('small', 'Источник: ' + point.scheduleSource));
    if (field === 'contacts') wrapper.append(phoneLinks(value));
    panel.append(wrapper);
  }
  $('points').append(panel);
}

function openEditor(order, original = null, stamp = order.updatedAt) {
  editorStamp = stamp;
  draft = structuredClone(order);
  if (!draft.route) draft.route = routeText(draft);
  previousNumber = original;
  form.reset();
  $('editor-error').textContent = '';
  $('editor-title').textContent = order.number ? 'Заявка № ' + order.number : 'Новая заявка';
  for (const key of fieldNames) form.elements[key].value = draft[key] ?? '';
  for (const key of paymentNames) form.elements[key].value = order.payment[key] ?? '';
  $('payment-source').textContent = order.payment.source ? 'Из PDF перевозчика: ' + order.payment.source : '';
  $('points').replaceChildren();
  order.points.forEach(addPoint);
  $('contacts').replaceChildren();
  for (const role of contactRoles) {
    const contact = order.contacts.find(item => item.role === role);
    const [wrapper, input] = labelInput(role, contact?.values.join('\n'), true);
    input.dataset.role = role;
    wrapper.append(phoneLinks(input.value));
    $('contacts').append(wrapper);
  }
  $('differences').hidden = !order.differences.length;
  $('difference-list').replaceChildren();
  for (const change of order.differences) {
    const box = node('div', null, 'difference');
    box.append(node('strong', change.field), node('p','Заказчик: ' + change.customer), node('p','Перевозчик: ' + change.carrier));
    $('difference-list').append(box);
  }
  editorPreview();
  editor.showModal();
}

function readDraft() {
  const order = {...draft};
  for (const key of fieldNames) {
    const input = form.elements[key];
    order[key] = input.type === 'number' ? (input.value === '' ? null : input.valueAsNumber) : input.value.trim();
  }
  for (const key of paymentNames) {
    const input = form.elements[key];
    order.payment[key] = input.type === 'number' ? (input.value === '' ? null : input.valueAsNumber) : input.value.trim();
  }
  order.points = [...$('points').children].map(panel => {
    const values = Object.fromEntries([...panel.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el.value.trim()]));
    return {...values, contacts:splitLines(values.contacts), scheduleSource:values.schedule === panel.dataset.schedule ? panel.dataset.source : 'Вручную'};
  });
  order.contacts = [...$('contacts').querySelectorAll('[data-role]')].map(input => ({
    role: input.dataset.role,
    name: draft.contacts.find(contact => contact.role === input.dataset.role)?.name || '',
    values: splitLines(input.value),
  }));
  return order;
}

for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
$('search').addEventListener('input', render);
$('filter').addEventListener('change', render);
$('add-point').addEventListener('click', () => addPoint());
$('new').addEventListener('click', () => openEditor(blankOrder()));
$('editor-etrn').addEventListener('click', () => openEtrn());
etrnForm.addEventListener('input', refreshEtrn);
etrnForm.addEventListener('submit', async event => {
  event.preventDefault();
  const generation = accountGeneration;
  const etrn = readEtrn();
  try {
    if (etrnOrderNumber === null) {
      draft.etrn = etrn;
      editorPreview();
    } else {
      await updateOrder(etrnOrderNumber, etrnStamp, order => ({...order, etrn}), generation);
      if (generation !== accountGeneration) return;
      render();
      $('notice').textContent = 'Статус ЭТРН сохранён.';
    }
    etrnDialog.close();
  } catch (error) { if (generation === accountGeneration) $('etrn-error').textContent = error.message; }
});
$('import').addEventListener('click', () => {
  if (pendingImports.has($('import-form'))) return;
  $('import-form').reset();
  $('import-error').textContent = '';
  importDialog.showModal();
});
form.addEventListener('input', editorPreview);
form.addEventListener('submit', async event => {
  event.preventDefault();
  const generation = accountGeneration;
  $('editor-error').textContent = '';
  try {
    const current = await store.list();
    if (generation !== accountGeneration) return;
    assertUnchanged(current, previousNumber, editorStamp);
    const saved = await store.save(upsert(current, readDraft(), previousNumber), current);
    if (generation !== accountGeneration) return;
    orders = saved;
    editor.close();
    render();
    $('notice').textContent = 'Заявка сохранена.';
  } catch (error) { if (generation === accountGeneration) $('editor-error').textContent = error.message; }
});
$('import-form').addEventListener('submit', async event => {
  event.preventDefault();
  const files = [$('customer-pdf').files[0], $('carrier-pdf').files[0]];
  const submit = event.submitter;
  const operation = startImport(submit, event.currentTarget, 'Читаем PDF…');
  if (!operation) return;
  $('import-error').textContent = '';
  try {
    if (files.some(file => !file)) throw new Error('Выбери ровно два PDF.');
    for (const file of files) checkImportFile(file, 'PDF', 20);
    const { readPdf } = await import('./pdf.mjs');
    if (!operation.active()) return;
    const documents = await Promise.all(files.map(readPdf));
    if (!operation.active()) return;
    const imported = importPair(...documents);
    const saved = await store.list();
    if (!operation.active()) return;
    const current = saved.find(item => item.number === imported.number);
    importDialog.close();
    openReview(mergeImport(imported, current), current?.number ?? null, current?.updatedAt);
  } catch (error) {
    if (operation.active()) $('import-error').textContent = error.message || 'Не удалось прочитать PDF.';
  } finally {
    operation.finish();
  }
});

function showWorkspace(visible) {
  $('workspace').hidden = !visible;
  $('workspace-nav').hidden = !visible;
  $('sign-in').hidden = visible;
}

function signInScreen(message = '') {
  signedIn = false;
  accountGeneration++;
  refreshing = undefined;
  auth.clear();
  $('sign-out').disabled = false;
  for (const reset of pendingImports.values()) reset();
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  orders = [];
  draft = reviewOrder = driverOrder = null;
  previousNumber = etrnOrderNumber = reviewPrevious = null;
  editorStamp = etrnStamp = reviewStamp = undefined;
  $('review-title').textContent = 'Результат распознавания';
  for (const id of ['import-error', 'ledger-error', 'review-error', 'editor-error', 'etrn-error', 'driver-copy-status']) {
    $(id).textContent = '';
  }
  $('account-email').textContent = '';
  $('sync-status').textContent = '';
  $('notice').textContent = '';
  $('print-report').replaceChildren();
  $('editor-form').reset();
  $('import-form').reset();
  $('ledger-form').reset();
  $('etrn-form').reset();
  $('report-preview').replaceChildren();
  $('review-card').replaceChildren();
  $('points').replaceChildren();
  $('contacts').replaceChildren();
  $('difference-list').replaceChildren();
  $('driver-message').value = '';
  $('driver-title').textContent = 'Данные водителя';
  $('archive').open = false;
  $('archive-table').replaceChildren();
  render();
  $('sign-in-error').textContent = message;
  showWorkspace(false);
}

async function refresh() {
  if (!signedIn || refreshing !== undefined) return;
  const generation = accountGeneration;
  refreshing = generation;
  try {
    const saved = await store.list();
    if (!signedIn || generation !== accountGeneration) return;
    if (orders !== saved) {
      const archiveOpen = $('archive').open;
      orders = saved;
      render();
      $('archive').open = archiveOpen;
    }
    $('sync-status').textContent = '';
  } catch (error) {
    if (generation !== accountGeneration) return;
    if (signedIn && (error.status === 401 || error.status === 403)) {
      if (!$('sign-out').disabled) signInScreen('Сеанс закончился. Войдите снова.');
    }
    else if (signedIn) $('sync-status').textContent = error.message;
  } finally {
    if (generation === accountGeneration) refreshing = undefined;
  }
}

async function showAccount(account) {
  accountGeneration++;
  signedIn = true;
  $('account-email').textContent = account.email;
  $('sync-tools').hidden = false;
  try {
    $('local-import').hidden = localOrders().length === 0;
  } catch {
    $('local-import').hidden = true;
  }
  $('sync-status').textContent = 'Загружаем заявки…';
  showWorkspace(true);
  await refresh();
}

$('sign-in-form').addEventListener('submit', async event => {
  event.preventDefault();
  const login = event.currentTarget;
  const button = event.submitter;
  if (signedIn || signingIn) return;
  const generation = ++accountGeneration;
  signingIn = true;
  button.disabled = true;
  $('sign-in-error').textContent = '';
  try {
    const account = await auth.login(login.elements.email.value.trim(), login.elements.password.value);
    if (generation !== accountGeneration) return;
    login.reset();
    button.disabled = false;
    return showAccount(account);
  } catch (error) {
    if (generation === accountGeneration) $('sign-in-error').textContent = error.message;
  } finally {
    signingIn = false;
    if (generation === accountGeneration) button.disabled = false;
  }
});

$('sign-out').addEventListener('click', async event => {
  const button = event.currentTarget;
  if (!signedIn || button.disabled) return;
  const generation = accountGeneration;
  button.disabled = true;
  try {
    await auth.logout();
    if (generation === accountGeneration) signInScreen();
  } catch (error) {
    if (generation !== accountGeneration) return;
    if (error.status === 401 || error.status === 403) signInScreen();
    else $('sync-status').textContent = error.message;
  } finally {
    if (generation === accountGeneration) button.disabled = false;
  }
});

$('sync-refresh').addEventListener('click', refresh);
$('local-import').addEventListener('click', async event => {
  const operation = startImport(event.currentTarget);
  if (!operation) return;
  try {
    const local = localOrders();
    if (!window.confirm(`Перенести ${local.length} заявок в реестр аккаунта ${$('account-email').textContent}? Совпадающие номера будут пропущены.`)) return;
    const current = await store.list();
    if (!operation.active()) return;
    const unique = [...new Map(local.map(order => [order.number, order])).values()];
    const saved = addLedgerOrders(current, unique);
    if (saved.length > current.length) {
      const result = await store.save(saved, current);
      if (!operation.active()) return;
      orders = result;
      render();
    }
    $('notice').textContent = `Добавлено: ${saved.length - current.length}. Пропущено: ${local.length - saved.length + current.length}.`;
  } catch (error) {
    if (operation.active()) $('notice').textContent = error.message;
  } finally {
    operation.finish();
  }
});

if (demo) {
  $('demo-note').hidden = false;
  showWorkspace(true);
  store.list().then(async saved => {
    orders = saved.length ? saved : await store.save([demoOrder(today())]);
    render();
  }).catch(error => { $('notice').textContent = error.message; });
} else {
  window.addEventListener('storage', event => {
    if (event.key === sessionChangeKey && event.newValue && !signingIn) {
      signInScreen('Сеанс изменился в другой вкладке. Войдите снова.');
    }
  });
  const generation = accountGeneration;
  auth.restore().then(account => {
    if (generation === accountGeneration) return showAccount(account);
  }).catch(error => {
    if (generation === accountGeneration) signInScreen(error.status === 401 ? '' : error.message);
  });
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 15000);
}

for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => {
    view = button.dataset.view;
    for (const tab of document.querySelectorAll('[data-view]')) tab.setAttribute('aria-pressed', String(tab === button));
    $('view-title').textContent = view === 'all' ? 'Заявки' : button.textContent;
    render();
  });
}

function openReview(order, previous, stamp) {
  reviewStamp = stamp;
  reviewOrder = order;
  reviewPrevious = previous;
  $('review-title').textContent = 'Результат распознавания · № ' + order.number;
  $('review-error').textContent = '';
  const card = $('review-card');
  card.replaceChildren(node('h3', routeText(order) || 'Маршрут не указан'));
  if (routeDates(order)) card.append(node('p', routeDates(order), 'quiet'));
  const group = node('div', null, 'review-fields');
  for (const [label, value] of [
    ['Заказчик',order.customer], ['Перевозчик',order.carrier],
    ['Ставка заказчика',order.customerAmount == null ? '' : money(order.customerAmount)],
    ['Ставка перевозчика',order.carrierAmount == null ? '' : money(order.carrierAmount)],
  ]) {
    const field = node('div');
    field.append(node('small',label),node('strong',value || 'Не указано'));
    group.append(field);
  }
  card.append(group);
  if (order.driver) card.append(node('p', 'Водитель · ' + order.driver));
  if (order.vehicle) card.append(node('p', 'Транспорт · ' + order.vehicle));
  if (order.differences.length) card.append(node('p','Есть расхождения PDF. В заявке использованы данные перевозчика.', 'quiet'));
  $('review-dialog').showModal();
}

$('review-edit').addEventListener('click', () => {
  if (!reviewOrder || pendingImports.has($('review-save'))) return;
  $('review-dialog').close();
  openEditor(reviewOrder, reviewPrevious, reviewStamp);
});
$('review-save').addEventListener('click', async () => {
  if (!reviewOrder) return;
  const operation = startImport($('review-save'));
  if (!operation) return;
  const order = reviewOrder;
  const previous = reviewPrevious;
  const stamp = reviewStamp;
  const active = () => operation.active() && reviewOrder === order;
  try {
    const current = await store.list();
    if (!active()) return;
    assertUnchanged(current, previous, stamp);
    const saved = await store.save(upsert(current, order, previous), current);
    if (!active()) return;
    orders = saved;
    $('review-dialog').close();
    render();
    $('notice').textContent = 'Заявка сохранена.';
  } catch (error) { if (active()) $('review-error').textContent = error.message; }
  finally { operation.finish(); }
});

$('ledger').addEventListener('click', () => {
  if (pendingImports.has($('ledger-form'))) return;
  $('ledger-form').reset();
  $('ledger-error').textContent = '';
  $('ledger-dialog').showModal();
});
$('ledger-form').addEventListener('submit', async event => {
  event.preventDefault();
  const operation = startImport(event.submitter, event.currentTarget);
  if (!operation) return;
  const file = $('ledger-file').files[0];
  $('ledger-error').textContent = '';
  try {
    checkImportFile(file, 'Excel', 10);
    const {readSheet} = await import('read-excel-file/browser');
    if (!operation.active()) return;
    const rows = await readSheet(file, 'Ноябрь');
    if (!operation.active()) return;
    const imported = parseLedger(rows, '2026-11');
    if (!imported.length) throw new Error('В листе нет заявок за ноябрь 2026.');
    const current = await store.list();
    if (!operation.active()) return;
    const saved = addLedgerOrders(current, imported);
    const result = await store.save(saved, current);
    if (!operation.active()) return;
    orders = result;
    $('ledger-dialog').close();
    render();
    const added = saved.length - current.length;
    $('notice').textContent = `Добавлено: ${added}. Уже в реестре: ${imported.length - added}.`;
  } catch (error) { if (operation.active()) $('ledger-error').textContent = error.message; }
  finally { operation.finish(); }
});

function reportData() {
  return monthReport(orders, $('report-month').value);
}
function refreshReport() {
  const {rows,total} = reportData();
  const unknown = rows.filter(order => orderMargin(order) === null).length;
  const summary = $('report-preview');
  summary.replaceChildren(node('h3', money(total)),
    node('p', `Заявок: ${rows.length}. Без суммы маржи: ${unknown}.`),
    node('p', 'Период определяется по дате заявки. Архивные рейсы учитываются, срывы исключаются.', 'quiet'));
}
$('report').addEventListener('click', () => {
  $('report-month').value = today().slice(0,7);
  refreshReport();
  $('report-dialog').showModal();
});
$('report-month').addEventListener('input', refreshReport);
$('report-form').addEventListener('submit', event => {
  event.preventDefault();
  const month = $('report-month').value;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    $('report-month').setCustomValidity('Укажи месяц в формате ГГГГ-ММ.');
    $('report-month').reportValidity();
    $('report-month').setCustomValidity('');
    return;
  }
  const {rows,total} = reportData();
  const report = $('print-report');
  const table = node('table');
  const head = node('thead');
  const headers = node('tr');
  for (const title of ['Дата','Заявка','Заказчик','Перевозчик','Маржа']) headers.append(node('th',title));
  head.append(headers);
  const body = node('tbody');
  for (const order of rows) {
    const row = node('tr');
    const value = orderMargin(order);
    for (const field of [order.date.split('-').reverse().join('.'),order.number,order.customer,order.carrier,value === null ? '—' : money(value)]) row.append(node('td',field));
    body.append(row);
  }
  table.append(head,body);
  report.replaceChildren(node('h1','Маржа · ' + month), node('p','Заявок: ' + rows.length + ' · Итого: ' + money(total)), table);
  window.print();
});
