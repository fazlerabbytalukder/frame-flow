// Everything a frame needs besides the media itself, derived from the project
// at one point in time — camera, cursor, clicks, shortcuts, captions,
// annotations, fade — plus motion-blurred compositing. The preview and the
// exporter both render through composeFrame(), so they cannot drift apart.

import { cameraAt, loupeAt } from './zoom-engine.js';
import { cursorSettings, clickBounceScale, lastClickBefore } from './cursor-style.js';
import { drawFrame, captionStateAt, annotationsAt, normalizeCrop, computeGeometry, textBase } from './composition-engine.js';
import { layoutGeometry } from './camera-layout.js';
import {
  prepareCursorTrack, smoothedCursorAt, cursorPositionAt, activeClicksAt,
  activeShortcutsAt, cursorWindow, idleOpacity, cursorTilt,
} from './cursor-track.js';
import { totalDuration, resolve, transitionAt, clipSpeed, isAddedClip } from './timeline-engine.js';

function smooth01(v) {
  const c = Math.min(1, Math.max(0, v));
  return c * c * (3 - 2 * c);
}

export function trackFor(project, rawTrack) {
  return prepareCursorTrack(rawTrack, { shakes: Boolean(project.style.cursor?.removeShakes) });
}

function sourceTimeOf(project, timelineTime) {
  const hit = resolve(project.clips, timelineTime);
  return hit ? hit.sourceTime : 0;
}

// Cursor position used to steer following zooms: smoothed more heavily than
// the visible pointer so the camera doesn't twitch. A loupe tracks closer.
// Zoom focus points live in crop-UV space (like annotations) while cursor
// samples and clicks are full-video UV. Convert, clamped into the frame.
export function fullToCropUV(project, p) {
  const crop = normalizeCrop(project.style.crop);
  const w = Math.max(0.0001, 1 - crop.l - crop.r);
  const h = Math.max(0.0001, 1 - crop.t - crop.b);
  return {
    x: Math.min(1, Math.max(0, (p.x - crop.l) / w)),
    y: Math.min(1, Math.max(0, (p.y - crop.t) / h)),
  };
}

function cameraCursor(project, track, window = 0.25) {
  if (!track || track.samples.length === 0) return null;
  return (timelineTime) => {
    const c = smoothedCursorAt(track.samples, sourceTimeOf(project, timelineTime), window);
    return c && fullToCropUV(project, c);
  };
}

// `rest` is where an unzoomed "fill" frame looks (see computeGeometry): the
// cursor, smoothed over a long window so it pans like a camera operator.
const REST_WINDOW = 0.9;

export function cameraFor(project, track, timelineTime) {
  const cam = cameraAt(project.zoomEvents, timelineTime, {
    animation: project.style.animation?.screen || 'classic',
    cursorAt: cameraCursor(project, track),
  });
  if (!track || track.samples.length === 0) return cam;
  const c = smoothedCursorAt(track.samples, sourceTimeOf(project, timelineTime), REST_WINDOW);
  return c ? { ...cam, rest: fullToCropUV(project, c) } : cam;
}

// Visible cursor overlay state { x, y, opacity, rotation } or null.
export function cursorFor(project, track, timelineTime, sourceTime) {
  const cs = project.style.cursor || {};
  if (!cs.overlay || !track || track.samples.length === 0) return null;
  const window = cursorWindow(cs.animation);
  const at = (src) =>
    window > 0 ? smoothedCursorAt(track.samples, src, window) : cursorPositionAt(track.samples, src);

  const total = totalDuration(project.clips);
  let src = sourceTime;
  // Freeze the pointer for the last half second.
  if (cs.stopAtEnd && timelineTime > total - 0.6) src = sourceTimeOf(project, Math.max(0, total - 0.6));
  let pos = at(src);
  if (!pos) return null;
  const look = cursorSettings(cs);

  // Glide back to where the video started so the clip loops seamlessly.
  const glide = Math.min(look.loopDuration, total);
  if (cs.loop && glide > 0 && timelineTime > total - glide) {
    const start = at(sourceTimeOf(project, 0));
    const f = smooth01((timelineTime - (total - glide)) / glide);
    if (start) pos = { x: pos.x + (start.x - pos.x) * f, y: pos.y + (start.y - pos.y) * f };
  }

  const click = look.bounce > 0 ? lastClickBefore(track.clicks, src) : null;
  return {
    x: pos.x,
    y: pos.y,
    opacity: cs.hideIdle ? idleOpacity(track, src, { delay: look.idleDelay }) : 1,
    // Sway 0..1 maps to up to twice the original fixed tilt.
    rotation: look.sway > 0 ? cursorTilt(track.samples, src, window) * look.sway * 2 : 0,
    scale: click ? clickBounceScale(src - click.t, look.bounce, look.bounceSpeed) : 1,
  };
}

