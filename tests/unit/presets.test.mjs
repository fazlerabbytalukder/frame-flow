import { test } from 'node:test';
import assert from 'node:assert/strict';

import { presetMatches, presetFromProject } from '../../src/features/editor/presets.js';

const project = () => ({
  project: { width: 1080, height: 1920 },
  style: {
    background: 'silk-lagoon', padding: 0.06, webcam: { enabled: true, shape: 'circle', position: 'bottom-right' },
    zoomStyle: 'classic', volume: 1,
  },
});

test('a preset matches when every setting it holds equals the project, key order aside', () => {
  const p = project();
  const preset = { name: 'TikTok', style: { webcam: { position: 'bottom-right', shape: 'circle', enabled: true }, padding: 0.06 }, canvas: { width: 1080, height: 1920 } };
  assert.ok(presetMatches(preset, p));
  assert.ok(presetMatches({ name: 'old', style: { background: 'silk-lagoon' } }, p), 'no canvas: canvas not compared');
});

test('any differing setting or canvas size breaks the match', () => {
  const p = project();
  assert.ok(!presetMatches({ style: { padding: 0.1 } }, p));
  assert.ok(!presetMatches({ style: { webcam: { enabled: false, shape: 'circle', position: 'bottom-right' } } }, p));
  assert.ok(!presetMatches({ style: { framing: 'fit' } }, p), 'a setting the project lacks is a difference');
  assert.ok(!presetMatches({ style: { padding: 0.06 }, canvas: { width: 1920, height: 1080 } }, p));
  assert.ok(!presetMatches(null, p));
});

test('presetFromProject captures the style and the canvas size', () => {
  const p = project();
  const saved = presetFromProject(p);
  assert.equal(saved.style, p.style);
  assert.deepEqual(saved.canvas, { width: 1080, height: 1920 });
  // Round-tripped through JSON it still matches.
  assert.ok(presetMatches(JSON.parse(JSON.stringify({ name: 'x', ...saved })), p));
});
