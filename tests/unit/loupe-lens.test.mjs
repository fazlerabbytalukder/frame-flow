import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loupeSourceRadius } from '../../src/engine/composition-engine.js';

test('loupe bend: magnified centre, monotonic, reaches past the rim', () => {
  const m = 2.5;
  // Near the centre the lens magnifies by m.
  const u = 0.05;
  assert.ok(Math.abs(loupeSourceRadius(u, m) / u - 1 / m) < 1e-3);
  // Every output radius shows a farther source radius than the one before.
  let prev = 0;
  for (let i = 1; i <= 100; i++) {
    const s = loupeSourceRadius(i / 100, m);
    assert.ok(s > prev, `monotonic at ${i}`);
    prev = s;
  }
  // The rim shows content from beyond the lens edge (water-drop look).
  assert.ok(loupeSourceRadius(1, m) > 1.05);
});

test('loupe fringes: none at the centre, red and blue split at the rim', () => {
  assert.equal(loupeSourceRadius(0, 2, -1), loupeSourceRadius(0, 2, 1));
  assert.ok(Math.abs(loupeSourceRadius(0.1, 2, -1) - loupeSourceRadius(0.1, 2, 1)) < 1e-4);
  assert.ok(loupeSourceRadius(1, 2, 1) - loupeSourceRadius(1, 2, -1) > 0.03);
});
