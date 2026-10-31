// Pure timeline math over the project's clip sequence. Clips play back to
// back (no gaps); each clip is a window { start, duration } into its source
// asset plus a playback `speed` (default 1), so trimming, splitting and speed
// changes never touch the media. `duration` is always SOURCE seconds; a clip
// occupies duration/speed seconds on the timeline. Shared by the preview
// playback controller and the exporter.

// Clips added from other video files (asset ids "added-..."). The cursor
// track, clicks, transcript and webcam all belong to the screen recording, so
// anything keyed on recording time skips these clips (while still counting
// their length on the timeline).
export function isAddedClip(clip) {
  return typeof clip?.assetId === 'string' && clip.assetId.startsWith('added-');
}

export function clipSpeed(clip) {
  const s = Number(clip.speed);
  return Number.isFinite(s) && s >= 0.25 && s <= 4 ? s : 1;
}

// Seconds this clip occupies on the timeline.
export function clipTimelineLength(clip) {
  return clip.duration / clipSpeed(clip);
}

export function totalDuration(clips) {
  return clips.reduce((sum, c) => sum + clipTimelineLength(c), 0);
}

// Timeline offset where clip index i begins.
export function clipOffset(clips, index) {
  let t = 0;
  for (let i = 0; i < index; i++) t += clipTimelineLength(clips[i]);
  return t;
}

// Map a timeline time to { index, clip, sourceTime }. Clamps to the ends.
export function resolve(clips, timelineTime) {
  if (clips.length === 0) return null;
  let t = Math.max(0, timelineTime);
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const len = clipTimelineLength(clip);
    if (t < len || i === clips.length - 1) {
      const local = Math.min(t, len - 0.0001);
      return {
        index: i,
        clip,
        sourceTime: clip.start + Math.max(0, local) * clipSpeed(clip),
      };
    }
    t -= len;
  }
  return null;
}

// Where SOURCE times land on the timeline. A source moment can appear in
// several clips (or none, if trimmed away); every occurrence is returned,
// sorted. Used to place click sounds on the edited timeline.
export function sourceToTimelineTimes(clips, sourceTimes) {
  const out = [];
  let offset = 0;
  for (const clip of clips) {
    const speed = clipSpeed(clip);
    if (!isAddedClip(clip)) {
      for (const t of sourceTimes) {
        if (t >= clip.start && t < clip.start + clip.duration) out.push(offset + (t - clip.start) / speed);
      }
    }
    offset += clipTimelineLength(clip);
  }
  return out.sort((a, b) => a - b);
}

const MIN_CLIP = 0.2;

// Split the clip under `timelineTime` into two. Returns true if it split.
export function splitAt(project, timelineTime) {
  const clips = project.clips;
  const hit = resolve(clips, timelineTime);
  if (!hit) return false;
  const local = hit.sourceTime - hit.clip.start; // source seconds into the clip
  if (local < MIN_CLIP || hit.clip.duration - local < MIN_CLIP) return false;

  const left = { ...hit.clip, duration: local };
  const right = {
    ...hit.clip,
    id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    start: hit.clip.start + local,
    duration: hit.clip.duration - local,
  };
  // The new cut inside the clip starts plain; the clip's own transition stays
  // on the cut before it.
  delete right.transition;
  clips.splice(hit.index, 1, left, right);
  return true;
}

// Where a clip inserted at timeline time t goes (an index into clips). At a
// cut (or the start/end) within `snap` seconds it goes there; inside a clip,
// that clip is split at t and the new clip goes between the halves. When the
// split would leave a sliver, the nearer edge of the clip is used.
export function insertIndexAt(project, t, snap = 0.15) {
  const clips = project.clips;
  let off = 0;
  for (let i = 0; i <= clips.length; i++) {
    if (Math.abs(off - t) <= snap) return i;
    if (i < clips.length) off += clipTimelineLength(clips[i]);
  }
  if (t >= off) return clips.length;
  const hit = resolve(clips, t);
  if (!hit) return clips.length;
  if (splitAt(project, t)) return hit.index + 1;
  const start = clipOffset(clips, hit.index);
  return t - start < clipTimelineLength(hit.clip) / 2 ? hit.index : hit.index + 1;
}

// Trim a clip edge. `edge` is 'start' (moves the source in-point) or 'end'.
// `newValue` is the new SOURCE time for that edge. Clamped to the asset bounds
// and a minimum clip length.
export function trimClip(project, clipId, edge, newValue, assetDuration) {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return;
  if (edge === 'start') {
    const end = clip.start + clip.duration;
    const start = Math.min(Math.max(0, newValue), end - MIN_CLIP);
    clip.duration = end - start;
    clip.start = start;
  } else {
    const maxEnd = assetDuration || clip.start + clip.duration;
    const end = Math.min(Math.max(clip.start + MIN_CLIP, newValue), maxEnd);
    clip.duration = end - clip.start;
  }
}

