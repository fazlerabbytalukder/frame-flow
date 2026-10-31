// Cursor polish, keyboard classification (privacy), typing detection,
// speed-range splitting and the FFmpeg atempo chain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  removeShakes, prepareCursorTrack, idleOpacity, cursorTilt, activeShortcutsAt,
  detectTypingSegments, cursorWindow,
} from '../../src/engine/cursor-track.js';
import { applySpeedToSourceRange, totalDuration } from '../../src/engine/timeline-engine.js';

const require = createRequire(import.meta.url);
const { classifyKey, nameTable } = require('../../electron/services/keys.js');
const { atempoChain } = require('../../electron/services/media-service.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

test('cursor animation styles map to smoothing windows', () => {
  assert.equal(cursorWindow('none'), 0);
  assert.ok(cursorWindow('smooth') > cursorWindow('medium') && cursorWindow('medium') > cursorWindow('rapid'));
  assert.equal(cursorWindow(undefined), cursorWindow('medium'));
});

test('removeShakes holds still through tremor but follows real moves', () => {
  const s = [];
  for (let i = 0; i < 60; i++) s.push({ t: i / 60, x: 0.5 + (i % 2 ? 0.0015 : -0.0015), y: 0.5 });
  s.push({ t: 1.1, x: 0.7, y: 0.5 });
  const out = removeShakes(s);
  assert.ok(out.slice(0, 60).every((p) => p.x === out[0].x));
  assert.equal(out[60].x, 0.7);
  assert.deepEqual(removeShakes([]), []);
});

test('prepareCursorTrack is memoized per raw track and option', () => {
  const raw = { samples: [{ t: 0, x: 0, y: 0 }, { t: 1, x: 0.5, y: 0.5 }] };
  assert.equal(prepareCursorTrack(raw), prepareCursorTrack(raw));
  assert.notEqual(prepareCursorTrack(raw, { shakes: true }), prepareCursorTrack(raw));
  assert.equal(prepareCursorTrack(null), null);
  assert.deepEqual(prepareCursorTrack(raw).shortcuts, []);
});

test('idleOpacity fades out after stillness and returns when moving', () => {
  const samples = [];
  for (let i = 0; i <= 60; i++) samples.push({ t: i / 60, x: i / 60, y: 0.5 }); // moving 0..1s
  for (let i = 61; i <= 360; i++) samples.push({ t: i / 60, x: 1, y: 0.5 }); // still 1..6s
  samples.push({ t: 6.1, x: 0.5, y: 0.5 }); // moves again
  const track = prepareCursorTrack({ samples });
  assert.equal(idleOpacity(track, 0.5), 1);
  assert.equal(idleOpacity(track, 2.4), 1);
  assert.equal(idleOpacity(track, 3), 0);
  // Moving again: eases back in instead of popping.
  const back = idleOpacity(track, 6.17);
  assert.ok(back > 0 && back < 1, `fading back in (${back})`);
  assert.equal(idleOpacity(track, 6.3), 1);
  // A longer delay keeps it visible for longer.
  assert.equal(idleOpacity(track, 3, { delay: 3 }), 1);
  assert.equal(idleOpacity(track, 4.5, { delay: 3 }), 0);
});

test('cursorTilt leans into horizontal motion', () => {
  const right = Array.from({ length: 60 }, (_, i) => ({ t: i / 60, x: i / 60, y: 0.5 }));
  const left = right.map((s) => ({ ...s, x: 1 - s.x }));
  assert.ok(cursorTilt(right, 0.5, 0.1) > 0);
  assert.ok(cursorTilt(left, 0.5, 0.1) < 0);
  assert.ok(Math.abs(cursorTilt(right, 0.5, 0)) <= 0.35);
});

test('activeShortcutsAt shows the latest shortcut for its hold time', () => {
  const sc = [{ t: 1, keys: ['Ctrl', 'C'] }, { t: 1.5, keys: ['Ctrl', 'V'] }];
  assert.deepEqual(activeShortcutsAt(sc, 0.5), []);
  assert.deepEqual(activeShortcutsAt(sc, 1.2)[0].keys, ['Ctrl', 'C']);
  assert.deepEqual(activeShortcutsAt(sc, 1.6)[0].keys, ['Ctrl', 'V']);
  assert.deepEqual(activeShortcutsAt(sc, 3), []);
});

test('detectTypingSegments finds bursts and ignores short/sparse ones', () => {
  const burst = (from, n, step) => Array.from({ length: n }, (_, i) => from + i * step);
  const typing = [...burst(1, 30, 0.15), 9, 9.5, ...burst(20, 6, 0.1), ...burst(30, 25, 0.2)];
  const segs = detectTypingSegments(typing);
  assert.equal(segs.length, 2);
  near(segs[0].start, 0.8);
  near(segs[0].end, 1 + 29 * 0.15 + 0.2, 1e-9);
  assert.equal(segs[1].keys, 25);
  assert.deepEqual(detectTypingSegments([]), []);
});

test('applySpeedToSourceRange splits overlapping clips and preserves source coverage', () => {
  const p = { clips: [{ id: 'a', start: 0, duration: 10, speed: 1 }] };
  assert.equal(applySpeedToSourceRange(p, 3, 7, 4), 1);
  assert.deepEqual(p.clips.map((c) => [c.start, c.duration, c.speed]), [[0, 3, 1], [3, 4, 4], [7, 3, 1]]);
  near(totalDuration(p.clips), 3 + 1 + 3);
  assert.equal(new Set(p.clips.map((c) => c.id)).size, 3);
});

test('applySpeedToSourceRange absorbs slivers and skips untouched clips', () => {
  const p = { clips: [{ id: 'a', start: 0, duration: 5 }, { id: 'b', start: 20, duration: 5 }] };
  applySpeedToSourceRange(p, 0.1, 4.95, 2);
  assert.deepEqual(p.clips.map((c) => [c.id, c.start, c.duration, c.speed ?? 1]), [['a', 0, 5, 2], ['b', 20, 5, 1]]);
});

// uiohook keycodes used below (from UiohookKey).
const names = nameTable({ A: 30, S: 31, Ctrl: 29, Alt: 56, Shift: 42, Meta: 3675, Q: 16, ArrowLeft: 57419, F5: 63, Space: 57 });
const key = (keycode, mods = {}) => ({ keycode, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('keyboard: shortcuts are named, typing is anonymous, modifiers alone ignored', () => {
  assert.deepEqual(classifyKey(key(31, { ctrlKey: true }), names), { kind: 'shortcut', keys: ['Ctrl', 'S'] });
  assert.deepEqual(
    classifyKey(key(31, { ctrlKey: true, shiftKey: true }), names),
    { kind: 'shortcut', keys: ['Ctrl', 'Shift', 'S'] }
  );
  assert.deepEqual(classifyKey(key(30, { metaKey: true }), names), { kind: 'shortcut', keys: ['Win', 'A'] });
  assert.deepEqual(classifyKey(key(30), names), { kind: 'typing' });
  assert.deepEqual(classifyKey(key(30, { shiftKey: true }), names), { kind: 'typing' });
  assert.deepEqual(classifyKey(key(57), names), { kind: 'typing' });
  assert.equal(classifyKey(key(29, { ctrlKey: true }), names), null);
  assert.equal(classifyKey(key(57419), names), null);
  assert.equal(classifyKey(key(63), names), null);
  assert.equal(classifyKey(key(9999), names), null);
});

test('keyboard: AltGr (Ctrl+Alt) characters are never recorded by name', () => {
  // Ctrl+Alt+Q types "@" on German layouts.
  assert.deepEqual(classifyKey(key(16, { ctrlKey: true, altKey: true }), names), { kind: 'typing' });
});

test('atempoChain keeps every factor within 0.5..2 and multiplies to the speed', () => {
  assert.equal(atempoChain(1), '');
  for (const speed of [0.25, 0.5, 0.75, 1.5, 2, 3, 4]) {
    const factors = [...atempoChain(speed).matchAll(/atempo=([\d.]+)/g)].map((m) => Number(m[1]));
    assert.ok(factors.every((f) => f >= 0.5 && f <= 2), `${speed}: ${factors}`);
    near(factors.reduce((a, b) => a * b, 1), speed, 1e-3);
  }
});

test('export resolutions scale the short side for every aspect; GIF stops at 1080p', async () => {
  const { resolutionOptions } = await import('../../src/engine/export-planner.js');
  const dims = (w, h, f) => resolutionOptions(w, h, f).map((o) => [o.id, o.width, o.height]);
  assert.deepEqual(dims(1920, 1080), [['720p', 1280, 720], ['1080p', 1920, 1080], ['4k', 3840, 2160]]);
  assert.deepEqual(dims(1080, 1920), [['720p', 720, 1280], ['1080p', 1080, 1920], ['4k', 2160, 3840]]);
  assert.deepEqual(dims(1080, 1080, 'gif'), [['720p', 720, 720], ['1080p', 1080, 1080]]);
  for (const o of resolutionOptions(1366, 777)) assert.ok(o.width % 2 === 0 && o.height % 2 === 0);
});

const { buildAudioGraph } = require('../../electron/services/media-service.js');

test('audio graph: clips from several files — each from its own input, silence where a file has none', () => {
  const clips = [
    { start: 0, duration: 2, speed: 1, input: 1 },
    { start: 0, duration: 1.5, speed: 1, input: null },
    { start: 1, duration: 2, speed: 2, input: 2 },
    { start: 2, duration: 1, speed: 1, input: 1 },
  ];
  const g = buildAudioGraph({ clips, total: 5.5 }).graph;
  assert.match(g, /\[1:a\]asplit=2\[s0\]\[s3\]/);
  assert.match(g, /\[2:a\]asplit=1\[s2\]/);
  assert.match(g, /anullsrc=r=48000:cl=stereo,atrim=duration=1\.500,.*\[a1\]/);
  // Every piece is padded/trimmed to its timeline length: 2 s at 2x -> 1 s.
  assert.match(g, /\[s2\]atrim=start=1\.000:end=3\.000,asetpts=PTS-STARTPTS,atempo=2\.0000,aformat=[^,]+,apad=whole_dur=1\.000,atrim=duration=1\.000\[a2\]/);
  assert.match(g, /\[a0\]\[a1\]\[a2\]\[a3\]concat=n=4:v=0:a=1\[voice\]/);
  // One file only keeps the original single-input graph.
  const single = buildAudioGraph({ voiceInput: 1, clips: [{ start: 0, duration: 2, speed: 1 }], total: 2 }).graph;
  assert.doesNotMatch(single, /anullsrc|aformat/);
});

test('audio graph: nothing to mix -> null; voice only -> direct; extras -> amix trimmed to video', () => {
  assert.equal(buildAudioGraph({}), null);
  const clips = [{ start: 0, duration: 2, speed: 1 }, { start: 3, duration: 2, speed: 2 }];
  const voice = buildAudioGraph({ voiceInput: 1, clips, total: 3 });
  assert.match(voice.graph, /\[1:a\]asplit=2/);
  assert.match(voice.graph, /atempo=2\.0000/);
  // Output is always padded + trimmed to the exact video length (-shortest).
  assert.match(voice.graph, /\[voice\]apad=whole_dur=3\.000,atrim=0:3\.000\[aout\]/);
  assert.doesNotMatch(voice.graph, /afftdn|loudnorm|amix/);

  const all = buildAudioGraph({
    voiceInput: 1, clips, total: 3, denoise: true, normalize: true,
    clickInput: 2, clickTimes: [0.5, 1.25], musicInput: 3, musicVolume: 0.3,
  });
  assert.match(all.graph, /afftdn/);
  assert.match(all.graph, /loudnorm=.*,aresample=48000\[voice\]/);
  assert.match(all.graph, /adelay=500:all=1/);
  assert.match(all.graph, /adelay=1250:all=1/);
  assert.match(all.graph, /\[3:a\]atrim=0:3\.000.*volume=0\.30.*afade=t=out/);
  assert.match(all.graph, /amix=inputs=3:normalize=0/);
  // Each mix input is padded/trimmed to the video length BEFORE amix.
  assert.match(all.graph, /\[voice\]apad=whole_dur=3\.000,atrim=0:3\.000\[p0\]/);
  assert.match(all.graph, /\[p0\]\[p1\]\[p2\]amix=inputs=3:normalize=0:duration=longest:dropout_transition=0\[aout\]/);

  // No recording audio: clicks alone still produce a track.
  const clicksOnly = buildAudioGraph({ clickInput: 1, clickTimes: [0.2], total: 2 });
  assert.match(clicksOnly.graph, /\[1:a\]volume=0\.60,asplit=1\[k0\]/);
  // A click track ends at its last tick; padding stops -shortest cutting the video.
  assert.match(clicksOnly.graph, /\[clicks\]apad=whole_dur=2\.000,atrim=0:2\.000\[aout\]/);
});

test('sourceToTimelineTimes maps clicks through trims, speed and reordering', async () => {
  const { sourceToTimelineTimes } = await import('../../src/engine/timeline-engine.js');
  const clips = [
    { start: 4, duration: 2, speed: 2 }, // source 4..6 -> timeline 0..1
    { start: 0, duration: 2, speed: 1 }, // source 0..2 -> timeline 1..3
  ];
  assert.deepEqual(sourceToTimelineTimes(clips, [5, 1, 3, 4]), [0, 0.5, 2]); // 3 was trimmed away
  assert.deepEqual(sourceToTimelineTimes(clips, []), []);
});
