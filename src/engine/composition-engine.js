// Draws one composited frame: background (color/gradient/wallpaper/image/video), drop shadow,
// rounded-corner video with crop + zoom camera, content-attached overlays
// (smoothed cursor, click ripples, annotations), webcam PiP, captions, and the
// fade clip transition. The preview canvas and the exporter both call
// drawFrame with the same inputs, which is what keeps them pixel-consistent.

import { sharpen } from './gl-filters.js';
import { cursorSettings, drawCursorShape, drawClickEffect } from './cursor-style.js';

export const BACKGROUNDS = [
  { id: 'gradient-1', label: 'Indigo', stops: ['#312e81', '#7c3aed', '#c026d3'] },
  { id: 'gradient-2', label: 'Ocean', stops: ['#0f766e', '#0369a1', '#1e3a8a'] },
  { id: 'gradient-3', label: 'Sunset', stops: ['#9a3412', '#db2777', '#7e22ce'] },
  { id: 'gradient-4', label: 'Aurora', stops: ['#064e3b', '#0d9488', '#a3e635'] },
  { id: 'gradient-5', label: 'Peach', stops: ['#fb7185', '#fdba74', '#fef3c7'] },
  { id: 'gradient-6', label: 'Midnight', stops: ['#020617', '#1e1b4b', '#4c1d95'] },
  { id: 'gradient-7', label: 'Sky', stops: ['#e0f2fe', '#7dd3fc', '#6366f1'] },
  { id: 'solid-dark', label: 'Graphite', stops: ['#1c1f26', '#1c1f26'] },
  { id: 'solid-light', label: 'Paper', stops: ['#e2e8f0', '#e2e8f0'] },
  { id: 'none', label: 'None', stops: ['#000000', '#000000'] },
];

export const ANNOTATION_COLORS = ['#facc15', '#ef4444', '#818cf8', '#34d399', '#f8fafc'];

export const ANNOTATION_LABELS = { text: 'Text', arrow: 'Arrow', rect: 'Box', blur: 'Blur', spotlight: 'Spotlight' };

// Masks change the video itself (hide data, focus attention), so they are
// drawn right after it — cursor, ripples and other annotations stay on top.
const MASK_TYPES = new Set(['blur', 'spotlight']);

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export const INSET_COLORS = { light: '#f1f5f9', dark: '#0f1115', glass: 'rgba(255,255,255,0.18)' };

// Drop shadow controls; defaults reproduce the original fixed shadow.
// angle in degrees (90 = straight down), distance/blur as fractions of the
// canvas height.
export function shadowParams(s) {
  const o = s || {};
  return {
    angle: ((Number.isFinite(Number(o.angle)) ? Number(o.angle) : 90) * Math.PI) / 180,
    distance: clamp(Number.isFinite(Number(o.distance)) ? Number(o.distance) : 0.018, 0, 0.08),
    blur: clamp(Number.isFinite(Number(o.blur)) ? Number(o.blur) : 0.045, 0, 0.12),
    opacity: clamp(Number.isFinite(Number(o.opacity)) ? Number(o.opacity) : 0.55, 0, 1),
  };
}

// At least 10% of the source stays visible in each direction (area
// recordings can be that small); opposite edges shrink together past that.
const MAX_CROP_SUM = 0.9;

export function normalizeCrop(crop) {
  const c = crop || {};
  let l = clamp(Number(c.l) || 0, 0, MAX_CROP_SUM);
  let r = clamp(Number(c.r) || 0, 0, MAX_CROP_SUM);
  let t = clamp(Number(c.t) || 0, 0, MAX_CROP_SUM);
  let b = clamp(Number(c.b) || 0, 0, MAX_CROP_SUM);
  if (l + r > MAX_CROP_SUM) {
    const k = MAX_CROP_SUM / (l + r);
    l *= k;
    r *= k;
  }
  if (t + b > MAX_CROP_SUM) {
    const k = MAX_CROP_SUM / (t + b);
    t *= k;
    b *= k;
  }
  return { l, r, t, b };
}

// Built-in wallpapers, drawn procedurally so no image files ship with the
// app. Two painters:
// - 'glow' (default): a base fill plus soft radial light pools
//   (blobs: [x, y, radius, color] in canvas fractions).
// - 'layers': a sky gradient (top → bottom), an optional sun glow
//   ([x, y, radius, color]) and overlapping wavy ribbons drawn back to front
//   (bands: [baseline, amplitude, waves, phase, topColor, bottomColor], in
//   fractions of the band field). `angle` tilts the field; `sheen` adds a
//   soft highlight along each ribbon's crest.
// Ids are stored in projects and presets, so never rename one.
export const WALLPAPER_CATEGORIES = [
  { id: 'silk', label: 'Silk' },
  { id: 'horizon', label: 'Horizon' },
  { id: 'mesh', label: 'Mesh' },
  { id: 'glow', label: 'Glow' },
];

