// Cursor looks and click effects. Shapes are SVG path data (M/L/Q/C/Z, one
// point set per command) on a 24-unit grid with the hotspot at the origin, so
// the same data draws on the canvas and in the editor's style picker (<path d>).

const ARROW = 'M0 0L0 20L4.6 15.6L8.4 23L11.4 21.4L7.6 14.2L14 14Z';
const DART = 'M0 0L4.2 18.5L8.4 11.2L17 8.6Z';

// fill/stroke pairs are drawn in order (outer halo first); `dot` is a circle.
export const CURSOR_TYPES = [
  { id: 'classic', label: 'Classic', path: ARROW, layers: [{ fill: '#ffffff', stroke: 'rgba(0,0,0,0.8)', width: 1.6 }] },
  { id: 'dark', label: 'Dark', path: ARROW, layers: [{ fill: '#111111', stroke: '#ffffff', width: 1.8 }] },
  {
    id: 'outline',
    label: 'Outline',
    path: ARROW,
    layers: [
      { stroke: 'rgba(0,0,0,0.85)', width: 3.4 },
      { stroke: '#ffffff', width: 1.6 },
    ],
  },
  {
    id: 'minimal',
    label: 'Minimal',
    path: ARROW,
    layers: [
      { stroke: 'rgba(255,255,255,0.9)', width: 3.2 },
      { stroke: '#111111', width: 1.3 },
    ],
  },
  { id: 'dot', label: 'Dot', dot: 6.5, layers: [{ fill: '#ffffff', stroke: 'rgba(0,0,0,0.85)', width: 2.2 }] },
  { id: 'dart', label: 'Dart', path: DART, layers: [{ fill: '#111111', stroke: '#ffffff', width: 1.4 }] },
  ...playfulCursors(),
];

// Families group variants under one tile in the style picker.
export const CURSOR_FAMILIES = [{ id: 'playful', label: 'Playful' }];

// Flat parts of a single-shape cursor type, in paint order: { path | dot,
// fill, stroke, width }. 3D types (with `shapes`) are drawn by drawShape3d.
export function cursorParts(type) {
  if (type.shapes) return [];
  return type.layers.map((l) => ({ ...l, path: type.path, dot: type.dot }));
}

