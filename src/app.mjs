import './style.css';
import { mountCalculator } from './calculator.mjs';
import { archived, blankOrder, etrnProgress, etrnStatus, margin, mergeImport, monthReport, orderMargin, tripStatus, tripStatuses, upsert } from './domain.mjs';
import { importPair, phones } from './import.mjs';
import { addLedgerOrders, parseLedger } from './ledger.mjs';
import { checkImportFile, readExcelArchive } from './import-files.mjs';
import { auth, demo, localOrders, sessionChangeKey, store } from './storage.mjs';
import { driverMessage } from './driver.mjs';
import { demoOrders } from './demo.mjs';
import { defaultAccents, displayKey, layoutLabels, matchesTripView, pendingEtrn, readDisplayPreferences, readStatusColors, readThemeLayouts, routeText, selectOrders, statusColors, themeLabels, validAccent, violetPalettes } from './registry.mjs';

const $ = id => document.getElementById(id);
const currency = new Intl.NumberFormat('ru', {style:'currency', currency:'RUB', maximumFractionDigits:0});
const money = value => currency.format(value);
const fieldNames = ['number','date','customer','carrier','driver','passport','vehicle','route','cargo','customerAmount','carrierAmount','customerTax','carrierTax'];
const paymentNames = ['originals','edo','unit','conditions'];
const contactRoles = ['Заказчик','Перевозчик','Водитель'];
const etrnKeys = ['required','manualComplete','orderForm','created','allSigned'];
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
let pendingWrites = 0;
let saveFailure;
let refreshFailure;
let serverConfirmed = false;
let accountGeneration = 0;
const pendingImports = new Map();
let view = 'all';
let sort = 'delivery';
let ascending = true;
const display = readDisplayPreferences();
display.statusColors = readStatusColors();
display.themeLayouts = readThemeLayouts();
let period = {};
const contactPanel = $('contact-popover');
let contactAnchor;
let contactFrame;
let contactObserver;
const selections = new Map();
const savingTrips = new Set();
const tripTitles = new Map(tripStatuses);
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

function showSyncStatus() {
  if (demo || !signedIn) return;
  const status = $('sync-status');
  const problem = saveFailure ?? refreshFailure;
  const state = pendingWrites || refreshing !== undefined ? 'busy'
    : problem?.network || problem?.status >= 500 ? 'offline'
    : saveFailure ? 'failed' : refreshFailure ? 'unavailable'
    : serverConfirmed ? 'saved' : '';
  status.dataset.state = state;
  status.textContent = ({
    busy: 'Синхронизация', offline: 'Нет соединения',
    failed: 'Ошибка сохранения', unavailable: 'Реестр недоступен', saved: 'Сохранено',
  })[state] ?? '';
  status.title = saveFailure?.network
    ? 'Сервер не подтвердил запись. Проверьте заявку после восстановления связи.'
    : problem?.message ?? '';
}

async function saveRecords(records, current) {
  if (demo) return store.save(records, current);
  const generation = accountGeneration;
  pendingWrites++;
  showSyncStatus();
  try {
    const saved = await store.save(records, current);
    if (generation === accountGeneration) {
      saveFailure = refreshFailure = undefined;
      serverConfirmed = true;
    }
    return saved;
  } catch (error) {
    if (generation === accountGeneration) saveFailure = error;
    throw error;
  } finally {
    if (generation === accountGeneration) {
      pendingWrites--;
      showSyncStatus();
    }
  }
}

async function updateOrder(number, stamp, update, generation) {
  const current = await store.list();
  if (generation !== accountGeneration) return;
  assertUnchanged(current, number, stamp);
  const order = current.find(item => item.number === number);
  const saved = await saveRecords(upsert(current, update(order), number), current);
  if (generation === accountGeneration) orders = saved;
}