export const WALLPAPERS = [
  // Silk: tilted ribbons with a highlight on each crest.
  { id: 'silk-lagoon', label: 'Lagoon', category: 'silk', kind: 'layers', angle: -18, sheen: true, sky: ['#04122b', '#0b3a75', '#1d6fd1'],
    bands: [[0.3, 0.06, 0.8, 0.4, '#1559c4', '#0a2a66'], [0.45, 0.07, 0.7, 2.1, '#2b8af0', '#0d3f8f'], [0.6, 0.06, 0.9, 4.0, '#4fb4ff', '#1356b8'], [0.76, 0.05, 0.6, 1.2, '#9ad7ff', '#2a74d6']] },
  { id: 'silk-orchid', label: 'Orchid', category: 'silk', kind: 'layers', angle: 22, sheen: true, sky: ['#1a0730', '#4a1470', '#9a2fb0'],
    bands: [[0.3, 0.07, 0.7, 1.0, '#6d22a8', '#2c0b4d'], [0.47, 0.06, 0.9, 3.3, '#a43bc4', '#4a1270'], [0.62, 0.07, 0.6, 5.1, '#e05bb8', '#7a1d86'], [0.78, 0.05, 0.8, 0.3, '#ff9ccf', '#b8338f']] },
  { id: 'silk-citrus', label: 'Citrus', category: 'silk', kind: 'layers', angle: -24, sheen: true, sky: ['#3a0f05', '#9c2e0a', '#f0700f'],
    bands: [[0.28, 0.06, 0.8, 2.6, '#c2410c', '#5c1606'], [0.44, 0.07, 0.6, 0.6, '#ef6c12', '#8a2508'], [0.6, 0.06, 0.9, 3.9, '#fb9a2a', '#b5400b'], [0.76, 0.05, 0.7, 5.5, '#ffd36b', '#e77714']] },
  { id: 'silk-jade', label: 'Jade', category: 'silk', kind: 'layers', angle: 16, sheen: true, sky: ['#021a14', '#064d3b', '#0f8a67'],
    bands: [[0.32, 0.06, 0.7, 4.4, '#0b6e52', '#032c22'], [0.48, 0.07, 0.8, 1.8, '#13a37a', '#06473a'], [0.63, 0.06, 0.6, 0.2, '#3fd19c', '#0b7458'], [0.79, 0.05, 0.9, 2.9, '#b5f5d6', '#2bb386']] },
  { id: 'silk-fjord', label: 'Fjord', category: 'silk', kind: 'layers', angle: -12, sheen: true, sky: ['#05051a', '#141a4d', '#2b3a8f'],
    bands: [[0.3, 0.05, 0.9, 1.4, '#232f7a', '#0b0f33'], [0.46, 0.06, 0.7, 3.8, '#3446a8', '#141b55'], [0.61, 0.07, 0.8, 5.9, '#5b6fd6', '#23308a'], [0.77, 0.05, 0.6, 0.9, '#a9b6ff', '#4152b8']] },
  { id: 'silk-pearl', label: 'Pearl', category: 'silk', kind: 'layers', angle: 20, sheen: true, sky: ['#d9dde6', '#eceef3', '#f7f7fa'],
    bands: [[0.3, 0.06, 0.8, 0.7, '#c9cfdc', '#aab2c4'], [0.46, 0.06, 0.7, 2.9, '#dde2ec', '#bcc4d4'], [0.62, 0.07, 0.9, 4.6, '#eef1f7', '#cfd5e2'], [0.78, 0.05, 0.6, 1.6, '#ffffff', '#dde2ec']] },

  // Horizon: layered hills under a sky with a sun glow.
  { id: 'horizon-dawn', label: 'Dawn', category: 'horizon', kind: 'layers', angle: 0, sky: ['#2b2a6b', '#c06c8f', '#ffc49b'], sun: [0.68, 0.5, 0.35, '#fff1c4'],
    bands: [[0.6, 0.05, 1.1, 0.8, '#8a5c8f', '#6b4778'], [0.7, 0.04, 0.8, 2.6, '#5d3f6e', '#4a3260'], [0.8, 0.05, 1.3, 4.2, '#3b2850', '#2e1f40'], [0.9, 0.03, 0.7, 1.1, '#221733', '#1a1128']] },
  { id: 'horizon-dusk', label: 'Dusk', category: 'horizon', kind: 'layers', angle: 0, sky: ['#120a2e', '#6b1f5c', '#f2683a'], sun: [0.3, 0.56, 0.3, '#ffb15c'],
    bands: [[0.62, 0.04, 0.9, 3.1, '#7a2a4f', '#5a1f45'], [0.72, 0.05, 1.2, 0.4, '#4d1a3f', '#3b1435'], [0.82, 0.04, 0.8, 5.0, '#2d1030', '#220c26'], [0.92, 0.03, 1.4, 2.2, '#170819', '#100512']] },
  { id: 'horizon-alpine', label: 'Alpine', category: 'horizon', kind: 'layers', angle: 0, sky: ['#3d7bd9', '#8cc0f0', '#e6f4ff'], sun: [0.78, 0.25, 0.25, '#ffffff'],
    bands: [[0.55, 0.08, 1.6, 1.9, '#9fb8d6', '#7f9cc0'], [0.67, 0.07, 1.2, 4.4, '#5f7fa8', '#4a6a94'], [0.79, 0.05, 0.9, 0.7, '#2f6b55', '#245542'], [0.9, 0.03, 1.1, 3.3, '#1d4a3a', '#15382c']] },
  { id: 'horizon-dune', label: 'Dune', category: 'horizon', kind: 'layers', angle: 0, sky: ['#f2a65a', '#f7cf8f', '#fbe8c4'], sun: [0.25, 0.4, 0.3, '#fff6dc'],
    bands: [[0.6, 0.04, 0.7, 2.0, '#e0a060', '#c98848'], [0.7, 0.05, 0.9, 5.2, '#c47a3c', '#a9642e'], [0.8, 0.04, 0.6, 0.9, '#9c5626', '#82461e'], [0.9, 0.03, 0.8, 3.6, '#6e3615', '#562a10']] },
  { id: 'horizon-midnight', label: 'Midnight', category: 'horizon', kind: 'layers', angle: 0, sky: ['#02030d', '#0b1638', '#20356e'], sun: [0.7, 0.3, 0.18, '#dfe8ff'],
    bands: [[0.62, 0.05, 1.0, 1.2, '#1a2a55', '#142246'], [0.72, 0.04, 1.3, 3.7, '#111c3d', '#0d1631'], [0.82, 0.05, 0.8, 5.6, '#0a1128', '#070c1e'], [0.92, 0.03, 1.1, 0.5, '#04070f', '#020409']] },
  { id: 'horizon-mist', label: 'Mist', category: 'horizon', kind: 'layers', angle: 0, sky: ['#9aa7b5', '#c9d2db', '#eef1f4'], sun: [0.5, 0.42, 0.32, '#ffffff'],
    bands: [[0.58, 0.05, 1.2, 0.3, '#b3bec9', '#a3afbb'], [0.68, 0.05, 0.9, 2.8, '#8f9cab', '#7f8d9d'], [0.79, 0.04, 1.4, 4.9, '#6a7889', '#5c6a7b'], [0.9, 0.03, 0.8, 1.7, '#475565', '#3b4757']] },

  // Mesh: vivid overlapping colour fields.
  { id: 'mesh-candy', label: 'Candy', category: 'mesh', base: '#ff7eb3', blobs: [[0.0, 0.0, 0.9, '#ff4f9a'], [1.0, 0.1, 0.8, '#ffb86b'], [0.2, 1.0, 0.8, '#8f6bff'], [0.85, 0.9, 0.7, '#5ad8ff'], [0.5, 0.5, 0.3, '#ffd9ec']] },
  { id: 'mesh-tropic', label: 'Tropic', category: 'mesh', base: '#0fb5a5', blobs: [[0.0, 0.2, 0.9, '#00c2ff'], [1.0, 0.0, 0.8, '#7cf29a'], [0.9, 1.0, 0.8, '#ffd23f'], [0.1, 1.0, 0.7, '#0a7d8c']] },
  { id: 'mesh-plasma', label: 'Plasma', category: 'mesh', base: '#2a0a5c', blobs: [[0.1, 0.1, 0.8, '#ff2e88'], [0.9, 0.2, 0.8, '#5b2cff'], [0.6, 1.0, 0.9, '#ff8a00'], [0.0, 0.9, 0.6, '#c513ff']] },
  { id: 'mesh-sherbet', label: 'Sherbet', category: 'mesh', base: '#ffd6a8', blobs: [[0.0, 0.0, 0.8, '#ff9a8b'], [1.0, 0.3, 0.8, '#ffe28a'], [0.3, 1.0, 0.8, '#ffb3d9'], [0.95, 1.0, 0.6, '#a8e6cf']] },
  { id: 'mesh-arctic', label: 'Arctic', category: 'mesh', base: '#cfe9ff', blobs: [[0.0, 0.0, 0.8, '#7fb8ff'], [1.0, 0.2, 0.7, '#c9b8ff'], [0.4, 1.0, 0.9, '#9ff0ff'], [1.0, 1.0, 0.5, '#ffffff']] },
  { id: 'mesh-volt', label: 'Volt', category: 'mesh', base: '#062a1e', blobs: [[0.0, 1.0, 0.9, '#00d084'], [1.0, 0.0, 0.8, '#c6ff3d'], [0.8, 0.9, 0.6, '#007a5a'], [0.2, 0.1, 0.5, '#00b3c7']] },

  // Glow: dark bases with soft light pools.
  { id: 'wall-graphite', label: 'Graphite', category: 'glow', base: '#17181b', blobs: [[0.12, 0.18, 0.75, '#3b4252'], [0.88, 0.9, 0.7, '#2b2f38'], [0.72, 0.12, 0.45, '#525a6b']] },
  { id: 'wall-steel', label: 'Steel blue', category: 'glow', base: '#0c1a33', blobs: [[0.1, 0.9, 0.8, '#0d66d0'], [0.85, 0.15, 0.7, '#2680eb'], [0.55, 0.55, 0.4, '#93c5fd']] },
  { id: 'wall-ember', label: 'Ember', category: 'glow', base: '#160b08', blobs: [[0.2, 0.85, 0.8, '#c2410c'], [0.9, 0.2, 0.6, '#7c2d12'], [0.6, 0.6, 0.35, '#f59e0b']] },
  { id: 'wall-glacier', label: 'Glacier', category: 'glow', base: '#0a1c2e', blobs: [[0.85, 0.85, 0.8, '#0284c7'], [0.15, 0.2, 0.6, '#1e3a8a'], [0.5, 0.35, 0.4, '#e0f2fe']] },
  { id: 'wall-moss', label: 'Moss', category: 'glow', base: '#0c160f', blobs: [[0.15, 0.8, 0.75, '#3f6212'], [0.85, 0.2, 0.7, '#14532d'], [0.6, 0.65, 0.35, '#a3e635']] },
  { id: 'wall-dusk', label: 'Dusk', category: 'glow', base: '#1a0d2e', blobs: [[0.1, 0.15, 0.7, '#7e22ce'], [0.9, 0.85, 0.75, '#db2777'], [0.75, 0.25, 0.4, '#f97316']] },
  { id: 'wall-tide', label: 'Tide', category: 'glow', base: '#03201f', blobs: [[0.85, 0.8, 0.8, '#0f766e'], [0.15, 0.25, 0.6, '#0e7490'], [0.45, 0.6, 0.35, '#99f6e4']] },
  { id: 'wall-sandstone', label: 'Sandstone', category: 'glow', base: '#2e2014', blobs: [[0.2, 0.2, 0.75, '#b7834a'], [0.85, 0.85, 0.7, '#854d0e'], [0.7, 0.3, 0.4, '#fde68a']] },
  { id: 'wall-nebula', label: 'Nebula', category: 'glow', base: '#08081a', blobs: [[0.2, 0.7, 0.7, '#4338ca'], [0.8, 0.3, 0.65, '#a21caf'], [0.55, 0.85, 0.35, '#22d3ee']] },
  { id: 'wall-rose', label: 'Rose quartz', category: 'glow', base: '#26121c', blobs: [[0.85, 0.2, 0.75, '#be185d'], [0.15, 0.85, 0.7, '#9d174d'], [0.4, 0.4, 0.4, '#fecdd3']] },
  { id: 'wall-paper', label: 'Paper', category: 'glow', base: '#e7e5df', blobs: [[0.2, 0.2, 0.7, '#ffffff'], [0.85, 0.85, 0.7, '#cfcac0'], [0.75, 0.2, 0.4, '#c7d2fe']] },
  { id: 'wall-carbon', label: 'Carbon', category: 'glow', base: '#0b0b0b', blobs: [[0.5, 0.0, 0.9, '#2e2e2e'], [0.0, 1.0, 0.6, '#1d1d1d'], [1.0, 1.0, 0.5, '#262626']] },
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Background blur (style.backgroundBlur 0..1) in canvas pixels.
export function backgroundBlurPx(style, canvasH) {
  const b = clamp(Number(style.backgroundBlur) || 0, 0, 1);
  return b * 0.04 * canvasH;
}

// "Remove background" (style.frameless): the screen fills its area with no
// padding, rounding, shadow or bezel. Everything that lays out the frame
// reads the style through here so preview, export and hit-testing agree.
export function effectiveStyle(style) {
  if (!style || !style.frameless) return style;
  return { ...style, padding: 0, paddingY: 0, cornerRadius: 0, shadow: false, inset: { ...style.inset, size: 0 }, device: 'none' };
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Backgrounds are rendered once per source/size/blur and reused: motion blur
// draws several sub-frames per frame, and blurring is expensive.
const bgCache = new Map();
function cachedBackground(key, w, h, draw, deband = false) {
  const k = deband ? `${key}|deband` : key;
  const hit = bgCache.get(k);
  if (hit && hit.w === w && hit.h === h) return hit.canvas;
  const canvas = makeCanvas(w, h);
  draw(canvas.getContext('2d'));
  if (deband) dither(canvas.getContext('2d'), w, h);
  key = k;
  bgCache.set(key, { w, h, canvas });
  if (bgCache.size > 6) bgCache.delete(bgCache.keys().next().value);
  return canvas;
}

const sourceIds = new WeakMap();
let nextSourceId = 1;
function sourceId(source) {
  if (!sourceIds.has(source)) sourceIds.set(source, nextSourceId++);
  return sourceIds.get(source);
}

// Debanding: a blurred background is a very smooth gradient, and quantized
// to 8 bits it shows visible steps (banding), worse after video compression.
// (Canvas gradients are already dithered by Chromium; blur output is not.)
// Adding a fixed, tiny noise (under one level either way, the same every
// frame) breaks the steps up.
function dither(ctx, w, h) {
  let img;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch {
    return;
  }
  const d = img.data;
  let seed = 0x9e3779b9;
  for (let i = 0; i < d.length; i += 4) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const n = ((seed >>> 0) / 4294967296 - 0.5) * 1.5;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

// Picture enhancements (style.enhance): `sharpen` restores detail when a
// zoom upscales the recording (0 off .. 1 strong); `deband` dithers blurred
// backgrounds. Both on by default.
export function enhanceSettings(style) {
  const e = style?.enhance || {};
  const s = Number(e.sharpen);
  return { sharpen: Number.isFinite(s) ? clamp(s, 0, 1) : 0.5, deband: e.deband !== false };
}

// Cover-fit a source, slightly overscanned when blurred so the soft edge
// never pulls in transparent pixels.
function drawCover(ctx, source, sw, sh, w, h, blurPx) {
  const over = blurPx > 0 ? 1 + (4 * blurPx) / Math.min(w, h) : 1;
  const scale = Math.max(w / sw, h / sh) * over;
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.save();
  if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
}

function paintGlow(ctx, w, h, wp) {
  ctx.fillStyle = wp.base;
  ctx.fillRect(0, 0, w, h);
  const span = Math.max(w, h);
  for (const [x, y, r, color] of wp.blobs) {
    const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * span);
    g.addColorStop(0, `${color}e6`);
    g.addColorStop(0.55, `${color}55`);
    g.addColorStop(1, `${color}00`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

// Crest of a ribbon: a main wave plus a faster, smaller one so no two crests
// look alike. u runs 0..1 across the band field.
function ribbonY(u, [baseline, amp, waves, phase], fh) {
  const a = 2 * Math.PI * waves * u + phase;
  return (baseline + amp * (Math.sin(a) + 0.35 * Math.sin(2.3 * a + phase * 0.7))) * fh;
}

const RIBBON_STEPS = 96;

function paintLayers(ctx, w, h, wp) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  wp.sky.forEach((c, i) => sky.addColorStop(i / (wp.sky.length - 1), c));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  if (wp.sun) {
    const [x, y, r, color] = wp.sun;
    const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * Math.max(w, h));
    g.addColorStop(0, `${color}ff`);
    g.addColorStop(0.12, `${color}cc`);
    g.addColorStop(0.45, `${color}33`);
    g.addColorStop(1, `${color}00`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // The band field is rotated about the canvas centre and sized to cover
  // the canvas at that angle, so tilted ribbons never leave bare corners.
  const angle = ((wp.angle || 0) * Math.PI) / 180;
  const fw = Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle));
  const fh = Math.abs(w * Math.sin(angle)) + Math.abs(h * Math.cos(angle));
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(angle);
  ctx.translate(-fw / 2, -fh / 2);
  for (const band of wp.bands) {
    const [baseline, amp, , , top, bottom] = band;
    const crest = new Path2D();
    for (let i = 0; i <= RIBBON_STEPS; i++) {
      const u = i / RIBBON_STEPS;
      const y = ribbonY(u, band, fh);
      if (i === 0) crest.moveTo(u * fw, y);
      else crest.lineTo(u * fw, y);
    }
    const body = new Path2D(crest);
    body.lineTo(fw, fh * 1.05);
    body.lineTo(0, fh * 1.05);
    body.closePath();

    const fill = ctx.createLinearGradient(0, (baseline - amp * 1.35) * fh, 0, Math.min(1, baseline + 0.3) * fh);
    fill.addColorStop(0, top);
    fill.addColorStop(1, bottom);
    // A soft shadow from each ribbon onto the one behind it gives depth.
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = 0.035 * h;
    ctx.fillStyle = fill;
    ctx.fill(body);

    if (wp.sheen) {
      ctx.lineWidth = 0.004 * h;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.shadowColor = 'rgba(255,255,255,0.45)';
      ctx.shadowBlur = 0.02 * h;
      ctx.stroke(crest);
    }
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

// Paints a built-in wallpaper at any size; the panel uses it for thumbnails.
export function paintWallpaper(ctx, w, h, wp) {
  if (wp.kind === 'layers') paintLayers(ctx, w, h, wp);
  else paintGlow(ctx, w, h, wp);
}

// Fill behind a blurred wallpaper's soft edge.
function wallpaperBase(wp) {
  return wp.kind === 'layers' ? wp.sky[wp.sky.length - 1] : wp.base;
}

// CSS-style angle: 0deg points up, 90deg points right.
function linearGradientAt(ctx, w, h, angleDeg, stops) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  const half = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
  const dx = Math.cos(a) * half;
  const dy = Math.sin(a) * half;
  const grad = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
  stops.forEach((stop, i) => grad.addColorStop(i / (stops.length - 1), stop));
  return grad;
}

function paintBackground(ctx, w, h, style, backgroundImage, backgroundVideo) {
  const blurPx = backgroundBlurPx(style, h);
  const kind = style.background;
  // Debanding needs an offscreen canvas (absent in plain Node tests).
  const deband = enhanceSettings(style).deband && (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined');

  if (kind === 'video' && backgroundVideo && backgroundVideo.readyState >= 2 && backgroundVideo.videoWidth > 0) {
    // Live source: re-render only when the video frame changes.
    const key = `video|${sourceId(backgroundVideo)}|${backgroundVideo.currentTime}|${blurPx}`;
    ctx.drawImage(
      cachedBackground(key, w, h, (c) => {
        c.fillStyle = '#000';
        c.fillRect(0, 0, w, h);
        drawCover(c, backgroundVideo, backgroundVideo.videoWidth, backgroundVideo.videoHeight, w, h, blurPx);
      }),
      0,
      0
    );
    return;
  }
  if (kind === 'image' && backgroundImage && backgroundImage.width > 0) {
    const key = `image|${sourceId(backgroundImage)}|${blurPx}`;
    ctx.drawImage(
      cachedBackground(key, w, h, (c) => {
        c.fillStyle = '#000';
        c.fillRect(0, 0, w, h);
        drawCover(c, backgroundImage, backgroundImage.width, backgroundImage.height, w, h, blurPx);
      }, deband && blurPx > 0),
      0,
      0
    );
    return;
  }
  const wallpaper = WALLPAPERS.find((x) => x.id === kind);
  if (wallpaper) {
    ctx.drawImage(
      cachedBackground(`wall|${kind}|${blurPx}`, w, h, (c) => {
        if (blurPx <= 0) {
          paintWallpaper(c, w, h, wallpaper);
          return;
        }
        const raw = makeCanvas(w, h);
        paintWallpaper(raw.getContext('2d'), w, h, wallpaper);
        c.fillStyle = wallpaperBase(wallpaper);
        c.fillRect(0, 0, w, h);
        drawCover(c, raw, w, h, w, h, blurPx);
      }, deband && blurPx > 0),
      0,
      0
    );
    return;
  }
  if (kind === 'color') {
    ctx.fillStyle = HEX_COLOR.test(style.backgroundColor || '') ? style.backgroundColor : '#2a2a2a';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (kind === 'gradient') {
    const gr = style.backgroundGradient || {};
    const from = HEX_COLOR.test(gr.from || '') ? gr.from : '#1473e6';
    const to = HEX_COLOR.test(gr.to || '') ? gr.to : '#0b2a52';
    const angle = Number.isFinite(Number(gr.angle)) ? Number(gr.angle) : 135;
    ctx.fillStyle = linearGradientAt(ctx, w, h, angle, [from, to]);
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const bg = BACKGROUNDS.find((b) => b.id === kind) || BACKGROUNDS[0];
  if (bg.stops.length < 2 || bg.stops[0] === bg.stops[1]) {
    ctx.fillStyle = bg.stops[0];
  } else {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    bg.stops.forEach((stop, i) => grad.addColorStop(i / (bg.stops.length - 1), stop));
    ctx.fillStyle = grad;
  }
  ctx.fillRect(0, 0, w, h);
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// The rect the (cropped) video occupies on the canvas after padding, aspect-fit.
// paddingY defaults to padding (one value for both axes).
export function contentRect(canvasW, canvasH, videoW, videoH, padding, paddingY = padding) {
  const padX = Math.min(0.35, Math.max(0, padding || 0));
  const padY = Math.min(0.35, Math.max(0, paddingY ?? padX));
  const availW = canvasW * (1 - padX * 2);
  const availH = canvasH * (1 - padY * 2);
  const scale = Math.min(availW / videoW, availH / videoH);
  const w = videoW * scale;
  const h = videoH * scale;
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}

// Screen framing (style.framing) when the screen and its area differ in shape:
//   fit   the whole screen is visible, the background fills the rest
//   fill  the frame takes the area's shape and the camera crops into the
//         screen; unzoomed, it pans after the cursor (camera.rest)
//   auto  (default) fill when the area is much narrower than the screen, e.g.
//         a 16:9 screen in a 9:16 or 1:1 post, else fit (a narrow crop or a
//         phone recording on a wide canvas keeps its background)
export const FRAMINGS = ['auto', 'fit', 'fill'];

// Device frames (style.device) drawn around the recording. Chrome sizes are
// fractions of the content's shorter side: bezel on each side plus extra at
// the top (browser bar) and bottom (laptop base).
export const DEVICES = ['none', 'phone', 'tablet', 'laptop', 'browser'];
const DEVICE_CHROME = {
  phone: { side: 0.04, top: 0.04, bottom: 0.04, radius: 0.13, inner: 0.1 },
  tablet: { side: 0.05, top: 0.05, bottom: 0.05, radius: 0.07, inner: 0.035 },
  laptop: { side: 0.028, top: 0.045, bottom: 0.03, radius: 0.035, inner: 0.006, base: 0.05 },
  browser: { side: 0, top: 0.075, bottom: 0, radius: 0.02, inner: 0 },
};

export function deviceChrome(style) {
  return DEVICE_CHROME[style?.device] || null;
}
const AUTO_FILL_RATIO = 0.75;

export function framingFor(style, areaW, areaH, srcW, srcH) {
  if (style?.framing === 'fit' || style?.framing === 'fill') return style.framing;
  const r = areaW / areaH / (srcW / srcH);
  return r < AUTO_FILL_RATIO ? 'fill' : 'fit';
}

// Text overlays (captions, shortcuts) scale with the shorter side, so they
// read the same in a tall frame instead of growing with its height.
export function textBase(canvasW, canvasH) {
  return Math.min(canvasH, canvasW * 1.25);
}

// Vertical posts get their captions above the platform's caption/audio bar
// (see safe-zones.js); other shapes keep them near the bottom.
export function captionBottom(canvasW, canvasH) {
  return canvasW / canvasH < 0.7 ? canvasH * 0.76 : canvasH * 0.95;
}

// All the geometry one frame needs: crop region, content rect, camera view
// window, and the crop-UV -> canvas mapping used by overlays.
// `area` is the canvas region the screen is laid out in (camera layouts use a
// part of the canvas); it defaults to the whole canvas.
export function computeGeometry({ videoW, videoH, canvasW, canvasH, style: rawStyle, camera, area }) {
  const style = effectiveStyle(rawStyle);
  const crop = normalizeCrop(style.crop);
  const cx0 = crop.l * videoW;
  const cy0 = crop.t * videoH;
  const cw = Math.max(1, (1 - crop.l - crop.r) * videoW);
  const ch = Math.max(1, (1 - crop.t - crop.b) * videoH);

  // `frame` is the rounded window on the background; with an inset the video
  // (`rect`) sits inside it, scaled uniformly so its aspect never changes.
  const a = area || { x: 0, y: 0, w: canvasW, h: canvasH };
  const framing = framingFor(style, a.w, a.h, cw, ch);
  // A device frame grows the box being fitted by its chrome; the video
  // (`rect`) sits inside it with its aspect unchanged.
  const dev = deviceChrome(style);
  const unitOf = (w, h) => Math.min(w, h);
  let frame;
  // Source window shown at camera scale 1: the whole crop for fit, the
  // largest window of the frame's shape for fill.
  let baseW = cw;
  let baseH = ch;
  if (framing === 'fill') {
    const padX = Math.min(0.35, Math.max(0, style.padding || 0));
    const padY = Math.min(0.35, Math.max(0, style.paddingY ?? padX));
    const w = a.w * (1 - padX * 2);
    const h = a.h * (1 - padY * 2);
    frame = { x: a.x + (a.w - w) / 2, y: a.y + (a.h - h) / 2, w, h };
  } else if (dev) {
    // Fit content + chrome: solve for the content size u-relative chrome.
    const u0 = unitOf(cw, ch);
    const bw = cw + 2 * dev.side * u0;
    const bh = ch + (dev.top + dev.bottom + (dev.base || 0)) * u0;
    const fit = contentRect(a.w, a.h, bw, bh, style.padding, style.paddingY ?? style.padding);
    const k = fit.w / bw;
    frame = { x: a.x + fit.x, y: a.y + fit.y, w: fit.w, h: fit.h - (dev.base || 0) * u0 * k };
  } else {
    const fit = contentRect(a.w, a.h, cw, ch, style.padding, style.paddingY ?? style.padding);
    frame = { x: a.x + fit.x, y: a.y + fit.y, w: fit.w, h: fit.h };
  }
  let rect;
  let inset = 0;
  let deviceRect = null;
  if (dev) {
    // Chrome around the screen, measured on the frame's own size.
    // u: the screen's shorter side, roughly, in canvas pixels.
    const u = framing === 'fill'
      ? unitOf(frame.w, frame.h) / (1 + dev.top + dev.bottom)
      : (frame.w / (cw + 2 * dev.side * unitOf(cw, ch))) * unitOf(cw, ch);
    rect = {
      x: frame.x + dev.side * u,
      y: frame.y + dev.top * u,
      w: frame.w - 2 * dev.side * u,
      h: frame.h - (dev.top + dev.bottom) * u,
    };
    deviceRect = { u, ...dev };
  } else {
    inset = clamp(Number(style.inset?.size) || 0, 0, 0.06) * canvasH;
    const shrink = inset > 0 ? Math.min((frame.w - 2 * inset) / frame.w, (frame.h - 2 * inset) / frame.h) : 1;
    rect = {
      w: frame.w * shrink,
      h: frame.h * shrink,
      x: frame.x + (frame.w - frame.w * shrink) / 2,
      y: frame.y + (frame.h - frame.h * shrink) / 2,
    };
  }
  if (framing === 'fill') {
    // The source window takes the visible screen's shape.
    const aspect = rect.w / rect.h;
    if (cw / ch > aspect) baseW = ch * aspect;
    else baseH = cw / aspect;
  }
  const viewW = baseW / camera.scale;
  const viewH = baseH / camera.scale;
  // Unzoomed, a fill frame looks where the cursor is; zooms take over as
  // they scale in.
  let cx = camera.cx;
  let cy = camera.cy;
  if (framing === 'fill' && camera.rest) {
    const z = clamp((camera.scale - 1) / 0.3, 0, 1);
    const k = z * z * (3 - 2 * z);
    cx = camera.rest.x + (cx - camera.rest.x) * k;
    cy = camera.rest.y + (cy - camera.rest.y) * k;
  }
  const sxRel = clamp(cx * cw - viewW / 2, 0, cw - viewW);
  const syRel = clamp(cy * ch - viewH / 2, 0, ch - viewH);

  // Canvas pixels per cropped-source pixel under the current zoom.
  const pxScale = rect.w / viewW;

  return {
    crop,
    cx0,
    cy0,
    cw,
    ch,
    framing,
    frame,
    inset,
    device: deviceRect,
    rect,
    viewW,
    viewH,
    sxRel,
    syRel,
    pxScale,
    // Crop-UV (0..1 of the cropped region) to canvas coordinates.
    uvToCanvas(u, v) {
      return {
        x: rect.x + (u * cw - sxRel) * pxScale,
        y: rect.y + (v * ch - syRel) * (rect.h / viewH),
      };
    },
    // Full-video UV (cursor samples) to crop-UV; null when cropped out.
    fullUVToCropUV(u, v) {
      const cu = (u - crop.l) / Math.max(0.0001, 1 - crop.l - crop.r);
      const cv = (v - crop.t) / Math.max(0.0001, 1 - crop.t - crop.b);
      if (cu < -0.02 || cu > 1.02 || cv < -0.02 || cv > 1.02) return null;
      return { x: clamp(cu, 0, 1), y: clamp(cv, 0, 1) };
    },
  };
}

// camera: { cx, cy, scale } in cropped-video UV space (from zoom-engine).
// --- clip transitions ---------------------------------------------------------
const DIP_TRANSITIONS = { black: '#000000', white: '#ffffff' };

function smoothstep01(x) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

let transitionCanvas;
function transitionLayer(w, h) {
  if (!transitionCanvas || transitionCanvas.width !== w || transitionCanvas.height !== h) transitionCanvas = makeCanvas(w, h);
  return transitionCanvas;
}

// Draw the screen layer moved by a clip transition. tr.p: 1 = fully shown,
// 0 = gone (at the cut); tr.dir: 'out' for the leaving clip, 'in' for the next.
function compositeTransition(ctx, layer, tr, w, h) {
  const p = smoothstep01(tr.p);
  const q = 1 - p;
  const out = tr.dir === 'out';
  ctx.save();
  if (tr.type === 'zoom') {
    // Zoom through: the old clip grows away, the new one grows into place.
    const s = out ? 1 + q * 0.35 : 1 - q * 0.25;
    ctx.globalAlpha = p;
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-w / 2, -h / 2);
  } else if (tr.type === 'slide') {
    ctx.translate((out ? -1 : 1) * q * w, 0);
  } else if (tr.type === 'slideUp') {
    ctx.translate(0, (out ? -1 : 1) * q * h);
  } else if (tr.type === 'blur') {
    ctx.globalAlpha = p;
    ctx.filter = `blur(${(q * h * 0.03).toFixed(2)}px)`;
  } else if (tr.type === 'wipe') {
    // Left to right: the old clip is wiped off, the new one wiped on.
    ctx.beginPath();
    if (out) ctx.rect(q * w, 0, w - q * w, h);
    else ctx.rect(0, 0, p * w, h);
    ctx.clip();
  } else {
    ctx.globalAlpha = p;
  }
  ctx.drawImage(layer, 0, 0, w, h);
  ctx.restore();
}

// Optional inputs: webcamVideo, caption {text, words?, age?, duration?} (or captionText), backgroundImage, backgroundVideo, fade (0..1), transition ({ type, p, dir }),
// cursor {x,y in full-video UV}, clicks [{x,y,age}], annotations [{...}].
export function drawFrame(ctx, opts) {
  const {
    video, videoW, videoH, canvasW, canvasH, camera,
    webcamVideo, captionText, backgroundImage, backgroundVideo, cursor, clicks, annotations,
  } = opts;
  const style = effectiveStyle(opts.style);
  // Layout transitions can fade the whole screen frame (screenAlpha).
  const screenAlpha = opts.screenAlpha == null ? 1 : clamp(opts.screenAlpha, 0, 1);
  const fade = (opts.fade == null ? 1 : clamp(opts.fade, 0, 1)) * screenAlpha;

  paintBackground(ctx, canvasW, canvasH, style, backgroundImage, backgroundVideo);

  const g = computeGeometry({ videoW, videoH, canvasW, canvasH, style, camera, area: opts.screenArea });
  const { rect } = g;
  const radius = (style.cornerRadius || 0) * (canvasH / 1080);

  // The recording, its frame and everything attached to it. Drawn straight
  // onto the canvas, or onto a layer when a clip transition moves it.
  const drawScreenLayer = (ctx) => {
    const { frame, inset } = g;
    const device = g.device;
    if (device && screenAlpha > 0.01) {
      drawDeviceBody(ctx, g, style, screenAlpha, canvasH);
    } else if (style.shadow && Math.max(style.padding || 0, style.paddingY ?? 0) > 0.005 && screenAlpha > 0.01) {
      const sh = shadowParams(style.shadowStyle);
      ctx.save();
      ctx.globalAlpha = screenAlpha;
      ctx.shadowColor = `rgba(0,0,0,${sh.opacity})`;
      ctx.shadowBlur = canvasH * sh.blur;
      ctx.shadowOffsetX = Math.cos(sh.angle) * canvasH * sh.distance;
      ctx.shadowOffsetY = Math.sin(sh.angle) * canvasH * sh.distance;
      roundedRectPath(ctx, frame.x, frame.y, frame.w, frame.h, radius);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
    }

    // Inset bezel: the frame shows a solid ring around the video.
    if (inset > 0) {
      ctx.save();
      ctx.globalAlpha = fade;
      roundedRectPath(ctx, frame.x, frame.y, frame.w, frame.h, radius);
      ctx.fillStyle = INSET_COLORS[style.inset?.color] || INSET_COLORS.light;
      ctx.fill();
      ctx.restore();
    }

    // Video + content-attached overlays, clipped to the rounded frame.
    if (screenAlpha > 0.01) {
      ctx.save();
      roundedRectPath(ctx, rect.x, rect.y, rect.w, rect.h, device ? device.inner * device.u : Math.max(0, radius - inset));
      ctx.clip();
      ctx.globalAlpha = fade;
      drawScreen(ctx, video, videoW, videoH, g, style);

      const masks = annotations ? annotations.filter((a) => MASK_TYPES.has(a.type)) : [];
      if (masks.length > 0) drawMasks(ctx, g, masks, canvasH);
      // The lens magnifies what is already on the canvas (masks included), so it
      // can never reveal blurred content.
      if (opts.loupe && opts.loupe.strength > 0.01) drawLoupe(ctx, g, opts.loupe, canvasH);
      if (clicks && clicks.length > 0) drawClickRipples(ctx, g, clicks, style);
      if (cursor && style.cursor?.overlay) drawCursor(ctx, g, cursor, style);
      if (annotations && annotations.length > masks.length) {
        drawAnnotations(ctx, g, annotations.filter((a) => !MASK_TYPES.has(a.type)), canvasH);
      }

      ctx.globalAlpha = 1;
      ctx.restore();
      if (device) drawDeviceDetails(ctx, g, style, fade);
    }
  };
  const tr = opts.transition && opts.transition.p < 1 ? opts.transition : null;
  if (tr && !DIP_TRANSITIONS[tr.type]) {
    const layer = transitionLayer(canvasW, canvasH);
    const lctx = layer.getContext('2d');
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, canvasW, canvasH);
    drawScreenLayer(lctx);
    compositeTransition(ctx, layer, tr, canvasW, canvasH);
  } else {
    drawScreenLayer(ctx);
  }
  if (tr && DIP_TRANSITIONS[tr.type]) {
    // Dip: the whole picture (background too) passes through a solid colour.
    ctx.save();
    ctx.globalAlpha = 1 - smoothstep01(tr.p);
    ctx.fillStyle = DIP_TRANSITIONS[tr.type];
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.restore();
  }

  // Webcam stays fixed on the canvas, unaffected by the zoom camera. With
  // opts.webcamRect (camera layouts) it goes exactly there; null hides it;
  // undefined falls back to the corner bubble from the style.
  const wc = style.webcam;
  let camRect = null;
  if (webcamVideo && wc && wc.enabled !== false && webcamVideo.readyState >= 2 && opts.webcamRect !== null) {
    camRect = opts.webcamRect || defaultWebcamRect(canvasW, canvasH, wc);
    drawWebcam(ctx, webcamVideo, canvasH, camRect, opts.webcamMask, { look: cameraLook(wc), face: opts.webcamFace });
  }

  // Captions and shortcuts go where they read best in this shape and layout.
  const anchor = textAnchor(canvasW, canvasH, opts.screenArea, camRect);
  const cap = opts.caption || (captionText ? { text: captionText } : null);
  const look = cap ? captionSettings(style) : null;
  const caption = cap ? layoutCaption(ctx, cap, canvasW, canvasH, anchor, look) : null;
  if (caption) drawCaption(ctx, caption, cap, look);
  if (opts.shortcuts && opts.shortcuts.length > 0) {
    drawShortcuts(ctx, opts.shortcuts, canvasW, canvasH, anchor, caption);
  }
}

// The screen recording inside its frame. When a zoom upscales it (more than
// one canvas pixel per source pixel), an edge-limited sharpen restores the
// crispness lost to scaling, growing with the zoom.
function drawScreen(ctx, video, videoW, videoH, g, style) {
  const { rect } = g;
  const sx = g.cx0 + g.sxRel;
  const sy = g.cy0 + g.syRel;
  const amount = enhanceSettings(style).sharpen * clamp((g.pxScale - 1.1) * 1.2, 0, 1.4);
  if (amount > 0.02) {
    const out = sharpen(video, videoW, videoH, sx, sy, g.viewW, g.viewH, rect.w, rect.h, amount);
    if (out) {
      ctx.drawImage(out, 0, 0, Math.round(rect.w), Math.round(rect.h), rect.x, rect.y, rect.w, rect.h);
      return;
    }
  }
  ctx.drawImage(video, sx, sy, g.viewW, g.viewH, rect.x, rect.y, rect.w, rect.h);
}

// Device body: shadow, the shell with a light rim, and model details (the
// camera island on a phone, a camera dot on a tablet, a laptop's base, a
// browser's title bar). The screen is drawn into g.rect afterwards.
function drawDeviceBody(ctx, g, style, alpha, canvasH) {
  const { frame, rect, device: d } = g;
  const u = d.u;
  const r = d.radius * u;
  const type = style.device;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (style.shadow !== false) {
    const sh = shadowParams(style.shadowStyle);
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${sh.opacity})`;
    ctx.shadowBlur = canvasH * sh.blur;
    ctx.shadowOffsetX = Math.cos(sh.angle) * canvasH * sh.distance;
    ctx.shadowOffsetY = Math.sin(sh.angle) * canvasH * sh.distance;
    roundedRectPath(ctx, frame.x, frame.y, frame.w, frame.h, r);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
  }
  if (type === 'laptop') {
    // Base: a thin wedge wider than the lid, with a notch for opening it.
    const bh = d.base * u;
    const over = frame.w * 0.07;
    const y = frame.y + frame.h;
    const grad = ctx.createLinearGradient(0, y, 0, y + bh);
    grad.addColorStop(0, '#d9dbe0');
    grad.addColorStop(0.45, '#b9bcc4');
    grad.addColorStop(1, '#7d8089');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(frame.x - over * 0.6, y);
    ctx.lineTo(frame.x + frame.w + over * 0.6, y);
    ctx.lineTo(frame.x + frame.w + over, y + bh * 0.62);
    ctx.quadraticCurveTo(frame.x + frame.w + over, y + bh, frame.x + frame.w + over - bh * 0.4, y + bh);
    ctx.lineTo(frame.x - over + bh * 0.4, y + bh);
    ctx.quadraticCurveTo(frame.x - over, y + bh, frame.x - over, y + bh * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    roundedRectPath(ctx, frame.x + frame.w / 2 - frame.w * 0.08, y, frame.w * 0.16, bh * 0.28, bh * 0.14);
    ctx.fill();
  }
  // Shell.
  const shell = ctx.createLinearGradient(frame.x, frame.y, frame.x, frame.y + frame.h);
  if (type === 'browser') {
    shell.addColorStop(0, '#2b2d31');
    shell.addColorStop(1, '#232428');
  } else {
    shell.addColorStop(0, '#2a2b2f');
    shell.addColorStop(1, '#141518');
  }
  roundedRectPath(ctx, frame.x, frame.y, frame.w, frame.h, r);
  ctx.fillStyle = shell;
  ctx.fill();
  ctx.lineWidth = Math.max(1, u * 0.006);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  roundedRectPath(ctx, frame.x + ctx.lineWidth / 2, frame.y + ctx.lineWidth / 2, frame.w - ctx.lineWidth, frame.h - ctx.lineWidth, r);
  ctx.stroke();
  if (type === 'phone') {
    // Side buttons.
    ctx.fillStyle = '#1b1c1f';
    const bw = u * 0.012;
    roundedRectPath(ctx, frame.x - bw, frame.y + frame.h * 0.2, bw * 1.5, frame.h * 0.08, bw / 2);
    ctx.fill();
    roundedRectPath(ctx, frame.x + frame.w - bw / 2, frame.y + frame.h * 0.26, bw * 1.5, frame.h * 0.12, bw / 2);
    ctx.fill();
  }
  if (type === 'browser') {
    const barH = rect.y - frame.y;
    const dot = barH * 0.16;
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(frame.x + barH * 0.55 + i * dot * 3.1, frame.y + barH / 2, dot, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    const pw = Math.min(frame.w * 0.5, frame.w - barH * 6);
    roundedRectPath(ctx, frame.x + (frame.w - pw) / 2, frame.y + barH * 0.22, pw, barH * 0.56, barH * 0.28);
    ctx.fill();
  }
  ctx.restore();
}

// Device details: the phone's camera island over the screen, or the camera
// dot in a tablet's or laptop's top bezel.
function drawDeviceDetails(ctx, g, style, alpha = 1) {
  const { rect, device: d } = g;
  if (!d) return;
  const u = d.u;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#050506';
  if (style.device === 'phone') {
    const portrait = rect.h >= rect.w;
    const iw = u * 0.32;
    const ih = u * 0.075;
    if (portrait) roundedRectPath(ctx, rect.x + rect.w / 2 - iw / 2, rect.y + u * 0.03, iw, ih, ih / 2);
    else roundedRectPath(ctx, rect.x + u * 0.03, rect.y + rect.h / 2 - iw / 2, ih, iw, ih / 2);
    ctx.fill();
  } else if (style.device === 'tablet' || style.device === 'laptop') {
    // Camera dot centred in the top bezel.
    ctx.fillStyle = '#0b0c10';
    ctx.beginPath();
    ctx.arc(rect.x + rect.w / 2, (g.frame.y + rect.y) / 2, u * 0.009, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Camera colour looks (style.webcam.look) as canvas filter steps at full
// strength; `strength` blends each step from neutral.
export const CAMERA_LOOKS = {
  natural: [],
  warm: [['sepia', 0.22], ['saturate', 1.12], ['brightness', 1.03]],
  cool: [['hue-rotate', -10], ['saturate', 0.92], ['contrast', 1.05], ['brightness', 1.02]],
  film: [['contrast', 1.12], ['saturate', 0.82], ['sepia', 0.14]],
  vivid: [['saturate', 1.38], ['contrast', 1.08]],
  soft: [['brightness', 1.06], ['contrast', 0.9], ['saturate', 1.04]],
  mono: [['grayscale', 1], ['contrast', 1.12]],
};
const NEUTRAL = { sepia: 0, grayscale: 0, 'hue-rotate': 0, saturate: 1, contrast: 1, brightness: 1 };

export function cameraLookFilter(look, strength = 1) {
  const steps = CAMERA_LOOKS[look] || [];
  const k = clamp(Number(strength), 0, 1);
  if (steps.length === 0 || k === 0) return 'none';
  return steps
    .map(([fn, v]) => {
      const x = NEUTRAL[fn] + (v - NEUTRAL[fn]) * k;
      return fn === 'hue-rotate' ? `${fn}(${x.toFixed(2)}deg)` : `${fn}(${x.toFixed(3)})`;
    })
    .join(' ');
}

function cameraLook(wc) {
  const s = Number(wc.lookStrength);
  const sh = Number(wc.sharpen);
  return {
    filter: cameraLookFilter(wc.look, Number.isFinite(s) ? s : 0.7),
    sharpen: Number.isFinite(sh) ? clamp(sh, 0, 1) : 0,
  };
}

// --- text placement -----------------------------------------------------------

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Where bottom-centred text (captions, shortcuts) sits: { cx, maxWidth,
// bottom, avoid }. With the screen beside the camera it centres under the
// screen; with the screen stacked above the camera it sits on the screen's
// lower edge. `avoid` is a camera rect to keep clear (not a fullscreen camera
// or a cutout presenter, which text may cross).
export function textAnchor(canvasW, canvasH, screenArea, camRect) {
  const area = screenArea || { x: 0, y: 0, w: canvasW, h: canvasH };
  const unit = textBase(canvasW, canvasH);
  let cx = canvasW / 2;
  let maxWidth = canvasW * 0.8;
  let bottom = captionBottom(canvasW, canvasH);
  const beside = area.w < canvasW * 0.85 && area.h > canvasH * 0.85;
  const stacked = area.h < canvasH * 0.85 && area.w > canvasW * 0.85;
  if (beside) {
    cx = area.x + area.w / 2;
    maxWidth = area.w * 0.85;
  } else if (stacked) {
    bottom = Math.min(bottom, area.y + area.h - unit * 0.02);
  }
  const visible = camRect && (camRect.alpha ?? 1) > 0.5 && camRect.w > 1 && camRect.h > 1;
  const fullscreen = visible && camRect.w >= canvasW * 0.9 && camRect.h >= canvasH * 0.9;
  const avoid = visible && !fullscreen && !((camRect.cutout ?? 0) > 0.5) ? camRect : null;
  return { cx, maxWidth, bottom, avoid };
}

// The free horizontal span beside the camera at the text's height, on the
// side away from it: { x0, x1 } or null when the camera spans the width.
function spanBesideCamera(anchor, canvasW, margin) {
  const cam = anchor.avoid;
  if (!cam) return null;
  const left = cam.x + cam.w / 2 < anchor.cx;
  const x0 = left ? cam.x + cam.w + margin : margin;
  const x1 = left ? canvasW - margin : cam.x - margin;
  return x1 > x0 ? { x0, x1 } : null;
}

// Lift a block of height h whose bottom is at `bottom` above the camera if
// they would overlap, unless that would push it into the top third.
function clearOfCamera(anchor, x, w, h, bottom, canvasH, margin) {
  const cam = anchor.avoid;
  if (!cam || !overlaps({ x, y: bottom - h, w, h }, cam)) return bottom;
  const lifted = cam.y - margin;
  return lifted - h >= canvasH * 0.3 ? lifted : bottom;
}

// --- keyboard shortcut keycaps ----------------------------------------------

// shortcuts: [{ keys: ['Ctrl', 'S'], age, hold }] — drawn as keycaps centered
// near the bottom (above captions when both show), fading in and out.
// `caption`: the caption block when one shows (keycaps sit above it).
function drawShortcuts(ctx, shortcuts, canvasW, canvasH, anchor, caption) {
  const s = shortcuts[shortcuts.length - 1];
  const fadeIn = clamp(s.age / 0.12, 0, 1);
  const fadeOut = clamp((s.hold - s.age) / 0.25, 0, 1);
  const alpha = Math.min(fadeIn, fadeOut);
  if (alpha <= 0) return;

  const fontSize = Math.round(textBase(canvasW, canvasH) * 0.034);
  const padX = fontSize * 0.55;
  const capH = fontSize * 1.7;
  const gap = fontSize * 0.35;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const widths = s.keys.map((k) => Math.max(capH, ctx.measureText(k).width + padX * 2));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
  // Above the caption block when there is one, else where a caption would
  // end, beside a corner camera when they'd collide.
  const gapY = fontSize * 0.5;
  let cx = caption ? caption.cx : anchor.cx;
  let bottom = caption ? caption.top - gapY : anchor.bottom;
  if (!caption && anchor.avoid && overlaps({ x: cx - total / 2, y: bottom - capH, w: total, h: capH }, anchor.avoid)) {
    const span = spanBesideCamera(anchor, canvasW, gapY);
    if (span && span.x1 - span.x0 >= total) cx = (span.x0 + span.x1) / 2;
    else bottom = clearOfCamera(anchor, cx - total / 2, total, capH, bottom, canvasH, gapY);
  }
  const y = bottom - capH + (1 - fadeIn) * fontSize * 0.4;
  let x = cx - total / 2;
  s.keys.forEach((k, i) => {
    const w = widths[i];
    ctx.fillStyle = 'rgba(15, 17, 24, 0.85)';
    roundedRectPath(ctx, x, y, w, capH, fontSize * 0.35);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = Math.max(1, fontSize * 0.06);
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(k, x + w / 2, y + capH / 2);
    x += w + gap;
  });
  ctx.restore();
}

// --- cursor + clicks --------------------------------------------------------

function drawCursor(ctx, g, cursorFullUV, style) {
  const uv = g.fullUVToCropUV(cursorFullUV.x, cursorFullUV.y);
  if (!uv) return;
  const p = g.uvToCanvas(uv.x, uv.y);
  const cs = cursorSettings(style.cursor);
  const size = g.ch * 0.035 * cs.size * (cursorFullUV.scale ?? 1) * g.pxScale;
  const opacity = cursorFullUV.opacity ?? 1;
  if (opacity <= 0.01) return;

  // Vector shapes scale cleanly with zoom.
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.translate(p.x, p.y);
  if (cursorFullUV.rotation) ctx.rotate(cursorFullUV.rotation);
  drawCursorShape(ctx, cs.type, size);
  ctx.restore();
}

function drawClickRipples(ctx, g, clicks, style) {
  const cs = cursorSettings(style.cursor);
  if (cs.clickEffect === 'none') return;
  const life = cs.clickDuration / 1000;
  const r = g.ch * 0.045 * cs.clickSize * g.pxScale;
  for (const c of clicks) {
    const uv = g.fullUVToCropUV(c.x, c.y);
    if (!uv) continue;
    const p = g.uvToCanvas(uv.x, uv.y);
    const t = clamp(c.age / life, 0, 1);
    drawClickEffect(ctx, cs.clickEffect, p.x, p.y, t, r, cs.clickColor, cs.clickOpacity);
  }
}

// --- masks --------------------------------------------------------------------

// Canvas rect of a two-point annotation (crop-UV corners), normalized.
function maskRect(g, a) {
  const p1 = g.uvToCanvas(a.x, a.y);
  const p2 = g.uvToCanvas(a.x2 ?? a.x + 0.2, a.y2 ?? a.y + 0.15);
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    w: Math.abs(p2.x - p1.x),
    h: Math.abs(p2.y - p1.y),
  };
}

let pixelScratch = null;

function drawMasks(ctx, g, masks, canvasH) {
  const { rect } = g;
  for (const a of masks) {
    const r = maskRect(g, a);
    if (r.w < 1 || r.h < 1) continue;
    if (a.type === 'blur') {
      // Pixelate: shrink the region to coarse blocks, then scale it back up
      // without smoothing. Irreversible, unlike a Gaussian blur of text.
      if (typeof document === 'undefined' || !ctx.canvas) continue;
      const block = Math.max(6, canvasH * 0.014);
      const sw = Math.max(1, Math.round(r.w / block));
      const sh = Math.max(1, Math.round(r.h / block));
      pixelScratch ||= document.createElement('canvas');
      if (pixelScratch.width < sw || pixelScratch.height < sh) {
        pixelScratch.width = Math.max(pixelScratch.width, sw);
        pixelScratch.height = Math.max(pixelScratch.height, sh);
      }
      const sctx = pixelScratch.getContext('2d');
      sctx.imageSmoothingEnabled = true;
      sctx.clearRect(0, 0, sw, sh);
      sctx.drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pixelScratch, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
      ctx.restore();
    } else if (a.type === 'spotlight') {
      // Dim the whole video except a rounded hole (even-odd fill).
      const radius = Math.min(r.w, r.h) * 0.08;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      const rr = Math.min(radius, r.w / 2, r.h / 2);
      ctx.moveTo(r.x + rr, r.y);
      ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rr);
      ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rr);
      ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rr);
      ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rr);
      ctx.closePath();
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.85, Math.max(0.2, a.dim ?? 0.6))})`;
      ctx.fill('evenodd');
      ctx.restore();
    }
  }
}

// --- loupe ----------------------------------------------------------------------

// The lens behaves like a drop of water: strong magnification in the middle
// that compresses towards the rim, where it shows content from beyond its
// edge, with colour fringes that grow towards the rim. The bend is computed
// per pixel by a small WebGL shader (one pass, red/green/blue sampled with
// slightly different bends); glass shading is drawn on top with canvas 2D.
// Without WebGL the lens falls back to a flat magnified disc.
const LOUPE_REACH = 1.12; // the rim shows content from 1.12 lens radii out
const LOUPE_FRINGE = 0.025; // red/blue spread at the rim, as a fraction of the bend

// Source radius (in lens radii) seen at output radius u (0..1). At the
// centre the slope is 1/m (magnified); at the rim it reaches LOUPE_REACH.
// `fringe` (-1..1) shifts a colour channel's bend, mostly near the rim.
// LENS_FRAGMENT implements the same curve.
export function loupeSourceRadius(u, m, fringe = 0) {
  const a = 1 / m;
  const u5 = u * u * u * u * u;
  return u * (a + (LOUPE_REACH - a) * u5) * (1 + fringe * LOUPE_FRINGE * u * u * u);
}

const LENS_VERTEX = `
attribute vec2 pos;
varying vec2 v;
void main() {
  v = vec2(pos.x, -pos.y); // lens coords, y down like the canvas
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const LENS_FRAGMENT = `
precision highp float;
varying vec2 v;
uniform sampler2D frame;
uniform float m;      // magnification at the centre
uniform float reach;  // LOUPE_REACH
uniform float fringe; // LOUPE_FRINGE
uniform float span;   // lens radius / snapshot half-size
uniform float px;     // lens radius in pixels (edge anti-aliasing)
float bend(float u, float f) {
  float a = 1.0 / m;
  float u2 = u * u;
  return u * (a + (reach - a) * u2 * u2 * u) * (1.0 + f * fringe * u2 * u);
}
vec2 at(vec2 dir, float u, float f) {
  return 0.5 + 0.5 * dir * bend(u, f) * span;
}
void main() {
  float u = length(v);
  if (u > 1.0) discard;
  vec2 dir = u > 0.0 ? v / u : vec2(0.0);
  vec3 c = vec3(
    texture2D(frame, at(dir, u, -1.0)).r,
    texture2D(frame, at(dir, u, 0.0)).g,
    texture2D(frame, at(dir, u, 1.0)).b
  );
  float alpha = clamp((1.0 - u) * px, 0.0, 1.0);
  gl_FragColor = vec4(c * alpha, alpha);
}`;

let lensGL; // { canvas, gl, ...uniforms } once set up; null if WebGL is unavailable

function lensRenderer() {
  if (lensGL !== undefined) return lensGL;
  lensGL = null;
  try {
    const canvas = makeCanvas(256, 256);
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, LENS_VERTEX));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, LENS_FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const uniform = (name) => gl.getUniformLocation(prog, name);
    gl.uniform1f(uniform('reach'), LOUPE_REACH);
    gl.uniform1f(uniform('fringe'), LOUPE_FRINGE);
    lensGL = { canvas, gl, m: uniform('m'), span: uniform('span'), px: uniform('px') };
  } catch {
    lensGL = null;
  }
  return lensGL;
}

let lensSnap;
function snapCanvas(size) {
  if (!lensSnap || lensSnap.width !== size) lensSnap = makeCanvas(size, size);
  return lensSnap;
}

// Renders the bent lens into the top-left D×D pixels of the WebGL canvas and
// returns that canvas, or null if WebGL is unavailable. `snap` holds the
// frame around the lens centre, R pixels in each direction.
function renderLens(snap, R, m, D) {
  const L = lensRenderer();
  if (!L) return null;
  const { gl, canvas } = L;
  if (canvas.width < D || canvas.height < D) {
    canvas.width = Math.max(canvas.width, D);
    canvas.height = Math.max(canvas.height, D);
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, snap);
  gl.viewport(0, canvas.height - D, D, D); // WebGL's origin is bottom-left
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1f(L.m, m);
  gl.uniform1f(L.span, D / 2 / R);
  gl.uniform1f(L.px, D / 2);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return canvas;
}

// loupe: { x, y (crop-UV), scale, radius (fraction of canvas H), strength }.
function drawLoupe(ctx, g, loupe, canvasH) {
  if (!ctx.canvas) return;
  // Lens focus is crop-UV, like zoom focus points.
  const p = g.uvToCanvas(loupe.x, loupe.y);
  const r = loupe.radius * canvasH * loupe.strength;
  if (r < 2) return;
  const m = 1 + (loupe.scale - 1) * loupe.strength;
  const D = Math.ceil(2 * r);

  // Snapshot the frame around the lens, out to the farthest point the rim
  // samples, before drawing over it.
  const R = Math.ceil((D / 2) * LOUPE_REACH * (1 + LOUPE_FRINGE) + 2);
  const snap = snapCanvas(2 * R);
  const s = snap.getContext('2d');
  s.clearRect(0, 0, 2 * R, 2 * R);
  s.drawImage(ctx.canvas, R - p.x, R - p.y);
  const lens = renderLens(snap, R, m, D);

  // Soft shadow under the drop, then the bent content on top of it.
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = canvasH * 0.035;
  ctx.shadowOffsetY = canvasH * 0.008;
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.clip();
  if (lens) {
    ctx.drawImage(lens, 0, 0, D, D, p.x - D / 2, p.y - D / 2, D, D);
  } else {
    const src = r / m;
    ctx.drawImage(snap, R - src, R - src, src * 2, src * 2, p.x - r, p.y - r, r * 2, r * 2);
  }

  // Glass shading: darker towards the edge, a light band just inside the
  // rim, and a soft highlight up and to the left.
  const edge = ctx.createRadialGradient(p.x, p.y, r * 0.55, p.x, p.y, r);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(0.75, 'rgba(0,0,0,0.12)');
  edge.addColorStop(0.93, 'rgba(0,0,0,0.38)');
  edge.addColorStop(0.97, 'rgba(255,255,255,0.16)');
  edge.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = edge;
  ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
  const hx = p.x - r * 0.38;
  const hy = p.y - r * 0.46;
  const spec = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.6);
  spec.addColorStop(0, 'rgba(255,255,255,0.22)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec;
  ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
  ctx.restore();

  // Thin bright rim where the glass catches the light.
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r - Math.max(0.5, canvasH * 0.0008), 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, canvasH * 0.0016);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();
  ctx.restore();
}

// --- annotations ------------------------------------------------------------

// Annotation: { type: 'text'|'arrow'|'rect', x, y, x2, y2, text, color } with
// coordinates in crop-UV space, so they stick to the content under zooms.
function drawAnnotations(ctx, g, annotations, canvasH) {
  for (const a of annotations) {
    const color = ANNOTATION_COLORS.includes(a.color) ? a.color : ANNOTATION_COLORS[0];
    const p1 = g.uvToCanvas(a.x, a.y);
    const stroke = Math.max(2, g.ch * 0.006 * g.pxScale);

    if (a.type === 'text') {
      const fontSize = g.ch * 0.038 * g.pxScale;
      ctx.save();
      ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const text = a.text || 'Text';
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(10, 12, 18, 0.65)';
      roundedRectPath(
        ctx,
        p1.x - w / 2 - fontSize * 0.5,
        p1.y - fontSize * 0.8,
        w + fontSize,
        fontSize * 1.6,
        fontSize * 0.35
      );
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(text, p1.x, p1.y);
      ctx.restore();
    } else if (a.type === 'arrow') {
      const p2 = g.uvToCanvas(a.x2 ?? a.x + 0.1, a.y2 ?? a.y + 0.1);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = stroke;
      ctx.lineCap = 'round';
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const head = stroke * 4.5;
      // Shaft stops short of the tip so the head stays crisp.
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x - Math.cos(angle) * head * 0.6, p2.y - Math.sin(angle) * head * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - Math.cos(angle - 0.45) * head, p2.y - Math.sin(angle - 0.45) * head);
      ctx.lineTo(p2.x - Math.cos(angle + 0.45) * head, p2.y - Math.sin(angle + 0.45) * head);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (a.type === 'rect') {
      const p2 = g.uvToCanvas(a.x2 ?? a.x + 0.15, a.y2 ?? a.y + 0.12);
      const x = Math.min(p1.x, p2.x);
      const y = Math.min(p1.y, p2.y);
      const w = Math.abs(p2.x - p1.x);
      const h = Math.abs(p2.y - p1.y);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = stroke;
      ctx.shadowColor = color;
      ctx.shadowBlur = stroke * 2.5;
      roundedRectPath(ctx, x, y, w, h, stroke * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// --- webcam + captions -------------------------------------------------------

const WEBCAM_POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

function defaultWebcamRect(canvasW, canvasH, wc) {
  const unit = textBase(canvasW, canvasH);
  const size = Math.min(0.45, Math.max(0.1, wc.size || 0.22)) * unit;
  const margin = unit * 0.035;
  const pos = WEBCAM_POSITIONS.includes(wc.position) ? wc.position : 'bottom-right';
  return {
    x: pos.endsWith('left') ? margin : canvasW - margin - size,
    y: pos.startsWith('top') ? margin : canvasH - margin - size,
    w: size,
    h: size,
    radius: wc.shape === 'rounded' ? size * 0.18 : size / 2,
    alpha: 1,
  };
}

// The camera window to show in a rect of aspect `aspect`: cover-fit, or with
// face tracking (face: { x, y, size } in 0..1 of the camera picture) centred
// on the face with some headroom, zoomed in a little when the face is small.
export function webcamCrop(vw, vh, aspect, face) {
  let sw = Math.min(vw, vh * aspect);
  let sh = sw / aspect;
  if (!face) return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh };
  const z = clamp((0.34 * sw) / Math.max(1, face.size * vw), 1, 1.5);
  sw /= z;
  sh /= z;
  return {
    sx: clamp(face.x * vw - sw / 2, 0, vw - sw),
    sy: clamp(face.y * vh - sh * 0.42, 0, vh - sh),
    sw,
    sh,
  };
}

// r: { x, y, w, h, radius, alpha, cutout } — a circle is a square with
// radius w/2. The camera image is cropped to the rect's aspect (webcamCrop).
// `cutout` (0..1) blends from the framed camera to the presenter cut out of
// their background with `mask` (alpha = person, any resolution, same framing
// as the video); without a mask the cutout shows the framed camera.
// look: { filter, sharpen } colour grade and sharpening; face: see webcamCrop.
function drawWebcam(ctx, video, canvasH, r, mask, { look, face } = {}) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const { sx, sy, sw, sh } = webcamCrop(vw, vh, r.w / r.h, face);
  const alpha = clamp(r.alpha ?? 1, 0, 1);
  const cutout = mask ? clamp(r.cutout ?? 0, 0, 1) : 0;
  const filter = look && look.filter !== 'none' ? look.filter : 'none';
  // Sharpened camera window, or the video itself.
  let src = video;
  let win = [sx, sy, sw, sh];
  if (look && look.sharpen > 0.01) {
    const out = sharpen(video, vw, vh, sx, sy, sw, sh, r.w, r.h, look.sharpen * 1.6);
    if (out) {
      src = out;
      win = [0, 0, Math.round(r.w), Math.round(r.h)];
    }
  }

  if (cutout < 1) {
    ctx.save();
    ctx.globalAlpha = alpha * (1 - cutout);
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = canvasH * 0.03;
    ctx.shadowOffsetY = canvasH * 0.01;
    roundedRectPath(ctx, r.x, r.y, r.w, r.h, clamp(r.radius ?? 0, 0, Math.min(r.w, r.h) / 2));
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.clip();
    ctx.filter = filter;
    ctx.drawImage(src, ...win, r.x, r.y, r.w, r.h);
    ctx.restore();
  }
  if (cutout <= 0) return;

  // Presenter: camera pixels kept where the mask says "person", feathered a
  // little, with a soft shadow that follows their silhouette.
  const w = Math.max(1, Math.round(r.w));
  const h = Math.max(1, Math.round(r.h));
  const layer = cutoutCanvas(w, h);
  const l = layer.getContext('2d');
  l.globalCompositeOperation = 'copy';
  l.filter = filter;
  l.drawImage(src, ...win, 0, 0, w, h);
  l.globalCompositeOperation = 'destination-in';
  l.filter = `blur(${Math.max(0.5, h * 0.003)}px)`;
  const mx = mask.width / vw;
  const my = mask.height / vh;
  l.drawImage(mask, sx * mx, sy * my, sw * mx, sh * my, 0, 0, w, h);
  l.filter = 'none';
  l.globalCompositeOperation = 'source-over';

  ctx.save();
  // The presenter turns solid in the first half of a switch while the frame
  // around them fades over all of it, so they never look see-through.
  ctx.globalAlpha = alpha * Math.min(1, cutout * 2);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = canvasH * 0.03;
  ctx.shadowOffsetY = canvasH * 0.008;
  ctx.drawImage(layer, 0, 0, w, h, r.x, r.y, r.w, r.h);
  ctx.restore();
}

let cutoutLayer;
function cutoutCanvas(w, h) {
  if (!cutoutLayer || cutoutLayer.width !== w || cutoutLayer.height !== h) cutoutLayer = makeCanvas(w, h);
  return cutoutLayer;
}

// Caption looks (style.captions.look) and animations (style.captions.animation).
export const CAPTION_LOOKS = [
  'pill', 'bold', 'outline', 'minimal', 'highlight',
  'glass', 'card', 'neon', 'gradient', 'punch', 'lines', 'news',
];
export const CAPTION_ANIMATIONS = ['none', 'fade', 'pop', 'rise', 'words', 'wordpop', 'karaoke'];
export function captionSettings(style) {
  const c = style?.captions || {};
  const size = Number(c.size);
  return {
    look: CAPTION_LOOKS.includes(c.look) ? c.look : 'pill',
    animation: CAPTION_ANIMATIONS.includes(c.animation) ? c.animation : 'none',
    size: Number.isFinite(size) ? clamp(size, 0.6, 1.8) : 1,
    color: /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#2680eb',
    uppercase: c.uppercase === true,
  };
}

const CAPTION_FONT = '"Segoe UI", system-ui, sans-serif';
const LOOK_WEIGHT = {
  pill: 600, bold: 800, outline: 700, minimal: 500, highlight: 700,
  glass: 600, card: 700, neon: 700, gradient: 800, punch: 900, lines: 600, news: 600,
};
const LOOK_SCALE = { bold: 1.25, punch: 1.3, minimal: 0.85 };
// Looks whose karaoke marks the spoken word by colouring its text rather
// than boxing it (a box would fight their own glow, gradient or stroke).
const KARAOKE_TEXT = new Set(['neon', 'gradient', 'punch']);

// The accent with its hue turned by `deg`, for two-tone gradients.
export function shiftHue(hex, deg) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return `hsl(${Math.round(h * 60 + deg + 360) % 360}, ${Math.round(sat * 100)}%, ${Math.round(clamp(l, 0.45, 0.7) * 100)}%)`;
}

// Frosted glass: the frame behind the block, blurred, clipped to its shape.
function drawBackdropBlur(ctx, x, y, w, h, radius, blur) {
  const m = ctx.getTransform();
  const pad = blur * 2;
  ctx.save();
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = `blur(${Math.max(1, blur * m.a)}px)`;
  const sx = m.a * (x - pad) + m.e;
  const sy = m.d * (y - pad) + m.f;
  const sw = m.a * (w + pad * 2);
  const sh = m.d * (h + pad * 2);
  ctx.drawImage(ctx.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
  ctx.restore();
}

// Wrapped caption block positioned by `anchor` (see textAnchor).
// If it would cover a corner camera, the block first narrows into the space
// beside it (staying low, out of the way of the screen); only when that space
// is too tight does it lift above the camera. `lines` holds the words of each
// line with their x offsets, so animations can treat words one by one.
function layoutCaption(ctx, cap, canvasW, canvasH, anchor, look) {
  const set = look || captionSettings();
  const scale = LOOK_SCALE[set.look] || 1;
  const fontSize = Math.round(textBase(canvasW, canvasH) * 0.042 * set.size * scale);
  const lineHeight = fontSize * 1.35;
  const padX = fontSize * 0.9;
  const padY = fontSize * 0.45;
  const margin = fontSize * 0.5;
  const text = set.uppercase ? String(cap.text).toUpperCase() : String(cap.text);
  ctx.save();
  ctx.font = `${LOOK_WEIGHT[set.look]} ${fontSize}px ${CAPTION_FONT}`;
  const space = ctx.measureText(' ').width;
  const block = (cx, maxWidth) => {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = [];
    let width = 0;
    words.forEach((word, i) => {
      const w = ctx.measureText(word).width;
      if (line.length > 0 && width + space + w > maxWidth) {
        lines.push({ words: line, width });
        line = [];
        width = 0;
      }
      line.push({ text: word, x: line.length ? width + space : 0, w, i });
      width = line.length > 1 ? width + space + w : w;
    });
    if (line.length) lines.push({ words: line, width });
    const w = Math.max(0, ...lines.map((l) => l.width)) + padX * 2;
    const h = lines.length * lineHeight + padY * 2;
    return { lines, cx, w, h, x: cx - w / 2 };
  };
  let b = block(anchor.cx, anchor.maxWidth);
  let bottom = anchor.bottom;
  if (anchor.avoid && overlaps({ x: b.x, y: bottom - b.h, w: b.w, h: b.h }, anchor.avoid)) {
    const span = spanBesideCamera(anchor, canvasW, margin);
    if (span && span.x1 - span.x0 >= canvasW * 0.45) {
      b = block((span.x0 + span.x1) / 2, (span.x1 - span.x0) - padX * 2);
    } else {
      bottom = clearOfCamera(anchor, b.x, b.w, b.h, bottom, canvasH, margin);
    }
  }
  ctx.restore();
  return { ...b, fontSize, lineHeight, padY, top: bottom - b.h };
}

// Start and length (seconds into the caption) of word i: from the
// transcript when the caption has word times, else spread evenly.
function wordTiming(cap, i, count) {
  const w = cap.words && cap.words.length === count ? cap.words[i] : null;
  if (w) return { t: w.t, d: Math.max(0.05, w.d) };
  const d = (cap.duration || 1) / Math.max(1, count);
  return { t: i * d, d };
}

// Pop-in scale: from 0.86 up to a slight overshoot, settling at 1.
export function popScale(age) {
  const k = clamp(age / 0.22, 0, 1);
  const back = 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2);
  return 0.86 + 0.14 * back;
}

function drawCaption(ctx, c, cap, set) {
  const age = cap.age ?? Infinity;
  const left = (cap.duration ?? Infinity) - age;
  const count = c.lines.reduce((n, l) => n + l.words.length, 0);
  const anim = set.animation;
  const fs = c.fontSize;
  let alpha = 1;
  if (anim === 'fade' || anim === 'pop' || anim === 'rise') {
    alpha = clamp(Math.min(age / (anim === 'rise' ? 0.3 : 0.15), left / 0.15), 0, 1);
  }
  const scale = anim === 'pop' && Number.isFinite(age) ? popScale(age) : 1;
  // Rise: the block glides up into place, easing out.
  const lift = anim === 'rise' && Number.isFinite(age) ? fs * 0.6 * Math.pow(1 - clamp(age / 0.35, 0, 1), 3) : 0;
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (lift) ctx.translate(0, lift);
  const midY = c.top + c.h / 2;
  if (scale !== 1) {
    ctx.translate(c.cx, midY);
    ctx.scale(scale, scale);
    ctx.translate(-c.cx, -midY);
  }
  ctx.font = `${LOOK_WEIGHT[set.look]} ${fs}px ${CAPTION_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // Block backgrounds.
  if (set.look === 'pill') {
    ctx.fillStyle = 'rgba(10, 12, 18, 0.72)';
    roundedRectPath(ctx, c.x, c.top, c.w, c.h, fs * 0.5);
    ctx.fill();
  } else if (set.look === 'glass') {
    const r = fs * 0.55;
    drawBackdropBlur(ctx, c.x, c.top, c.w, c.h, r, fs * 0.45);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    roundedRectPath(ctx, c.x, c.top, c.w, c.h, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.lineWidth = Math.max(1, fs * 0.04);
    ctx.stroke();
  } else if (set.look === 'card') {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = fs * 0.6;
    ctx.shadowOffsetY = fs * 0.12;
    ctx.fillStyle = '#ffffff';
    roundedRectPath(ctx, c.x, c.top, c.w, c.h, fs * 0.35);
    ctx.fill();
    ctx.restore();
  } else if (set.look === 'news') {
    // Lower-third: a dark plate with an accent stripe on the left.
    const r = fs * 0.14;
    ctx.fillStyle = 'rgba(14, 17, 24, 0.9)';
    roundedRectPath(ctx, c.x, c.top, c.w, c.h, r);
    ctx.fill();
    ctx.save();
    roundedRectPath(ctx, c.x, c.top, c.w, c.h, r);
    ctx.clip();
    ctx.fillStyle = set.color;
    ctx.fillRect(c.x, c.top, fs * 0.18, c.h);
    ctx.restore();
  }
  const dark = set.look === 'card';
  let gradient = null;
  if (set.look === 'gradient') {
    gradient = ctx.createLinearGradient(c.x, c.top, c.x + c.w, c.top + c.h);
    gradient.addColorStop(0, set.color);
    gradient.addColorStop(1, shiftHue(set.color, 70));
  }

  c.lines.forEach((line, li) => {
    const y = c.top + c.padY + c.lineHeight * (li + 0.5);
    const x0 = c.cx - line.width / 2;
    if (set.look === 'highlight' || set.look === 'lines') {
      // Highlight: an accent bar per line. Lines: a dark box per line, like
      // video-player subtitles.
      const boxed = set.look === 'lines';
      const px = fs * (boxed ? 0.3 : 0.35);
      ctx.fillStyle = boxed ? 'rgba(0, 0, 0, 0.78)' : set.color;
      roundedRectPath(ctx, x0 - px, y - c.lineHeight / 2 + fs * 0.05, line.width + px * 2, c.lineHeight - fs * 0.1, fs * (boxed ? 0.12 : 0.22));
      ctx.fill();
    }
    for (const word of line.words) {
      const { t, d } = wordTiming(cap, word.i, count);
      const spoken = age >= t;
      const current = spoken && age < t + d + 0.05;
      const wa = anim === 'words' || anim === 'wordpop' ? clamp((age - t) / 0.12, 0, 1) : 1;
      if (wa <= 0) continue;
      ctx.save();
      ctx.globalAlpha = alpha * wa;
      const x = x0 + word.x;
      if (anim === 'wordpop') {
        const k = popScale(age - t);
        ctx.translate(x + word.w / 2, y);
        ctx.scale(k, k);
        ctx.translate(-(x + word.w / 2), -y);
      }
      let fill = gradient || (dark ? '#111827' : '#f8fafc');
      if (anim === 'karaoke') {
        if (current && KARAOKE_TEXT.has(set.look)) {
          fill = set.look === 'gradient' ? '#ffffff' : set.color;
        } else if (current) {
          ctx.fillStyle = set.look === 'highlight' ? 'rgba(255,255,255,0.28)' : set.color;
          const px = fs * 0.14;
          roundedRectPath(ctx, x - px, y - fs * 0.62, word.w + px * 2, fs * 1.24, fs * 0.2);
          ctx.fill();
          if (dark) fill = '#ffffff';
        } else if (!spoken) {
          fill = dark ? 'rgba(17,24,39,0.4)' : 'rgba(248,250,252,0.55)';
        }
      }
      if (set.look === 'bold' || set.look === 'outline' || set.look === 'gradient') {
        ctx.strokeStyle = 'rgba(8, 10, 16, 0.92)';
        ctx.lineWidth = fs * (set.look === 'bold' ? 0.2 : set.look === 'gradient' ? 0.12 : 0.14);
        ctx.strokeText(word.text, x, y);
      }
      if (set.look === 'punch') {
        // Sticker style: a hard offset shadow under a thick outline.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.lineWidth = fs * 0.24;
        ctx.strokeText(word.text, x + fs * 0.06, y + fs * 0.09);
        ctx.fillText(word.text, x + fs * 0.06, y + fs * 0.09);
        ctx.strokeStyle = '#000000';
        ctx.strokeText(word.text, x, y);
      }
      if (set.look === 'neon') {
        // Two glow passes in the accent colour under a bright core.
        const glow = current && anim === 'karaoke' ? 1.6 : 1;
        ctx.fillStyle = set.color;
        ctx.shadowColor = set.color;
        ctx.shadowBlur = fs * 0.7 * glow;
        ctx.fillText(word.text, x, y);
        ctx.shadowBlur = fs * 0.25 * glow;
        ctx.fillText(word.text, x, y);
        ctx.shadowColor = 'transparent';
      }
      if (set.look === 'minimal' || set.look === 'glass') {
        ctx.shadowColor = set.look === 'glass' ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.75)';
        ctx.shadowBlur = fs * (set.look === 'glass' ? 0.15 : 0.3);
      }
      ctx.fillStyle = fill;
      ctx.fillText(word.text, x, y);
      ctx.restore();
    }
  });
  ctx.restore();
}

// The caption text active at time t, or null.
export function captionAt(captions, t) {
  return captionStateAt(captions, t)?.text ?? null;
}

// The caption active at time t with how far into it we are:
// { text, words, age, duration } or null.
export function captionStateAt(captions, t) {
  if (!captions) return null;
  for (const c of captions) {
    if (t >= c.time && t <= c.time + c.duration) return { text: c.text, words: c.words, age: t - c.time, duration: c.duration };
  }
  return null;
}

// Annotations active at timeline time t.
export function annotationsAt(annotations, t) {
  if (!annotations) return [];
  return annotations.filter((a) => t >= a.time && t <= a.time + a.duration);
}

// Map a click on the canvas (0..1 of canvas size) to crop-UV space, accounting
// for padding, crop, and the current zoom camera, so "click to place" lands
// exactly where the user pointed.
export function canvasPointToVideoUV(px, py, canvasW, canvasH, videoW, videoH, style, camera, area) {
  const g = computeGeometry({
    videoW,
    videoH,
    canvasW,
    canvasH,
    style,
    camera: camera || { cx: 0.5, cy: 0.5, scale: 1 },
    area,
  });
  const u = (g.sxRel + (px * canvasW - g.rect.x) / g.pxScale) / g.cw;
  const v = (g.syRel + (py * canvasH - g.rect.y) / (g.rect.h / g.viewH)) / g.ch;
  return { x: clamp(u, 0, 1), y: clamp(v, 0, 1) };
}