// Play the SOURCE range [srcStart, srcEnd) at `speed` wherever it appears in
// the clip sequence (clips may be reordered): overlapping clips are split at
// the range edges and the middle piece gets the new speed. Slivers shorter
// than the minimum clip are not created. Returns how many pieces changed.
export function applySpeedToSourceRange(project, srcStart, srcEnd, speed) {
  let changed = 0;
  const out = [];
  for (const clip of project.clips) {
    if (isAddedClip(clip)) {
      out.push(clip);
      continue;
    }
    const a = Math.max(clip.start, srcStart);
    const b = Math.min(clip.start + clip.duration, srcEnd);
    if (b - a < MIN_CLIP) {
      out.push(clip);
      continue;
    }
    const pieces = [];
    const before = a - clip.start;
    const after = clip.start + clip.duration - b;
    // Absorb slivers into the sped-up piece rather than leaving tiny clips.
    const midStart = before < MIN_CLIP ? clip.start : a;
    const midEnd = after < MIN_CLIP ? clip.start + clip.duration : b;
    if (midStart > clip.start) pieces.push({ ...clip, duration: midStart - clip.start });
    pieces.push({ ...clip, start: midStart, duration: midEnd - midStart, speed });
    if (midEnd < clip.start + clip.duration) {
      pieces.push({ ...clip, start: midEnd, duration: clip.start + clip.duration - midEnd });
    }
    pieces.forEach((p, i) => {
      if (i > 0) p.id = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    });
    out.push(...pieces);
    changed += 1;
  }
  project.clips = out;
  return changed;
}

export function deleteClip(project, clipId) {
  if (project.clips.length <= 1) return false;
  const i = project.clips.findIndex((c) => c.id === clipId);
  if (i === -1) return false;
  project.clips.splice(i, 1);
  return true;
}

// Move a clip to position `index` in the sequence (drag to reorder).
export function moveClipTo(project, clipId, index) {
  const i = project.clips.findIndex((c) => c.id === clipId);
  if (i === -1) return false;
  const j = Math.min(Math.max(0, index), project.clips.length - 1);
  if (i === j) return false;
  const [clip] = project.clips.splice(i, 1);
  project.clips.splice(j, 0, clip);
  return true;
}

export function moveClip(project, clipId, direction) {
  const i = project.clips.findIndex((c) => c.id === clipId);
  const j = i + direction;
  if (i === -1 || j < 0 || j >= project.clips.length) return false;
  const [clip] = project.clips.splice(i, 1);
  project.clips.splice(j, 0, clip);
  return true;
}

// Transitions between clips. clips[i].transition is the cut INTO clip i
// (i >= 1); a clip without one uses the project default
// (style.clipTransition). Each transition is centred on the cut: the leaving
// clip animates out in the first half, the next one animates in.
export const CLIP_TRANSITIONS = ['none', 'fade', 'black', 'white', 'zoom', 'slide', 'slideUp', 'blur', 'wipe'];

export function transitionDuration(d) {
  const n = Number(d);
  return Number.isFinite(n) ? Math.min(2, Math.max(0.1, n)) : 0.4;
}

export function transitionFor(clips, i, fallback) {
  const own = clips[i]?.transition;
  const t = own && CLIP_TRANSITIONS.includes(own.type) ? own : fallback;
  if (!t || !CLIP_TRANSITIONS.includes(t.type)) return { type: 'none', duration: 0.4 };
  return { type: t.type, duration: transitionDuration(t.duration) };
}

// The transition running at a timeline time: { type, p, dir, index } where
// p is how visible the picture is (1 = fully, 0 = gone at the cut) and dir
// is 'out' (leaving clip index-1) or 'in' (entering clip index). Null when
// none is running. A transition never takes more than half of either clip.
export function transitionAt(clips, timelineTime, fallback) {
  if (clips.length < 2) return null;
  let boundary = 0;
  for (let i = 1; i < clips.length; i++) {
    const prevLen = clipTimelineLength(clips[i - 1]);
    boundary += prevLen;
    const tr = transitionFor(clips, i, fallback);
    if (tr.type === 'none') continue;
    const half = Math.min(tr.duration / 2, prevLen / 2, clipTimelineLength(clips[i]) / 2);
    const d = timelineTime - boundary;
    if (half > 0 && Math.abs(d) < half) return { type: tr.type, p: Math.abs(d) / half, dir: d < 0 ? 'out' : 'in', index: i };
  }
  return null;
}

// Fade strength (0 = fully faded to background, 1 = fully visible) at a
// timeline time, for the fade-through-background clip transition. The first
// clip does not fade in at t=0 and the last does not fade out at the end.
export function fadeAlphaAt(clips, timelineTime, transition) {
  const tr = transitionAt(clips, timelineTime, transition);
  return tr && tr.type === 'fade' ? tr.p : 1;
}
