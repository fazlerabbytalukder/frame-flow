// Where the screen recording and the webcam go on the canvas at a given
// moment. Pure functions of time, shared by preview and export.
//
// Layouts (project.layouts: [{ id, time, duration, layout }]):
//   overlay  default when no layout segment is active: webcam bubble in a corner
//   camera   webcam fills the canvas, screen hidden
//   split    screen and webcam side by side (stacked on portrait canvases)
//   screen   screen only, webcam hidden
//   cutout   the presenter, cut out of their background, stands at the bottom
//            of the frame over the screen (needs a person mask, see person-mask.js)
// 'overlay' can also be placed as a block, e.g. to return to the bubble
// between other layouts. Changes animate over LAYOUT_EASE seconds after each boundary.
//
// The overlay bubble can also dodge the cursor ("smart framing") and hide
// during long silences.

export const LAYOUTS = ['overlay', 'camera', 'split', 'screen', 'cutout'];
export const LAYOUT_EASE = 0.45;

const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

function smoothstep(v) {
  const c = Math.min(1, Math.max(0, v));
  return c * c * (3 - 2 * c);
}

function lerp(a, b, f) {
  return a + (b - a) * f;
}

export function layoutAt(layouts, t) {
  let active = null;
  for (const l of layouts || []) {
    if (t >= l.time && t < l.time + l.duration && (!active || l.time > active.time)) active = l;
  }
  return active && LAYOUTS.includes(active.layout) ? active.layout : 'overlay';
}

// { from, to, f }: the layout transition in progress at t (f = 1 when settled).
export function layoutBlendAt(layouts, t) {
  const to = layoutAt(layouts, t);
  let boundary = -Infinity;
  for (const l of layouts || []) {
    for (const b of [l.time, l.time + l.duration]) {
      if (b <= t && b > boundary) boundary = b;
    }
  }
  if (t - boundary >= LAYOUT_EASE) return { from: to, to, f: 1 };
  const from = layoutAt(layouts, boundary - 1e-6);
  if (from === to) return { from: to, to, f: 1 };
  return { from, to, f: smoothstep((t - boundary) / LAYOUT_EASE) };
}

// True while the cutout layout is showing or animating in/out at t, i.e.
// when the compositor needs a person mask for the webcam frame.
export function usesCutout(layouts, t) {
  const { from, to } = layoutBlendAt(layouts, t);
  return from === 'cutout' || to === 'cutout';
}

// --- overlay bubble ---------------------------------------------------------------

// Sized from the shorter side (like captions), so a tall post doesn't get a
// bubble half its width.
export function cornerRect(canvasW, canvasH, wc, corner) {
  const unit = Math.min(canvasH, canvasW * 1.25);
  const size = Math.min(0.45, Math.max(0.1, wc.size || 0.22)) * unit;
  const margin = unit * 0.035;
  const pos = CORNERS.includes(corner) ? corner : 'bottom-right';
  return {
    x: pos.endsWith('left') ? margin : canvasW - margin - size,
    y: pos.startsWith('top') ? margin : canvasH - margin - size,
    w: size,
    h: size,
    radius: wc.shape === 'rounded' ? size * 0.18 : size / 2,
  };
}

// Corners to try when the preferred one is busy: flip sides first, so the
// bubble moves the shortest distance.
function cornerCandidates(preferred) {
  const p = CORNERS.includes(preferred) ? preferred : 'bottom-right';
  const [v, h] = p.split('-');
  const flipH = `${v}-${h === 'left' ? 'right' : 'left'}`;
  const flipV = `${v === 'top' ? 'bottom' : 'top'}-${h}`;
  const diag = `${v === 'top' ? 'bottom' : 'top'}-${h === 'left' ? 'right' : 'left'}`;
  return [p, flipH, flipV, diag];
}

const BUCKET = 1; // seconds per framing decision
const LOOKAHEAD = 1.5; // judge each bucket by where the cursor goes next
const BUSY = 0.1; // fraction of time the cursor may spend under the bubble

// Corner for the bucket starting at timeline time b. `cursorCanvas(t)`
// returns the cursor in canvas-normalized coordinates (0..1) or null.
function bucketCorner(b, preferred, cursorCanvas, canvasW, canvasH, wc) {
  const points = [];
  for (let k = 0; k < 15; k++) {
    const p = cursorCanvas(b + (k / 15) * LOOKAHEAD);
    if (p) points.push(p);
  }
  if (points.length === 0) return preferred;
  const occupancy = (corner) => {
    const r = cornerRect(canvasW, canvasH, wc, corner);
    const pad = r.w * 0.25;
    const x0 = (r.x - pad) / canvasW, x1 = (r.x + r.w + pad) / canvasW;
    const y0 = (r.y - pad) / canvasH, y1 = (r.y + r.h + pad) / canvasH;
    return points.filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).length / points.length;
  };
  const candidates = cornerCandidates(preferred);
  if (occupancy(candidates[0]) < BUSY) return candidates[0];
  let best = candidates[0];
  let bestOcc = Infinity;
  for (const c of candidates) {
    const o = occupancy(c);
    if (o < bestOcc - 1e-9) {
      best = c;
      bestOcc = o;
    }
  }
  return best;
}

