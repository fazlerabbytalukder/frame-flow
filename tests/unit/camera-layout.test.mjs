// Camera layouts, smart framing (bubble dodges the cursor), hide on silence.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  layoutAt, layoutBlendAt, cornerRect, overlayRect, silenceVisibility, layoutGeometry, LAYOUT_EASE,
} from '../../src/engine/camera-layout.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const layouts = [
  { id: 'a', time: 2, duration: 3, layout: 'camera' },
  { id: 'b', time: 5, duration: 2, layout: 'split' }, // adjacent to a
];

test('layoutAt: overlay outside segments, latest-starting segment wins', () => {
  assert.equal(layoutAt(layouts, 1), 'overlay');
  assert.equal(layoutAt(layouts, 2), 'camera');
  assert.equal(layoutAt(layouts, 5), 'split');
  assert.equal(layoutAt(layouts, 7), 'overlay'); // end is exclusive
  assert.equal(layoutAt([{ time: 0, duration: 9, layout: 'bogus' }], 1), 'overlay');
  assert.equal(layoutAt(undefined, 1), 'overlay');
});

test('layoutBlendAt eases after every boundary, including adjacent segments', () => {
  assert.deepEqual(layoutBlendAt(layouts, 1), { from: 'overlay', to: 'overlay', f: 1 });
  const enter = layoutBlendAt(layouts, 2 + LAYOUT_EASE / 2);
  assert.equal(enter.from, 'overlay');
  assert.equal(enter.to, 'camera');
  near(enter.f, 0.5);
  assert.equal(layoutBlendAt(layouts, 2 + LAYOUT_EASE).f, 1);
  const swap = layoutBlendAt(layouts, 5.1);
  assert.deepEqual([swap.from, swap.to], ['camera', 'split']);
  const exit = layoutBlendAt(layouts, 7.1);
  assert.deepEqual([exit.from, exit.to], ['split', 'overlay']);
});

test('cornerRect places the bubble in each corner with circle or rounded shape', () => {
  const r = cornerRect(1920, 1080, { size: 0.2 }, 'top-left');
  near(r.w, 216);
  near(r.x, 1080 * 0.035);
  near(r.radius, 108);
  assert.ok(cornerRect(1920, 1080, { size: 0.2, shape: 'rounded' }, 'bottom-right').radius < 50);
  const br = cornerRect(1920, 1080, { size: 0.2 }, 'nonsense');
  near(br.x + br.w, 1920 - 1080 * 0.035);
});

test('smart framing: bubble moves away when the cursor heads into its corner', () => {
  const wc = { size: 0.22, position: 'bottom-right', avoidCursor: true };
  // Cursor in the middle until t=3, then parks in the bottom-right corner.
  const cursor = (t) => (t < 3 ? { x: 0.5, y: 0.5 } : { x: 0.95, y: 0.92 });
  const home = cornerRect(1920, 1080, wc, 'bottom-right');
  const away = cornerRect(1920, 1080, wc, 'bottom-left');
  assert.deepEqual(overlayRect(1920, 1080, wc, 0.5, cursor), home);
  const later = overlayRect(1920, 1080, wc, 4.9, cursor);
  near(later.x, away.x);
  // The move animates instead of jumping.
  const mid = overlayRect(1920, 1080, wc, 2.2, cursor);
  assert.ok(mid.x < home.x && mid.x > away.x, `mid-slide x ${mid.x}`);
  // Off: always the preferred corner.
  assert.deepEqual(overlayRect(1920, 1080, { ...wc, avoidCursor: false }, 4.9, cursor), home);
});

test('silenceVisibility hides the bubble inside long pauses and returns before speech', () => {
  const silences = [{ start: 2, end: 6 }, { start: 10, end: 11 }];
  assert.equal(silenceVisibility(silences, 1), 1);
  assert.equal(silenceVisibility(silences, 2.2), 1); // not instantly
  assert.equal(silenceVisibility(silences, 4), 0);
  assert.equal(silenceVisibility(silences, 5.9), 1); // back just before speech
  assert.equal(silenceVisibility(silences, 10.5), 1); // short pause ignored
  assert.equal(silenceVisibility([], 4), 1);
});

const project = (extra = {}) => ({
  assets: [{ type: 'webcam-recording' }],
  layouts,
  style: { webcam: { enabled: true, size: 0.22, position: 'bottom-right', ...extra } },
});