function tripControl(order, confirmMove = false) {
  const select = node('select', null, 'trip-status');
  const stage = tripStatus(order);
  const initial = tripTitles.has(stage) ? stage : '';
  if (!initial) {
    const unknown = node('option', 'Статус не распознан');
    unknown.value = '';
    unknown.disabled = true;
    select.append(unknown);
  }
  select.setAttribute('aria-label', 'Статус заявки № ' + order.number);
  for (const [key, title] of tripStatuses) {
    const option = node('option', title);
    option.value = key;
    select.append(option);
  }
  select.value = initial;
  select.dataset.stage = stage;
  select.disabled = savingTrips.has(order.number);
  select.addEventListener('change', async () => {
    const stage = select.value;
    if (savingTrips.has(order.number) || (confirmMove &&
        !window.confirm(`Изменить статус заявки № ${order.number} на «${tripTitles.get(stage)}»?`))) {
      select.value = initial;
      return;
    }
    const generation = accountGeneration;
    savingTrips.add(order.number);
    select.disabled = true;
    try {
      await updateOrder(order.number, order.updatedAt, current => ({...current, trip:{...current.trip, stage}}), generation);
      if (generation !== accountGeneration) return;
      $('notice').textContent = 'Статус рейса сохранён.';
    } catch (error) {
      if (generation !== accountGeneration) return;
      if (error.status === 401 || error.status === 403) return signInScreen(error.message);
      $('notice').textContent = error.message;
    } finally {
      if (generation === accountGeneration) {
        savingTrips.delete(order.number);
        render();
      }
    }
  });
  return select;
}

function routeDates(order) {
  return order.points.filter(point => point.schedule)
    .map(point => point.kind + ' ' + point.schedule).join(' · ');
}

function contactsCell(order) {
  const important = ['Перевозчик','Водитель'].map(role => [role,
    order.contacts.filter(contact => contact.role === role).flatMap(contact => contact.values)]);
  for (const point of order.points) important.push([point.kind, point.contacts]);
  const cell = node('div', null, 'contact-actions');
  if (order.driver) cell.append(node('strong', order.driver, 'contact-driver'));
  const driver = action('Данные водителя', () => openDriver(order), 'driver-link');
  const entries = important.filter(([,values]) => values.some(value => phones(value).length));
  const count = entries.reduce((sum,[,values]) => sum + new Set(values.flatMap(phones)).size,0);
  if (!count) {
    cell.append(node('span', 'Нет контактов', 'no-contacts'), driver);
    return cell;
  }
  const trigger = action('Контакты · ' + count, () => {
    if (contactAnchor === trigger) closeContacts(true);
    else openContacts(trigger, entries, driver);
  }, 'row-contacts');
  trigger.setAttribute('aria-controls', 'contact-popover');
  trigger.setAttribute('aria-expanded', 'false');
  cell.append(trigger, driver);
  return cell;
}

function openContacts(trigger, entries, nextControl) {
  closeContacts();
  contactAnchor = trigger;
  trigger.setAttribute('aria-expanded', 'true');
  contactPanel.append(node('h2', 'Контакты заявки'));
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
    contactPanel.append(item);
  }
  const closeButton = action('Закрыть', () => closeContacts(true), 'contact-close');
  contactPanel.append(closeButton);
  const controls = [...contactPanel.querySelectorAll('a[href], button')];
  contactPanel.onkeydown = event => {
    if (event.key !== 'Tab') return;
    const index = controls.indexOf(event.target);
    if (index === -1) return;
    event.preventDefault();
    const next = controls[index + (event.shiftKey ? -1 : 1)];
    if (next) return next.focus();
    closeContacts();
    (event.shiftKey ? trigger : nextControl).focus();
  };
  contactPanel.hidden = false;
  positionContacts();
  if (!contactAnchor) return;
  controls[0].focus({preventScroll:true});
  if (typeof IntersectionObserver === 'function') {
    contactObserver = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && contactAnchor === trigger) closeContacts();
    });
    contactObserver.observe(trigger);
  }
}

function closeContacts(restoreFocus = false) {
  if (!contactAnchor) return;
  const trigger = contactAnchor;
  contactAnchor = undefined;
  contactObserver?.disconnect();
  contactObserver = undefined;
  if (contactFrame !== undefined) window.cancelAnimationFrame(contactFrame);
  contactFrame = undefined;
  trigger.setAttribute('aria-expanded', 'false');
  contactPanel.hidden = true;
  contactPanel.onkeydown = null;
  contactPanel.replaceChildren();
  if (restoreFocus) trigger.focus({preventScroll:true});
}

