// Recording session flow over IPC (chunk streaming, pause/resume, finalize,
// discard) and crash recovery from pending folders.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const recovery = require('../../electron/services/recovery-service');
const storage = require('../../electron/services/storage');
const { suite, invoke, rejects } = require('./harness');
const { sourceWebm } = require('./fixtures');
const { decodedDuration, probe, ffmpeg } = require('./media');

// MediaRecorder hands the renderer ~1 s blobs; emulate that with fixed slices.
function* chunksOf(buf, size) {
  for (let i = 0; i < buf.length; i += size) {
    const slice = buf.subarray(i, Math.min(buf.length, i + size));
    yield slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length);
  }
}

module.exports = (ctx) => {
  suite('Recording session (IPC)', (test) => {
    test('chunks are rejected when no recording is running', async () => {
      await rejects(invoke('recording:chunk', 'screen', new ArrayBuffer(8)), /No recording in progress/);
      await rejects(invoke('recording:finalize', {}), /No recording in progress/);
    });

    test('begin -> stream chunks -> pause/resume -> finalize produces a seekable project', async () => {
      const src = fs.readFileSync(await sourceWebm(ctx, { seconds: 4 }));
      const begin = await invoke('recording:begin');
      assert.equal(begin.ok, true);
      assert.equal(typeof begin.clicksAvailable, 'boolean');

      // The in-progress session is not offered for recovery.
      const before = await invoke('recording:list-pending');

      let n = 0;
      for (const chunk of chunksOf(src, 48 * 1024)) {
        await invoke('recording:chunk', 'screen', chunk);
        if (++n === 2) {
          await invoke('recording:pause');
          await invoke('recording:resume');
        }
      }
      const pendings = recovery.listPending();
      assert.ok(pendings.length >= 1, 'pending folder must exist on disk while recording');
      assert.ok(pendings.every((p) => !before.some((b) => b.id === p.id)));

      const project = await invoke('recording:finalize', {
        approxDuration: 4, micLabel: 'm'.repeat(500), systemAudio: true, mimeType: 'video/webm', cursorHidden: true,
      });
      assert.equal(project.recording.micLabel.length, 200);
      assert.equal(project.style.cursor.overlay, true);
      assert.ok(Math.abs(project.clips[0].duration - 4) < 0.25, `duration ${project.clips[0].duration}`);

      const dir = storage.projectDir(project.id);
      for (const f of ['project.json', 'media/screen.webm', 'media/screen-raw.webm', 'media/cursor.json']) {
        assert.ok(fs.existsSync(path.join(dir, f)), f);
      }
      // Raw stream preserved byte-for-byte.
      assert.ok(fs.readFileSync(path.join(dir, 'media/screen-raw.webm')).equals(src));
      // Remuxed file carries a container duration (MediaRecorder output does not).
      const info = await probe(path.join(dir, 'media/screen.webm'));
      assert.ok(info.duration > 3.5, `remuxed duration ${info.duration}`);
      assert.equal(info.audioCodec, 'opus');
      assert.equal(fs.existsSync(recovery.pendingDir(project.id)), false, 'pending folder removed');
      const cursor = await invoke('projects:read-cursor', project.id);
      assert.ok(Array.isArray(cursor.samples) && Array.isArray(cursor.clicks));
      if (begin.clicksAvailable) {
        // Keyboard data travels with the cursor track (privacy-reduced in keys.js).
        assert.ok(Array.isArray(cursor.shortcuts), 'shortcuts recorded');
        assert.ok(Array.isArray(cursor.typing), 'typing timestamps recorded');
        assert.ok(cursor.typing.every((t) => typeof t === 'number'), 'typing holds timestamps only');
      }
    });

    test('chunk validation rejects bad payloads mid-recording', async () => {
      await invoke('recording:begin');
      try {
        await rejects(invoke('recording:chunk', 'screen', new ArrayBuffer(0)), /Invalid chunk/);
        await rejects(invoke('recording:chunk', 'screen', 'not a buffer'), /Invalid chunk/);
        await rejects(invoke('recording:chunk', 'screen', Buffer.from('abc')), /Invalid chunk/);
        await rejects(invoke('recording:chunk', '../evil', new ArrayBuffer(8)), /chunk target/);
        await rejects(invoke('recording:chunk', 'screen', new ArrayBuffer(64 * 1024 * 1024 + 1)), /Invalid chunk/);
      } finally {
        await invoke('recording:discard');
      }
    });

    test('discard removes the pending session', async () => {
      const before = new Set(fs.readdirSync(path.join(storage.baseDir(), 'pending')));
      await invoke('recording:begin');
      await invoke('recording:chunk', 'screen', new ArrayBuffer(20_000));
      await invoke('recording:discard');
      const after = fs.readdirSync(path.join(storage.baseDir(), 'pending')).filter((d) => !before.has(d));
      assert.deepEqual(after, []);
    });

    test('a second begin keeps the abandoned session for recovery', async () => {
      await invoke('recording:begin');
      await invoke('recording:chunk', 'screen', new ArrayBuffer(20_000));
      const first = recovery.listPending().map((p) => p.id);
      await invoke('recording:begin');
      try {
        const listed = (await invoke('recording:list-pending')).map((p) => p.id);
        assert.ok(first.some((id) => listed.includes(id)), 'abandoned session should be recoverable');
      } finally {
        await invoke('recording:discard');
        for (const id of first) recovery.discard(id);
      }
    });
  });

  suite('Area recording + video import', (test) => {
    test('an area recording becomes a project cropped to that area (also after recovery)', async () => {
      const src = await sourceWebm(ctx, { seconds: 2 });
      const id = recovery.createPending({ sourceName: 'Area', area: { x: 0.25, y: 0.1, w: 0.5, h: 0.6 } });
      fs.copyFileSync(src, path.join(recovery.pendingDir(id), 'screen.webm'));
      const project = await invoke('recording:recover', id);
      const c = project.style.crop;
      const near = (a, b) => Math.abs(a - b) < 1e-9;
      assert.ok(near(c.l, 0.25) && near(c.r, 0.25) && near(c.t, 0.1) && near(c.b, 0.3), JSON.stringify(c));
      // A malformed area in meta.json is ignored rather than trusted.
      const id2 = recovery.createPending({ area: { x: 'evil', y: 0, w: 2, h: 2 } });
      fs.copyFileSync(src, path.join(recovery.pendingDir(id2), 'screen.webm'));
      assert.deepEqual((await invoke('recording:recover', id2)).style.crop, { l: 0, r: 0, t: 0, b: 0 });
    });

    test('import: H.264 MP4 is stream-copied; other formats are converted; both edit and export', async () => {
      const { importVideo } = require('../../electron/services/import-service');
      const { createProjectDocument } = require('../../electron/ipc/projects');
      const mp4 = path.join(ctx.fixturesDir, 'clip.mp4');
      const mkv = path.join(ctx.fixturesDir, 'clip.mkv');
      assert.equal((await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i',
        'sine=frequency=330', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4])).code, 0);
      assert.equal((await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=322x182:rate=25', '-t', '1.5',
        '-c:v', 'libvpx', mkv])).code, 0);

      for (const [file, seconds, hasAudio] of [[mp4, 2, true], [mkv, 1.5, false]]) {
        const project = await importVideo(file, { createProjectDocument });
        assert.equal(project.assets[0].path, 'media/screen.mp4');
        assert.ok(Math.abs(project.clips[0].duration - seconds) < 0.15, `${file}: ${project.clips[0].duration}`);
        const media = path.join(storage.projectDir(project.id), 'media/screen.mp4');
        const info = await probe(media);
        assert.equal(info.videoCodec, 'h264');
        assert.equal(info.audioCodec, hasAudio ? 'aac' : null);
        assert.ok(info.width % 2 === 0 && info.height % 2 === 0, 'even dimensions');
        // Loads through the normal path and exports with the imported audio.
        const loaded = await invoke('projects:load', project.id);
        assert.equal(loaded.project.name, path.basename(file, path.extname(file)));
        const { outputPath } = await invoke('export:start', {
          projectId: project.id, width: 320, height: 180, fps: 30, format: 'mp4', hardware: false,
          clips: [{ start: 0, duration: 1 }],
        });
        for (let i = 0; i < 30; i++) await invoke('export:frame', new ArrayBuffer(320 * 180 * 4));
        await invoke('export:finish');
        assert.equal((await probe(outputPath)).audioCodec, hasAudio ? 'aac' : null);
      }
    });

    test('import rejects unsupported or broken files and leaves nothing behind', async () => {
      const { importVideo } = require('../../electron/services/import-service');
      const { createProjectDocument } = require('../../electron/ipc/projects');
      const before = fs.readdirSync(storage.projectsDir()).length;
      const txt = path.join(ctx.fixturesDir, 'notes.txt');
      fs.writeFileSync(txt, 'hello');
      await rejects(importVideo(txt, { createProjectDocument }), /Unsupported video format/);
      const fake = path.join(ctx.fixturesDir, 'fake.mp4');
      fs.writeFileSync(fake, Buffer.alloc(5000, 3));
      await rejects(importVideo(fake, { createProjectDocument }), /No video stream/);
      const wav = path.join(ctx.fixturesDir, 'audio-only.mp4');
      await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine', '-t', '1', '-c:a', 'aac', wav]);
      await rejects(importVideo(wav, { createProjectDocument }), /No video stream/);
      assert.equal(fs.readdirSync(storage.projectsDir()).length, before);
    });
  });

  suite('Crash recovery', (test) => {
    test('a recording truncated mid-write (crash) is recovered into a playable project', async () => {
      const src = fs.readFileSync(await sourceWebm(ctx, { seconds: 4 }));
      const id = recovery.createPending({ sourceName: 'Crashed screen' });
      // Partial flush: the process died 60% of the way through, mid-cluster.
      const cut = Math.floor(src.length * 0.6) + 7;
      for (const chunk of chunksOf(src.subarray(0, cut), 32 * 1024)) {
        recovery.appendChunk(id, 'screen', Buffer.from(chunk));
      }
      recovery.writeCursorSnapshot(id, { samples: [{ t: 0, x: 0.5, y: 0.5 }], clicks: [] });

      const listed = await invoke('recording:list-pending');
      const entry = listed.find((p) => p.id === id);
      assert.ok(entry, 'crashed session listed for recovery');
      assert.equal(entry.bytes, cut);

      const project = await invoke('recording:recover', id);
      assert.equal(project.project.name, 'Crashed screen (recovered)');
      const media = path.join(storage.projectDir(project.id), 'media/screen.webm');
      const v = await decodedDuration(media, 'v');
      assert.ok(v > 1.5 && v < 4, `recovered video duration ${v}`);
      assert.ok(Math.abs(project.clips[0].duration - v) < 0.3);
      assert.equal(fs.existsSync(recovery.pendingDir(id)), false);
      assert.ok(!(await invoke('recording:list-pending')).some((p) => p.id === id));
    });

    test('a broken webcam track does not lose the screen recording', async () => {
      const src = await sourceWebm(ctx, { seconds: 2 });
      const id = recovery.createPending({});
      fs.copyFileSync(src, path.join(recovery.pendingDir(id), 'screen.webm'));
      fs.writeFileSync(path.join(recovery.pendingDir(id), 'webcam.webm'), Buffer.alloc(4096, 7));
      const project = await invoke('recording:recover', id);
      assert.equal(project.project.name, 'Recovered recording');
      assert.equal(project.assets.some((a) => a.type === 'webcam-recording'), false);
      assert.equal(project.style.webcam.enabled, false);
    });

    test('tiny or empty pending folders are not offered', async () => {
      const id = recovery.createPending({});
      recovery.appendChunk(id, 'screen', Buffer.alloc(500));
      const empty = recovery.createPending({});
      const ids = (await invoke('recording:list-pending')).map((p) => p.id);
      assert.ok(!ids.includes(id) && !ids.includes(empty));
      await invoke('recording:discard-pending', id);
      await invoke('recording:discard-pending', empty);
      assert.equal(fs.existsSync(recovery.pendingDir(id)), false);
    });

    test('garbage data fails recovery cleanly and keeps the pending data', async () => {
      const id = recovery.createPending({});
      recovery.appendChunk(id, 'screen', Buffer.alloc(50_000, 1));
      await rejects(invoke('recording:recover', id), /FFmpeg/);
      // The data goes back to the pending folder, still listed and discardable.
      const raw = path.join(recovery.pendingDir(id), 'screen.webm');
      assert.equal(fs.statSync(raw).size, 50_000, 'raw data must survive a failed recovery');
      assert.ok((await invoke('recording:list-pending')).some((p) => p.id === id), 'still offered for recovery');
      assert.equal(fs.existsSync(storage.projectDir(id)), false, 'no half-built project folder left behind');
      await invoke('recording:discard-pending', id);
      assert.equal(fs.existsSync(recovery.pendingDir(id)), false);
    });

    test('recovery ids are validated', async () => {
      await rejects(invoke('recording:recover', '../../x'), /Invalid project id/);
      await rejects(invoke('recording:discard-pending', 'C:\\x'), /Invalid project id/);
    });
  });
};