// Playful family: chunky "toy" cursors. Each is one or more 3D shapes: a
// thick dark outline, a coloured side extruded down-right (the hotspot tip
// stays put), a gradient face with a bevel (light top-left rim, shaded
// bottom-right rim) and optional face details. See drawShape3d.
function playfulCursors() {
  const INK = '#1e1b3d';
  // A stockier arrow than the classic one, so the outline reads as chunky.
  const CHUNKY = 'M0 0L0 17L4.4 13.3L8.2 20.6L12 18.7L8.3 11.6L14.8 11Z';
  const STAR = 'M15.5 -2.5L16.8 0.9L20.3 2L16.8 3.1L15.5 6.5L14.2 3.1L10.7 2L14.2 0.9Z';
  const HAND =
    'M-2 2Q-2 0 0 0Q2 0 2 2L2 9Q2 7.5 4 7.5Q6 7.5 6 9.5Q6 8.5 8 8.5Q10 8.5 10 10.5Q10 9.8 11.6 9.8' +
    'Q13.2 9.8 13.2 11.6L13.2 16Q13.2 22 7 22L3.5 22Q0 22 -2 18.5L-5.8 12.6Q-6.6 11.1 -5.3 10.4Q-4.1 9.8 -3.2 11.1L-2 12.8Z';
  const PENCIL = 'M0 0L5.66 1.41L15.2 10.96L16.62 12.37L18.73 14.49L14.49 18.73L12.37 16.62L10.96 15.2L1.41 5.66Z';
  const PLANE = 'M0 0L21 8L10.5 10.5L8 21Z';

  const arrow = (id, label, face, side) => ({
    id,
    label,
    family: 'playful',
    shapes: [{ path: CHUNKY, face, side, ink: INK }],
  });
  return [
    arrow('fun-sun', 'Sunny', ['#fff07a', '#ffc21a'], '#ff7a1a'),
    arrow('fun-mint', 'Mint', ['#a8f7e4', '#22cfae'], '#0d8a83'),
    arrow('fun-coral', 'Coral', ['#ffb7a6', '#ff5f4a'], '#bf2e3b'),
    arrow('fun-grape', 'Grape', ['#d9c2ff', '#9466ff'], '#5530c4'),
    {
      id: 'fun-spark',
      label: 'Spark',
      family: 'playful',
      shapes: [
        { path: CHUNKY, face: ['#a9d0ff', '#3d86ff'], side: '#1f4bbf', ink: INK },
        { path: STAR, face: ['#fff59a', '#ffcc1f'], side: '#f0821a', ink: INK, outline: 1.6, depth: 1.1 },
      ],
    },
    {
      id: 'fun-hand',
      label: 'Hand',
      family: 'playful',
      shapes: [
        {
          path: HAND,
          face: ['#ffe2b5', '#f7b866'],
          side: '#d07a2e',
          ink: INK,
          details: [{ path: 'M2 9L2 12.6M6 9.5L6 12.8M10 10.5L10 13.2', stroke: 'rgba(150,80,20,0.6)', width: 1.1 }],
        },
      ],
    },
    {
      id: 'fun-pencil',
      label: 'Pencil',
      family: 'playful',
      shapes: [
        {
          path: PENCIL,
          face: ['#ff9fb4', '#ff5c82'],
          side: '#c22a5a',
          ink: INK,
          details: [
            { path: 'M0 0L5.66 1.41L1.41 5.66Z', fill: '#ffe0b0' },
            { path: 'M0 0L2.4 0.6L0.6 2.4Z', fill: '#2b2b40' },
            { path: 'M15.2 10.96L16.62 12.37L12.37 16.62L10.96 15.2Z', fill: '#d7dbe6' },
            { path: 'M16.62 12.37L18.73 14.49L14.49 18.73L12.37 16.62Z', fill: '#ffc2d0' },
            { path: 'M5.66 1.41L1.41 5.66M15.2 10.96L10.96 15.2M16.62 12.37L12.37 16.62', stroke: 'rgba(30,27,61,0.55)', width: 0.8 },
          ],
        },
      ],
    },
    {
      id: 'fun-plane',
      label: 'Paper plane',
      family: 'playful',
      shapes: [
        {
          path: PLANE,
          face: ['#c4ecff', '#4cb8ff'],
          side: '#1c6fc4',
          ink: INK,
          details: [
            { path: 'M0 0L10.5 10.5L8 21Z', fill: 'rgba(10,60,130,0.22)' },
            { path: 'M0 0L10.5 10.5', stroke: 'rgba(255,255,255,0.85)', width: 0.9 },
          ],
        },
      ],
    },
  ];
}

export const CLICK_EFFECTS = [
  { id: 'none', label: 'None' },
  { id: 'ripple', label: 'Ripple' },
  { id: 'ring', label: 'Ring' },
  { id: 'pulse', label: 'Pulse' },
];

