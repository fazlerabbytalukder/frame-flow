import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeCrop, contentRect, computeGeometry, captionAt, annotationsAt,
  canvasPointToVideoUV, drawFrame,
} from '../../src/engine/composition-engine.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const IDENTITY = { cx: 0.5, cy: 0.5, scale: 1 };

test('normalizeCrop keeps at least 10% visible per axis', () => {
  assert.deepEqual(normalizeCrop(null), { l: 0, r: 0, t: 0, b: 0 });
  assert.deepEqual(normalizeCrop({ l: -1, r: 2, t: 'x', b: 0.1 }), { l: 0, r: 0.9, t: 0, b: 0.1 });
  // A small area recording: 12% wide at the right edge.
  const area = normalizeCrop({ l: 0.88, r: 0, t: 0.3, b: 0.5 });
  near(area.l, 0.88);
  near(1 - area.t - area.b, 0.2);
  // Overlapping edges shrink together, preserving their ratio.
  const both = normalizeCrop({ l: 0.6, r: 0.6 });
  near(both.l + both.r, 0.9);
  near(both.l, both.r);
});

test('contentRect aspect-fits inside the padding and centers', () => {
  // 16:9 video in a square canvas: width-limited.
  const r = contentRect(1000, 1000, 1920, 1080, 0.1);
  near(r.w, 800);
  near(r.h, 450);
  near(r.x, 100);
  near(r.y, 275);
  // 16:9 video in a portrait canvas.
  const p = contentRect(1080, 1920, 1920, 1080, 0);
  near(p.w, 1080);
  near(p.y, (1920 - 607.5) / 2);
  // Padding is capped at 0.35.
  near(contentRect(100, 100, 100, 100, 0.9).w, 30);
});

test('computeGeometry: no zoom shows the whole cropped frame', () => {
  const g = computeGeometry({
    videoW: 1920, videoH: 1080, canvasW: 1920, canvasH: 1080,
    style: { padding: 0, crop: { l: 0.25, r: 0.25, t: 0, b: 0 } }, camera: IDENTITY,
  });
  near(g.cx0, 480);
  near(g.cw, 960);
  near(g.viewW, 960);
  near(g.sxRel, 0);
  const tl = g.uvToCanvas(0, 0);
  const br = g.uvToCanvas(1, 1);
  near(tl.x, g.rect.x);
  near(br.x, g.rect.x + g.rect.w);
  near(br.y, g.rect.y + g.rect.h);
});

test('computeGeometry: zoom centers the focus point and never leaves the frame', () => {
  const style = { padding: 0.05, crop: null };
  const g = computeGeometry({ videoW: 1920, videoH: 1080, canvasW: 1280, canvasH: 720, style, camera: { cx: 0.5, cy: 0.5, scale: 2 } });
  near(g.viewW, 960);
  near(g.sxRel, 480);
  const c = g.uvToCanvas(0.5, 0.5);
  near(c.x, g.rect.x + g.rect.w / 2);
  near(c.y, g.rect.y + g.rect.h / 2);

  const edge = computeGeometry({ videoW: 1920, videoH: 1080, canvasW: 1280, canvasH: 720, style, camera: { cx: 0, cy: 1, scale: 2 } });
  near(edge.sxRel, 0);
  near(edge.syRel, 1080 - 540);
});

test('fullUVToCropUV maps into crop space and rejects cropped-out points', () => {
  const g = computeGeometry({
    videoW: 100, videoH: 100, canvasW: 100, canvasH: 100,
    style: { padding: 0, crop: { l: 0.2, r: 0.2, t: 0, b: 0.4 } }, camera: IDENTITY,
  });
  const p = g.fullUVToCropUV(0.5, 0.3);
  near(p.x, 0.5);
  near(p.y, 0.5);
  assert.equal(g.fullUVToCropUV(0.05, 0.3), null);
  assert.equal(g.fullUVToCropUV(0.5, 0.9), null);
});

test('canvasPointToVideoUV inverts uvToCanvas under padding, crop and zoom', () => {
  const style = { padding: 0.08, crop: { l: 0.1, r: 0.05, t: 0.02, b: 0.1 } };
  const camera = { cx: 0.6, cy: 0.4, scale: 1.7 };
  const g = computeGeometry({ videoW: 1920, videoH: 1080, canvasW: 1080, canvasH: 1080, style, camera });
  for (const [u, v] of [[0.5, 0.5], [0.4, 0.3], [0.7, 0.55]]) {
    const p = g.uvToCanvas(u, v);
    const back = canvasPointToVideoUV(p.x / 1080, p.y / 1080, 1080, 1080, 1920, 1080, style, camera);
    near(back.x, u, 1e-9);
    near(back.y, v, 1e-9);
  }
});

test('captionAt / annotationsAt use inclusive time windows', () => {
  const caps = [{ text: 'a', time: 1, duration: 2 }, { text: 'b', time: 5, duration: 1 }];
  assert.equal(captionAt(caps, 0.9), null);
  assert.equal(captionAt(caps, 1), 'a');
  assert.equal(captionAt(caps, 3), 'a');
  assert.equal(captionAt(caps, 5.5), 'b');
  assert.equal(captionAt(null, 1), null);
  const anns = [{ time: 0, duration: 2 }, { time: 1, duration: 2 }];
  assert.equal(annotationsAt(anns, 1.5).length, 2);
  assert.equal(annotationsAt(anns, 2.5).length, 1);
  assert.deepEqual(annotationsAt(undefined, 1), []);
});

// A recording 2D context: enough surface for drawFrame to run headlessly.
function fakeCtx() {
  const calls = [];
  const handler = {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 10 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args) => calls.push([prop, args]);
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  };
  return { ctx: new Proxy({}, handler), calls };
}

