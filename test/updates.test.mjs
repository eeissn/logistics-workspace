import assert from 'node:assert/strict';
import test from 'node:test';
import {updates} from '../src/updates.mjs';

test('обновления охватывают всю известную историю и отсортированы по датам', () => {
  assert.equal(updates.length, 9);
  assert.deepEqual(updates.map(group => group.title), [
    '17 ноября 2026', '16 ноября 2026', '15 ноября 2026', '14 ноября 2026',
    '13 ноября 2026', '12 ноября 2026', '11 ноября 2026',
    '23 сентября 2026', '16 сентября 2026 · предыстория'
  ]);
  assert.ok(updates.every(group => group.items.length >= 3));
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


test('17 ноября: проверки шифрования и разделения двух аккаунтов в обновлениях', () => {
  assert.equal(updates[0].title, '17 ноября 2026');
  const entry = updates[0].items.join(' ');
  assert.match(entry, /побайтово совпадать/);
  assert.match(entry, /двух сотрудников/);
  assert.match(entry, /на тестовых данных/);
});
