const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// All Frame Studio data lives under Documents/Frame Studio. Every path handed to
// the filesystem is resolved and checked against this root so a malformed
// project id or asset path from the renderer can never escape it.

const DIR_NAME = 'Frame Studio';
// The app was called Frame Studio before; its library is moved over on startup.
const LEGACY_DIR_NAME = 'FrameFlow';

function baseDir() {
  const docs = app.getPath('documents');
  const dir = path.join(docs, DIR_NAME);
  const legacy = path.join(docs, LEGACY_DIR_NAME);
  // If the move failed (files locked), keep using the old folder rather than
  // showing an empty library.
  if (!fs.existsSync(dir) && fs.existsSync(legacy)) return legacy;
  return dir;
}

function migrateLegacyDir() {
  const docs = app.getPath('documents');
  const dir = path.join(docs, DIR_NAME);
  const legacy = path.join(docs, LEGACY_DIR_NAME);
  if (fs.existsSync(dir) || !fs.existsSync(legacy)) return;
  try {
    fs.renameSync(legacy, dir);
  } catch {
    // Retried next launch; baseDir() falls back to the legacy folder meanwhile.
  }
}

function projectsDir() {
  return path.join(baseDir(), 'projects');
}

function ensureBaseDirs() {
  migrateLegacyDir();
  fs.mkdirSync(projectsDir(), { recursive: true });
}

function assertInsideBase(targetPath) {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(baseDir());
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes Frame Studio storage root');
  }
  return resolved;
}

const PROJECT_ID_RE = /^[a-z0-9-]{1,64}$/;

function assertProjectId(id) {
  if (typeof id !== 'string' || !PROJECT_ID_RE.test(id)) {
    throw new Error('Invalid project id');
  }
  return id;
}

function projectDir(projectId) {
  assertProjectId(projectId);
  return assertInsideBase(path.join(projectsDir(), projectId));
}

function projectFile(projectId) {
  return path.join(projectDir(projectId), 'project.json');
}

function mediaDir(projectId) {
  return path.join(projectDir(projectId), 'media');
}

function exportsDir(projectId) {
  return path.join(projectDir(projectId), 'exports');
}

function newProjectId() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const rand = Math.random().toString(36).slice(2, 6);
  return `rec-${stamp}-${rand}`;
}

// Atomic JSON write: write to a temp file, then rename over the target, so a
// crash mid-write never corrupts project.json.
function writeJsonAtomic(filePath, data) {
  const resolved = assertInsideBase(filePath);
  const tmp = resolved + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, resolved);
}

function readJson(filePath) {
  const resolved = assertInsideBase(filePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

// The recording's media file, from the saved project (imported videos are
// .mp4, recordings .webm). Always resolved inside the project folder.
function screenMediaPath(projectId) {
  try {
    const doc = readJson(projectFile(projectId));
    const asset = (doc.assets || []).find((a) => a.type === 'screen-recording');
    if (asset && typeof asset.path === 'string' && !asset.path.includes('..') && !path.isAbsolute(asset.path)) {
      return assertInsideBase(path.join(projectDir(projectId), asset.path));
    }
  } catch {
    // Fall through to the conventional location.
  }
  return path.join(mediaDir(projectId), 'screen.webm');
}

module.exports = {
  screenMediaPath,
  baseDir,
  projectsDir,
  ensureBaseDirs,
  assertInsideBase,
  assertProjectId,
  projectDir,
  projectFile,
  mediaDir,
  exportsDir,
  newProjectId,
  writeJsonAtomic,
  readJson,
};