// Fade dims only the video (the frame and shadow stay); every other
// transition moves the whole screen layer (see drawFrame opts.transition).
function transitionInputs(clips, timelineTime, fallback) {
  const tr = transitionAt(clips, timelineTime, fallback);
  if (!tr) return { fade: 1, transition: null };
  return tr.type === 'fade' ? { fade: tr.p, transition: null } : { fade: 1, transition: tr };
}

// All non-media drawFrame inputs for one instant.
export function frameInputs(project, track, timelineTime, sourceTime = sourceTimeOf(project, timelineTime)) {
  const style = project.style;
  return {
    camera: cameraFor(project, track, timelineTime),
    loupe: loupeAt(project.zoomEvents, timelineTime, cameraCursor(project, track, 0.12)),
    cursor: cursorFor(project, track, timelineTime, sourceTime),
    clicks: track ? activeClicksAt(track.clicks, sourceTime, cursorSettings(style.cursor).clickDuration / 1000) : [],
    shortcuts: track && style.shortcuts?.enabled !== false ? activeShortcutsAt(track.shortcuts, sourceTime) : [],
    caption: captionStateAt(project.captions, timelineTime),
    annotations: annotationsAt(project.annotations, timelineTime),
    ...transitionInputs(project.clips, timelineTime, style.clipTransition),
  };
}

// --- motion blur --------------------------------------------------------------

// Shutter: the blur spans `strength * MAX_SHUTTER` seconds around the frame.
const MAX_SHUTTER = 0.06;

export function blurSettings(project) {
  const mb = project.style.animation?.motionBlur || {};
  const strength = Math.min(1, Math.max(0, Number(mb.strength) || 0));
  return {
    shutter: strength * MAX_SHUTTER,
    cursor: mb.cursor !== false,
    zoom: mb.zoom !== false,
    pan: mb.pan !== false,
  };
}

const MOVE_EPS = 0.0008;

// Sub-frame inputs across the shutter. Only the animated parts (camera,
// cursor) vary; the video frame and everything else stay at the frame time.
// Returns a single entry when nothing moves enough to blur.
export function blurSubframes(project, track, timelineTime, sourceTime, base, samples) {
  const blur = blurSettings(project);
  if (blur.shutter <= 0 || samples < 2 || !(blur.cursor || blur.zoom || blur.pan)) return [base];

  const times = [];
  for (let k = 0; k < samples; k++) times.push(timelineTime + blur.shutter * (k / (samples - 1) - 0.5));

  // Cheap check at the shutter edges first.
  const first = times[0];
  const last = times[times.length - 1];
  const camA = cameraFor(project, track, first);
  const camB = cameraFor(project, track, last);
  const camMoves =
    (blur.zoom && Math.abs(camA.scale - camB.scale) > MOVE_EPS) ||
    (blur.pan && Math.hypot(camA.cx - camB.cx, camA.cy - camB.cy) > MOVE_EPS);
  // Source time advances at the clip's speed within the (short) shutter.
  const speed = clipSpeed(resolve(project.clips, timelineTime)?.clip || {});
  const srcAt = (tt) => sourceTime + (tt - timelineTime) * speed;
  let curMoves = false;
  if (blur.cursor && base.cursor) {
    const a = cursorFor(project, track, first, srcAt(first));
    const b = cursorFor(project, track, last, srcAt(last));
    curMoves = Boolean(a && b && Math.hypot(a.x - b.x, a.y - b.y) > MOVE_EPS * 2);
  }
  if (!camMoves && !curMoves) return [base];

  return times.map((tt) => {
    const out = { ...base };
    if (camMoves) {
      const c = cameraFor(project, track, tt);
      out.camera = {
        cx: blur.pan ? c.cx : base.camera.cx,
        cy: blur.pan ? c.cy : base.camera.cy,
        scale: blur.zoom ? c.scale : base.camera.scale,
        rest: blur.pan ? c.rest : base.camera.rest,
      };
    }
    if (curMoves) out.cursor = cursorFor(project, track, tt, srcAt(tt)) || base.cursor;
    return out;
  });
}