export const CLICK_COLORS = ['#2680eb', '#ef4444', '#f59e0b', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

const HEX = /^#[0-9a-f]{6}$/i;

function num(v, lo, hi, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

// Every cursor setting with defaults filled in. Older projects used
// `clickHighlights` (on/off) and `rotate` (on/off).
export function cursorSettings(cs = {}) {
  return {
    type: CURSOR_TYPES.some((t) => t.id === cs.type) ? cs.type : 'classic',
    size: num(cs.size, 0.5, 3, 1),
    clickEffect: CLICK_EFFECTS.some((e) => e.id === cs.clickEffect)
      ? cs.clickEffect
      : cs.clickHighlights === false
        ? 'none'
        : 'ring',
    clickColor: HEX.test(cs.clickColor || '') ? cs.clickColor : '#facc15',
    clickSize: num(cs.clickSize, 0.4, 2.5, 1),
    clickOpacity: num(cs.clickOpacity, 0.1, 1, 0.9),
    clickDuration: num(cs.clickDuration, 200, 1500, 500), // ms
    bounce: num(cs.bounce, 0, 1, 0),
    bounceSpeed: num(cs.bounceSpeed, 150, 900, 350), // ms
    sway: num(cs.sway, 0, 1, cs.rotate ? 0.5 : 0),
    loopDuration: num(cs.loopDuration, 0.3, 3, 1), // s: glide back to the start
    idleDelay: num(cs.idleDelay, 0.5, 5, 1.5), // s: stillness before hiding
  };
}

// Cursor scale at `age` seconds after a click: a quick press, then a springy
// return that overshoots slightly. strength 0..1, speed in ms.
export function clickBounceScale(age, strength, speedMs) {
  if (!(strength > 0) || age < 0) return 1;
  const total = speedMs / 1000;
  if (age >= total) return 1;
  const k = 0.3 * strength;
  const press = 0.25;
  const p = age / total;
  if (p < press) {
    const u = p / press;
    return 1 - k * u * u * (3 - 2 * u);
  }
  const u = (p - press) / (1 - press);
  return 1 - k * Math.exp(-4.5 * u) * Math.cos(2.5 * Math.PI * u);
}

// The last click at or before `t` (clicks sorted by t), or null.
export function lastClickBefore(clicks, t) {
  if (!clicks || clicks.length === 0) return null;
  let lo = 0;
  let hi = clicks.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (clicks[mid].t <= t) {
      found = clicks[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Trace path data made of absolute M/L/Q/C/Z commands (what the shapes above
// use) onto the context with plain 2D calls, which work on any context.
// (dx, dy) offsets every point; `begin` false appends to the current path.
function tracePath(ctx, d, dx = 0, dy = 0, begin = true) {
  if (begin) ctx.beginPath();
  for (const [, cmd, args] of d.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    if (cmd === 'Z') {
      ctx.closePath();
      continue;
    }
    const n = args.trim().split(/[\s,]+/).map(Number);
    if (cmd === 'M') ctx.moveTo(n[0] + dx, n[1] + dy);
    else if (cmd === 'L') ctx.lineTo(n[0] + dx, n[1] + dy);
    else if (cmd === 'Q') ctx.quadraticCurveTo(n[0] + dx, n[1] + dy, n[2] + dx, n[3] + dy);
    else ctx.bezierCurveTo(n[0] + dx, n[1] + dy, n[2] + dx, n[3] + dy, n[4] + dx, n[5] + dy);
  }
}

// Pixels per grid unit on this context (6 layers when it can't tell).
function unitPx(ctx) {
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  return m ? Math.hypot(m.a, m.b) : 0;
}

// One chunky 3D shape (grid units): ink outline around face and extrusion,
// the coloured side, the gradient face, a bevel, then face details.
function drawShape3d(ctx, shape, first) {
  const depth = shape.depth ?? 1.8;
  const outline = shape.outline ?? 2.4;
  // Enough layers that the extruded edge has no visible steps at this size.
  const steps = Math.min(48, Math.max(6, Math.ceil((depth * unitPx(ctx)) / 0.6)));
  const offsets = [];
  for (let i = steps; i >= 0; i--) offsets.push((depth * i) / steps);

  // Outline: the silhouette swept along the extrusion, stroked wide.
  ctx.fillStyle = shape.ink;
  ctx.strokeStyle = shape.ink;
  ctx.lineWidth = outline * 2;
  offsets.forEach((o, i) => {
    if (first && i === 0) {
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1.5;
    }
    tracePath(ctx, shape.path, o, o);
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = 'transparent';
  });

  // Side: the same sweep in the darker colour, inside the outline.
  ctx.fillStyle = shape.side;
  for (const o of offsets) {
    if (o === 0) continue;
    tracePath(ctx, shape.path, o, o);
    ctx.fill();
  }

  // Face.
  const grad = ctx.createLinearGradient(0, 0, 12, 18);
  grad.addColorStop(0, shape.face[0]);
  grad.addColorStop(1, shape.face[1]);
  ctx.fillStyle = grad;
  tracePath(ctx, shape.path);
  ctx.fill();

  ctx.save();
  tracePath(ctx, shape.path);
  ctx.clip();
  // Bevel: the face minus a shifted copy of itself leaves a rim band.
  const rim = (d, color) => {
    ctx.beginPath();
    ctx.rect(-40, -40, 100, 100);
    tracePath(ctx, shape.path, d, d, false);
    ctx.fillStyle = color;
    ctx.fill('evenodd');
  };
  rim(0.9, 'rgba(255,255,255,0.6)');
  rim(-0.9, 'rgba(0,0,0,0.14)');
  // Soft gloss towards the top-left of the face.
  const gloss = ctx.createRadialGradient(2.5, 5, 0, 2.5, 5, 8);
  gloss.addColorStop(0, 'rgba(255,255,255,0.38)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(-10, -10, 40, 40);
  for (const d of shape.details || []) {
    tracePath(ctx, d.path);
    if (d.fill) {
      ctx.fillStyle = d.fill;
      ctx.fill();
    }
    if (d.stroke) {
      ctx.strokeStyle = d.stroke;
      ctx.lineWidth = d.width ?? 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Draw a cursor of `type` with its hotspot at the current origin; `px` is the
// rendered height of the 24-unit grid.
export function drawCursorShape(ctx, typeId, px) {
  const type = CURSOR_TYPES.find((t) => t.id === typeId) || CURSOR_TYPES[0];
  ctx.save();
  ctx.scale(px / 24, px / 24);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (type.shapes) {
    type.shapes.forEach((shape, i) => drawShape3d(ctx, shape, i === 0));
    ctx.restore();
    return;
  }
  for (const layer of cursorParts(type)) {
    if (layer.dot) {
      ctx.beginPath();
      ctx.arc(0, 0, layer.dot, 0, Math.PI * 2);
    } else {
      tracePath(ctx, layer.path);
    }
    if (layer.fill) {
      ctx.fillStyle = layer.fill;
      ctx.fill();
      ctx.shadowColor = 'transparent';
    }
    if (layer.stroke) {
      ctx.strokeStyle = layer.stroke;
      ctx.lineWidth = layer.width;
      ctx.stroke();
      ctx.shadowColor = 'transparent';
    }
  }
  ctx.restore();
}

// One click effect at canvas point (x, y). `t` is 0..1 through its lifetime,
// `r` the full radius in pixels.
export function drawClickEffect(ctx, effect, x, y, t, r, color, opacity) {
  if (effect === 'none') return;
  const fade = 1 - t;
  const ease = 1 - (1 - t) * (1 - t);
  ctx.save();
  if (effect === 'pulse') {
    ctx.beginPath();
    ctx.arc(x, y, r * (0.35 + 0.65 * ease), 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, 0.35 * opacity * fade);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.strokeStyle = rgba(color, opacity * fade);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, r * 0.14), 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, opacity * fade);
    ctx.fill();
  } else {
    const rings = effect === 'ripple' ? [0, 0.3] : [0];
    for (const delay of rings) {
      const local = (t - delay) / (1 - delay);
      if (local < 0) continue;
      const e = 1 - (1 - local) * (1 - local);
      ctx.beginPath();
      ctx.arc(x, y, r * (0.25 + 0.75 * e), 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.5, r * 0.12 * (1 - local));
      ctx.strokeStyle = rgba(color, opacity * (1 - local));
      ctx.stroke();
    }
  }
  ctx.restore();
}
