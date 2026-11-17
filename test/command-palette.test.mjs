import test from 'node:test';
import assert from 'node:assert/strict';
import {commandDefinitions, matchCommands} from '../src/command-palette.mjs';

test('command palette exposes navigation, registry and analytics without duplicate identifiers', () => {
  assert.equal(new Set(commandDefinitions.map(item => item.id)).size, commandDefinitions.length);
  assert.ok(['active','history','search','new','pdf','excel','report','split','settings']
    .every(key => commandDefinitions.some(item => item.id === key)));
});

test('command palette search accepts Russian aliases and multiple words', () => {
  assert.ok(matchCommands('этрН').every(item => item.contextual && item.id !== 'bulk-etrn')); // Only selected-order ETRN commands, never implicit bulk changes.
  assert.deepEqual(matchCommands('история').map(item => item.id), ['history']);
  assert.deepEqual(matchCommands('импорт excel').map(item => item.id), ['excel']);
  assert.deepEqual(matchCommands('маржа').map(item => item.id), ['report']);
  assert.deepEqual(matchCommands('список детали').map(item => item.id), ['split']);
  assert.ok(matchCommands('ЗАЯВКИ').some(item => item.id === 'active'));
  assert.deepEqual(matchCommands('nothing-here'), []);
});
