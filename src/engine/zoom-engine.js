// Pure zoom camera math. Shared by the interactive preview and the exporter so
// both always frame the video identically.
//
// A zoom event: { id, type, time, duration, x, y, scale, transition, follow }
//   type           'screen' (classic camera zoom) or 'loupe' (magnifying lens)
//   time/duration  seconds on the project timeline (duration includes both transitions)
//   x, y           focus center (anchor) in normalized video space (0..1)
//   scale          zoom factor at full strength (1 = no zoom)
//   transition     seconds to ease in and out ('classic' animation only)
//   follow         pan to keep the cursor in view while zoomed
//
// Screen animation styles:
//   classic   smoothstep ease over `transition` (projects made before springs)
//   focused   critically damped spring that settles fast (easy to read)
//   smooth    softer, slower spring (more fluid, less readable)

export function smoothstep(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

const IDENTITY = { cx: 0.5, cy: 0.5, scale: 1 };

export const SCREEN_ANIMATIONS = ['focused', 'smooth', 'classic'];

// Angular frequency (rad/s) of the critically damped camera spring.
const SPRING_OMEGA = { focused: 11, smooth: 5.5 };

// Keep the visible window inside the source frame: at `scale`, the viewport
// spans 1/scale of the video, so the center must stay half a viewport from
// every edge.
export function clampCenter(cx, cy, scale) {
  const half = 0.5 / Math.max(1, scale);
  return {
    cx: Math.min(1 - half, Math.max(half, cx)),
    cy: Math.min(1 - half, Math.max(half, cy)),
  };
}

// Loupe zooms magnify a lens instead of moving the camera; the camera
// ignores them (see loupeAt).
export function isLoupe(z) {
  return z.type === 'loupe';
}

// Project-wide zoom style (style.zoomStyle): 'classic' moves the camera,
// 'loupe' magnifies a lens around the focus. New zooms, manual and auto, are
// created in it; switching converts the existing ones (see withZoomStyle).
export const ZOOM_STYLES = ['classic', 'loupe'];

export function zoomStyleOf(style) {
  return style?.zoomStyle === 'loupe' ? 'loupe' : 'classic';
}

export function zoomTypeFor(style) {
  return zoomStyleOf(style) === 'loupe' ? 'loupe' : 'screen';
}

// Every zoom converted to `zoomStyle`. Auto zooms stay auto: a style switch
// is not a hand edit, so re-running auto zoom may still replace them.
export function withZoomStyle(zoomEvents, zoomStyle) {
  const type = zoomStyle === 'loupe' ? 'loupe' : 'screen';
  return zoomEvents.map((z) => ({ ...z, type }));
}

function activeZoomAt(zoomEvents, t, loupe = false) {
  let active = null;
  for (const z of zoomEvents) {
    if (isLoupe(z) !== loupe) continue;
    if (t >= z.time && t <= z.time + z.duration) {
      if (!active || z.time > active.time) active = z;
    }
  }
  return active;
}

// Soft dead zone: offsets inside ±r map to 0, beyond it the camera moves by
// the excess, so small cursor moves never pan but the cursor can't leave view.
function deadZone(d, r) {
  if (d > r) return d - r;
  if (d < -r) return d + r;
  return 0;
}

// Focus point for an active zoom: its anchor, shifted toward the cursor when
// the zoom follows it. `cursorAt(t)` returns {x, y} in video UV or null.
function focusOf(zoom, t, cursorAt) {
  let x = zoom.x;
  let y = zoom.y;
  if (zoom.follow && cursorAt) {
    const c = cursorAt(t);
    if (c) {
      const r = 0.22 / Math.max(1, zoom.scale);
      x = zoom.x + deadZone(c.x - zoom.x, r);
      y = zoom.y + deadZone(c.y - zoom.y, r);
    }
  }
  return { x, y };
}

// Where the camera wants to be at t (no easing).
export function targetAt(zoomEvents, t, cursorAt) {
  const z = activeZoomAt(zoomEvents, t);
  if (!z) return IDENTITY;
  const f = focusOf(z, t, cursorAt);
  const c = clampCenter(f.x, f.y, z.scale);
  return { cx: c.cx, cy: c.cy, scale: z.scale };
}

function classicCamera(zoomEvents, t, cursorAt) {
  const active = activeZoomAt(zoomEvents, t);
  if (!active) return IDENTITY;

  const trans = Math.min(active.transition ?? 0.8, active.duration / 2);
  const end = active.time + active.duration;

  let strength = 1;
  if (trans > 0) {
    if (t < active.time + trans) {
      strength = smoothstep((t - active.time) / trans);
    } else if (t > end - trans) {
      strength = smoothstep((end - t) / trans);
    }
  }

  const scale = 1 + (active.scale - 1) * strength;
  const f = focusOf(active, t, cursorAt);
  const target = clampCenter(f.x, f.y, scale);
  return {
    cx: 0.5 + (target.cx - 0.5) * strength,
    cy: 0.5 + (target.cy - 0.5) * strength,
    scale,
  };
}

// The camera is a critically damped spring chasing targetAt(). To make it a
// pure function of t (preview scrubbing and export must agree), the spring is
// simulated on a fixed global time grid starting from rest far enough back
// that the starting state no longer matters (residual < 0.1%).
const SPRING_DT = 1 / 120;

function springCamera(zoomEvents, t, omega, cursorAt) {
  const settle = 10 / omega;
  const gridEnd = Math.floor(t / SPRING_DT) * SPRING_DT;
  const steps = Math.ceil(settle / SPRING_DT);
  let time = gridEnd - steps * SPRING_DT;

  const start = targetAt(zoomEvents, time, cursorAt);
  let x = start.cx, y = start.cy, s = start.scale;
  let vx = 0, vy = 0, vs = 0;
  const k = omega * omega;
  const d = 2 * omega;

  const step = (dt, target) => {
    vx += (k * (target.cx - x) - d * vx) * dt;
    vy += (k * (target.cy - y) - d * vy) * dt;
    vs += (k * (target.scale - s) - d * vs) * dt;
    x += vx * dt;
    y += vy * dt;
    s += vs * dt;
  };

  for (let i = 0; i < steps; i++) {
    time += SPRING_DT;
    step(SPRING_DT, targetAt(zoomEvents, time, cursorAt));
  }
  const rest = t - gridEnd;
  if (rest > 1e-9) step(rest, targetAt(zoomEvents, t, cursorAt));

  const scale = Math.max(1, s);
  const c = clampCenter(x, y, scale);
  return { cx: c.cx, cy: c.cy, scale };
}

// Camera state for timeline position t: { cx, cy, scale } in video UV space.
// opts.animation: 'classic' (default) | 'focused' | 'smooth'
// opts.cursorAt:  timeline time -> cursor {x, y} (enables zoom.follow)
export function cameraAt(zoomEvents, t, opts = {}) {
  const omega = SPRING_OMEGA[opts.animation];
  if (!omega) return classicCamera(zoomEvents, t, opts.cursorAt);
  if (!zoomEvents.some((z) => !isLoupe(z))) return IDENTITY;
  return springCamera(zoomEvents, t, omega, opts.cursorAt);
}

// Loupe lens state at t: { x, y, scale, radius, strength } or null. The lens
// pops in and out over a short fixed ease regardless of screen animation —
// it is an overlay, not a camera move. radius is a fraction of canvas height.
const LOUPE_EASE = 0.3;

export function loupeAt(zoomEvents, t, cursorAt) {
  const z = activeZoomAt(zoomEvents, t, true);
  if (!z) return null;
  const ease = Math.min(LOUPE_EASE, z.duration / 2);
  const strength = ease > 0 ? Math.min(smoothstep((t - z.time) / ease), smoothstep((z.time + z.duration - t) / ease)) : 1;
  let x = z.x;
  let y = z.y;
  if (z.follow && cursorAt) {
    const c = cursorAt(t);
    if (c) {
      x = c.x;
      y = c.y;
    }
  }
  return {
    x,
    y,
    scale: Math.max(1.2, z.scale),
    radius: Math.min(0.4, Math.max(0.06, z.radius ?? 0.18)),
    strength,
  };
}

export function makeZoomEvent({
  time, x = 0.5, y = 0.5, scale = 1.8, duration = 3, transition = 0.8, follow = true, type = 'screen',
}) {
  return {
    id: `zoom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    time: Math.max(0, time),
    duration,
    x,
    y,
    scale,
    transition,
    follow,
  };
}
