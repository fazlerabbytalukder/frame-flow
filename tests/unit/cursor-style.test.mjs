import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cursorSettings, clickBounceScale, lastClickBefore, drawCursorShape, drawClickEffect, CURSOR_TYPES,
} from '../../src/engine/cursor-style.js';

test('cursor settings fill defaults, clamp, and honour the older on/off flags', () => {
  const d = cursorSettings({});
  assert.equal(d.type, 'classic');
  assert.equal(d.clickEffect, 'ring');
  assert.equal(d.sway, 0);
  assert.equal(cursorSettings({ clickHighlights: false }).clickEffect, 'none');
  assert.equal(cursorSettings({ rotate: true }).sway, 0.5);
  const c = cursorSettings({ type: 'nope', size: 99, clickColor: 'red', clickOpacity: -1, clickDuration: 5, bounce: 3, sway: 0.2 });
  assert.equal(c.type, 'classic');
  assert.equal(c.size, 3);
  assert.equal(c.clickColor, '#facc15');
  assert.equal(c.clickOpacity, 0.1);
  assert.equal(c.clickDuration, 200);
  assert.equal(c.bounce, 1);
  assert.equal(c.sway, 0.2);
});

test('click bounce presses in, springs back past rest, and settles', () => {
  assert.equal(clickBounceScale(0.1, 0, 350), 1);
  assert.equal(clickBounceScale(-0.1, 1, 350), 1);
  assert.equal(clickBounceScale(0.4, 1, 350), 1);
  const pressed = clickBounceScale(0.35 * 0.25, 1, 350);
  assert.ok(Math.abs(pressed - 0.7) < 1e-9, `fully pressed ${pressed}`);
  const samples = Array.from({ length: 70 }, (_, i) => clickBounceScale((i / 70) * 0.35, 1, 350));
  assert.ok(Math.max(...samples.slice(20)) > 1, 'overshoots');
  assert.ok(Math.abs(clickBounceScale(0.349, 1, 350) - 1) < 0.02, 'settles near rest');
  // Weaker bounce, smaller press.
  assert.ok(clickBounceScale(0.35 * 0.25, 0.5, 350) > pressed);
});

test('lastClickBefore finds the latest click at or before t', () => {
  const clicks = [{ t: 1 }, { t: 2 }, { t: 3.5 }];
  assert.equal(lastClickBefore(clicks, 0.5), null);
  assert.equal(lastClickBefore(clicks, 2).t, 2);
  assert.equal(lastClickBefore(clicks, 3).t, 2);
  assert.equal(lastClickBefore(clicks, 9).t, 3.5);
  assert.equal(lastClickBefore([], 1), null);
});

function recordingCtx() {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get: (target, key) =>
        key in target
          ? target[key]
          : (...args) => {
              calls.push([key, ...args]);
              // Gradients are objects with addColorStop.
              if (key === 'createLinearGradient' || key === 'createRadialGradient') return { addColorStop() {} };
              return undefined;
            },
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    }
  );
  return { ctx, calls };
}

test('every cursor type and click effect draws through plain canvas calls', () => {
  for (const t of CURSOR_TYPES) {
    const { ctx, calls } = recordingCtx();
    drawCursorShape(ctx, t.id, 36);
    const names = calls.map((c) => c[0]);
    assert.ok(names.includes(t.dot ? 'arc' : 'lineTo'), `${t.id} traces its shape`);
    assert.ok(names.includes('stroke'), `${t.id} is outlined`);
  }
  const { ctx, calls } = recordingCtx();
  drawCursorShape(ctx, 'classic', 24);
  // The arrow's first point is the hotspot at the origin.
  assert.deepEqual(calls.find((c) => c[0] === 'moveTo'), ['moveTo', 0, 0]);

  for (const effect of ['ripple', 'ring', 'pulse']) {
    const r = recordingCtx();
    drawClickEffect(r.ctx, effect, 10, 10, 0.5, 20, '#2680eb', 1);
    assert.ok(r.calls.some((c) => c[0] === 'arc'), effect);
  }
  const none = recordingCtx();
  drawClickEffect(none.ctx, 'none', 10, 10, 0.5, 20, '#2680eb', 1);
  assert.equal(none.calls.length, 0);
});

test('playful family: variants draw multi-part shapes, curves included, and are valid settings', async () => {
  const { CURSOR_FAMILIES, cursorParts } = await import('../../src/engine/cursor-style.js');
  for (const f of CURSOR_FAMILIES) {
    const variants = CURSOR_TYPES.filter((t) => t.family === f.id);
    assert.ok(variants.length >= 4, `${f.id} has variants`);
    for (const t of variants) {
      assert.equal(cursorSettings({ type: t.id }).type, t.id, `${t.id} survives cursorSettings`);
      assert.ok(t.shapes.length > 0, `${t.id} is built from 3D shapes`);
      for (const sh of t.shapes) assert.ok(sh.face.length === 2 && sh.side && sh.ink, `${t.id} has face, side and ink colours`);
    }
  }
  const hand = recordingCtx();
  drawCursorShape(hand.ctx, 'fun-hand', 36);
  assert.ok(hand.calls.some((c) => c[0] === 'quadraticCurveTo'), 'the hand is traced with curves');
  // 3D look: extruded side layers, a clipped face for the bevel, a gradient face.
  assert.ok(hand.calls.filter((c) => c[0] === 'fill').length > 8, 'the side is swept in layers');
  assert.ok(hand.calls.some((c) => c[0] === 'clip'), 'face details are clipped to the face');
  assert.ok(hand.calls.some((c) => c[0] === 'fill' && c[1] === 'evenodd'), 'bevel rims');
  // The hotspot stays at the tip: the face (unshifted) starts at the origin.
  const arrow = recordingCtx();
  drawCursorShape(arrow.ctx, 'fun-sun', 24);
  assert.ok(arrow.calls.some((c) => c[0] === 'moveTo' && c[1] === 0 && c[2] === 0));
  // Every single-shape type is still one path drawn in layers.
  assert.equal(cursorParts(CURSOR_TYPES.find((t) => t.id === 'classic')).length, 1);
});
