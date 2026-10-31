// Utilities over the recorded cursor samples and clicks: interpolation and
// smoothing for the rendered cursor overlay, plus zoom suggestions (clicks
// when a global hook recorded them, dwell detection otherwise).
//
// Samples: [{ t: seconds, x: 0..1, y: 0..1 }] sorted by t (source time).
// Clicks:  [{ t, x, y }] sorted by t (source time).

import { makeZoomEvent } from './zoom-engine.js';

function indexBefore(samples, t) {
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function cursorPositionAt(samples, t) {
  if (!samples || samples.length === 0) return null;
  if (t <= samples[0].t) return { x: samples[0].x, y: samples[0].y };
  const last = samples[samples.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y };

  const lo = indexBefore(samples, t);
  const a = samples[lo];
  const b = samples[lo + 1];
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// Triangular-weighted average of the samples around t: the raw 60 Hz track
// has hand jitter; this gives the floaty, deliberate motion the overlay wants.
export function smoothedCursorAt(samples, t, window = 0.12) {
  if (!samples || samples.length === 0) return null;
  let sumW = 0;
  let sx = 0;
  let sy = 0;
  const from = t - window;
  const to = t + window;
  let i = indexBefore(samples, from);
  for (; i < samples.length && samples[i].t <= to; i++) {
    const s = samples[i];
    if (s.t < from) continue;
    const w = 1 - Math.abs(s.t - t) / window;
    if (w <= 0) continue;
    sumW += w;
    sx += s.x * w;
    sy += s.y * w;
  }
  if (sumW === 0) return cursorPositionAt(samples, t);
  return { x: sx / sumW, y: sy / sumW };
}

// Clicks that should still be rendering a ripple at time t.
export function activeClicksAt(clicks, t, ripple = 0.5) {
  if (!clicks || clicks.length === 0) return [];
  const out = [];
  for (const c of clicks) {
    const age = t - c.t;
    if (age >= 0 && age <= ripple) out.push({ ...c, age });
    if (c.t > t) break;
  }
  return out;
}

// --- cursor polish ----------------------------------------------------------

// Smoothing window (seconds) per cursor animation style. 'none' shows the raw
// interpolated path.
export const CURSOR_ANIMATIONS = { smooth: 0.18, medium: 0.12, rapid: 0.05, none: 0 };

export function cursorWindow(animation) {
  return CURSOR_ANIMATIONS[animation] ?? CURSOR_ANIMATIONS.medium;
}

// Remove hand tremor / accessibility-tool shakes: the cursor only moves once
// it gets more than `threshold` UV away from its last resting point.
export function removeShakes(samples, threshold = 0.004) {
  if (!samples || samples.length === 0) return [];
  const out = [];
  let rest = samples[0];
  for (const s of samples) {
    if (Math.hypot(s.x - rest.x, s.y - rest.y) > threshold) rest = s;
    out.push({ t: s.t, x: rest.x, y: rest.y });
  }
  return out;
}

// Times at which the cursor moved (for idle hiding), sorted.
function movementTimes(samples, eps = 0.0015) {
  const out = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (Math.hypot(b.x - a.x, b.y - a.y) > eps) out.push(b.t);
  }
  return out;
}

const prepared = new WeakMap();

// The cursor track as the renderer uses it: shake-filtered when asked, plus
// derived lookups. Memoized per raw track so preview and export do the work
// once and see identical data.
export function prepareCursorTrack(raw, { shakes = false } = {}) {
  if (!raw) return null;
  let entry = prepared.get(raw);
  if (!entry) {
    entry = {};
    prepared.set(raw, entry);
  }
  const key = shakes ? 'deshaken' : 'plain';
  if (!entry[key]) {
    const samples = shakes ? removeShakes(raw.samples || []) : raw.samples || [];
    entry[key] = {
      samples,
      clicks: raw.clicks || [],
      shortcuts: raw.shortcuts || [],
      typing: raw.typing || [],
      moves: movementTimes(samples),
    };
  }
  return entry[key];
}

function indexAtOrBefore(sorted, t) {
  let lo = 0;
  let hi = sorted.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function lastAtOrBefore(sorted, t) {
  const i = indexAtOrBefore(sorted, t);
  return i === -1 ? null : sorted[i];
}

// Overlay opacity when "hide when idle" is on: fully visible while moving,
// fades out `fade` seconds after `delay` seconds of stillness.
// When it starts moving again after hiding, it eases back in over `fadeIn`
// seconds from however visible it was.
export function idleOpacity(track, t, { delay = 1.5, fade = 0.3, fadeIn = 0.15 } = {}) {
  const hidden = (still) => smoothClamp((still - delay) / fade);
  const i = indexAtOrBefore(track.moves, t);
  const start = track.samples[0]?.t ?? 0;
  if (i === -1) return 1 - hidden(t - start);
  const last = track.moves[i];
  const out = hidden(t - last);
  // How hidden it was when this movement began.
  const before = hidden(last - (i > 0 ? track.moves[i - 1] : start));
  const back = before * (1 - smoothClamp((t - last) / fadeIn));
  return 1 - Math.max(out, back);
}

function smoothClamp(v) {
  const c = Math.min(1, Math.max(0, v));
  return c * c * (3 - 2 * c);
}

// Tilt (radians) proportional to horizontal velocity, like a pointer leaning
// into the motion.
export function cursorTilt(samples, t, window) {
  const h = 0.04;
  const a = window > 0 ? smoothedCursorAt(samples, t - h, window) : cursorPositionAt(samples, t - h);
  const b = window > 0 ? smoothedCursorAt(samples, t + h, window) : cursorPositionAt(samples, t + h);
  if (!a || !b) return 0;
  const vx = (b.x - a.x) / (2 * h);
  return Math.max(-0.35, Math.min(0.35, vx * 0.3));
}

// --- keyboard ----------------------------------------------------------------

// Shortcut keycaps visible at time t (source time). Each shows for `hold` s.
export function activeShortcutsAt(shortcuts, t, hold = 1.2) {
  if (!shortcuts || shortcuts.length === 0) return [];
  let latest = null;
  for (const s of shortcuts) {
    if (s.t > t) break;
    if (t - s.t <= hold) latest = s;
  }
  return latest ? [{ ...latest, age: t - latest.t, hold }] : [];
}

// Typing bursts from keystroke timestamps (source time): keys closer than
// `gap` seconds belong together; bursts shorter than `minLength` seconds or
// with fewer than `minKeys` keys are ignored. Returns [{ start, end, keys }].
export function detectTypingSegments(typing, { gap = 1.2, minLength = 2.5, minKeys = 8, pad = 0.2 } = {}) {
  if (!typing || typing.length === 0) return [];
  const out = [];
  let start = typing[0];
  let prev = typing[0];
  let n = 1;
  const flush = () => {
    if (prev - start >= minLength && n >= minKeys) {
      out.push({ start: Math.max(0, start - pad), end: prev + pad, keys: n });
    }
  };
  for (let i = 1; i < typing.length; i++) {
    const t = typing[i];
    if (t - prev > gap) {
      flush();
      start = t;
      n = 0;
    }
    prev = t;
    n += 1;
  }
  flush();
  return out;
}

// --- zoom suggestions -----------------------------------------------------

// With real click data: cluster clicks that are close in time and space and
// zoom on each cluster. Without it: fall back to dwell detection.
export function suggestZooms(samples, { clicks, duration, minDwell = 1.4, radius = 0.045, maxSuggestions = 6 } = {}) {
  if (clicks && clicks.length > 0) {
    return suggestFromClicks(clicks, duration, maxSuggestions);
  }
  return suggestFromDwell(samples, { duration, minDwell, radius, maxSuggestions });
}

function suggestFromClicks(clicks, duration, maxSuggestions) {
  // Cluster: clicks within 2.5s and 0.18 UV of the cluster centroid.
  const clusters = [];
  for (const c of clicks) {
    const last = clusters[clusters.length - 1];
    if (
      last &&
      c.t - last.endT < 2.5 &&
      Math.hypot(c.x - last.cx, c.y - last.cy) < 0.18
    ) {
      last.n += 1;
      last.cx += (c.x - last.cx) / last.n;
      last.cy += (c.y - last.cy) / last.n;
      last.endT = c.t;
    } else {
      clusters.push({ startT: c.t, endT: c.t, cx: c.x, cy: c.y, n: 1 });
    }
  }

  const events = [];
  for (const cl of clusters.slice(0, maxSuggestions * 2)) {
    const start = Math.max(0, cl.startT - 0.6);
    let span = Math.min(cl.endT - cl.startT + 2.4, 8);
    if (duration) span = Math.min(span, Math.max(0.5, duration - start));
    if (span < 1.2) continue;
    if (events.some((e) => start < e.time + e.duration && start + span > e.time)) continue;
    events.push(makeZoomEvent({ time: start, duration: span, x: cl.cx, y: cl.cy, scale: 1.8 }));
    if (events.length >= maxSuggestions) break;
  }
  return events;
}

function suggestFromDwell(samples, { duration, minDwell, radius, maxSuggestions }) {
  if (!samples || samples.length < 10) return [];

  const dwells = [];
  let anchor = samples[0];
  let dwellStart = samples[0].t;
  let sumX = samples[0].x;
  let sumY = samples[0].y;
  let count = 1;

  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    const dx = s.x - anchor.x;
    const dy = s.y - anchor.y;
    if (Math.hypot(dx, dy) <= radius) {
      sumX += s.x;
      sumY += s.y;
      count += 1;
      continue;
    }
    if (s.t - dwellStart >= minDwell) {
      dwells.push({ start: dwellStart, end: s.t, x: sumX / count, y: sumY / count });
    }
    anchor = s;
    dwellStart = s.t;
    sumX = s.x;
    sumY = s.y;
    count = 1;
  }
  const lastT = samples[samples.length - 1].t;
  if (lastT - dwellStart >= minDwell) {
    dwells.push({ start: dwellStart, end: lastT, x: sumX / count, y: sumY / count });
  }

  // Longest dwells first, then back in chronological order.
  dwells.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const picked = dwells.slice(0, maxSuggestions).sort((a, b) => a.start - b.start);

  const events = [];
  for (const d of picked) {
    const start = Math.max(0, d.start - 0.4);
    let span = Math.min(d.end - d.start + 1.2, 8);
    if (duration) span = Math.min(span, Math.max(0.5, duration - start));
    if (span < 1.5) continue;
    if (events.some((e) => start < e.time + e.duration && start + span > e.time)) continue;
    events.push(makeZoomEvent({ time: start, duration: span, x: d.x, y: d.y, scale: 1.8 }));
  }
  return events;
}
