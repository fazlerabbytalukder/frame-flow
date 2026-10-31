import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clipSpeed, clipTimelineLength, totalDuration, clipOffset, resolve,
  splitAt, trimClip, deleteClip, moveClip, fadeAlphaAt, moveClipTo, transitionAt, transitionFor,
  isAddedClip, sourceToTimelineTimes, applySpeedToSourceRange, insertIndexAt,
} from '../../src/engine/timeline-engine.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

const project = (...clips) => ({
  clips: clips.map((c, i) => ({ id: `c${i}`, start: 0, speed: 1, ...c })),
});

test('clipSpeed falls back to 1 for missing or out-of-range speeds', () => {
  assert.equal(clipSpeed({}), 1);
  assert.equal(clipSpeed({ speed: 'x' }), 1);
  assert.equal(clipSpeed({ speed: 0 }), 1);
  assert.equal(clipSpeed({ speed: 10 }), 1);
  assert.equal(clipSpeed({ speed: 2 }), 2);
});

test('durations and offsets are speed-aware', () => {
  const { clips } = project({ duration: 4, speed: 2 }, { duration: 3 }, { duration: 2, speed: 0.5 });
  assert.equal(clipTimelineLength(clips[0]), 2);
  assert.equal(totalDuration(clips), 2 + 3 + 4);
  assert.equal(clipOffset(clips, 0), 0);
  assert.equal(clipOffset(clips, 2), 5);
  assert.equal(totalDuration([]), 0);
});

test('resolve maps timeline time to source time across clips', () => {
  const { clips } = project({ start: 10, duration: 4, speed: 2 }, { start: 0, duration: 3 });
  assert.equal(resolve([], 1), null);
  let r = resolve(clips, 1);
  assert.equal(r.index, 0);
  near(r.sourceTime, 12);
  r = resolve(clips, 2.5);
  assert.equal(r.index, 1);
  near(r.sourceTime, 0.5);
  // Clamps both ends.
  near(resolve(clips, -5).sourceTime, 10);
  r = resolve(clips, 999);
  assert.equal(r.index, 1);
  assert.ok(r.sourceTime < 3 && r.sourceTime > 2.99);
});

test('resolve never returns a source time outside its clip window', () => {
  const { clips } = project({ start: 1, duration: 2.3, speed: 1.5 }, { start: 5, duration: 1.1, speed: 0.5 });
  const total = totalDuration(clips);
  for (let t = 0; t <= total + 0.5; t += 1 / 30) {
    const r = resolve(clips, t);
    assert.ok(r.sourceTime >= r.clip.start - 1e-9);
    assert.ok(r.sourceTime < r.clip.start + r.clip.duration + 1e-9);
  }
});

test('splitAt splits in source seconds and preserves total duration', () => {
  const p = project({ start: 0, duration: 10, speed: 2 });
  assert.equal(splitAt(p, 2), true); // timeline 2s = source 4s at 2x
  assert.equal(p.clips.length, 2);
  near(p.clips[0].duration, 4);
  near(p.clips[1].start, 4);
  near(p.clips[1].duration, 6);
  assert.equal(p.clips[1].speed, 2);
  assert.notEqual(p.clips[0].id, p.clips[1].id);
  near(totalDuration(p.clips), 5);
});

test('splitAt refuses slivers shorter than the minimum clip', () => {
  const p = project({ duration: 5 });
  assert.equal(splitAt(p, 0.1), false);
  assert.equal(splitAt(p, 4.9), false);
  assert.equal(splitAt({ clips: [] }, 1), false);
  assert.equal(p.clips.length, 1);
});

test('trimClip clamps to asset bounds and minimum length', () => {
  const p = project({ start: 2, duration: 4 });
  trimClip(p, 'c0', 'start', -1, 10);
  assert.equal(p.clips[0].start, 0);
  assert.equal(p.clips[0].duration, 6);
  trimClip(p, 'c0', 'start', 99, 10);
  near(p.clips[0].duration, 0.2);
  trimClip(p, 'c0', 'end', 99, 10);
  near(p.clips[0].start + p.clips[0].duration, 10);
  trimClip(p, 'c0', 'end', -5, 10);
  near(p.clips[0].duration, 0.2);
  trimClip(p, 'nope', 'end', 1, 10); // unknown id is a no-op
});

test('deleteClip keeps at least one clip', () => {
  const p = project({ duration: 1 }, { duration: 2 });
  assert.equal(deleteClip(p, 'missing'), false);
  assert.equal(deleteClip(p, 'c0'), true);
  assert.equal(deleteClip(p, 'c1'), false);
  assert.equal(p.clips.length, 1);
});

test('moveClip reorders within bounds only', () => {
  const p = project({ duration: 1 }, { duration: 2 }, { duration: 3 });
  assert.equal(moveClip(p, 'c0', -1), false);
  assert.equal(moveClip(p, 'c2', 1), false);
  assert.equal(moveClip(p, 'c0', 1), true);
  assert.deepEqual(p.clips.map((c) => c.id), ['c1', 'c0', 'c2']);
});