export function overlayRect(canvasW, canvasH, wc, t, cursorCanvas) {
  const preferred = wc.position || 'bottom-right';
  if (!wc.avoidCursor || !cursorCanvas) return cornerRect(canvasW, canvasH, wc, preferred);
  const b = Math.floor(t / BUCKET) * BUCKET;
  const cur = bucketCorner(b, preferred, cursorCanvas, canvasW, canvasH, wc);
  const prev = b > 0 ? bucketCorner(b - BUCKET, preferred, cursorCanvas, canvasW, canvasH, wc) : cur;
  const to = cornerRect(canvasW, canvasH, wc, cur);
  if (prev === cur) return to;
  const from = cornerRect(canvasW, canvasH, wc, prev);
  const f = smoothstep((t - b) / 0.5);
  return lerpRect(from, to, f);
}

// --- silence ------------------------------------------------------------------------

// Bubble visibility (0..1) at source time t given detected silences
// [{ start, end }]: fades out a moment into a pause, back just before speech.
export function silenceVisibility(silences, t) {
  if (!silences || silences.length === 0) return 1;
  for (const s of silences) {
    if (t < s.start || t > s.end) continue;
    if (s.end - s.start < 1.5) return 1;
    const out = smoothstep((t - (s.start + 0.5)) / 0.3);
    const back = smoothstep((s.end - 0.15 - t) / 0.3);
    return 1 - Math.min(out, back);
  }
  return 1;
}

// --- full layout geometry ---------------------------------------------------------------

function lerpRect(a, b, f) {
  return {
    x: lerp(a.x, b.x, f),
    y: lerp(a.y, b.y, f),
    w: lerp(a.w, b.w, f),
    h: lerp(a.h, b.h, f),
    radius: lerp(a.radius ?? 0, b.radius ?? 0, f),
    alpha: lerp(a.alpha ?? 1, b.alpha ?? 1, f),
    cutout: lerp(a.cutout ?? 0, b.cutout ?? 0, f),
  };
}

// The cutout presenter stands on the bottom edge on the side the bubble lives
// on. The camera frame is 80% of the canvas tall and at most 60% of it wide,
// so a wide webcam is cropped at the sides and the presenter stays off the
// middle of the screen.
// Tall posts put the presenter in the lower half at nearly full width.
export function stageRect(canvasW, canvasH, wc, camAspect) {
  const portrait = canvasH > canvasW * 1.1;
  const h = canvasH * (portrait ? 0.5 : 0.8);
  const w = Math.min(canvasW * (portrait ? 0.92 : 0.6), h * (camAspect > 0 ? camAspect : 16 / 9));
  const margin = canvasW * (portrait ? 0.04 : 0.03);
  const left = (wc.position || 'bottom-right').endsWith('left');
  return { x: left ? margin : canvasW - margin - w, y: canvasH - h, w, h, radius: 0, alpha: 1, cutout: 1 };
}

// Screen area + webcam rect for a settled layout.
function rectsFor(layout, canvasW, canvasH, overlay, stage) {
  const full = { x: 0, y: 0, w: canvasW, h: canvasH };
  const portrait = canvasH > canvasW;
  switch (layout) {
    case 'camera':
      return { screen: { ...full, alpha: 0 }, cam: { ...full, radius: 0, alpha: 1 } };
    case 'split': {
      const gap = Math.min(canvasW, canvasH) * 0.03;
      if (portrait) {
        const split = canvasH * 0.58;
        return {
          screen: { x: 0, y: 0, w: canvasW, h: split, alpha: 1 },
          cam: { x: gap, y: split, w: canvasW - gap * 2, h: canvasH - split - gap, radius: gap, alpha: 1 },
        };
      }
      const split = canvasW * 0.62;
      return {
        screen: { x: 0, y: 0, w: split, h: canvasH, alpha: 1 },
        cam: { x: split, y: gap * 2, w: canvasW - split - gap * 2, h: canvasH - gap * 4, radius: gap, alpha: 1 },
      };
    }
    case 'cutout':
      return { screen: { ...full, alpha: 1 }, cam: stage };
    case 'screen':
      // The bubble shrinks into its corner as it disappears.
      return {
        screen: { ...full, alpha: 1 },
        cam: { ...overlay, x: overlay.x + overlay.w / 2, y: overlay.y + overlay.h / 2, w: 0, h: 0, radius: 0, alpha: 0 },
      };
    default:
      return { screen: { ...full, alpha: 1 }, cam: { ...overlay, alpha: overlay.alpha ?? 1 } };
  }
}

// Everything the compositor needs: { screenArea, screenAlpha, webcam }.
// `opts`: { cursorCanvas(t), silences, sourceTime, hasWebcam, camAspect }.
export function layoutGeometry(project, timelineTime, canvasW, canvasH, opts = {}) {
  const wc = project.style.webcam || {};
  const camOn = Boolean(opts.hasWebcam) && wc.enabled !== false;
  const overlay = {
    ...overlayRect(canvasW, canvasH, wc, timelineTime, opts.cursorCanvas),
    alpha: wc.hideOnSilence ? silenceVisibility(opts.silences, opts.sourceTime ?? timelineTime) : 1,
  };
  const { from, to, f } = camOn
    ? layoutBlendAt(project.layouts, timelineTime)
    : { from: 'screen', to: 'screen', f: 1 };
  const stage = stageRect(canvasW, canvasH, wc, opts.camAspect);
  const a = rectsFor(from, canvasW, canvasH, overlay, stage);
  const b = rectsFor(to, canvasW, canvasH, overlay, stage);
  const screen = lerpRect({ ...a.screen, radius: 0 }, { ...b.screen, radius: 0 }, f);
  const cam = lerpRect(a.cam, b.cam, f);
  return {
    screenArea: { x: screen.x, y: screen.y, w: screen.w, h: screen.h },
    screenAlpha: screen.alpha,
    webcam: camOn && cam.alpha > 0.01 && cam.w > 1 && cam.h > 1 ? cam : null,
  };
}
