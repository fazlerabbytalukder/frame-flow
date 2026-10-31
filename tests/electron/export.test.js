// Export pipeline: raw RGBA frames -> FFmpeg, audio rebuilt from the clip
// sequence, aspect presets, GIF, cancel/restart, validation, disk-full guard.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const storage = require('../../electron/services/storage');
const { suite, invoke, rejects } = require('./harness');
const { makeProject } = require('./fixtures');
const { decodedDuration, probe, ffmpeg } = require('./media');
const { importMusic } = require('../../electron/ipc/projects');

function frame(w, h, i) {
  const buf = Buffer.alloc(w * h * 4);
  for (let p = 0; p < buf.length; p += 4) {
    buf[p] = (i * 7) & 255;
    buf[p + 1] = 128;
    buf[p + 2] = 255 - ((i * 7) & 255);
    buf[p + 3] = 255;
  }
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

async function exportFrames(opts, frames) {
  const { outputPath } = await invoke('export:start', opts);
  const started = Date.now();
  let result;
  try {
    for (let i = 0; i < frames; i++) await invoke('export:frame', frame(opts.width, opts.height, i));
    result = await invoke('export:finish');
  } catch (err) {
    // Free the export slot so one failure doesn't cascade into later tests.
    await invoke('export:cancel').catch(() => {});
    throw err;
  }
  assert.equal(result.outputPath, outputPath);
  return { ...result, ms: Date.now() - started };
}

const timelineLength = (clips) => clips.reduce((s, c) => s + c.duration / (c.speed || 1), 0);

module.exports = (ctx) => {
  const leakWarnings = [];
  process.on('warning', (w) => {
    if (w.name === 'MaxListenersExceededWarning') leakWarnings.push(w.message);
  });
  let project;
  const getProject = async () => (project ||= await makeProject(ctx, { seconds: 4 }));

  suite('Export (FFmpeg)', (test) => {
    test('MP4: speed-changed multi-clip timeline keeps audio in sync with video', async () => {
      const p = await getProject();
      const clips = [
        { start: 0, duration: 2, speed: 2 },   // 1.0 s on the timeline
        { start: 2.5, duration: 1, speed: 0.5 }, // 2.0 s
        { start: 1, duration: 1, speed: 1 },   // 1.0 s, reordered back in time
      ];
      const fps = 30;
      const total = timelineLength(clips);
      const { outputPath, bytes } = await exportFrames(
        { projectId: p.id, width: 320, height: 180, fps, format: 'mp4', clips, volume: 0.5 },
        Math.round(total * fps)
      );
      assert.ok(bytes > 1000);
      const info = await probe(outputPath);
      assert.equal(info.videoCodec, 'h264');
      assert.equal(info.audioCodec, 'aac');
      assert.equal(info.width, 320);
      assert.equal(info.height, 180);
      assert.equal(info.fps, 30);
      const v = await decodedDuration(outputPath, 'v');
      const a = await decodedDuration(outputPath, 'a');
      assert.ok(Math.abs(v - total) < 0.1, `video ${v} vs timeline ${total}`);
      assert.ok(Math.abs(a - v) < 0.1, `audio ${a} vs video ${v} (A/V drift)`);
      assert.ok(/yuv420p/.test(info.raw), 'yuv420p for broad player support');
    });

    test('typing speed-ups (3x/4x) keep audio in sync via chained atempo', async () => {
      const p = await getProject();
      const clips = [
        { start: 0, duration: 1, speed: 1 },
        { start: 1, duration: 2, speed: 4 }, // 0.5 s on the timeline
        { start: 3, duration: 0.9, speed: 3 }, // 0.3 s
      ];
      const fps = 30;
      const total = timelineLength(clips);
      const { outputPath } = await exportFrames(
        { projectId: p.id, width: 320, height: 180, fps, format: 'mp4', clips },
        Math.round(total * fps)
      );
      const v = await decodedDuration(outputPath, 'v');
      const a = await decodedDuration(outputPath, 'a');
      assert.ok(Math.abs(v - total) < 0.1, `video ${v} vs timeline ${total}`);
      assert.ok(Math.abs(a - v) < 0.1, `audio ${a} vs video ${v}`);
    });

    test('landscape, square and portrait exports keep their exact dimensions', async () => {
      const p = await getProject();
      for (const [w, h] of [[1280, 720], [720, 720], [720, 1280]]) {
        const { outputPath } = await exportFrames(
          { projectId: p.id, width: w, height: h, fps: 30, format: 'mp4', clips: [{ start: 0, duration: 0.5 }] },
          15
        );
        const info = await probe(outputPath);
        assert.deepEqual([info.width, info.height], [w, h]);
      }
    });

    test('GIF export produces a looping GIF and removes its temp MP4', async () => {
      const p = await getProject();
      const { outputPath, bytes } = await exportFrames(
        { projectId: p.id, width: 1280, height: 720, fps: 15, format: 'gif', clips: [{ start: 0, duration: 1 }] },
        15
      );
      assert.ok(outputPath.endsWith('.gif') && bytes > 0);
      const info = await probe(outputPath);
      assert.equal(info.videoCodec, 'gif');
      assert.equal(info.width, 1280, 'GIF keeps 720p (short side under the 1080 cap)');
      const leftovers = fs.readdirSync(storage.exportsDir(p.id)).filter((f) => f.includes('.tmp.'));
      assert.deepEqual(leftovers, []);
    });

    test('export without an audio track in the source still succeeds', async () => {
      const p = await getProject();
      fs.renameSync(path.join(storage.mediaDir(p.id), 'screen.webm'), path.join(storage.mediaDir(p.id), 'screen.bak'));
      try {
        const { outputPath } = await exportFrames(
          { projectId: p.id, width: 320, height: 180, fps: 30, format: 'mp4', clips: [{ start: 0, duration: 1 }] },
          30
        );
        assert.equal((await probe(outputPath)).audioCodec, null);
      } finally {
        fs.renameSync(path.join(storage.mediaDir(p.id), 'screen.bak'), path.join(storage.mediaDir(p.id), 'screen.webm'));
      }
    });

    test('cancel kills the encoder, deletes the partial file, and a new export works', async () => {
      const p = await getProject();
      const opts = { projectId: p.id, width: 320, height: 180, fps: 30, format: 'mp4', clips: [{ start: 0, duration: 2 }] };
      const { outputPath } = await invoke('export:start', opts);
      for (let i = 0; i < 20; i++) await invoke('export:frame', frame(320, 180, i));
      await invoke('export:cancel');
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(fs.existsSync(outputPath), false, 'partial export removed');
      await rejects(invoke('export:frame', frame(320, 180, 0)), /No export in progress/);
      await invoke('export:cancel'); // idempotent
      const again = await exportFrames(opts, 60);
      assert.ok(again.bytes > 0);
    });

    test('back-to-back exports within the same second never overwrite each other', async () => {
      const p = await getProject();
      const opts = { projectId: p.id, width: 64, height: 64, fps: 10, format: 'mp4', clips: [{ start: 0, duration: 0.5 }] };
      const outs = [];
      for (let i = 0; i < 3; i++) outs.push((await exportFrames(opts, 5)).outputPath);
      assert.equal(new Set(outs).size, 3, outs.join(', '));
      for (const o of outs) assert.ok(fs.statSync(o).size > 0);
    });

    test('GPU encoding: detected encoder produces a valid, in-sync H.264 file', async () => {
      const { hardware } = await invoke('export:encoders');
      console.log(`      gpu encoder: ${hardware || 'none (CPU fallback)'}`);
      const p = await getProject();
      const clips = [{ start: 0, duration: 2, speed: 1 }];
      const { outputPath } = await invoke('export:start', {
        projectId: p.id, width: 640, height: 360, fps: 30, format: 'mp4', clips, hardware: true, quality: 'balanced',
      }).then(async (r) => {
        assert.equal(r.encoder, hardware || 'libx264');
        for (let i = 0; i < 60; i++) await invoke('export:frame', frame(640, 360, i));
        return invoke('export:finish');
      });
      const info = await probe(outputPath);
      assert.equal(info.videoCodec, 'h264');
      assert.deepEqual([info.width, info.height], [640, 360]);
      const v = await decodedDuration(outputPath, 'v');
      const a = await decodedDuration(outputPath, 'a');
      assert.ok(Math.abs(v - 2) < 0.1 && Math.abs(a - v) < 0.1, `video ${v}, audio ${a}`);
    });

    test('quality presets trade size for fidelity; hardware:false forces x264', async () => {
      const p = await getProject();
      const sizes = {};
      for (const quality of ['high', 'small']) {
        const start = await invoke('export:start', {
          projectId: p.id, width: 640, height: 360, fps: 30, format: 'mp4',
          clips: [{ start: 0, duration: 1 }], hardware: false, quality,
        });
        assert.equal(start.encoder, 'libx264');
        // Noisy frames so the quality setting actually matters.
        for (let i = 0; i < 30; i++) {
          const buf = Buffer.alloc(640 * 360 * 4);
          for (let j = 0; j < buf.length; j++) buf[j] = (j * 7919 + i * 104729) % 251;
          await invoke('export:frame', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
        }
        sizes[quality] = (await invoke('export:finish')).bytes;
      }
      assert.ok(sizes.small < sizes.high * 0.8, `small ${sizes.small} vs high ${sizes.high}`);
    });

    test('copy-to-clipboard only accepts files in the project exports folder', async () => {
      const p = await getProject();
      await rejects(invoke('export:copy-to-clipboard', p.id, 'C:\\Windows\\win.ini'), /Invalid export path|escapes/);
      await rejects(invoke('export:copy-to-clipboard', p.id, storage.projectFile(p.id)), /Invalid export path/);
      await rejects(
        invoke('export:copy-to-clipboard', p.id, path.join(storage.exportsDir(p.id), 'export-nope.mp4')),
        /not found/
      );
      await rejects(invoke('export:copy-to-clipboard', '../x', 'a'), /Invalid project id/);
      await rejects(invoke('export:copy-to-clipboard', p.id, 42), /Invalid export path/);
    });

    test('concurrent starts cannot both win the export slot', async () => {
      const p = await getProject();
      const opts = { projectId: p.id, width: 64, height: 64, fps: 10, format: 'mp4', clips: [{ start: 0, duration: 1 }] };
      const results = await Promise.allSettled([invoke('export:start', opts), invoke('export:start', opts)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      await invoke('export:cancel');
    });

    test('recording with no audio stream exports (silent), and click sounds alone create a track', async () => {
      const p = await makeProject(ctx, { seconds: 2, audio: false });
      const silent = await exportFrames(
        { projectId: p.id, width: 320, height: 180, fps: 30, format: 'mp4', clips: [{ start: 0, duration: 2 }] },
        60
      );
      assert.equal((await probe(silent.outputPath)).audioCodec, null);

      const ticks = await exportFrames(
        {
          projectId: p.id, width: 320, height: 180, fps: 30, format: 'mp4', clips: [{ start: 0, duration: 2 }],
          audio: { clickSounds: true, clickTimes: [0.3, 0.31, 1.2, 99] },
        },
        60
      );
      assert.equal((await probe(ticks.outputPath)).audioCodec, 'aac');
      const a = await decodedDuration(ticks.outputPath, 'a');
      assert.ok(Math.abs(a - 2) < 0.15, `click track ${a}s should span the video`);
    });

    test('clips added from other videos export with their own sound (silence when they have none)', async () => {
      const { importClipVideo } = require('../../electron/services/import-service');
      const p = await makeProject(ctx, { seconds: 3 });
      const silent = path.join(ctx.fixturesDir, 'clip-silent.mp4');
      const loud = path.join(ctx.fixturesDir, 'clip-tone.mov');
      assert.equal((await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-t', '1.5', '-pix_fmt', 'yuv420p', silent])).code, 0);
      assert.equal((await ffmpeg([
        '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100',
        '-t', '2', '-c:v', 'mpeg4', '-c:a', 'pcm_s16le', loud,
      ])).code, 0);
      const a = await importClipVideo(p.id, silent);
      const b = await importClipVideo(p.id, loud);
      assert.match(a.id, /^added-/);
      assert.equal(a.path, `media/added/${a.id}.mp4`);
      assert.ok(Math.abs(a.duration - 1.5) < 0.1 && Math.abs(b.duration - 2) < 0.15, `${a.duration} ${b.duration}`);
      assert.equal((await probe(path.join(storage.projectDir(p.id), b.path))).videoCodec, 'h264', 'converted for playback');
      const doc = await invoke('projects:load', p.id);
      doc.assets.push(a, b);
      await invoke('projects:save', doc);

      const clips = [
        { start: 0, duration: 1, speed: 1 },
        { start: 0, duration: 1.5, speed: 1, assetId: a.id },
        { start: 0.5, duration: 1, speed: 1, assetId: b.id },
        // Unknown ids fall back to the recording rather than reading a renderer path.
        { start: 1, duration: 1, speed: 1, assetId: 'added-forged' },
      ];
      const fps = 30;
      const total = timelineLength(clips);
      const { outputPath } = await exportFrames(
        { projectId: p.id, width: 320, height: 180, fps, format: 'mp4', clips },
        Math.round(total * fps)
      );
      const v = await decodedDuration(outputPath, 'v');
      const au = await decodedDuration(outputPath, 'a');
      assert.ok(Math.abs(v - total) < 0.1, `video ${v} vs ${total}`);
      assert.ok(Math.abs(au - v) < 0.1, `audio ${au} must match video ${v}`);
      // The silent clip's stretch (1.0 - 2.5 s) is quiet; the tone (2.5 - 3.5 s) is not.
      const level = async (from, len) => {
        const r = await ffmpeg(['-ss', String(from), '-t', String(len), '-i', outputPath, '-af', 'volumedetect', '-f', 'null', '-']);
        return Number((/max_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr) || [])[1]);
      };
      const quiet = await level(1.2, 1.1);
      const tone = await level(2.6, 0.8);
      assert.ok(!(quiet > -60), `silent clip should be silent, max ${quiet} dB`);
      assert.ok(tone > -30, `added clip keeps its sound, max ${tone} dB`);
      await rejects(importClipVideo(p.id, path.join(ctx.fixturesDir, 'music.txt')), /Unsupported video format/);
    });

    test('music + denoise + loudness + clicks mix to exactly the video length', async () => {
      const p = await getProject();
      const wav = path.join(ctx.fixturesDir, 'music.wav');
      const gen = await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '1.3', wav]);
      assert.equal(gen.code, 0);
      const music = importMusic(p.id, wav);
      const doc = await invoke('projects:load', p.id);
      doc.style.audio = { ...doc.style.audio, music: { ...music, volume: 0.5 } };
      await invoke('projects:save', doc);

      const clips = [{ start: 0, duration: 3, speed: 1 }];
      const { outputPath } = await exportFrames(
        {
          projectId: p.id, width: 320, height: 180, fps: 30, format: 'mp4', clips,
          audio: { denoise: true, normalize: true, clickSounds: true, clickTimes: [0.5, 2], music: true, musicVolume: 0.5 },
        },
        90
      );
      const v = await decodedDuration(outputPath, 'v');
      const a = await decodedDuration(outputPath, 'a');
      assert.ok(Math.abs(v - 3) < 0.1, `video ${v}`);
      assert.ok(Math.abs(a - v) < 0.1, `audio ${a} vs video ${v} (music loops must be trimmed)`);
      const vol = await ffmpeg(['-i', outputPath, '-af', 'volumedetect', '-f', 'null', '-']);
      const mean = Number((/mean_volume: (-?[\d.]+) dB/.exec(vol.stderr) || [])[1]);
      assert.ok(mean > -40, `mixed audio should be audible, mean ${mean} dB`);
    });

    test('music path comes from the saved project, never from the renderer', async () => {
      const p = await makeProject(ctx, { seconds: 2 });
      // No music stored: music:true must be ignored, not fail.
      const { outputPath } = await exportFrames(
        {
          projectId: p.id, width: 320, height: 180, fps: 30, format: 'mp4', clips: [{ start: 0, duration: 1 }],
          audio: { music: true, musicPath: 'C:\\Windows\\Media\\tada.wav' },
        },
        30
      );
      const a = await decodedDuration(outputPath, 'a');
      assert.ok(Math.abs(a - 1) < 0.1);
      await rejects(
        invoke('projects:save', { ...(await invoke('projects:load', p.id)), style: { ...(await invoke('projects:load', p.id)).style, audio: { music: { path: '..\\..\\x.mp3' } } } }),
        /music path/
      );
    });

    test('captions are saved as .srt next to the export; paths are validated', async () => {
      const p = await getProject();
      const { outputPath } = await exportFrames(
        { projectId: p.id, width: 64, height: 64, fps: 10, format: 'mp4', clips: [{ start: 0, duration: 0.5 }] },
        5
      );
      const { srtPath } = await invoke('export:write-srt', p.id, outputPath, '1\n00:00:00,000 --> 00:00:01,000\nHi\n');
      assert.equal(srtPath, outputPath.replace(/\.mp4$/, '.srt'));
      assert.match(fs.readFileSync(srtPath, 'utf8'), /Hi/);
      await rejects(invoke('export:write-srt', p.id, storage.projectFile(p.id), 'x'), /Invalid export path/);
      await rejects(invoke('export:write-srt', p.id, outputPath, 42), /Invalid captions/);
      await rejects(invoke('export:write-srt', p.id, outputPath, 'x'.repeat(5 * 1024 * 1024 + 1)), /Invalid captions/);
    });

    test('silence detection finds pauses in the recording audio', async () => {
      const { detectSilences } = require('../../electron/services/media-service');
      const file = path.join(ctx.fixturesDir, 'talk-pause-talk.webm');
      // 1 s tone, 2.5 s silence, 1 s tone.
      const gen = await ffmpeg([
        '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i',
        "aevalsrc='if(lt(t,1)+gt(t,3.5),0.5*sin(2*PI*440*t),0)':s=48000:d=4.5",
        '-t', '4.5', '-c:v', 'libvpx', '-deadline', 'realtime', '-c:a', 'libopus', file,
      ]);
      assert.equal(gen.code, 0, gen.stderr.slice(-500));
      const silences = await detectSilences(file);
      assert.equal(silences.length, 1, JSON.stringify(silences));
      assert.ok(Math.abs(silences[0].start - 1) < 0.15 && Math.abs(silences[0].end - 3.5) < 0.15, JSON.stringify(silences));
      const silent = await makeProject(ctx, { seconds: 2, audio: false });
      assert.deepEqual(await invoke('projects:detect-silence', silent.id), []);
      await rejects(invoke('projects:detect-silence', '../x'), /Invalid project id/);
    });

    test('only one export runs at a time', async () => {
      const p = await getProject();
      const opts = { projectId: p.id, width: 64, height: 64, fps: 10, format: 'mp4', clips: [{ start: 0, duration: 1 }] };
      await invoke('export:start', opts);
      try {
        await rejects(invoke('export:start', opts), /already running/);
      } finally {
        await invoke('export:cancel');
      }
    });

    test('options and frames are validated', async () => {
      const p = await getProject();
      const ok = { projectId: p.id, width: 320, height: 180, fps: 30, format: 'mp4', clips: [{ start: 0, duration: 1 }] };
      await rejects(invoke('export:start', null), /Invalid export options/);
      await rejects(invoke('export:start', { ...ok, projectId: '../x' }), /project id/);
      await rejects(invoke('export:start', { ...ok, width: 8 }), /dimensions/);
      await rejects(invoke('export:start', { ...ok, height: 10000 }), /dimensions/);
      await rejects(invoke('export:start', { ...ok, width: 'abc' }), /dimensions/);
      await rejects(invoke('export:start', { ...ok, fps: 0 }), /frame rate/);
      await rejects(invoke('export:start', { ...ok, fps: 240 }), /frame rate/);
      await rejects(invoke('export:finish'), /No export in progress/);

      await invoke('export:start', ok);
      try {
        await rejects(invoke('export:frame', new ArrayBuffer(10)), /Bad frame size/);
        await rejects(invoke('export:frame', 'x'), /Bad frame size/);
      } finally {
        await invoke('export:cancel');
      }
    });

    test('a nearly-full disk blocks the export before encoding', async () => {
      const p = await getProject();
      const original = fs.promises.statfs;
      fs.promises.statfs = async () => ({ bsize: 4096, bavail: 1000 }); // ~4 MB free
      try {
        await rejects(
          invoke('export:start', { projectId: p.id, width: 64, height: 64, fps: 10, clips: [{ start: 0, duration: 1 }] }),
          /Not enough disk space/
        );
      } finally {
        fs.promises.statfs = original;
      }
      // Nothing left running.
      await invoke('export:start', { projectId: p.id, width: 64, height: 64, fps: 10, clips: [{ start: 0, duration: 1 }] });
      await invoke('export:cancel');
    });

    test('odd dimensions are rejected up front, not after rendering every frame', async () => {
      const p = await getProject();
      for (const format of ['mp4', 'gif']) {
        await rejects(
          invoke('export:start', { projectId: p.id, width: 321, height: 180, fps: 10, format, clips: [{ start: 0, duration: 1 }] }),
          /even/
        );
      }
    });

    test('throughput: 1080p30 encode speed (performance budget)', async () => {
      const p = await getProject();
      const frames = 60;
      const { ms } = await exportFrames(
        { projectId: p.id, width: 1920, height: 1080, fps: 30, format: 'mp4', clips: [{ start: 0, duration: 2 }] },
        frames
      );
      const fpsRate = (frames / ms) * 1000;
      console.log(`      perf: IPC+encode ${fpsRate.toFixed(1)} frames/s at 1920x1080 (${(ms / frames).toFixed(1)} ms/frame)`);
      assert.ok(fpsRate > 5, 'encoder slower than 5 fps at 1080p');
    });

    test('frame backpressure does not leak stdin listeners', () => {
      assert.deepEqual(leakWarnings, []);
    });
  });
};