const scratch = new Map();

function scratchCanvas(w, h) {
  const key = `${w}x${h}`;
  let c = scratch.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    scratch.set(key, c);
  }
  return c;
}

// Screen area, screen alpha and webcam rect for this instant (camera layouts,
// smart framing, hide-on-silence). media: { canvasW, canvasH, videoW, videoH }.
export function layoutFor(project, rawTrack, timelineTime, media, sourceTime) {
  const track = trackFor(project, rawTrack);
  const src = sourceTime ?? sourceTimeOf(project, timelineTime);
  let cursorCanvas = null;
  if (project.style.webcam?.avoidCursor && track && track.samples.length > 0 && media.videoW) {
    // Unzoomed screen placement: good enough to judge which corner is busy.
    const g = computeGeometry({
      videoW: media.videoW, videoH: media.videoH, canvasW: media.canvasW, canvasH: media.canvasH,
      style: project.style, camera: { cx: 0.5, cy: 0.5, scale: 1 },
    });
    cursorCanvas = (t) => {
      const c = smoothedCursorAt(track.samples, sourceTimeOf(project, t), 0.15);
      if (!c) return null;
      const uv = fullToCropUV(project, c);
      const p = g.uvToCanvas(uv.x, uv.y);
      return { x: p.x / media.canvasW, y: p.y / media.canvasH };
    };
  }
  return layoutGeometry(project, timelineTime, media.canvasW, media.canvasH, {
    cursorCanvas,
    silences: project.audioAnalysis?.silences,
    sourceTime: src,
    hasWebcam: (project.assets || []).some((a) => a.type === 'webcam-recording'),
    camAspect: media.webcamVideo?.videoWidth ? media.webcamVideo.videoWidth / media.webcamVideo.videoHeight : undefined,
  });
}

// Smart framing: while zoomed in, the view shifts so a camera bubble never
// covers the cursor. It pans first; when the view is already pinned against
// the screen's edge (the cursor in the bubble's corner), it zooms in a little
// more, up to 1.5x, which moves content near that edge away from it. The
// correction grows with how deep the cursor is inside the bubble's area and
// with the zoom, so it stays continuous. Off with style.smartFraming === false.
const MAX_EXTRA_ZOOM = 1.5;

export function avoidCameraCover(project, track, timelineTime, camera, layout, media) {
  if (project.style.smartFraming === false || !(camera.scale > 1.02)) return camera;
  const cam = layout.webcam;
  if (!cam || (cam.alpha ?? 1) < 0.5 || !media.videoW || !track || track.samples.length === 0) return camera;
  if (cam.w >= media.canvasW * 0.9 && cam.h >= media.canvasH * 0.9) return camera;
  const c = smoothedCursorAt(track.samples, sourceTimeOf(project, timelineTime), 0.25);
  if (!c) return camera;
  const uv = fullToCropUV(project, c);
  const geometry = (cm) =>
    computeGeometry({
      videoW: media.videoW, videoH: media.videoH, canvasW: media.canvasW, canvasH: media.canvasH,
      style: project.style, camera: cm, area: layout.screenArea,
    });
  const p = geometry(camera).uvToCanvas(uv.x, uv.y);
  const m = textBase(media.canvasW, media.canvasH) * 0.05;
  const r = { x: cam.x - m, y: cam.y - m, w: cam.w + 2 * m, h: cam.h + 2 * m };
  if (p.x <= r.x || p.x >= r.x + r.w || p.y <= r.y || p.y >= r.y + r.h) return camera;

  // Push across the bubble's narrow direction: sideways for a corner
  // bubble, up or down for a camera that spans the width.
  const sideways = cam.w < media.canvasW * 0.6;
  const far = sideways ? cam.x + cam.w / 2 > media.canvasW / 2 : cam.y + cam.h / 2 > media.canvasH / 2;
  // How far the cursor must travel to leave the area (signed, canvas px).
  const needed = (q) =>
    sideways ? (far ? q.x - r.x : -(r.x + r.w - q.x)) : far ? q.y - r.y : -(r.y + r.h - q.y);
  // The camera at `mul` x the zoom, panned to carry the cursor out.
  const pushedAt = (mul) => {
    const base = { ...camera, scale: camera.scale * mul };
    const g = geometry(base);
    const d = needed(g.uvToCanvas(uv.x, uv.y));
    const cm = sideways
      ? { ...base, cx: base.cx + d / (g.pxScale * g.cw) }
      : { ...base, cy: base.cy + d / ((g.rect.h / g.viewH) * g.ch) };
    const left = needed(geometry(cm).uvToCanvas(uv.x, uv.y));
    return { cm, clear: far ? left <= 0.5 : left >= -0.5 };
  };
  let target = pushedAt(1);
  if (!target.clear) {
    // Smallest extra zoom that clears it (or the most we allow).
    let lo = 1;
    let hi = MAX_EXTRA_ZOOM;
    target = pushedAt(hi);
    for (let k = 0; k < 12 && target.clear; k++) {
      const mid = (lo + hi) / 2;
      const t = pushedAt(mid);
      if (t.clear) {
        hi = mid;
        target = t;
      } else lo = mid;
    }
  }
  const depth = smooth01((sideways ? Math.min(p.y - r.y, r.y + r.h - p.y) : Math.min(p.x - r.x, r.x + r.w - p.x)) / (2 * m));
  const w = depth * smooth01((camera.scale - 1) / 0.3);
  const t = target.cm;
  return {
    ...camera,
    cx: camera.cx + (t.cx - camera.cx) * w,
    cy: camera.cy + (t.cy - camera.cy) * w,
    scale: camera.scale + (t.scale - camera.scale) * w,
  };
}

