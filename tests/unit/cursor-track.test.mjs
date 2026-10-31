import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cursorPositionAt, smoothedCursorAt, activeClicksAt, suggestZooms,
} from '../../src/engine/cursor-track.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

const line = Array.from({ length: 61 }, (_, i) => ({ t: i / 60, x: i / 60, y: 0.5 }));

test('cursorPositionAt interpolates and clamps', () => {
  assert.equal(cursorPositionAt([], 1), null);
  assert.equal(cursorPositionAt(null, 1), null);
  assert.deepEqual(cursorPositionAt(line, -1), { x: 0, y: 0.5 });
  assert.deepEqual(cursorPositionAt(line, 5), { x: 1, y: 0.5 });
  near(cursorPositionAt(line, 0.5).x, 0.5);
  near(cursorPositionAt(line, 1 / 120).x, 1 / 120);
});

test('smoothedCursorAt follows linear motion and damps jitter', () => {
  near(smoothedCursorAt(line, 0.5).x, 0.5, 1e-3);
  const jitter = Array.from({ length: 120 }, (_, i) => ({ t: i / 60, x: 0.5 + (i % 2 ? 0.02 : -0.02), y: 0.5 }));
  const s = smoothedCursorAt(jitter, 1);
  assert.ok(Math.abs(s.x - 0.5) < 0.005, `smoothing left ${s.x}`);
  // Sparse samples fall back to interpolation.
  const sparse = [{ t: 0, x: 0, y: 0 }, { t: 10, x: 1, y: 1 }];
  near(smoothedCursorAt(sparse, 5).x, 0.5);
  assert.equal(smoothedCursorAt([], 1), null);
});

test('activeClicksAt returns clicks within the ripple window with their age', () => {
  const clicks = [{ t: 1, x: 0, y: 0 }, { t: 1.3, x: 0, y: 0 }, { t: 3, x: 0, y: 0 }];
  assert.deepEqual(activeClicksAt(clicks, 0.5), []);
  const a = activeClicksAt(clicks, 1.4);
  assert.equal(a.length, 2);
  near(a[0].age, 0.4);
  assert.equal(activeClicksAt(clicks, 1.6).length, 1);
  assert.deepEqual(activeClicksAt(null, 1), []);
});

test('suggestZooms clusters nearby clicks into non-overlapping zooms', () => {
  const clicks = [
    { t: 1, x: 0.2, y: 0.2 }, { t: 1.5, x: 0.22, y: 0.21 }, // cluster A
    { t: 8, x: 0.8, y: 0.8 },                                // cluster B
    { t: 8.3, x: 0.1, y: 0.9 },                              // far away -> own cluster, overlaps B
  ];
  const z = suggestZooms([], { clicks, duration: 20 });
  assert.equal(z.length, 2);
  near(z[0].time, 0.4);
  near(z[0].x, 0.21);
  for (let i = 1; i < z.length; i++) assert.ok(z[i].time >= z[i - 1].time + z[i - 1].duration);
});

test('suggestZooms never runs past the recording end', () => {
  const z = suggestZooms([], { clicks: [{ t: 9.5, x: 0.5, y: 0.5 }], duration: 10 });
  for (const e of z) assert.ok(e.time + e.duration <= 10 + 1e-9);
});

test('suggestZooms falls back to dwell detection without clicks', () => {
  const samples = [];
  let t = 0;
  for (; t < 1; t += 1 / 60) samples.push({ t, x: t, y: 0.5 }); // moving
  for (; t < 4; t += 1 / 60) samples.push({ t, x: 0.7, y: 0.3 }); // dwell
  for (; t < 5; t += 1 / 60) samples.push({ t, x: 0.1 + (t - 4), y: 0.9 }); // moving
  const z = suggestZooms(samples, { duration: 5 });
  assert.equal(z.length, 1);
  near(z[0].x, 0.7, 1e-3);
  near(z[0].y, 0.3, 1e-3);
  assert.deepEqual(suggestZooms(samples.slice(0, 5), {}), []);
});