function positionContacts() {
  contactFrame = undefined;
  if (!contactAnchor?.isConnected) return closeContacts();
  const anchor = contactAnchor.getBoundingClientRect();
  const viewport = window.visualViewport;
  const inset = 8;
  const left = (viewport?.offsetLeft ?? 0) + inset;
  const top = (viewport?.offsetTop ?? 0) + inset;
  const right = left + (viewport?.width ?? document.documentElement.clientWidth) - inset * 2;
  const bottom = top + (viewport?.height ?? document.documentElement.clientHeight) - inset * 2;
  if (anchor.bottom <= top || anchor.top >= bottom || anchor.right <= left || anchor.left >= right) return closeContacts();

  contactPanel.style.width = Math.min(304, right - left) + 'px';
  const below = Math.max(0, bottom - anchor.bottom - inset);
  const above = Math.max(0, anchor.top - top - inset);
  const flip = below < contactPanel.scrollHeight + 2 && above > below;
  const room = flip ? above : below;
  const fitsBeside = room >= 84;
  contactPanel.style.maxHeight = (fitsBeside ? room : bottom - top) + 'px';
  const panel = contactPanel.getBoundingClientRect();
  const y = fitsBeside ? (flip ? anchor.top - inset - panel.height : anchor.bottom + inset) : top;
  contactPanel.style.top = Math.max(top, Math.min(bottom - panel.height, y)) + 'px';
  contactPanel.style.left = Math.max(left, Math.min(right - panel.width, anchor.right - panel.width)) + 'px';
}

function queueContactPosition() {
  if (contactAnchor && contactFrame === undefined) contactFrame = window.requestAnimationFrame(positionContacts);
}

