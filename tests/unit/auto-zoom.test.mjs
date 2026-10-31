import { test } from 'node:test';
import assert from 'node:assert/strict';

import { autoZoomEvents, applyAutoZoom } from '../../src/engine/auto-zoom.js';
import { contentRect, effectiveStyle, computeGeometry, backgroundBlurPx } from '../../src/engine/composition-engine.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

function project({ clips, zoomEvents = [], crop } = {}) {
  return {
    clips: clips || [{ id: 'c1', start: 0, duration: 20, speed: 1 }],
    zoomEvents,
    style: { crop: crop || { l: 0, r: 0, t: 0, b: 0 } },
  };
}

// Two click bursts far apart: two zoom suggestions.
const track = {
  samples: [],
  clicks: [
    { t: 2, x: 0.2, y: 0.3 },
    { t: 2.5, x: 0.21, y: 0.31 },
    { t: 12, x: 0.8, y: 0.7 },
  ],
};

test('auto zooms land on the clicks and are marked auto', () => {
  const zooms = autoZoomEvents(project(), track);
  assert.equal(zooms.length, 2);
  assert.ok(zooms.every((z) => z.auto === true));
  near(zooms[0].time, 1.4);
  near(zooms[0].x, 0.205, 0.01);
  near(zooms[1].x, 0.8, 0.01);
});

test('auto zoom times follow the edited timeline (cuts and speed)', () => {
  // Source 0-5 kept at 2x (2.5s on the timeline), 5-10 cut, 10-20 kept.
  const clips = [
    { id: 'a', start: 0, duration: 5, speed: 2 },
    { id: 'b', start: 10, duration: 10, speed: 1 },
  ];
  const zooms = autoZoomEvents(project({ clips }), track);
  near(zooms[0].time, 1.4 / 2);
  near(zooms[1].time, 2.5 + (11.4 - 10));
});

test('suggestions that were cut away are dropped', () => {
  const clips = [{ id: 'b', start: 10, duration: 10, speed: 1 }];
  const zooms = autoZoomEvents(project({ clips }), track);
  assert.equal(zooms.length, 1);
});

test('focus points are converted into the cropped frame', () => {
  const zooms = autoZoomEvents(project({ crop: { l: 0.5, r: 0, t: 0, b: 0 } }), track);
  near(zooms[1].x, (0.8 - 0.5) / 0.5, 0.02);
});

test('re-running replaces auto zooms but keeps manual ones', () => {
  const manual = { id: 'm', time: 11, duration: 3, x: 0.5, y: 0.5, scale: 2 };
  const stale = { id: 'old', time: 5, duration: 2, x: 0.5, y: 0.5, scale: 1.8, auto: true };
  const { zoomEvents, added } = applyAutoZoom(project({ zoomEvents: [stale, manual] }), track);
  assert.ok(zoomEvents.includes(manual));
  assert.ok(!zoomEvents.includes(stale));
  // The 12s click overlaps the manual zoom, so only the 2s one is added.
  assert.equal(added, 1);
  assert.deepEqual(zoomEvents.map((z) => z.id === 'm'), [false, true]);
});

test('no cursor data means no auto zooms', () => {
  assert.deepEqual(autoZoomEvents(project(), null), []);
  assert.equal(applyAutoZoom(project(), { samples: [], clicks: [] }).added, 0);
});

test('padding can differ per axis', () => {
  const r = contentRect(1000, 1000, 100, 100, 0.1, 0.25);
  near(r.h, 500);
  near(r.w, 500);
  const wide = contentRect(1000, 500, 1000, 100, 0.05, 0.3);
  near(wide.w, 900);
});

test('remove background lays the screen edge to edge', () => {
  const style = { padding: 0.1, paddingY: 0.2, cornerRadius: 30, shadow: true, inset: { size: 0.02 }, frameless: true };
  const e = effectiveStyle(style);
  assert.equal(e.padding, 0);
  assert.equal(e.paddingY, 0);
  assert.equal(e.cornerRadius, 0);
  assert.equal(e.shadow, false);
  assert.equal(e.inset.size, 0);
  assert.equal(effectiveStyle({ padding: 0.1 }).padding, 0.1);
  const g = computeGeometry({
    videoW: 1920, videoH: 1080, canvasW: 1920, canvasH: 1080, style,
    camera: { cx: 0.5, cy: 0.5, scale: 1 },
  });
  assert.deepEqual(g.frame, { x: 0, y: 0, w: 1920, h: 1080 });
});

test('background blur scales with the canvas and is clamped', () => {
  assert.equal(backgroundBlurPx({}, 1080), 0);
  near(backgroundBlurPx({ backgroundBlur: 0.5 }, 1000), 20);
  near(backgroundBlurPx({ backgroundBlur: 5 }, 1000), 40);
});

test('auto zooms are created in the project zoom style', () => {
  assert.ok(autoZoomEvents(project(), track).every((z) => z.type === 'screen'));
  const p = project();
  p.style.zoomStyle = 'loupe';
  const zooms = autoZoomEvents(p, track);
  assert.ok(zooms.length > 0 && zooms.every((z) => z.type === 'loupe'));
});
