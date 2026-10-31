// Spring camera, cursor-following zooms, and motion-blur sub-frame planning.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cameraAt, targetAt } from '../../src/engine/zoom-engine.js';
import { blurSubframes, frameInputs, trackFor, cursorFor } from '../../src/engine/frame-state.js';

const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (±${eps})`);
const zoom = (o = {}) => ({ id: 'z', time: 1, duration: 3, x: 0.3, y: 0.3, scale: 2, transition: 0.5, follow: false, ...o });

test('spring camera rests at identity away from zooms', () => {
  for (const animation of ['focused', 'smooth']) {
    assert.deepEqual(cameraAt([zoom()], 0.2, { animation }), { cx: 0.5, cy: 0.5, scale: 1 });
    assert.deepEqual(cameraAt([], 2, { animation }), { cx: 0.5, cy: 0.5, scale: 1 });
    const after = cameraAt([zoom()], 8, { animation });
    near(after.scale, 1, 1e-3);
  }
});

test('focused spring settles on the target well inside the zoom; smooth lags behind it', () => {
  const z = [zoom()];
  const focused = cameraAt(z, 1.6, { animation: 'focused' });
  const smooth = cameraAt(z, 1.6, { animation: 'smooth' });
  near(focused.scale, 2, 0.05);
  near(focused.cx, 0.3, 0.01);
  assert.ok(smooth.scale < focused.scale - 0.05, `smooth ${smooth.scale} vs focused ${focused.scale}`);
  near(cameraAt(z, 3.5, { animation: 'smooth' }).scale, 2, 0.01);
});

test('spring camera starts moving only when the zoom starts and never overshoots', () => {
  const z = [zoom()];
  near(cameraAt(z, 0.999, { animation: 'focused' }).scale, 1, 1e-3);
  let max = 0;
  for (let t = 0; t < 6; t += 1 / 60) max = Math.max(max, cameraAt(z, t, { animation: 'focused' }).scale);
  assert.ok(max <= 2 + 1e-3, `overshoot to ${max}`);
});

test('spring camera is continuous frame to frame and deterministic', () => {
  const z = [zoom(), zoom({ id: 'b', time: 4.2, x: 0.8, y: 0.7, scale: 2.5 })];
  let prev = cameraAt(z, 0, { animation: 'focused' });
  for (let t = 1 / 60; t < 8; t += 1 / 60) {
    const c = cameraAt(z, t, { animation: 'focused' });
    // Perceived zoom speed is the ratio between frames, not the difference.
    assert.ok(Math.max(c.scale / prev.scale, prev.scale / c.scale) < 1.08, `scale jump at ${t.toFixed(3)}`);
    assert.ok(Math.hypot(c.cx - prev.cx, c.cy - prev.cy) < 0.05, `pan jump at ${t.toFixed(3)}`);
    prev = c;
  }
  assert.deepEqual(cameraAt(z, 2.345, { animation: 'smooth' }), cameraAt(z, 2.345, { animation: 'smooth' }));
});

test('spring camera keeps the viewport inside the frame', () => {
  const z = [zoom({ x: 0.98, y: 0.02, scale: 3 })];
  for (let t = 0; t < 6; t += 0.05) {
    const c = cameraAt(z, t, { animation: 'smooth' });
    const half = 0.5 / c.scale;
    assert.ok(c.cx + half <= 1 + 1e-9 && c.cy - half >= -1e-9);
  }
});

test('following zoom: dead zone holds the anchor, larger moves pan, cursor stays in view', () => {
  const z = [zoom({ follow: true, x: 0.5, y: 0.5 })];
  const at = (x, y) => () => ({ x, y });
  assert.deepEqual(targetAt(z, 2, at(0.55, 0.52)), { cx: 0.5, cy: 0.5, scale: 2 });
  const moved = targetAt(z, 2, at(0.8, 0.5));
  near(moved.cx, 0.8 - 0.11, 1e-9);
  for (const [x, y] of [[0.95, 0.05], [0.1, 0.9], [0.7, 0.3]]) {
    const c = targetAt(z, 2, at(x, y));
    const half = 0.5 / c.scale;
    assert.ok(Math.abs(x - c.cx) <= half + 1e-9 && Math.abs(y - c.cy) <= half + 1e-9, `cursor ${x},${y} out of view`);
  }
  // follow=false ignores the cursor.
  assert.deepEqual(targetAt([zoom({ x: 0.5, y: 0.5 })], 2, at(0.9, 0.9)), { cx: 0.5, cy: 0.5, scale: 2 });
});

test('classic animation still honours follow', () => {
  const z = [zoom({ follow: true, x: 0.5, y: 0.5, transition: 0.2 })];
  const c = cameraAt(z, 2.5, { animation: 'classic', cursorAt: () => ({ x: 0.9, y: 0.5 }) });
  assert.ok(c.cx > 0.6);
});

// --- frame state / motion blur ------------------------------------------------

function project(style = {}) {
  return {
    clips: [{ id: 'c', start: 0, duration: 6, speed: 1 }],
    zoomEvents: [zoom()],
    captions: [],
    annotations: [],
    style: {
      cursor: { overlay: true, size: 1, animation: 'medium' },
      animation: { screen: 'focused', motionBlur: { strength: 1, cursor: true, zoom: true, pan: true } },
      clipTransition: { type: 'none' },
      ...style,
    },
  };
}
const raw = {
  samples: Array.from({ length: 361 }, (_, i) => ({ t: i / 60, x: i < 120 ? 0.2 : 0.2 + (i - 120) / 600, y: 0.5 })),
  clicks: [],
  shortcuts: [{ t: 2, keys: ['Ctrl', 'S'] }],
  typing: [],
};

test('motion blur: no sub-frames while nothing moves, N while the camera zooms', () => {
  const p = project();
  p.style.cursor.overlay = false;
  const track = trackFor(p, raw);
  const still = frameInputs(p, track, 0.3, 0.3);
  assert.equal(blurSubframes(p, track, 0.3, 0.3, still, 8).length, 1);
  const zooming = frameInputs(p, track, 1.1, 1.1);
  const frames = blurSubframes(p, track, 1.1, 1.1, zooming, 8);
  assert.equal(frames.length, 8);
  assert.ok(frames[7].camera.scale > frames[0].camera.scale);
});

test('motion blur toggles: zoom off keeps scale fixed across sub-frames; strength 0 disables', () => {
  const p = project();
  p.style.cursor.overlay = false;
  p.style.animation.motionBlur.zoom = false;
  const track = trackFor(p, raw);
  const base = frameInputs(p, track, 1.1, 1.1);
  const frames = blurSubframes(p, track, 1.1, 1.1, base, 8);
  for (const f of frames) assert.equal(f.camera.scale, base.camera.scale);
  p.style.animation.motionBlur.strength = 0;
  assert.equal(blurSubframes(p, track, 1.1, 1.1, base, 8).length, 1);
});

test('motion blur follows a moving cursor', () => {
  const p = project();
  p.zoomEvents = [];
  const track = trackFor(p, raw);
  const base = frameInputs(p, track, 4, 4);
  const frames = blurSubframes(p, track, 4, 4, base, 6);
  assert.equal(frames.length, 6);
  assert.ok(frames[5].cursor.x > frames[0].cursor.x);
});

test('frameInputs exposes shortcuts only when enabled', () => {
  const p = project();
  const track = trackFor(p, raw);
  assert.deepEqual(frameInputs(p, track, 2.5, 2.5).shortcuts.map((s) => s.keys), [['Ctrl', 'S']]);
  p.style.shortcuts = { enabled: false };
  assert.deepEqual(frameInputs(p, track, 2.5, 2.5).shortcuts, []);
});

test('cursor loop returns to the start position; stopAtEnd freezes it', () => {
  const p = project();
  p.style.cursor.loop = true;
  const track = trackFor(p, raw);
  const end = cursorFor(p, track, 6, 6);
  const start = cursorFor(p, track, 0, 0);
  near(end.x, start.x, 1e-6);
  // A longer glide is already under way earlier, a short one hasn't started.
  p.style.cursor.loopDuration = 2.5;
  const longGlide = cursorFor(p, track, 4.5, 4.5);
  p.style.cursor.loopDuration = 0.5;
  const shortGlide = cursorFor(p, track, 4.5, 4.5);
  p.style.cursor.loopDuration = undefined;
  assert.notEqual(longGlide.x, shortGlide.x);
  near(shortGlide.x, cursorFor({ ...p, style: { ...p.style, cursor: { ...p.style.cursor, loop: false } } }, track, 4.5, 4.5).x, 1e-9);
  p.style.cursor.loop = false;
  p.style.cursor.stopAtEnd = true;
  const a = cursorFor(p, track, 5.7, 5.7);
  const b = cursorFor(p, track, 5.95, 5.95);
  near(a.x, b.x, 1e-9);
});

test('loupe: lens state eases in/out, follows the cursor, and never moves the camera', async () => {
  const { loupeAt } = await import('../../src/engine/zoom-engine.js');
  const z = [zoom({ type: 'loupe', time: 1, duration: 2, x: 0.3, y: 0.4, scale: 2.5, radius: 0.2 })];
  assert.equal(loupeAt(z, 0.5), null);
  assert.equal(loupeAt(z, 1).strength, 0);
  const mid = loupeAt(z, 2);
  assert.deepEqual([mid.x, mid.y, mid.scale, mid.radius, mid.strength], [0.3, 0.4, 2.5, 0.2, 1]);
  const followed = loupeAt([{ ...z[0], follow: true }], 2, () => ({ x: 0.7, y: 0.6 }));
  assert.deepEqual([followed.x, followed.y], [0.7, 0.6]);
  for (const animation of ['focused', 'classic']) {
    assert.deepEqual(cameraAt(z, 2, { animation }), { cx: 0.5, cy: 0.5, scale: 1 });
  }
  // Screen zooms still work next to a loupe.
  const both = [...z, zoom({ id: 's', time: 5, duration: 2 })];
  near(cameraAt(both, 6, { animation: 'focused' }).scale, 2, 0.05);
});

test('fullToCropUV maps cursor/click positions into the cropped frame', async () => {
  const { fullToCropUV } = await import('../../src/engine/frame-state.js');
  const p = { style: { crop: { l: 0.2, r: 0.2, t: 0.1, b: 0.1 } } };
  const c = fullToCropUV(p, { x: 0.5, y: 0.5 });
  near(c.x, 0.5, 1e-9);
  near(c.y, 0.5, 1e-9);
  assert.deepEqual(fullToCropUV(p, { x: 0, y: 1 }), { x: 0, y: 1 }); // clamped
  near(fullToCropUV(p, { x: 0.35, y: 0.1 }).x, 0.25, 1e-9);
  assert.deepEqual(fullToCropUV({ style: {} }, { x: 0.3, y: 0.7 }), { x: 0.3, y: 0.7 });
});
