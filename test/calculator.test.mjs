import test from 'node:test';
import assert from 'node:assert/strict';
import { vatPrice } from '../src/calculator.mjs';

test('VAT calculator preserves the original thresholds and exact amount', () => {
  assert.deepEqual(vatPrice(35000, 22), {exact:42700, rounded:43000});
  assert.deepEqual(vatPrice(35000, 5), {exact:36750, rounded:37000});
  assert.deepEqual(vatPrice(1234, 22), {exact:1505.48, rounded:1500});
  assert.deepEqual(vatPrice(123.45, 5), {exact:129.62, rounded:130});
});