function openDriver(order) {
  closeContacts();
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

function openOrder(number) {
  const current = orders.find(order => order.number === number);
  if (!current) return;
  const container = $(archived(current) ? 'archive-table' : 'table');
  selections.set(container, {number, expanded:true});
  openEditor(current, number);
}

function etrnAction(order) {
  const progress = etrnProgress(order.etrn);
  const button = action(progress, () => openEtrn(order.number), 'etrn-link');
  button.dataset.state = pendingEtrn(order) ? 'pending' : 'regular';
  button.setAttribute('aria-label', 'ЭТРН заявки № ' + order.number + ': ' + progress);
  return button;
}

function setSort(column) {
  ascending = column === sort ? !ascending : column !== 'date';
  sort = column;
  render();
}

function renderRows(container, rows) {
  const table = node('div', null, 'order-table');
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', container.id === 'table' ? 'Активные заявки' : 'Архивные заявки');
  const header = node('div', null, 'row table-head');
  header.setAttribute('role', 'row');
  for (const [column, title] of [['number','№ заявки'], ['date','Дата'], ['customer','Заказчик'], ['carrier','Перевозчик'],
    ['route','Маршрут'], ['pickup','Загрузка'], ['delivery','Выгрузка'], ['etrn','ЭТРН'], ['trip','Статус рейса'], ['', 'Водитель / контакты']]) {
    const heading = node('div');
    heading.setAttribute('role', 'columnheader');
    if (column === sort) heading.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
    if (column) {
      const button = action(title, () => {
        setSort(column);
        container.querySelector(`[data-sort="${column}"]`)?.focus();
      }, 'sort-column');
      button.dataset.sort = column;
      if (sort === column) {
        button.setAttribute('aria-current', 'true');
        button.textContent += ascending ? ' ↑' : ' ↓';
      }
      heading.append(button);
    } else heading.textContent = title;
    header.append(heading);
  }
  table.append(header);
  for (const order of rows) {
    const row = node('div', null, 'row order');
    row.setAttribute('role', 'row');
    row.dataset.stage = tripStatus(order);
    const label = node('div', null, 'order-id');
    label.append(action('№ ' + order.number, () => openOrder(order.number), 'order-link'));
    const date = node('div', order.date ? order.date.slice(5).split('-').reverse().join('.') : '—', 'order-date');
    const customer = node('div', order.customer || '—', 'customer-cell');
    const carrier = node('div', order.carrier || '—', 'carrier-cell');
    const direction = node('div', null, 'destination');
    direction.append(node('strong', routeText(order) || 'Маршрут не указан'));
    const windows = ['Погрузка', 'Выгрузка'].map((kind, index) => {
      const cell = node('div', null, 'route-window ' + (index === 0 ? 'pickup-window' : 'delivery-window'));
      const schedules = order.points.filter(point => point.kind === kind && point.schedule).map(point => point.schedule);
      if (schedules.length) {
        const label = node('small', index === 0 ? 'Загрузка' : 'Выгрузка', 'window-label');
        label.setAttribute('aria-hidden', 'true');
        cell.append(label, node('span', schedules.join(' · ')));
      } else {
        cell.dataset.empty = 'true';
        cell.append(node('span', '—', 'quiet'));
      }
      return cell;
    });
    const stage = node('div', null, 'status-cell');
    stage.append(tripControl(order));
    const etrn = node('div', null, 'etrn-cell');
    etrn.append(etrnAction(order));
    row.append(label, date, customer, carrier, direction, ...windows, etrn, stage, contactsCell(order));
    for (const cell of row.children) cell.setAttribute('role', 'cell');
    table.append(row);
  }
  container.append(table);
}

function orderSummary(order, open, selected, showParties = false) {
  const button = action(null, open, 'order-summary');
  button.dataset.order = order.number;
  button.dataset.stage = tripStatus(order);
  if (selected !== undefined) button.setAttribute('aria-pressed', String(selected));
  button.append(node('strong', '№ ' + order.number),
    node('span', tripTitles.get(tripStatus(order)) ?? 'Статус не распознан', 'stage-badge'),
    node('span', routeText(order) || 'Маршрут не указан', 'summary-route'));
  const dates = routeDates(order);
  if (showParties) {
    const parties = node('span', null, 'summary-parties');
    parties.append(node('span', order.customer || '—'), node('small', order.carrier || '—'));
    button.append(parties);
  }
  if (dates || showParties) button.append(node('small', dates || '—', 'quiet summary-dates'));
  return button;
}

function renderCompact(container, rows) {
  const list = node('ul', null, 'compact-list');
  for (const order of rows) {
    const item = node('li');
    item.append(orderSummary(order, () => openOrder(order.number)));
    list.append(item);
  }
  container.append(list);
}

function renderKanban(container, rows, scrollLeft) {
  const board = node('div', null, 'kanban');
  board.tabIndex = 0;
  board.setAttribute('role', 'region');
  board.setAttribute('aria-label', 'Канбан по статусам рейсов');
  const groups = new Map([...tripStatuses.map(([stage]) => [stage, []]), ['', []]]);
  for (const order of rows) {
    const stage = tripStatus(order);
    (groups.get(stage) ?? groups.get('')).push(order);
  }
  for (const [stage, title] of [...tripStatuses, ['', 'Статус не распознан']]) {
    const group = groups.get(stage);
    if (!group.length && (!stage || container.id === 'archive-table')) continue;
    const column = node('section', null, 'kanban-column');
    column.append(node('h3', title + ' · ' + group.length));
    for (const order of group) {
      const card = node('article', null, 'kanban-card');
      card.append(orderSummary(order, () => openOrder(order.number)), tripControl(order, true), etrnAction(order));
      column.append(card);
    }
    board.append(column);
  }
  container.append(board);
  board.scrollLeft = scrollLeft;
}

function renderSplit(container, rows) {
  const selection = selections.get(container);
  const matched = rows.find(order => order.number === selection?.number);
  const order = matched ?? rows[0];
  const split = node('div', null, 'split-view');
  split.dataset.expanded = String(Boolean(matched && selection.expanded));
  const list = node('ul', null, 'split-list');
  const inline = display.theme === 'sand' && window.matchMedia('(max-width: 760px)').matches;
  split.dataset.inline = String(inline);
  const grid = display.theme === 'sand' && !inline;
  if (grid) {
    list.classList.add('split-grid');
    const heading = node('li', null, 'split-grid-head');
    for (const name of ['№ заявки', 'Заказчик / перевозчик', 'Маршрут', 'Окна', 'Статус']) {
      heading.append(node('span', name));
    }
    list.append(heading);
  }
  let selectedEntry;
  const panel = node('section', null, 'split-detail');
  panel.setAttribute('aria-label', 'Детали заявки');
  for (const item of rows) {
    const entry = node('li');
    entry.append(orderSummary(item, () => {
      selections.set(container, {number:item.number, expanded:true});
      render();
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        container.querySelector('.split-detail')?.animate?.(
          [{opacity:.65, transform:'translateY(4px)'}, {opacity:1, transform:'translateY(0)'}],
          {duration:190, easing:'cubic-bezier(.2,.75,.25,1)'},
        );
      }
      if (window.matchMedia('(max-width: 760px)').matches) {
        container.querySelector('.split-back').focus({preventScroll:inline});
      } else {
        [...container.querySelectorAll('[data-order]')].find(button => button.dataset.order === item.number)?.focus({preventScroll:true});
      }
    }, item.number === order.number, grid));
    if (item === order) selectedEntry = entry;
    list.append(entry);
  }

  panel.append(action(inline ? 'Свернуть' : '← К списку', () => {
    selections.set(container, {number:order.number, expanded:false});
    render();
    container.querySelector('[aria-pressed="true"]')?.focus({preventScroll:inline});
  }, 'split-back'), node('h2', 'Заявка № ' + order.number));
  const status = node('div', null, 'split-status');
  status.append(tripControl(order));
  const journey = node('div', null, 'trip-overview');
  journey.append(node('p', routeText(order) || 'Маршрут не указан', 'trip-overview-route'), status);
  const stage = tripStatus(order);
  const stageIndex = tripStatuses.findIndex(([key]) => key === stage);
  if (stageIndex >= 0 && stage !== 'failed') {
    const progress = node('ol', null, 'trip-progress');
    progress.setAttribute('aria-label', 'Этапы рейса');
    for (const [index, [, title]] of tripStatuses.slice(0, -1).entries()) {
      const item = node('li', title);
      item.dataset.progress = index < stageIndex ? 'done' : index === stageIndex ? 'current' : 'next';
      if (index === stageIndex) item.setAttribute('aria-current', 'step');
      progress.append(item);
    }
    journey.append(progress);
  }
  panel.append(journey);
  if (order.points.length) {
    const windows = node('section', null, 'split-section split-windows');
    const points = node('ul', null, 'split-points');
    for (const point of order.points) {
      const item = node('li');
      item.append(node('strong', point.kind), node('span', point.address || 'Адрес не указан'));
      if (point.schedule) item.append(node('small', point.schedule, 'quiet'));
      points.append(item);
    }
    windows.append(node('h3', 'Точки и окна'), points);
    panel.append(windows);
  }
  panel.append(
    detailFields('Участники и транспорт', [
      ['Заказчик', order.customer], ['Перевозчик', order.carrier],
      ['Водитель', order.driver], ['Транспорт', order.vehicle],
    ]),
    etrnAction(order),
    detailFields('Дата заявки и груз', [
      ['Дата заявки', order.date?.split('-').reverse().join('.')], ['Груз', order.cargo],
    ]),
  );
  const actions = node('div', null, 'split-actions');
  actions.append(contactsCell(order),
    action('Открыть заявку', () => openOrder(order.number), 'primary'));
  panel.append(actions);
  split.append(list);
  if (inline) {
    if (split.dataset.expanded === 'true') selectedEntry.append(panel);
  } else split.append(panel);
  container.append(split);
}

