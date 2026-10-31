import { suggestZooms } from './cursor-track.js';
import { fullToCropUV } from './frame-state.js';
import { totalDuration, sourceToTimelineTimes, isAddedClip } from './timeline-engine.js';
import { zoomTypeFor } from './zoom-engine.js';

// Auto-zoom: turn recorded clicks (or cursor dwell) into zoom blocks on the
// edited timeline. Auto zooms carry `auto: true` so re-running replaces them
// without touching zooms the user placed by hand.

export function autoZoomEvents(project, cursorTrack) {
  if (!cursorTrack) return [];
  const suggestions = suggestZooms(cursorTrack.samples, {
    clicks: cursorTrack.clicks,
    // Suggestions are made in source time, so bound them by the source.
    duration: Math.max(0, ...project.clips.filter((c) => !isAddedClip(c)).map((c) => c.start + c.duration)),
  });
  const timelineEnd = totalDuration(project.clips);
  const type = zoomTypeFor(project.style);
  const out = [];
  for (const s of suggestions) {
    // A source moment can be cut away (skip) or repeated (first use wins).
    const [time] = sourceToTimelineTimes(project.clips, [s.time]);
    if (time == null) continue;
    const duration = Math.min(s.duration, timelineEnd - time);
    if (duration < 0.8) continue;
    out.push({ ...s, ...fullToCropUV(project, s), time, duration, type, auto: true });
  }
  return out;
}

// Returns a new zoomEvents list: manual zooms kept, previous auto zooms
// replaced, and new auto zooms added wherever they don't overlap a manual one.
export function applyAutoZoom(project, cursorTrack) {
  const manual = project.zoomEvents.filter((z) => !z.auto);
  const added = autoZoomEvents(project, cursorTrack).filter(
    (s) => !manual.some((e) => s.time < e.time + e.duration && s.time + s.duration > e.time)
  );
  return {
    zoomEvents: [...manual, ...added].sort((a, b) => a.time - b.time),
    added: added.length,
  };
}
