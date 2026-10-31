import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isFiller, wordsOnTimeline, fillerAndPauseCuts, wordRanges, mergeRanges, cutSourceRanges, captionsFromTranscript, rebuildAutoCaptions,
} from '../../src/engine/transcript.js';
import { totalDuration } from '../../src/engine/timeline-engine.js';

// "Hello everyone. Um, today I will show you. [long pause] Uh, first open settings."
const WORDS = [
  { text: 'Hello', start: 0.0, end: 0.4 },
  { text: 'everyone.', start: 0.4, end: 1.0 },
  { text: 'Um,', start: 1.8, end: 2.1 },
  { text: 'today', start: 2.5, end: 2.8 },
  { text: 'I', start: 2.8, end: 3.0 },
  { text: 'will', start: 3.0, end: 3.2 },
  { text: 'show', start: 3.2, end: 3.4 },
  { text: 'you.', start: 3.4, end: 3.7 },
  { text: 'Uh,', start: 6.0, end: 6.2 },
  { text: 'first', start: 6.4, end: 6.7 },
  { text: 'open', start: 6.7, end: 7.0 },
  { text: 'settings.', start: 7.0, end: 7.6 },
];

function project(clips = [{ id: 'c1', start: 0, duration: 10, speed: 1 }]) {
  return {
    clips,
    transcript: { words: WORDS.map((w) => ({ ...w })) },
    zoomEvents: [{ id: 'z1', time: 6.4, duration: 1.0 }],
    captions: [{ id: 'm1', time: 6.4, duration: 1.2, text: 'manual' }],
    annotations: [{ id: 'a1', time: 1.8, duration: 0.3 }],
    layouts: [],
  };
}

test('filler words are recognised regardless of punctuation and case', () => {
  for (const w of ['Um,', 'uh', 'UHH.', 'erm', 'Hmm?']) assert.ok(isFiller(w), w);
  for (const w of ['umbrella', 'I', 'hum', 'uhuh!x']) assert.ok(!isFiller(w), w);
});

test('words map to timeline times through cuts and speed changes', () => {
  // Second clip starts at 6 s source and plays at 2x.
  const p = project([
    { id: 'a', start: 0, duration: 4, speed: 1 },
    { id: 'b', start: 6, duration: 4, speed: 2 },
  ]);
  const words = wordsOnTimeline(p);
  assert.equal(words.length, WORDS.length);
  const first = words.find((w) => w.text === 'first');
  assert.ok(Math.abs(first.start - (4 + 0.4 / 2)) < 1e-9, `first at ${first.start}`);
  // A word whose source was cut away disappears.
  const p2 = project([{ id: 'a', start: 0, duration: 1.9, speed: 1 }]); // only a third of "Um" left
  assert.deepEqual(wordsOnTimeline(p2).map((w) => w.text), ['Hello', 'everyone.']);
});

test('filler and pause cuts: fillers removed, long pauses shortened to the kept gap', () => {
  const cuts = fillerAndPauseCuts(WORDS, { pause: 0.8, keep: 0.3 });
  // Um (1.8-2.1, plus the gap up to "today" capped at 0.25 s)
  assert.ok(cuts.some((c) => Math.abs(c.start - 1.8) < 1e-9 && Math.abs(c.end - 2.35) < 1e-9), JSON.stringify(cuts));
  // pause 3.7 -> 6.0 becomes 0.3 s
  const pause = cuts.find((c) => c.start > 3.7 && c.end <= 6.0 + 1e-9);
  assert.ok(pause && Math.abs(6.0 - 3.7 - (pause.end - pause.start) - 0.3) < 1e-9, JSON.stringify(cuts));
  assert.deepEqual(fillerAndPauseCuts(WORDS, { fillers: false, pauses: false }), []);
});

test('selected words become one padded range that never eats a neighbour', () => {
  const r = wordRanges(WORDS, [3, 4, 5]); // today I will
  assert.equal(r.length, 1);
  assert.ok(r[0].start >= WORDS[2].end && r[0].start <= WORDS[3].start);
  assert.ok(r[0].end <= WORDS[6].start && r[0].end >= WORDS[5].end);
  assert.equal(wordRanges(WORDS, [0, 2]).length, 2);
  assert.deepEqual(mergeRanges([{ start: 1, end: 2 }, { start: 1.5, end: 3 }, { start: 5, end: 6 }]), [{ start: 1, end: 3 }, { start: 5, end: 6 }]);
});

