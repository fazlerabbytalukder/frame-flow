import { test } from 'node:test';
import assert from 'node:assert/strict';

import { maskAlpha } from '../../src/engine/person-mask.js';

test('mask alpha: background stays out, the person is fully in, edges are soft', () => {
  assert.equal(maskAlpha(0), 0);
  assert.equal(maskAlpha(0.5), 0);
  assert.equal(maskAlpha(0.8), 255);
  assert.equal(maskAlpha(1), 255);
  const mid = maskAlpha(0.65);
  assert.ok(mid > 0 && mid < 255);
  let prev = -1;
  for (let c = 0; c <= 1; c += 0.01) {
    const a = maskAlpha(c);
    assert.ok(a >= prev);
    prev = a;
  }
});
