import { test } from 'node:test';
import assert from 'node:assert/strict';

import { smoothstep, cameraAt, clampCenter, makeZoomEvent } from '../../src/engine/zoom-engine.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

test('smoothstep is clamped, monotonic and symmetric', () => {
  assert.equal(smoothstep(-1), 0);
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(2), 1);
  near(smoothstep(0.5), 0.5);
  let prev = 0;
  for (let i = 1; i <= 100; i++) {
    const v = smoothstep(i / 100);
    assert.ok(v >= prev);
    prev = v;
  }
  for (let i = 0; i <= 10; i++) near(smoothstep(i / 10) + smoothstep(1 - i / 10), 1, 1e-12);
});

test('cameraAt is identity outside every zoom', () => {
  const z = [{ time: 2, duration: 3, x: 0.2, y: 0.8, scale: 2, transition: 0.5 }];
  assert.deepEqual(cameraAt([], 1), { cx: 0.5, cy: 0.5, scale: 1 });
  assert.deepEqual(cameraAt(z, 1.99), { cx: 0.5, cy: 0.5, scale: 1 });
  assert.deepEqual(cameraAt(z, 5.01), { cx: 0.5, cy: 0.5, scale: 1 });
});

test('cameraAt eases in, holds full strength, eases out', () => {
  const z = [{ time: 0, duration: 4, x: 0.5, y: 0.5, scale: 2, transition: 1 }];
  near(cameraAt(z, 0).scale, 1);
  near(cameraAt(z, 0.5).scale, 1.5);
  near(cameraAt(z, 1).scale, 2);
  near(cameraAt(z, 2).scale, 2);
  near(cameraAt(z, 3.5).scale, 1.5);
  near(cameraAt(z, 4).scale, 1);
});

test('cameraAt clamps the transition to half the duration', () => {
  const z = [{ time: 0, duration: 1, x: 0.5, y: 0.5, scale: 3, transition: 5 }];
  near(cameraAt(z, 0.5).scale, 3);
});

test('cameraAt keeps the viewport inside the frame at every instant', () => {
  const z = [{ time: 0, duration: 3, x: 0.99, y: 0.01, scale: 2.5, transition: 0.8 }];
  for (let t = 0; t <= 3; t += 0.05) {
    const c = cameraAt(z, t);
    const half = 0.5 / c.scale;
    assert.ok(c.cx - half >= -1e-9 && c.cx + half <= 1 + 1e-9, `x out of frame at ${t}`);
    assert.ok(c.cy - half >= -1e-9 && c.cy + half <= 1 + 1e-9, `y out of frame at ${t}`);
  }
});

test('cameraAt picks the latest-starting zoom when zooms overlap', () => {
  const z = [
    { time: 0, duration: 10, x: 0.25, y: 0.25, scale: 2, transition: 0 },
    { time: 3, duration: 2, x: 0.75, y: 0.75, scale: 2, transition: 0 },
  ];
  near(cameraAt(z, 4).cx, 0.75);
  near(cameraAt(z, 1).cx, 0.25);
});

test('zero transition jumps straight to full strength', () => {
  const z = [{ time: 1, duration: 2, x: 0.5, y: 0.5, scale: 2, transition: 0 }];
  near(cameraAt(z, 1).scale, 2);
});

test('clampCenter', () => {
  assert.deepEqual(clampCenter(0, 1, 2), { cx: 0.25, cy: 0.75 });
  assert.deepEqual(clampCenter(0.1, 0.9, 1), { cx: 0.5, cy: 0.5 });
  assert.deepEqual(clampCenter(0.1, 0.9, 0.5), { cx: 0.5, cy: 0.5 }); // scale < 1 treated as 1
});

test('makeZoomEvent defaults and clamps negative time', () => {
  const z = makeZoomEvent({ time: -3 });
  assert.equal(z.time, 0);
  assert.equal(z.scale, 1.8);
  assert.equal(z.duration, 3);
  assert.match(z.id, /^zoom-/);
  assert.notEqual(makeZoomEvent({ time: 0 }).id, makeZoomEvent({ time: 0 }).id);
});

test('zoom style: classic by default, loupe converts zooms and keeps auto flags', async () => {
  const { zoomStyleOf, zoomTypeFor, withZoomStyle } = await import('../../src/engine/zoom-engine.js');
  assert.equal(zoomStyleOf(undefined), 'classic');
  assert.equal(zoomStyleOf({}), 'classic');
  assert.equal(zoomStyleOf({ zoomStyle: 'bogus' }), 'classic');
  assert.equal(zoomTypeFor({ zoomStyle: 'loupe' }), 'loupe');
  assert.equal(zoomTypeFor({}), 'screen');
  assert.equal(makeZoomEvent({ time: 0 }).type, 'screen');
  assert.equal(makeZoomEvent({ time: 0, type: 'loupe' }).type, 'loupe');

  const zooms = [{ id: 'a', auto: true }, { id: 'b', type: 'loupe', radius: 0.2 }];
  const loupe = withZoomStyle(zooms, 'loupe');
  assert.deepEqual(loupe.map((z) => z.type), ['loupe', 'loupe']);
  assert.equal(loupe[0].auto, true);
  assert.equal(loupe[1].radius, 0.2);
  assert.deepEqual(withZoomStyle(loupe, 'classic').map((z) => z.type), ['screen', 'screen']);
  assert.equal(zooms[0].type, undefined, 'input is not mutated');
});
