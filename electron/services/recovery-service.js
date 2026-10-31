const fs = require('fs');
const path = require('path');

const storage = require('./storage');

// Crash-safe recording: while a recording runs, its chunks are appended to a
// "pending" folder on disk (screen.webm / webcam.webm, or screen.mkv written by
// native capture plus audio.webm), together with metadata
// and periodic cursor snapshots. A clean stop finalizes the pending folder into
// a project and removes it; anything left behind after a crash shows up as a
// recoverable recording on the next launch.

function pendingRoot() {
  return path.join(storage.baseDir(), 'pending');
}

function pendingDir(id) {
  storage.assertProjectId(id);
  return storage.assertInsideBase(path.join(pendingRoot(), id));
}

function createPending(meta) {
  const id = storage.newProjectId();
  const dir = pendingDir(id);
  fs.mkdirSync(dir, { recursive: true });
  storage.writeJsonAtomic(path.join(dir, 'meta.json'), {
    startedAt: new Date().toISOString(),
    ...meta,
  });
  return id;
}

const CHUNK_TARGETS = { screen: 'screen.webm', webcam: 'webcam.webm', audio: 'audio.webm' };

// The screen video of a pending session: MediaRecorder WebM, or the Matroska
// file from native (cursor-free) capture.
const SCREEN_FILES = ['screen.webm', 'screen.mkv'];

function pendingScreenFile(id) {
  for (const name of SCREEN_FILES) {
    const file = path.join(pendingDir(id), name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function appendChunk(id, which, buffer) {
  const file = CHUNK_TARGETS[which];
  if (!file) throw new Error('Unknown chunk target');
  fs.appendFileSync(path.join(pendingDir(id), file), buffer);
}

function writeCursorSnapshot(id, data) {
  storage.writeJsonAtomic(path.join(pendingDir(id), 'cursor.json'), data);
}

// Merge fields into meta.json (timing of a running session).
function updateMeta(id, patch) {
  storage.writeJsonAtomic(path.join(pendingDir(id), 'meta.json'), { ...readMeta(id), ...patch });
}

function readMeta(id) {
  try {
    return storage.readJson(path.join(pendingDir(id), 'meta.json'));
  } catch {
    return {};
  }
}

// Pending recordings that actually contain data (candidates for recovery).
function listPending() {
  const root = pendingRoot();
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    try {
      storage.assertProjectId(e.name);
      const screen = pendingScreenFile(e.name);
      if (!screen) continue;
      const stats = fs.statSync(screen);
      if (stats.size < 10_000) continue; // too little data to be worth recovering
      out.push({
        id: e.name,
        bytes: stats.size,
        startedAt: readMeta(e.name).startedAt || stats.mtime.toISOString(),
      });
    } catch {
      // Ignore malformed entries.
    }
  }
  out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  return out;
}

function discard(id) {
  fs.rmSync(pendingDir(id), { recursive: true, force: true });
}

module.exports = {
  pendingDir,
  createPending,
  appendChunk,
  writeCursorSnapshot,
  readMeta,
  updateMeta,
  pendingScreenFile,
  listPending,
  discard,
};