test('drawFrame runs every overlay path without throwing', () => {
  const { ctx, calls } = fakeCtx();
  const video = { width: 1920, height: 1080 };
  drawFrame(ctx, {
    video, videoW: 1920, videoH: 1080, canvasW: 1280, canvasH: 720,
    style: {
      background: 'gradient-2', padding: 0.06, cornerRadius: 18, shadow: true,
      crop: { l: 0.1 }, cursor: { overlay: true, size: 1 },
      webcam: { enabled: true, position: 'top-left', shape: 'rounded' },
    },
    camera: { cx: 0.4, cy: 0.6, scale: 1.5 },
    webcamVideo: { readyState: 4, videoWidth: 640, videoHeight: 480 },
    captionText: 'A fairly long caption that should wrap across more than one line of text',
    cursor: { x: 0.5, y: 0.5 },
    clicks: [{ x: 0.5, y: 0.5, age: 0.2 }],
    annotations: [
      { type: 'text', x: 0.3, y: 0.3, text: 'Hi', color: '#ef4444' },
      { type: 'arrow', x: 0.2, y: 0.2, x2: 0.4, y2: 0.4 },
      { type: 'rect', x: 0.1, y: 0.1 },
    ],
    fade: 0.5,
  });
  const drawImages = calls.filter(([n]) => n === 'drawImage');
  assert.equal(drawImages.length, 2); // screen + webcam
  assert.ok(calls.some(([n]) => n === 'fillText'));
  assert.ok(calls.some(([n]) => n === 'arc'));
});

test('toSrt formats cues in time order, clipped to the video, safe against blank lines', async () => {
  const { toSrt } = await import('../../src/engine/srt.js');
  const srt = toSrt(
    [
      { time: 3725.5, duration: 2, text: 'Later' },
      { time: 0.25, duration: 1.5, text: 'First line\n\n\nsecond line' },
      { time: 5, duration: 1, text: '   ' }, // empty: skipped
      { time: 3726, duration: 10, text: 'Runs past the end' },
      { time: 9999, duration: 1, text: 'After the end' },
    ],
    3727
  );
  assert.equal(
    srt,
    '1\n00:00:00,250 --> 00:00:01,750\nFirst line\nsecond line\n\n' +
      '2\n01:02:05,500 --> 01:02:07,000\nLater\n\n' +
      '3\n01:02:06,000 --> 01:02:07,000\nRuns past the end\n'
  );
  assert.equal(toSrt([]), '');
});

test('framing: auto fills tall and square posts, fits close shapes and wide canvases', async () => {
  const { framingFor } = await import('../../src/engine/composition-engine.js');
  assert.equal(framingFor({}, 1080, 1920, 1920, 1080), 'fill'); // 9:16
  assert.equal(framingFor({}, 1080, 1080, 1920, 1080), 'fill'); // 1:1
  assert.equal(framingFor({}, 1440, 1080, 1920, 1080), 'fit'); // 4:3 is close enough
  assert.equal(framingFor({}, 1920, 1080, 1920, 1080), 'fit');
  assert.equal(framingFor({}, 1920, 1080, 960, 1080), 'fit'); // narrow crop keeps its background
  assert.equal(framingFor({ framing: 'fit' }, 1080, 1920, 1920, 1080), 'fit');
  assert.equal(framingFor({ framing: 'fill' }, 1920, 1080, 1920, 1080), 'fill');
});

test('computeGeometry: fill frames take the area shape and crop the screen to match', () => {
  const g = computeGeometry({
    videoW: 1920, videoH: 1080, canvasW: 1080, canvasH: 1920,
    style: { padding: 0.05 }, camera: { cx: 0.5, cy: 0.5, scale: 1, rest: { x: 1, y: 0.5 } },
  });
  assert.equal(g.framing, 'fill');
  near(g.frame.w / g.frame.h, (1080 * 0.9) / (1920 * 0.9));
  near(g.viewH, 1080); // full height of the screen...
  near(g.viewW / g.viewH, g.rect.w / g.rect.h); // ...in the frame's shape, so nothing stretches
  near(g.sxRel, 1920 - g.viewW); // resting on the right edge
  const zoomed = computeGeometry({
    videoW: 1920, videoH: 1080, canvasW: 1080, canvasH: 1920,
    style: { padding: 0.05 }, camera: { cx: 0.2, cy: 0.5, scale: 2, rest: { x: 1, y: 0.5 } },
  });
  near(zoomed.viewH, 540);
  near(zoomed.sxRel + zoomed.viewW / 2, 0.2 * 1920); // a zoom aims at its own focus
});

test('textAnchor: under the screen beside a camera, on the screen edge when stacked', async () => {
  const { textAnchor } = await import('../../src/engine/composition-engine.js');
  const beside = textAnchor(1920, 1080, { x: 0, y: 0, w: 1190, h: 1080 }, { x: 1240, y: 60, w: 620, h: 960, alpha: 1 });
  near(beside.cx, 595);
  assert.ok(beside.maxWidth <= 1190);
  const stacked = textAnchor(1080, 1920, { x: 0, y: 0, w: 1080, h: 1114 }, { x: 30, y: 1114, w: 1020, h: 776, alpha: 1 });
  assert.ok(stacked.bottom <= 1114, 'text stays on the screen, off the camera');
  const full = textAnchor(1920, 1080, { x: 0, y: 0, w: 1920, h: 1080 }, { x: 0, y: 0, w: 1920, h: 1080, alpha: 1 });
  assert.equal(full.avoid, null, 'a fullscreen camera is not avoided');
  const cut = textAnchor(1920, 1080, null, { x: 1000, y: 200, w: 800, h: 880, alpha: 1, cutout: 1 });
  assert.equal(cut.avoid, null, 'captions may cross a cutout presenter');
});