test('added video clips are skipped by recording-time mapping but keep their length', () => {
  const clips = [
    { id: 'a', start: 0, duration: 2, speed: 1 },
    { id: 'v', assetId: 'added-x', start: 0, duration: 3, speed: 1 },
    { id: 'b', start: 2, duration: 2, speed: 1, assetId: 'screen-1' },
  ];
  assert.equal(isAddedClip(clips[1]), true);
  assert.equal(isAddedClip(clips[2]), false);
  assert.equal(isAddedClip(undefined), false);
  // Recording second 1 is in clip a; second 0.5 would also be inside the
  // added clip's window but that is a different file.
  assert.deepEqual(sourceToTimelineTimes(clips, [0.5, 2.5]), [0.5, 5.5]);
  const p = { clips: clips.map((c) => ({ ...c })) };
  applySpeedToSourceRange(p, 0, 10, 2);
  assert.deepEqual(p.clips.map((c) => c.speed), [2, 1, 2], 'the added clip keeps its speed');
});

test('inserting at the playhead: into a cut, or splitting the clip there', () => {
  const p = project({ duration: 2 }, { duration: 3, transition: { type: 'zoom', duration: 0.5 } });
  assert.equal(insertIndexAt(p, 0), 0, 'start');
  assert.equal(insertIndexAt(p, 2.1), 1, 'near the cut');
  assert.equal(insertIndexAt(p, 5), 2, 'end');
  assert.equal(p.clips.length, 2, 'no split for cuts');
  // Inside clip c1 at 3.5 s: split 1.5 s in, the new clip goes between.
  assert.equal(insertIndexAt(p, 3.5), 2);
  assert.deepEqual(p.clips.map((c) => [c.start, c.duration]), [[0, 2], [0, 1.5], [1.5, 1.5]]);
  assert.equal(p.clips[1].transition.type, 'zoom', 'the original cut keeps its transition');
  assert.equal(p.clips[2].transition, undefined, 'the new cut starts plain');
  // Too close to a clip edge to split: the nearer edge.
  const q = project({ duration: 2 }, { duration: 2 });
  assert.equal(insertIndexAt(q, 2.18, 0.15), 1);
  assert.equal(insertIndexAt(q, 3.9, 0.05), 2);
});

test('moveClipTo drops a clip at any position', () => {
  const p = project({ duration: 1 }, { duration: 2 }, { duration: 3 });
  assert.equal(moveClipTo(p, 'c0', 2), true);
  assert.deepEqual(p.clips.map((c) => c.id), ['c1', 'c2', 'c0']);
  assert.equal(moveClipTo(p, 'c0', 99), false, 'already last');
  assert.equal(moveClipTo(p, 'c2', -5), true);
  assert.deepEqual(p.clips.map((c) => c.id), ['c2', 'c1', 'c0']);
  assert.equal(moveClipTo(p, 'nope', 0), false);
});

test('transitions: each cut can have its own, others use the default', () => {
  const { clips } = project({ duration: 2 }, { duration: 2, transition: { type: 'zoom', duration: 1 } }, { duration: 2 });
  const fade = { type: 'fade', duration: 0.4 };
  // Cut 1 (t=2) is its own 1 s zoom; cut 2 (t=4) follows the default.
  assert.deepEqual(transitionAt(clips, 1.75, fade), { type: 'zoom', p: 0.5, dir: 'out', index: 1 });
  assert.deepEqual(transitionAt(clips, 2.25, fade), { type: 'zoom', p: 0.5, dir: 'in', index: 1 });
  assert.equal(transitionAt(clips, 4.1, fade).type, 'fade');
  assert.equal(transitionAt(clips, 4.1, { type: 'none' }), null);
  assert.equal(transitionAt(clips, 3, fade), null, 'nothing between cuts');
  // Fade still reports through fadeAlphaAt; other types do not.
  assert.equal(fadeAlphaAt(clips, 2, fade), 1);
  assert.equal(fadeAlphaAt(clips, 4, fade), 0);
  // An explicit cut overrides the default; unknown types fall back.
  clips[1].transition = { type: 'none' };
  assert.equal(transitionAt(clips, 2, fade), null);
  clips[1].transition = { type: 'spin' };
  assert.equal(transitionFor(clips, 1, fade).type, 'fade');
  assert.equal(transitionFor(clips, 1, { type: 'wipe', duration: 9 }).duration, 2);
});

test('a transition never takes more than half of a short clip', () => {
  const { clips } = project({ duration: 0.4 }, { duration: 3, transition: { type: 'slide', duration: 2 } });
  assert.equal(transitionAt(clips, 0.15, null), null, 'only the last 0.2 s of the short clip');
  assert.equal(transitionAt(clips, 0.3, null).dir, 'out');
  assert.equal(transitionAt(clips, 0.65, null), null);
});

test('fadeAlphaAt dips to 0 exactly at clip boundaries', () => {
  const { clips } = project({ duration: 2 }, { duration: 2 }, { duration: 2 });
  const fade = { type: 'fade', duration: 0.4 };
  assert.equal(fadeAlphaAt(clips, 2, fade), 0);
  assert.equal(fadeAlphaAt(clips, 4, fade), 0);
  near(fadeAlphaAt(clips, 2.1, fade), 0.5);
  assert.equal(fadeAlphaAt(clips, 0, fade), 1); // no fade-in at start
  assert.equal(fadeAlphaAt(clips, 6, fade), 1); // no fade-out at end
  assert.equal(fadeAlphaAt(clips, 2, { type: 'none' }), 1);
  assert.equal(fadeAlphaAt(clips.slice(0, 1), 1, fade), 1);
});
