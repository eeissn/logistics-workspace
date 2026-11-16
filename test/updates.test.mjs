import assert from 'node:assert/strict';
import test from 'node:test';
import {updates} from '../src/updates.mjs';

test('обновления охватывают всю известную историю и отсортированы по датам', () => {
  assert.equal(updates.length, 5);
  assert.deepEqual(updates.map(group => group.title), [
    '16 ноября 2026', '15 ноября 2026', '14 ноября 2026',
    '13 ноября 2026', '12 ноября 2026'
  ]);
  assert.ok(updates.every(group => group.items.length >= 5));
  assert.ok(updates.every(group => group.items.every(item => item.trim().length > 15)));
  assert.ok(updates.every(group => !/\\b\\d{1,2}:\\d{2}\\b/.test(group.title)));
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
