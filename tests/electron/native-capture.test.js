// Cursor-free native capture: output matching, pauses as cuts, clock
// alignment, and finalizing a native pending session into a project.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const recovery = require('../../electron/services/recovery-service');
const storage = require('../../electron/services/storage');
const mediaService = require('../../electron/services/media-service');
const native = require('../../electron/services/native-capture');
const { buildProjectFromPending } = require('../../electron/ipc/recording');
const { suite } = require('./harness');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

function gray(fill) {
  return Buffer.alloc(32 * 18, fill);
}

module.exports = (ctx) => {
  suite('Native capture', (test) => {
    test('a display maps to the output with its pixel size, then the closest picture', () => {
      const outputs = [
        { index: 0, width: 1920, height: 1080, gray: gray(200) },
        { index: 1, width: 2560, height: 1440, gray: gray(20) },
        { index: 2, width: 1920, height: 1080, gray: gray(30) },
      ];
      assert.equal(native.matchOutput({ width: 2560, height: 1440, gray: gray(200) }, outputs).index, 1);
      assert.equal(native.matchOutput({ width: 1920, height: 1080, gray: gray(25) }, outputs).index, 2);
      assert.equal(native.matchOutput({ width: 1920, height: 1080, gray: gray(190) }, outputs).index, 0);
      // Unknown size: fall back to the picture across all outputs.
      assert.equal(native.matchOutput({ width: 1280, height: 720, gray: gray(22) }, outputs).index, 1);
      assert.equal(native.matchOutput({ width: 1, height: 1 }, []), null);
    });

    test('pauses become cuts; an empty recording still has one clip', () => {
      const clips = native.clipsExcludingPauses(10, [
        { start: 6, end: 7 },
        { start: 2, end: 3.5 },
      ]);
      assert.deepEqual(clips.map((c) => [c.start, c.duration]), [[0, 2], [3.5, 2.5], [7, 3]]);
      assert.deepEqual(clips.map((c) => c.id), ['clip-1', 'clip-2', 'clip-3']);
      // A pause running to the end, overlapping pauses, junk entries.
      assert.deepEqual(
        native.clipsExcludingPauses(10, [{ start: 8, end: 12 }, { start: 1, end: 3 }, { start: 2, end: 4 }, { start: 5 }])
          .map((c) => [c.start, c.duration]),
        [[0, 1], [4, 4]]
      );
      assert.deepEqual(native.clipsExcludingPauses(4, []).map((c) => [c.start, c.duration]), [[0, 4]]);
      assert.equal(native.clipsExcludingPauses(4, [{ start: 0, end: 9 }]).length, 1);
    });

    test('input tracks shift onto the video clock', () => {
      const shifted = native.shiftTrack(
        { samples: [{ t: 0, x: 0.1, y: 0.2 }], clicks: [{ t: 1, x: 0, y: 0, button: 1 }], typing: [2, 2.5], displayBounds: { x: 0 } },
        0.25
      );
      near(shifted.samples[0].t, 0.25);
      assert.equal(shifted.samples[0].x, 0.1);
      near(shifted.clicks[0].t, 1.25);
      assert.deepEqual(shifted.typing, [2.25, 2.75]);
      assert.deepEqual(shifted.displayBounds, { x: 0 });
    });

    test('capture leaves the cursor out; audio is delayed or trimmed to line up', () => {
      const args = native.captureArgs(1, 'out.mkv');
      assert.ok(args.some((a) => a.includes('ddagrab=output_idx=1') && a.includes('draw_mouse=0')));
      const late = mediaService.nativeMuxArgs({ videoPath: 'v.mkv', audioPath: 'a.webm', audioOffset: 0.5, outputPath: 'o.mp4' });
      assert.deepEqual(late.slice(late.indexOf('-itsoffset'), late.indexOf('-itsoffset') + 4), ['-itsoffset', '0.500', '-i', 'a.webm']);
      const early = mediaService.nativeMuxArgs({ videoPath: 'v.mkv', audioPath: 'a.webm', audioOffset: -0.25, outputPath: 'o.mp4' });
      assert.deepEqual(early.slice(early.indexOf('-ss'), early.indexOf('-ss') + 4), ['-ss', '0.250', '-i', 'a.webm']);
      const silent = mediaService.nativeMuxArgs({ videoPath: 'v.mkv', audioPath: null, outputPath: 'o.mp4' });
      assert.ok(!silent.includes('-c:a'));
    });

    test('a native session finalizes into an MP4 project with cuts, shifted cursor and webcam offset', async () => {
      const id = recovery.createPending({ sourceName: 'Native fixture', native: true });
      const dir = recovery.pendingDir(id);
      await mediaService.run([
        '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '4',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-f', 'matroska', path.join(dir, 'screen.mkv'),
      ]);
      await mediaService.run([
        '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3.5',
        '-c:a', 'libopus', path.join(dir, 'audio.webm'),
      ]);
      await mediaService.run([
        '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=30', '-t', '3.5',
        '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', path.join(dir, 'webcam.webm'),
      ]);
      recovery.writeCursorSnapshot(id, { samples: [{ t: 0, x: 0.5, y: 0.5 }], clicks: [{ t: 1, x: 0.4, y: 0.4, button: 1 }] });
      const v0 = 1_000_000;
      recovery.updateMeta(id, {
        videoStartWall: v0,
        audioStartWall: v0 + 500,
        webcamStartWall: v0 + 450,
        cursorStartWall: v0 + 200,
        pauses: [{ start: v0 + 1000, end: v0 + 2000 }],
      });

      const project = await buildProjectFromPending(id, { approxDuration: 4, micLabel: 'Mic', systemAudio: true });
      assert.equal(project.assets.find((a) => a.type === 'screen-recording').path, 'media/screen.mp4');
      assert.equal(project.recording.cursorHidden, true);
      assert.equal(project.recording.mimeType, 'video/mp4');
      near(project.recording.webcamOffset, 0.45);
      assert.ok(project.assets.some((a) => a.type === 'webcam-recording'));
      assert.deepEqual(project.clips.map((c) => [c.start, Math.round(c.duration * 10) / 10]), [[0, 1], [2, 2]]);

      const screenFile = storage.screenMediaPath(project.id);
      assert.ok(fs.existsSync(screenFile));
      assert.equal(await mediaService.hasAudioStream(screenFile), true);
      near(await mediaService.probeDurationSeconds(screenFile), 4, 0.15);

      const cursor = storage.readJson(path.join(storage.mediaDir(project.id), 'cursor.json'));
      near(cursor.samples[0].t, 0.2);
      near(cursor.clicks[0].t, 1.2);
      assert.equal(fs.existsSync(dir), false, 'pending folder removed');
    });
  });
};
