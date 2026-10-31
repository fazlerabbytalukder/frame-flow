// SubRip (.srt) captions for an export. Caption times are already timeline
// time (they move with edits), so the file matches the exported video.

function stamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, w) => String(n).padStart(w, '0');
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)},${p(r, 3)}`;
}

// captions: [{ time, duration, text }]; totalDuration clips captions that run
// past the end of the video.
export function toSrt(captions, totalDuration = Infinity) {
  const cues = (captions || [])
    .filter((c) => c && typeof c.text === 'string' && c.text.trim() && c.time < totalDuration && c.duration > 0)
    .slice()
    .sort((a, b) => a.time - b.time);
  return cues
    .map((c, i) => {
      const end = Math.min(c.time + c.duration, totalDuration);
      // A blank line ends a cue in SRT, so collapse runs of newlines.
      const text = c.text.trim().replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n');
      return `${i + 1}\n${stamp(c.time)} --> ${stamp(end)}\n${text}\n`;
    })
    .join('\n');
}