test('cutting words shortens the video and ripples later items', () => {
  const p = project();
  const before = totalDuration(p.clips);
  const removed = cutSourceRanges(p, [{ start: 1.8, end: 2.4 }]); // the "Um"
  assert.ok(Math.abs(removed - 0.6) < 1e-9);
  assert.ok(Math.abs(totalDuration(p.clips) - (before - 0.6)) < 1e-9);
  assert.deepEqual(p.clips.map((c) => [c.start, +(c.start + c.duration).toFixed(3)]), [[0, 1.8], [2.4, 10]]);
  assert.ok(Math.abs(p.zoomEvents[0].time - 5.8) < 1e-6, 'zoom moved earlier by the cut');
  assert.ok(Math.abs(p.captions[0].time - 5.8) < 1e-6, 'manual caption moved too');
  assert.equal(p.annotations.length, 0, 'annotation inside the cut is dropped');
  assert.ok(!wordsOnTimeline(p).some((w) => w.text === 'Um,'));
});

test('captions made from speech survive a cut even without the transcript flag', () => {
  const p = project();
  p.captions.push({ id: 'auto1', auto: true, time: 0, duration: 1, text: 'Hello everyone.' });
  cutSourceRanges(p, [{ start: 1.8, end: 2.4 }]);
  const auto = p.captions.filter((c) => c.auto);
  assert.ok(auto.length >= 3, 'rebuilt from the transcript instead of dropped');
  assert.ok(auto.some((c) => c.text.startsWith('today')));
  assert.equal(p.transcript.captions, true);
});

test('a cut never removes the whole edit', () => {
  const p = project([{ id: 'c1', start: 0, duration: 2, speed: 1 }]);
  assert.equal(cutSourceRanges(p, [{ start: 0, end: 5 }]), 0);
  assert.equal(p.clips.length, 1);
});

test('captions from speech: grouped, fillers skipped, word times kept relative', () => {
  const p = project();
  const caps = captionsFromTranscript(p, { maxWords: 7 });
  assert.ok(caps.length >= 3);
  assert.ok(caps.every((c) => c.auto));
  assert.ok(!caps.some((c) => /\b(Um|Uh)\b/.test(c.text)));
  assert.equal(caps[0].text, 'Hello everyone.');
  const today = caps.find((c) => c.text.startsWith('today'));
  assert.equal(today.words[0].t, 0);
  assert.ok(Math.abs(today.words[1].t - 0.3) < 1e-9);
  // Rebuild keeps manual captions and marks the transcript.
  rebuildAutoCaptions(p);
  assert.ok(p.captions.some((c) => c.id === 'm1'));
  assert.equal(p.transcript.captions, true);
  // Auto captions follow transcript cuts.
  cutSourceRanges(p, wordRanges(p.transcript.words, [3]));
  assert.ok(!p.captions.filter((c) => c.auto).some((c) => c.text.includes('today')));
});

test('added video clips have no transcript words and survive cuts untouched', async () => {
  const { wordsOnTimeline, cutSourceRanges } = await import('../../src/engine/transcript.js');
  const project = {
    clips: [
      { id: 'a', start: 0, duration: 2, speed: 1 },
      { id: 'v', assetId: 'added-x', start: 0, duration: 2, speed: 1 },
      { id: 'b', start: 2, duration: 2, speed: 1 },
    ],
    transcript: { words: [{ text: 'hello', start: 0.5, end: 0.9 }, { text: 'again', start: 2.5, end: 2.9 }] },
    zoomEvents: [], captions: [], annotations: [], layouts: [],
  };
  // "again" is at recording 2.5 s, which comes after the 2 s added clip.
  assert.deepEqual(wordsOnTimeline(project).map((w) => [w.text, +w.start.toFixed(2)]), [['hello', 0.5], ['again', 4.5]]);
  cutSourceRanges(project, [{ start: 0.5, end: 1 }]);
  const v = project.clips.find((c) => c.id === 'v');
  assert.deepEqual([v.start, v.duration], [0, 2], 'the added clip is not cut');
  assert.equal(project.clips.length, 4, 'clip a split around the cut');
});
