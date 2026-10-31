// Builds real projects through the same code path a recording takes
// (pending folder -> buildProjectFromPending), so fixtures exercise the
// remux, probe and project-document logic rather than bypassing it.
const fs = require('fs');
const path = require('path');

const recovery = require('../../electron/services/recovery-service');
const { buildProjectFromPending } = require('../../electron/ipc/recording');
const { makeWebm } = require('./media');

const cache = new Map();

async function sourceWebm(ctx, opts = {}) {
  const key = JSON.stringify(opts);
  if (!cache.has(key)) {
    const file = path.join(ctx.fixturesDir, `source-${cache.size}.webm`);
    cache.set(key, makeWebm(file, opts));
  }
  return cache.get(key);
}

async function makeProject(ctx, { seconds = 4, webcam = false, cursor = true, audio = true } = {}) {
  const src = await sourceWebm(ctx, audio ? { seconds } : { seconds, audio: false });
  const id = recovery.createPending({ sourceName: 'Fixture screen' });
  const dir = recovery.pendingDir(id);
  fs.copyFileSync(src, path.join(dir, 'screen.webm'));
  if (webcam) {
    fs.copyFileSync(await sourceWebm(ctx, { seconds, size: '320x240', audio: false }), path.join(dir, 'webcam.webm'));
  }
  if (cursor) {
    const samples = Array.from({ length: seconds * 60 }, (_, i) => ({ t: i / 60, x: (i % 60) / 60, y: 0.5 }));
    recovery.writeCursorSnapshot(id, { samples, clicks: [{ t: 1, x: 0.5, y: 0.5, button: 1 }] });
  }
  return buildProjectFromPending(id, {
    approxDuration: seconds,
    micLabel: 'Fixture mic',
    systemAudio: true,
    mimeType: 'video/webm;codecs=vp8,opus',
    cursorHidden: true,
  });
}

module.exports = { sourceWebm, makeProject };
