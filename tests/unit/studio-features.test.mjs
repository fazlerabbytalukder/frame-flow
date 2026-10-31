import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  captionStateAt, captionSettings, popScale, computeGeometry, deviceChrome, webcamCrop, cameraLookFilter, enhanceSettings, DEVICES,
} from '../../src/engine/composition-engine.js';
import { avoidCameraCover, faceAt } from '../../src/engine/frame-state.js';
import { headFromMask, smoothFaceTrack } from '../../src/engine/person-mask.js';

const require = createRequire(import.meta.url);
const media = require('../../electron/services/media-service.js');

test('caption state carries age, duration and word times', () => {
  const caps = [{ time: 2, duration: 1.5, text: 'a b', words: [{ text: 'a', t: 0, d: 0.3 }, { text: 'b', t: 0.5, d: 0.4 }] }];
  const s = captionStateAt(caps, 2.6);
  assert.equal(s.text, 'a b');
  assert.ok(Math.abs(s.age - 0.6) < 1e-9);
  assert.equal(s.duration, 1.5);
  assert.equal(s.words.length, 2);
  assert.equal(captionStateAt(caps, 4), null);
});

test('caption settings fall back to safe defaults', () => {
  assert.deepEqual(captionSettings({}), { look: 'pill', animation: 'none', size: 1, color: '#2680eb', uppercase: false });
  const s = captionSettings({ captions: { look: 'bold', animation: 'karaoke', size: 9, color: 'red', uppercase: true } });
  assert.equal(s.look, 'bold');
  assert.equal(s.animation, 'karaoke');
  assert.equal(s.size, 1.8);
  assert.equal(s.color, '#2680eb');
  assert.equal(s.uppercase, true);
});

test('newer caption looks and animations are accepted', () => {
  for (const look of ['glass', 'card', 'neon', 'gradient', 'punch', 'lines', 'news']) {
    assert.equal(captionSettings({ captions: { look } }).look, look);
  }
  for (const animation of ['rise', 'wordpop']) {
    assert.equal(captionSettings({ captions: { animation } }).animation, animation);
  }
});

test('pop animation starts small, overshoots a little and settles at 1', () => {
  assert.ok(popScale(0) < 0.9);
  const peak = Math.max(...[0.08, 0.1, 0.12, 0.15].map(popScale));
  assert.ok(peak > 1 && peak < 1.05, `peak ${peak}`);
  assert.equal(popScale(1), 1);
});

test('device frames keep the recording aspect and sit inside the canvas', () => {
  for (const device of DEVICES.filter((d) => d !== 'none')) {
    for (const [W, H] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
      const g = computeGeometry({
        videoW: 1600, videoH: 900, canvasW: W, canvasH: H,
        style: { padding: 0.08, device, framing: 'fit' }, camera: { cx: 0.5, cy: 0.5, scale: 1 },
      });
      assert.ok(g.device, `${device} chrome`);
      assert.ok(Math.abs(g.rect.w / g.rect.h - 16 / 9) < 0.01, `${device} ${W}x${H} aspect ${g.rect.w / g.rect.h}`);
      assert.ok(g.rect.x >= g.frame.x - 0.5 && g.rect.x + g.rect.w <= g.frame.x + g.frame.w + 0.5, `${device} inside x`);
      assert.ok(g.rect.y >= g.frame.y - 0.5 && g.rect.y + g.rect.h <= g.frame.y + g.frame.h + 0.5, `${device} inside y`);
      assert.ok(g.frame.x >= 0 && g.frame.y >= 0 && g.frame.x + g.frame.w <= W + 0.5 && g.frame.y + g.frame.h <= H + 0.5);
    }
  }
  assert.equal(deviceChrome({ device: 'none' }), null);
  // Edge to edge drops the device.
  const g = computeGeometry({ videoW: 1600, videoH: 900, canvasW: 1920, canvasH: 1080, style: { device: 'phone', frameless: true }, camera: { cx: 0.5, cy: 0.5, scale: 1 } });
  assert.equal(g.device, null);
});

