// Transcript editing. `project.transcript.words` are { text, start, end } in
// SOURCE seconds (from local Whisper). Cutting words removes their source
// ranges from every clip, ripples the timeline items after them, and rebuilds
// auto captions, so editing the text edits the video.

import { clipSpeed, clipTimelineLength, isAddedClip } from './timeline-engine.js';

const FILLERS = new Set(['um', 'umm', 'ummm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'ahh', 'hmm', 'hm', 'mm', 'mhm', 'eh']);

export function normalizeWord(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');
}

export function isFiller(text) {
  return FILLERS.has(normalizeWord(text));
}

// Where a source range sits on the timeline: every clip piece that shows part
// of it, as { start, end } timeline seconds plus `src`, the source seconds
// that piece covers.
function sourceRangeOnTimeline(clips, a, b) {
  const out = [];
  let offset = 0;
  for (const clip of clips) {
    const speed = clipSpeed(clip);
    if (isAddedClip(clip)) {
      offset += clipTimelineLength(clip);
      continue;
    }
    const s = Math.max(a, clip.start);
    const e = Math.min(b, clip.start + clip.duration);
    if (e > s) out.push({ start: offset + (s - clip.start) / speed, end: offset + (e - clip.start) / speed, src: e - s });
    offset += clipTimelineLength(clip);
  }
  return out;
}

// Words that are still in the edit, with their timeline times. A word is in
// when at least half of it survives; `index` points into transcript.words.
export function wordsOnTimeline(project) {
  const words = project.transcript?.words || [];
  const out = [];
  words.forEach((w, index) => {
    const pieces = sourceRangeOnTimeline(project.clips, w.start, w.end);
    const kept = pieces.reduce((s, p) => s + p.src, 0);
    if (pieces.length === 0 || kept < Math.max(0.001, w.end - w.start) * 0.5) return;
    out.push({ text: w.text, start: pieces[0].start, end: pieces[pieces.length - 1].end, index });
  });
  return out;
}

// Source ranges to cut for "remove filler words and pauses": every filler
// word (plus the gap up to the next word), and every pause longer than
// `pause`, shortened to `keep`. Ranges are merged and sorted.
export function fillerAndPauseCuts(words, { fillers = true, pauses = true, pause = 0.8, keep = 0.3 } = {}) {
  const ranges = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (fillers && isFiller(w.text)) {
      const next = words[i + 1];
      const end = next ? Math.min(next.start, w.end + 0.25) : w.end;
      ranges.push({ start: w.start, end: Math.max(w.end, end) });
    }
    if (pauses && i + 1 < words.length) {
      const gap = words[i + 1].start - w.end;
      if (gap > pause) ranges.push({ start: w.end + keep / 2, end: words[i + 1].start - keep / 2 });
    }
  }
  return mergeRanges(ranges);
}

export function mergeRanges(ranges) {
  const sorted = ranges.filter((r) => r.end - r.start > 0.01).sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 0.02) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

// Source range covered by a set of word indices, padded into the silence on
// both sides (never into a neighbouring word). Contiguous runs only.
export function wordRanges(words, indices) {
  const set = [...new Set(indices)].sort((a, b) => a - b);
  const ranges = [];
  let i = 0;
  while (i < set.length) {
    let j = i;
    while (j + 1 < set.length && set[j + 1] === set[j] + 1) j++;
    const first = words[set[i]];
    const last = words[set[j]];
    const prev = words[set[i] - 1];
    const next = words[set[j] + 1];
    const start = prev ? Math.max(prev.end, first.start - 0.05) : Math.max(0, first.start - 0.05);
    const end = next ? Math.min(next.start, last.end + 0.05) : last.end + 0.05;
    ranges.push({ start, end });
    i = j + 1;
  }
  return mergeRanges(ranges);
}

const MIN_PIECE = 0.05;

function newClipId() {
  return `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// Removes source ranges from every clip (slivers under 50 ms go too) and
// shifts timeline items so they stay on the content they were on. Items
// whose whole span was cut are dropped. Never removes the last clip.
// Returns the timeline seconds removed.
export function cutSourceRanges(project, ranges) {
  const cuts = mergeRanges(ranges);
  if (cuts.length === 0) return 0;
  // Timeline intervals that disappear, measured on the old timeline.
  const removed = mergeRanges(cuts.flatMap((r) => sourceRangeOnTimeline(project.clips, r.start, r.end)));

  const out = [];
  for (const clip of project.clips) {
    if (isAddedClip(clip)) {
      out.push(clip);
      continue;
    }
    let pieces = [{ start: clip.start, end: clip.start + clip.duration }];
    for (const r of cuts) {
      pieces = pieces.flatMap((p) => {
        if (r.end <= p.start || r.start >= p.end) return [p];
        const keep = [];
        if (r.start - p.start >= MIN_PIECE) keep.push({ start: p.start, end: r.start });
        if (p.end - r.end >= MIN_PIECE) keep.push({ start: r.end, end: p.end });
        return keep;
      });
    }
    pieces.forEach((p, k) => out.push({ ...clip, id: k === 0 ? clip.id : newClipId(), start: p.start, duration: p.end - p.start }));
  }
  if (out.length === 0) return 0;
  project.clips = out;

  const total = removed.reduce((s, r) => s + (r.end - r.start), 0);
  const shift = (t) => {
    let d = 0;
    for (const r of removed) {
      if (t >= r.end) d += r.end - r.start;
      else if (t > r.start) d += t - r.start;
    }
    return t - d;
  };
  const ripple = (items, minDuration = 0.1) =>
    (items || []).flatMap((item) => {
      const start = shift(item.time);
      const end = shift(item.time + item.duration);
      if (end - start < minDuration) return [];
      return [{ ...item, time: +start.toFixed(4), duration: +(end - start).toFixed(4) }];
    });
  project.zoomEvents = ripple(project.zoomEvents, 0.3);
  project.annotations = ripple(project.annotations);
  project.layouts = ripple(project.layouts, 0.3);
  // Captions made from speech are rebuilt from the edited transcript; typed
  // ones ripple like everything else.
  const hadAuto = project.transcript?.captions || (project.captions || []).some((c) => c.auto);
  project.captions = ripple((project.captions || []).filter((c) => !c.auto));
  if (hadAuto && project.transcript) rebuildAutoCaptions(project);
  return total;
}

// Groups the words still in the edit into caption blocks: up to `maxWords`
// words or `maxDuration` seconds, broken at sentence ends and pauses. Each
// caption keeps its words (times relative to the caption) for word-by-word
// animation. Captions made here are marked `auto` and replaced on rebuild.
export function captionsFromTranscript(project, { maxWords = 7, maxDuration = 3.2, pause = 0.6 } = {}) {
  const words = wordsOnTimeline(project).filter((w) => !isFiller(w.text));
  const out = [];
  let group = [];
  const flush = () => {
    if (group.length === 0) return;
    const time = group[0].start;
    const end = group[group.length - 1].end;
    out.push({
      id: `cap-auto-${out.length}-${Math.round(time * 1000)}`,
      auto: true,
      time: +time.toFixed(3),
      duration: +Math.max(0.4, end - time).toFixed(3),
      text: group.map((w) => w.text).join(' ').slice(0, 500),
      words: group.map((w) => ({ text: w.text, t: +(w.start - time).toFixed(3), d: +(w.end - w.start).toFixed(3) })),
    });
    group = [];
  };
  for (const w of words) {
    const prev = group[group.length - 1];
    if (prev && (w.start - prev.end > pause || w.end - group[0].start > maxDuration || group.length >= maxWords)) flush();
    group.push(w);
    if (/[.!?]$/.test(w.text)) flush();
  }
  flush();
  return out;
}

// Replace the auto captions with fresh ones from the transcript (manual
// captions stay).
export function rebuildAutoCaptions(project) {
  const manual = (project.captions || []).filter((c) => !c.auto);
  project.captions = [...manual, ...captionsFromTranscript(project)].sort((a, b) => a.time - b.time);
  if (project.transcript) project.transcript.captions = true;
  return project;
}