// Face position at webcam time t from project.faceTrack ({ step, points:
// [[x, y, size], ...] } sampled every `step` seconds), interpolated.
export function faceAt(faceTrack, t) {
  const pts = faceTrack?.points;
  if (!pts || pts.length === 0 || !(faceTrack.step > 0) || !Number.isFinite(t)) return null;
  const f = Math.max(0, t / faceTrack.step);
  const i = Math.min(pts.length - 1, Math.floor(f));
  const j = Math.min(pts.length - 1, i + 1);
  const k = Math.min(1, f - i);
  const a = pts[i];
  const b = pts[j];
  if (!a || !b) return null;
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, size: a[2] + (b[2] - a[2]) * k };
}

// Composite one frame. `media` carries the video/webcam/background elements
// and canvas size; `blurSamples` is the motion-blur quality (1 disables).
export function composeFrame(ctx, project, rawTrack, timelineTime, media, { sourceTime, blurSamples = 1 } = {}) {
  // A clip added from another video has no cursor, clicks, crop or camera
  // layout: those all belong to the screen recording.
  const added = isAddedClip(resolve(project.clips, timelineTime)?.clip);
  if (added) {
    project = { ...project, style: { ...project.style, crop: { l: 0, r: 0, t: 0, b: 0 } } };
    rawTrack = null;
  }
  const track = trackFor(project, rawTrack);
  const src = sourceTime ?? sourceTimeOf(project, timelineTime);
  const base = frameInputs(project, track, timelineTime, src);
  const layout = added
    ? layoutGeometry(project, timelineTime, media.canvasW, media.canvasH, { hasWebcam: false })
    : layoutFor(project, rawTrack, timelineTime, media, src);
  const frames = blurSubframes(project, track, timelineTime, src, base, blurSamples).map((f) => ({
    ...f,
    camera: avoidCameraCover(project, track, timelineTime, f.camera, layout, media),
  }));
  const wc = project.style.webcam;
  const common = {
    ...media,
    style: project.style,
    screenArea: layout.screenArea,
    screenAlpha: layout.screenAlpha,
    webcamRect: layout.webcam,
    webcamFace: wc?.faceTracking && media.webcamVideo ? faceAt(project.faceTrack, media.webcamVideo.currentTime) : null,
  };

  if (frames.length === 1) {
    drawFrame(ctx, { ...common, ...frames[0] });
    return frames.length;
  }

  // Running average: draw sub-frame k on its own canvas, then blend it over
  // the accumulated image with weight 1/(k+1).
  const sc = scratchCanvas(media.canvasW, media.canvasH);
  const sctx = sc.getContext('2d');
  drawFrame(ctx, { ...common, ...frames[0] });
  for (let k = 1; k < frames.length; k++) {
    drawFrame(sctx, { ...common, ...frames[k] });
    ctx.save();
    ctx.globalAlpha = 1 / (k + 1);
    ctx.drawImage(sc, 0, 0);
    ctx.restore();
  }
  return frames.length;
}