function detailFields(title, pairs) {
  const group = node('section', null, 'split-section');
  const fields = node('dl', null, 'split-fields');
  for (const [label, value] of pairs) {
    const field = node('div');
    field.append(node('dt', label), node('dd', value || '—'));
    fields.append(field);
  }
  group.append(node('h3', title), fields);
  return group;
}

function renderRegistry(container, rows) {
  const scrollLeft = container.firstElementChild?.scrollLeft ?? 0;
  container.replaceChildren();
  if (!rows.length) {
    const empty = node('div', null, 'empty');
    empty.append(node('h2', orders.length ? 'Заявки не найдены' : 'Добавь первую заявку'),
      node('p', orders.length ? 'Проверь выбранный раздел или поиск.' : 'Создай заявку вручную или импортируй PDF или Excel.'));
    container.append(empty);
    return;
  }
  ({table:renderRows, compact:renderCompact, kanban:renderKanban, split:renderSplit})[display.layout](container, rows, scrollLeft);
  if (display.layout === 'table' && container.firstElementChild) container.firstElementChild.scrollLeft = scrollLeft;
}

function shortPeriodDate(value) {
  return value ? value.slice(5).split('-').reverse().join('.') : '…';
}

function render() {
  closeContacts();
  const day = today();
  for (const button of document.querySelectorAll('[data-view]')) {
    const current = button.dataset.view === view;
    button.setAttribute('aria-pressed', String(current));
    const badge = button.querySelector('.view-count');
    if (badge) badge.textContent = orders.filter(order => matchesTripView(order, button.dataset.view, day)).length;
  }
  const viewFilter = view !== 'all' && view !== 'not-unloaded';
  const etrnFilter = $('filter').value;
  const filterCount = Number(viewFilter) + Number(Boolean(etrnFilter));
  $('filter-view').value = view;
  const activeFilters = $('active-filters');
  const filterLabels = [];
  if (viewFilter) filterLabels.push($('filter-view').selectedOptions?.[0]?.textContent.trim());
  if (etrnFilter) filterLabels.push($('filter').selectedOptions?.[0]?.textContent.trim());
  activeFilters.textContent = filterLabels.filter(Boolean).join(' · ');
  activeFilters.hidden = !filterCount;
  const hasPeriod = Boolean(period.from || period.to);
  $('filters-count').textContent = String(filterCount);
  $('filters-count').hidden = !filterCount;
  $('filters-open').setAttribute('aria-label', filterCount ? 'Фильтры: ' + filterCount : 'Фильтры');
  $('period-label').textContent = hasPeriod ? `${shortPeriodDate(period.from)}–${shortPeriodDate(period.to)}` : 'Период';
  $('period-open').setAttribute('aria-label', hasPeriod ? `Период: ${period.from || 'без начала'} — ${period.to || 'без окончания'}` : 'Период');
  $('period-open').dataset.active = String(hasPeriod);
  $('sort').value = sort;
  $('sort-direction').textContent = ascending ? '↑' : '↓';
  $('sort-direction').setAttribute('aria-pressed', String(ascending));
  const matches = selectOrders(orders, {
    query:$('search').value, filter:$('filter').value, view, today:day, sort, ascending, ...period,
  });
  const active = matches.filter(order => !archived(order));
  const past = matches.filter(archived);
  const primary = $('table');
  const archive = $('archive-table');
  const selected = selections.get(primary);
  if (selected && !active.some(order => order.number === selected.number) && past.some(order => order.number === selected.number)) {
    selections.set(archive, selected);
  }
  const archiveView = view === 'completed' || view === 'failed';
  renderRegistry(primary, archiveView ? matches : active);
  $('archive').hidden = archiveView || !past.length;
  $('archive-title').textContent = 'Архив · ' + past.length;
  if (!archiveView && past.length) renderRegistry(archive, past);
  else archive.replaceChildren();
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
  const etrn = readEtrn();
  $('etrn-fields').hidden = !etrn.required;
  $('etrn-status').textContent = etrnStatus(etrn);
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

function applyDisplay() {
  const root = document.documentElement;
  if (root) {
    root.dataset.theme = display.theme;
    root.dataset.violetPalette = display.violetPalette;
  }
  $('violet-palette-setting').hidden = display.theme !== 'violet';
  $('violet-palette').value = display.violetPalette;
  applyAccent();
  $('theme').value = display.theme;
  $('layout').value = display.layout;
  $('settings-layout').value = display.layout;
  $('status-palette').hidden = display.theme === 'sand';
}

function applyAccent() {
  const accent = display.accents[display.theme];
  $('accent-color').value = accent ?? defaultAccents[display.theme];
  $('reset-accent').disabled = !accent;
  const root = document.documentElement;
  if (!root) return;
  if (!accent) {
    root.style.removeProperty('--custom-accent');
    root.style.removeProperty('--custom-accent-text');
    root.style.removeProperty('--custom-accent-hover');
    root.style.removeProperty('--custom-focus');
    return;
  }
  const channels = accent.slice(1).match(/../g).map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  root.style.setProperty('--custom-accent', accent);
  root.style.setProperty('--custom-accent-text', luminance > .179 ? '#000' : '#fff');
  root.style.setProperty('--custom-accent-hover', `color-mix(in srgb, ${accent}, ${luminance > .179 ? '#fff' : '#000'} 10%)`);
  root.style.setProperty('--custom-focus', luminance > .25 ? '#45454d' : accent);
}

function saveDisplay() {
  try {
    localStorage.setItem(displayKey, JSON.stringify(display));
    $('settings-status').textContent = 'Настройки сохраняются в этом браузере.';
  } catch {
    $('settings-status').textContent = 'Браузер не сохранил настройки. Они действуют до закрытия страницы.';
  }
}

$('accent-color').addEventListener('input', event => {
  const accent = event.currentTarget.value;
  if (!validAccent(accent)) return;
  display.accents[display.theme] = accent;
  applyAccent();
  saveDisplay();
});
$('reset-accent').addEventListener('click', () => {
  $('accent-color').focus();
  delete display.accents[display.theme];
  applyAccent();
  saveDisplay();
});

function setDisplay(key, value) {
  if (key === 'theme' && value !== display.theme) {
    display.themeLayouts[display.theme] = display.layout;
    display.layout = display.themeLayouts[value] ?? (value === 'sand' ? 'split' : 'table');
  }
  display[key] = value;
  applyDisplay();
  saveDisplay();
  render();
}

const colorInputs = new Map();
function applyStatusColors() {
  for (const [stage, input] of colorInputs) {
    input.value = display.statusColors[stage] ?? statusColors[stage];
    document.documentElement?.style.setProperty('--status-' + stage, input.value);
  }
}
for (const [stage, title] of tripStatuses) {
  const label = node('label', stage === 'new' ? 'Заявка создана' : title);
  const input = node('input');
  input.type = 'color';
  input.id = 'status-color-' + stage;
  label.append(input);
  $('status-colors').append(label);
  colorInputs.set(stage, input);
  input.addEventListener('input', () => {
    if (!validAccent(input.value)) return;
    display.statusColors[stage] = input.value;
    applyStatusColors();
    saveDisplay();
  });
}
applyStatusColors();
$('reset-status-colors').addEventListener('click', () => {
  display.statusColors = {};
  applyStatusColors();
  saveDisplay();
});

$('filters-open').addEventListener('click', () => $('filters-dialog').showModal());
$('period-open').addEventListener('click', () => {
  $('period-from').value = period.from ?? '';
  $('period-to').value = period.to ?? '';
  $('period-to').min = period.from ?? '';
  $('period-dialog').showModal();
});
$('period-from').addEventListener('input', () => { $('period-to').min = $('period-from').value; });
$('period-form').addEventListener('submit', event => {
  event.preventDefault();
  period = {from:$('period-from').value, to:$('period-to').value};
  $('period-dialog').close();
  render();
});
$('period-reset').addEventListener('click', () => {
  period = {};
  $('period-dialog').close();
  render();
});

for (const [value, label] of Object.entries(violetPalettes)) {
  const option = node('option', label);
  option.value = value;
  $('violet-palette').append(option);
}
$('violet-palette').addEventListener('change', event => {
  display.violetPalette = event.currentTarget.value;
  applyDisplay();
  saveDisplay();
});

for (const [id, labels] of [['theme', themeLabels], ['layout', layoutLabels], ['settings-layout', layoutLabels]]) {
  for (const [value, label] of Object.entries(labels)) {
    const option = node('option', label);
    option.value = value;
    $(id).append(option);
  }
  $(id).addEventListener('change', event => {
    setDisplay(id === 'theme' ? 'theme' : 'layout', event.currentTarget.value);
  });
}
applyDisplay();
const mobileNav = window.matchMedia?.('(max-width: 850px)');
function setWorkspaceMenu() {
  $('workspace-menu').open = !mobileNav?.matches;
}
setWorkspaceMenu();
mobileNav?.addEventListener('change', setWorkspaceMenu);

window.matchMedia?.('(max-width: 760px)')?.addEventListener('change', () => {
  if (display.layout === 'split') render();
});

$('settings').addEventListener('click', () => {
  const email = $('account-email').textContent;
  $('settings-account').textContent = email;
  $('settings-account').hidden = !email;
  $('settings-dialog').showModal();
});
let calculator;
$('calculator').addEventListener('click', () => {
  calculator ??= mountCalculator($('calculator-dialog'));
  calculator.open();
});
let cargoSection;
$('cargo-open').addEventListener('click', async () => {
  const generation = accountGeneration;
  const dialog = $('cargo-dialog');
  if (dialog.open) return;
  try {
    const {createCargoSection} = await import('./cargo/section.mjs');
    if (generation !== accountGeneration || dialog.open) return;
    cargoSection ??= createCargoSection(dialog);
    cargoSection.open();
  } catch {
    if (generation === accountGeneration) $('notice').textContent = 'Не удалось открыть размещение груза. Повторите действие.';
  }
});
for (const id of ['settings-dialog', 'ledger-dialog', 'report-dialog', 'calculator-dialog', 'cargo-dialog']) {
  $(id).addEventListener('close', () => {
    if (!mobileNav?.matches) return;
    const menu = $('workspace-menu');
    menu.open = false;
    menu.querySelector('summary').focus();
  });
}

window.addEventListener('scroll', queueContactPosition, {capture:true, passive:true});
window.addEventListener('resize', queueContactPosition);
window.visualViewport?.addEventListener('resize', queueContactPosition);
window.visualViewport?.addEventListener('scroll', queueContactPosition);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !contactAnchor) return;
  event.preventDefault();
  closeContacts(true);
});
document.addEventListener('focusin', event => {
  if (contactAnchor && event.target !== contactAnchor && !contactPanel.contains(event.target)) closeContacts();
});
document.addEventListener('pointerdown', event => {
  if (contactAnchor && !contactAnchor.contains(event.target) && !contactPanel.contains(event.target)) closeContacts();
  const menu = $('workspace-menu');
  if (mobileNav?.matches && menu.open && !menu.contains(event.target)) menu.open = false;
});
$('sort').addEventListener('change', event => {
  sort = event.currentTarget.value;
  ascending = sort !== 'date';
  render();
});
$('sort-direction').addEventListener('click', () => setSort(sort));