test('browser frame has a title bar above the screen', () => {
  const g = computeGeometry({
    videoW: 1600, videoH: 900, canvasW: 1920, canvasH: 1080,
    style: { padding: 0.06, device: 'browser' }, camera: { cx: 0.5, cy: 0.5, scale: 1 },
  });
  assert.ok(g.rect.y - g.frame.y > 20, 'bar height');
  assert.ok(Math.abs(g.rect.x - g.frame.x) < 0.5, 'no side bezel');
});

test('webcam crop: cover-fit without a face; centred on the face with tracking', () => {
  const plain = webcamCrop(1280, 720, 1, null);
  assert.deepEqual(plain, { sx: 280, sy: 0, sw: 720, sh: 720 });
  const face = webcamCrop(1280, 720, 1, { x: 0.8, y: 0.4, size: 0.1 });
  assert.ok(face.sw < 720, 'zoomed in on a small face');
  assert.ok(face.sx + face.sw / 2 > 640, 'moved toward the face');
  assert.ok(face.sx >= 0 && face.sx + face.sw <= 1280 && face.sy >= 0 && face.sy + face.sh <= 720, 'stays inside the picture');
});

test('camera looks blend from neutral by strength', () => {
  assert.equal(cameraLookFilter('natural', 1), 'none');
  assert.equal(cameraLookFilter('warm', 0), 'none');
  assert.equal(cameraLookFilter('mono', 1), 'grayscale(1.000) contrast(1.120)');
  assert.equal(cameraLookFilter('mono', 0.5), 'grayscale(0.500) contrast(1.060)');
  assert.equal(cameraLookFilter('nope', 1), 'none');
});

test('enhance settings default to sharpen 0.5 and deband on', () => {
  assert.deepEqual(enhanceSettings({}), { sharpen: 0.5, deband: true });
  assert.deepEqual(enhanceSettings({ enhance: { sharpen: 3, deband: false } }), { sharpen: 1, deband: false });
});

// --- smart framing ------------------------------------------------------------

function framingProject(cursorX, cursorY, smartFraming) {
  return {
    clips: [{ id: 'c', start: 0, duration: 10, speed: 1 }],
    style: { padding: 0, crop: { l: 0, r: 0, t: 0, b: 0 }, smartFraming },
  };
}

test('smart framing pushes a zoomed view so the camera bubble leaves the cursor clear', () => {
  const track = { samples: Array.from({ length: 200 }, (_, i) => ({ t: i * 0.05, x: 0.9, y: 0.9 })) };
  const media = { canvasW: 1920, canvasH: 1080, videoW: 1920, videoH: 1080 };
  const layout = { webcam: { x: 1500, y: 660, w: 380, h: 380, alpha: 1 }, screenArea: null };
  const camera = { cx: 0.75, cy: 0.75, scale: 2 };
  const p = framingProject(0.9, 0.9, undefined);
  const cursorX = (cm) => computeGeometry({ ...media, style: p.style, camera: cm }).uvToCanvas(0.9, 0.9).x;
  assert.ok(cursorX(camera) > 1500, 'starts under the bubble');
  // The view is pinned to the right edge here, so it must zoom a little to clear.
  const moved = avoidCameraCover(p, track, 5, camera, layout, media);
  assert.ok(cursorX(moved) < 1500, `cursor clear of the bubble (${cursorX(moved)})`);
  assert.ok(moved.scale > camera.scale && moved.scale <= camera.scale * 1.5, `scale ${moved.scale}`);
  // With room to pan, it pans without extra zoom.
  const roomy = { ...layout, webcam: { x: 1100, y: 660, w: 380, h: 380, alpha: 1 } };
  const mid = { samples: track.samples.map((s) => ({ ...s, x: 0.6, y: 0.9 })) };
  const cam2 = { cx: 0.5, cy: 0.75, scale: 2 };
  const panned = avoidCameraCover(p, mid, 5, cam2, roomy, media);
  const x2 = computeGeometry({ ...media, style: p.style, camera: panned }).uvToCanvas(0.6, 0.9).x;
  assert.ok(x2 < 1100, `panned clear (${x2})`);
  assert.equal(panned.scale, 2);
  // Off, unzoomed, or no camera: untouched.
  assert.equal(avoidCameraCover(framingProject(0.9, 0.9, false), track, 5, camera, layout, media), camera);
  assert.equal(avoidCameraCover(p, track, 5, { ...camera, scale: 1 }, layout, media).cx, camera.cx);
  assert.equal(avoidCameraCover(p, track, 5, camera, { webcam: null }, media), camera);
  // Cursor far from the bubble: untouched.
  const away = { samples: track.samples.map((s) => ({ ...s, x: 0.55, y: 0.55 })) };
  assert.equal(avoidCameraCover(p, away, 5, camera, layout, media), camera);
});

