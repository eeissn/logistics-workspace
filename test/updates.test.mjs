import assert from 'node:assert/strict';
import test from 'node:test';
import {updates} from '../src/updates.mjs';

test('обновления охватывают всю известную историю и отсортированы по датам', () => {
  assert.equal(updates.length, 10);
  assert.deepEqual(updates.map(group => group.title), [
    '18 ноября 2026', '17 ноября 2026', '16 ноября 2026', '15 ноября 2026', '14 ноября 2026',
    '13 ноября 2026', '12 ноября 2026', '11 ноября 2026',
    '23 сентября 2026', '16 сентября 2026 · предыстория'
  ]);
  assert.ok(updates.every(group => group.items.length >= 1));
  assert.ok(updates.every(group => group.items.every(item => item.trim().length > 15)));
  assert.ok(updates.every(group => !/\d{1,2}:\d{2}/.test(group.title)));
});

test('история объясняет основные функции и не выдаёт планы за готовые возможности', () => {
  const all = updates.flatMap(group => group.items).join(' ');
  for (const topic of ['PDF', 'ЭТРН', 'Excel', 'марж', 'синхронизац',
    'учётных записей', 'Violet', 'Sand', 'iPhone', 'Историю', 'паспорта',
    'резервных копий']) {
    assert.ok(all.toLowerCase().includes(topic.toLowerCase()), topic);
  }
  assert.match(all, /Google Sheets ещё требует отдельной настройки/);
  assert.match(all, /Автоматическая доставка копий на домашний компьютер ещё не завершена/);
});


test('проверенное резервное копирование отображается в обновлениях без раскрытия закрытых данных', () => {
  const latest = updates.find(group => group.title === '16 ноября 2026');
  assert.ok(latest);
  assert.ok(latest.items.some(item => /зашифрованных резервных копий/.test(item)
    && /восстановление базы/.test(item)));
  const text = latest.items.join(' ');
  assert.doesNotMatch(text, /backup-private\\.pem|170\\.168\\.18\\.148|JARVIS|парол[ья]/i);
});


test('17 ноября: исправление ISO-дат отражено в истории обновлений', () => {
  const newest = updates.find(group => group.title === '17 ноября 2026');
  assert.ok(newest);
  assert.ok(newest.items.some(item => item.includes('Погрузки/выгрузки сегодня')
    && item.includes('разных форматах')));
});


test('журнал для пользователей описывает возможности, а не внутренние тесты', () => {
  const latest = updates[0].items.join(' ');
  assert.doesNotMatch(latest, /515 заявк|браузерн(ый|ую) провер|автоматическ(ие|ую) провер|CI|SQLite|SHA-256/i);
  assert.match(latest, /маржи/);
});

test('17 ноября: тестовая среда Excel указана в пользовательской истории', () => {
  const entry = updates.find(group => group.title === '17 ноября 2026');
  assert.ok(entry?.items.some(item => item.includes('учебную среду') &&
    item.includes('разными названиями')));
});

test('17 ноября: пользовательские улучшения интерфейса отражены в истории', () => {
  const entry = updates.find(group => group.title === '17 ноября 2026');
  assert.ok(entry?.items.some(item => item.includes('быстрые команды')
    && item.includes('навигация на iPhone') && item.includes('детали заявки')));
});

test('17 ноября: исправления по обратной связи и номера массового ЭТРН в истории', () => {
  const entry = updates.find(group => group.title === '17 ноября 2026');
  assert.ok(entry?.items.some(item => item.includes('кнопка синхронизации возвращена')
    && item.includes('поиск на iPhone')));
  assert.ok(entry?.items.some(item => item.includes('номер документа')
    && item.includes('исправить')));
});

test('17 ноября: новые UX-функции описаны без утверждения о релизе VPS', () => {
  const latest=updates.find(group=>group.title==='17 ноября 2026').items.join(' ');
  for(const text of ['тестовой версии','быстрый просмотр','сравнение двух месяцев',
    'финансовых рисках','Graphite','временный просмотр выбранных PDF']) {
    assert.ok(latest.includes(text), text);
  }
  assert.doesNotMatch(latest,/515 заявк|парол[ья]|\.pem|IPv4|CI|SQLite/);
});