test('layoutGeometry: overlay, camera, split, screen-only', () => {
  const opts = { hasWebcam: true };
  const overlay = layoutGeometry(project(), 1, 1920, 1080, opts);
  assert.deepEqual(overlay.screenArea, { x: 0, y: 0, w: 1920, h: 1080 });
  assert.equal(overlay.screenAlpha, 1);
  near(overlay.webcam.w, 1080 * 0.22);

  const camera = layoutGeometry(project(), 4, 1920, 1080, opts);
  assert.equal(camera.screenAlpha, 0);
  assert.deepEqual([camera.webcam.x, camera.webcam.y, camera.webcam.w, camera.webcam.h], [0, 0, 1920, 1080]);

  const split = layoutGeometry(project(), 6, 1920, 1080, opts);
  near(split.screenArea.w, 1920 * 0.62);
  assert.ok(split.webcam.x >= split.screenArea.w - 1e-9, 'camera to the right of the screen');

  const portrait = layoutGeometry(project(), 6, 1080, 1920, opts);
  assert.ok(portrait.webcam.y >= portrait.screenArea.h - 1e-9, 'stacked on portrait');

  const only = layoutGeometry({ ...project(), layouts: [{ time: 0, duration: 9, layout: 'screen' }] }, 3, 1920, 1080, opts);
  assert.equal(only.webcam, null);
});

test('layoutGeometry: no webcam (or disabled) means plain screen whatever the layouts say', () => {
  for (const g of [
    layoutGeometry(project(), 4, 1920, 1080, { hasWebcam: false }),
    layoutGeometry(project({ enabled: false }), 4, 1920, 1080, { hasWebcam: true }),
  ]) {
    assert.equal(g.screenAlpha, 1);
    assert.equal(g.webcam, null);
    assert.deepEqual(g.screenArea, { x: 0, y: 0, w: 1920, h: 1080 });
  }
});

test('layoutGeometry: hide on silence fades only the bubble', () => {
  const p = project({ hideOnSilence: true });
  p.layouts = [];
  const g = layoutGeometry(p, 4, 1920, 1080, { hasWebcam: true, silences: [{ start: 2, end: 6 }], sourceTime: 4 });
  assert.equal(g.webcam, null);
  const talking = layoutGeometry(p, 1, 1920, 1080, { hasWebcam: true, silences: [{ start: 2, end: 6 }], sourceTime: 1 });
  assert.equal(talking.webcam.alpha, 1);
});

test('cutout: presenter stands on the bottom edge, on the bubble side, off the middle', async () => {
  const { usesCutout, stageRect } = await import('../../src/engine/camera-layout.js');
  const cut = { ...project(), layouts: [{ time: 2, duration: 4, layout: 'cutout' }] };
  const g = layoutGeometry(cut, 4, 1920, 1080, { hasWebcam: true, camAspect: 16 / 9 });
  assert.equal(g.screenAlpha, 1);
  assert.deepEqual(g.screenArea, { x: 0, y: 0, w: 1920, h: 1080 });
  assert.equal(g.webcam.cutout, 1);
  near(g.webcam.y + g.webcam.h, 1080);
  near(g.webcam.h, 1080 * 0.8);
  near(g.webcam.w, 1920 * 0.6); // a 16:9 camera is cropped at the sides
  near(stageRect(1920, 1080, {}, 3 / 4).w / (1080 * 0.8), 3 / 4); // a narrow one keeps its aspect
  assert.ok(g.webcam.x + g.webcam.w / 2 > 1920 / 2, 'right side by default');
  const left = stageRect(1920, 1080, { position: 'top-left' }, 16 / 9);
  assert.ok(left.x + left.w / 2 < 1920 / 2, 'left when the bubble lives on the left');
  assert.ok(stageRect(1920, 1080, {}, 4).w <= 1920 * 0.6 + 1e-9, 'never wider than 60% of the frame');

  // Outside cutout blocks the bubble has no cutout; the switch blends it in.
  assert.equal(layoutGeometry(cut, 1, 1920, 1080, { hasWebcam: true }).webcam.cutout, 0);
  const mid = layoutGeometry(cut, 2 + LAYOUT_EASE / 2, 1920, 1080, { hasWebcam: true });
  assert.ok(mid.webcam.cutout > 0 && mid.webcam.cutout < 1);

  assert.equal(usesCutout(cut.layouts, 1), false);
  assert.equal(usesCutout(cut.layouts, 4), true);
  assert.equal(usesCutout(cut.layouts, 6 + LAYOUT_EASE / 2), true, 'still masking while it animates out');
  assert.equal(usesCutout(cut.layouts, 7), false);
  assert.equal(layoutAt([{ time: 0, duration: 5, layout: 'overlay' }], 1), 'overlay');
});