// --- face tracking ------------------------------------------------------------

function silhouette(w, h, cx) {
  // A head (circle r=10 at y=25) on shoulders (wide block from y=42).
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const head = (x - cx) ** 2 + (y - 25) ** 2 <= 100;
      const body = y >= 42 && Math.abs(x - cx) <= 35;
      if (head || body) a[y * w + x] = 255;
    }
  }
  return a;
}

test('the head is found above the shoulders', () => {
  const h = headFromMask(silhouette(128, 96, 80), 128, 96);
  assert.ok(Math.abs(h.x - 80 / 128) < 0.02, `x ${h.x}`);
  assert.ok(h.y > 15 / 96 && h.y < 35 / 96, `y ${h.y}`);
  assert.ok(h.size > 14 / 128 && h.size < 24 / 128, `size ${h.size}`);
  assert.equal(headFromMask(new Uint8Array(128 * 96), 128, 96), null);
});

test('face track fills gaps, smooths, and interpolates', () => {
  const pts = smoothFaceTrack([null, [0.5, 0.4, 0.1], [0.6, 0.4, 0.1], null, [0.6, 0.4, 0.1]], 1);
  assert.equal(pts.length, 5);
  assert.deepEqual(pts[0], [0.5, 0.4, 0.1]);
  assert.equal(smoothFaceTrack([null, null]), null);
  const track = { step: 0.5, points: [[0.2, 0.3, 0.1], [0.4, 0.5, 0.2]] };
  const f = faceAt(track, 0.25);
  assert.ok(Math.abs(f.x - 0.3) < 1e-9 && Math.abs(f.y - 0.4) < 1e-9 && Math.abs(f.size - 0.15) < 1e-9);
  assert.deepEqual(faceAt(track, 99), { x: 0.4, y: 0.5, size: 0.2 });
  assert.equal(faceAt(null, 1), null);
});

// --- voice modes --------------------------------------------------------------

test('voice modes build the right FFmpeg chain', () => {
  assert.deepEqual(media.voiceFilters('standard'), []);
  assert.deepEqual(media.voiceFilters('noise'), ['afftdn=nf=-25']);
  const podcast = media.voiceFilters('podcast');
  for (const f of ['highpass', 'afftdn', 'deesser', 'acompressor', 'alimiter']) assert.ok(podcast.some((x) => x.startsWith(f)), f);
  const g = media.buildAudioGraph({ voiceInput: 1, clips: [{ start: 0, duration: 2, speed: 1 }], voice: 'podcast', total: 2 });
  assert.match(g.graph, /deesser/);
  // Older projects: denoise without a voice mode still means noise reduction.
  assert.match(media.buildAudioGraph({ voiceInput: 1, clips: [{ start: 0, duration: 2 }], denoise: true, total: 2 }).graph, /afftdn=nf=-25/);
});