for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
$('search').addEventListener('input', render);
$('filter-view').addEventListener('change', event => {
  view = event.currentTarget.value;
  render();
});
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
    const saved = await saveRecords(upsert(current, readDraft(), previousNumber), current);
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
  pendingWrites = 0;
  saveFailure = refreshFailure = undefined;
  serverConfirmed = false;
  auth.clear();
  calculator?.reset();
  cargoSection?.reset();
  $('sign-out').disabled = false;
  setWorkspaceMenu();
  for (const reset of pendingImports.values()) reset();
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  orders = [];
  period = {};
  view = 'all';
  $('filter').value = '';
  selections.clear();
  savingTrips.clear();
  $('settings-account').textContent = '';
  $('settings-account').hidden = true;
  draft = reviewOrder = driverOrder = null;
  previousNumber = etrnOrderNumber = reviewPrevious = null;
  editorStamp = etrnStamp = reviewStamp = undefined;
  $('review-title').textContent = 'Результат распознавания';
  for (const id of ['import-error', 'ledger-error', 'review-error', 'editor-error', 'etrn-error', 'driver-copy-status']) {
    $(id).textContent = '';
  }
  $('account-email').textContent = '';
  $('sync-status').textContent = '';
  $('sync-status').title = '';
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
  showSyncStatus();
  try {
    const saved = await store.list();
    if (!signedIn || generation !== accountGeneration) return;
    if (orders !== saved) {
      const archiveOpen = $('archive').open;
      orders = saved;
      render();
      $('archive').open = archiveOpen;
    }
    refreshFailure = undefined;
    serverConfirmed = true;
  } catch (error) {
    if (generation !== accountGeneration) return;
    if (signedIn && (error.status === 401 || error.status === 403)) {
      if (!$('sign-out').disabled) signInScreen('Сеанс закончился. Войдите снова.');
    }
    else if (signedIn) refreshFailure = error;
  } finally {
    if (generation === accountGeneration) {
      refreshing = undefined;
      showSyncStatus();
    }
  }
}

async function showAccount(account) {
  accountGeneration++;
  signedIn = true;
  $('account-email').textContent = account.email;
  $('sync-tools').hidden = false;
  $('sign-out').hidden = false;
  try {
    $('local-import').hidden = localOrders().length === 0;
  } catch {
    $('local-import').hidden = true;
  }
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
      const result = await saveRecords(saved, current);
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
    orders = saved.length ? saved : await store.save(demoOrders(today()));
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
  button.append(node('span', null, 'view-count'));
  button.addEventListener('click', () => {
    view = button.dataset.view;
    if (mobileNav?.matches) $('workspace-menu').open = false;
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
    const saved = await saveRecords(upsert(current, order, previous), current);
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
    const archive = await readExcelArchive(file);
    if (!operation.active()) return;
    const {readSheet} = await import('read-excel-file/browser');
    if (!operation.active()) return;
    const rows = await readSheet(archive, 'Ноябрь');
    if (!operation.active()) return;
    const imported = parseLedger(rows, '2026-11');
    if (!imported.length) throw new Error('В листе нет заявок за ноябрь 2026.');
    const current = await store.list();
    if (!operation.active()) return;
    const saved = addLedgerOrders(current, imported);
    const result = await saveRecords(saved, current);
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
