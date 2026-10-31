const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

const captureService = require('../services/capture-service');
const cursorService = require('../services/cursor-service');
const clickService = require('../services/click-service');
const mediaService = require('../services/media-service');
const recovery = require('../services/recovery-service');
const storage = require('../services/storage');
const { createProjectDocument } = require('./projects');
const areaSelect = require('../services/area-select');
const shortcutService = require('../services/shortcut-service');
const nativeCapture = require('../services/native-capture');

// Crash-safe recording flow:
//   1. renderer lists sources, user picks one      -> recording:list-sources / select-source
//   2. recording:begin                             -> pending folder created, cursor sampling
//   3. recording:chunk (every ~1s per track)       -> appended straight to disk
//   4. recording:finalize                          -> pending folder becomes a project
//   recording:discard abandons a session; recording:list-pending / recover / discard-pending
//   handle sessions left behind by a crash.
//
// Screen recordings on Windows use native capture (FFmpeg, cursor left out):
// main writes screen.mkv, the renderer streams only audio + webcam, and
// recording:media-started reports when those started so everything can be
// aligned to the video clock. Pausing doesn't stop native capture; pauses
// are stored and become cuts in the project.

let activePendingId = null;
let cursorFlushTimer = null;
let nativeSession = null; // { pauses: [{ start, end }] } (wall ms) while native capture runs

const MAX_CHUNK = 64 * 1024 * 1024;

function stopCursorFlush() {
  if (cursorFlushTimer) {
    clearInterval(cursorFlushTimer);
    cursorFlushTimer = null;
  }
}

// Build a project out of a pending folder (normal stop and crash recovery both
// land here). Moves media into place, remuxes, writes project.json, and removes
// the pending folder on success.
async function buildProjectFromPending(pendingId, opts) {
  const dir = recovery.pendingDir(pendingId);
  if (fs.existsSync(path.join(dir, 'screen.mkv'))) return buildNativeProject(pendingId, opts);
  const { approxDuration, micLabel, systemAudio, mimeType, cursorHidden } = opts;
  const pendingScreen = path.join(dir, 'screen.webm');
  if (!fs.existsSync(pendingScreen)) throw new Error('No recording data to save');

  const projectId = pendingId; // same id keeps the recovery story simple
  const mediaDir = storage.mediaDir(projectId);
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(storage.exportsDir(projectId), { recursive: true });

  // Raw stream is preserved untouched; the remux makes it seekable. FFmpeg
  // copes with truncated WebM from a crashed session.
  const rawPath = path.join(mediaDir, 'screen-raw.webm');
  fs.renameSync(pendingScreen, rawPath);
  const screenPath = path.join(mediaDir, 'screen.webm');
  try {
    await mediaService.remuxWebm(rawPath, screenPath);
  } catch (err) {
    // Put the data back so the session stays listed for recovery/discard
    // instead of stranding it in a project folder with no project.json.
    fs.renameSync(rawPath, pendingScreen);
    if (!fs.existsSync(storage.projectFile(projectId))) {
      fs.rmSync(storage.projectDir(projectId), { recursive: true, force: true });
    }
    throw err;
  }

  let hasWebcam = false;
  const pendingWebcam = path.join(dir, 'webcam.webm');
  if (fs.existsSync(pendingWebcam)) {
    const camRawPath = path.join(mediaDir, 'webcam-raw.webm');
    fs.renameSync(pendingWebcam, camRawPath);
    try {
      await mediaService.remuxWebm(camRawPath, path.join(mediaDir, 'webcam.webm'));
      hasWebcam = true;
    } catch {
      // A broken webcam track shouldn't lose the screen recording.
    }
  }

  const duration =
    (await mediaService.probeDurationSeconds(screenPath)) ||
    (typeof approxDuration === 'number' && approxDuration > 0 ? approxDuration : 1);

  const pendingCursor = path.join(dir, 'cursor.json');
  if (fs.existsSync(pendingCursor)) {
    fs.copyFileSync(pendingCursor, path.join(mediaDir, 'cursor.json'));
  } else {
    storage.writeJsonAtomic(path.join(mediaDir, 'cursor.json'), { samples: [] });
  }

  const meta = recovery.readMeta(pendingId);
  const project = createProjectDocument({
    projectId,
    duration,
    sourceName: meta.sourceName || null,
    // An area recording starts cropped to the selected region.
    crop: areaToCropSafe(meta.area),
    micLabel,
    systemAudio,
    mimeType,
    hasWebcam,
    cursorHidden,
  });

  storage.writeJsonAtomic(storage.projectFile(projectId), project);
  recovery.discard(pendingId);
  return project;
}

// A native-capture session: mux video + audio, shift the input track onto
// the video clock, turn pauses into cuts and record the webcam's offset.
async function buildNativeProject(pendingId, { approxDuration, micLabel, systemAudio }) {
  const dir = recovery.pendingDir(pendingId);
  const meta = recovery.readMeta(pendingId);
  const projectId = pendingId;
  const mediaDir = storage.mediaDir(projectId);
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(storage.exportsDir(projectId), { recursive: true });

  // Seconds on the video clock for a wall-clock time (ms).
  const v0 = Number(meta.videoStartWall);
  const toVideo = (wall) => (Number.isFinite(v0) && Number.isFinite(Number(wall)) ? (Number(wall) - v0) / 1000 : 0);

  const audioPath = path.join(dir, 'audio.webm');
  const hasAudio = fs.existsSync(audioPath) && fs.statSync(audioPath).size > 0;
  const screenPath = path.join(mediaDir, 'screen.mp4');
  try {
    await mediaService.muxNativeRecording({
      videoPath: path.join(dir, 'screen.mkv'),
      audioPath: hasAudio ? audioPath : null,
      audioOffset: toVideo(meta.audioStartWall),
      outputPath: screenPath,
    });
  } catch (err) {
    // Leave the pending session for recovery/discard.
    if (!fs.existsSync(storage.projectFile(projectId))) {
      fs.rmSync(storage.projectDir(projectId), { recursive: true, force: true });
    }
    throw err;
  }

  let hasWebcam = false;
  const pendingWebcam = path.join(dir, 'webcam.webm');
  if (fs.existsSync(pendingWebcam)) {
    try {
      await mediaService.remuxWebm(pendingWebcam, path.join(mediaDir, 'webcam.webm'));
      hasWebcam = true;
    } catch {
      // A broken webcam track shouldn't lose the screen recording.
    }
  }

  const duration =
    (await mediaService.probeDurationSeconds(screenPath)) ||
    (typeof approxDuration === 'number' && approxDuration > 0 ? approxDuration : 1);

  const pendingCursor = path.join(dir, 'cursor.json');
  const track = fs.existsSync(pendingCursor) ? storage.readJson(pendingCursor) : { samples: [] };
  storage.writeJsonAtomic(path.join(mediaDir, 'cursor.json'), nativeCapture.shiftTrack(track, toVideo(meta.cursorStartWall)));

  const pauses = (Array.isArray(meta.pauses) ? meta.pauses : []).map((p) => ({
    start: toVideo(p.start),
    // A pause still open when the app died runs to the end.
    end: p.end == null ? duration : toVideo(p.end),
  }));

  const project = createProjectDocument({
    projectId,
    duration,
    sourceName: meta.sourceName || null,
    crop: areaToCropSafe(meta.area),
    micLabel,
    systemAudio,
    mimeType: 'video/mp4',
    hasWebcam,
    cursorHidden: true,
    screenPath: 'media/screen.mp4',
    clips: nativeCapture.clipsExcludingPauses(duration, pauses),
    webcamOffset: hasWebcam ? toVideo(meta.webcamStartWall) : 0,
  });

  storage.writeJsonAtomic(storage.projectFile(projectId), project);
  recovery.discard(pendingId);
  return project;
}

function areaToCropSafe(area) {
  return areaSelect.areaToCrop(areaSelect.sanitizeArea(area));
}

function registerRecordingIpc() {
  ipcMain.handle('recording:list-sources', async () => {
    return captureService.listSources();
  });

  ipcMain.handle('recording:select-source', async (event, sourceId) => {
    if (typeof sourceId !== 'string' || sourceId.length > 128) {
      throw new Error('Invalid source id');
    }
    return captureService.selectSource(sourceId);
  });

  // Drag a rectangle on the selected display; null when cancelled.
  ipcMain.handle('recording:select-area', async () => {
    const desc = captureService.describeSelectedSource();
    if (!desc || desc.kind !== 'screen') throw new Error('Select a screen first');
    const area = await areaSelect.selectArea(desc.displayBounds);
    captureService.setArea(area);
    return area;
  });

  ipcMain.handle('recording:shortcut-status', async () => shortcutService.getStatus());

  ipcMain.handle('recording:clear-area', async () => {
    captureService.setArea(null);
    return { ok: true };
  });

  // Whether the selected source can be recorded without the cursor.
  ipcMain.handle('recording:capture-mode', async () => {
    const desc = captureService.describeSelectedSource();
    const native = Boolean(desc && desc.kind === 'screen') && (await nativeCapture.available());
    return { native };
  });

  ipcMain.handle('recording:begin', async (event, opts) => {
    const native = Boolean(opts && opts.native === true);
    if (activePendingId) {
      // A previous session that never finalized; keep its data for recovery.
      stopCursorFlush();
      cursorService.stop();
      clickService.stop();
      nativeCapture.abort();
      nativeSession = null;
    }
    const desc = captureService.describeSelectedSource();
    const area = desc && desc.kind === 'screen' ? captureService.getArea() : null;
    activePendingId = recovery.createPending({ sourceName: desc ? desc.name : null, area, native });
    if (native) {
      if (!desc || desc.kind !== 'screen') {
        recovery.discard(activePendingId);
        activePendingId = null;
        throw new Error('Cursor-free capture needs a screen source');
      }
      try {
        const started = await nativeCapture.start({
          sourceId: desc.id,
          outFile: path.join(recovery.pendingDir(activePendingId), 'screen.mkv'),
        });
        recovery.updateMeta(activePendingId, { videoStartWall: started.startWall });
        nativeSession = { pauses: [] };
      } catch (err) {
        recovery.discard(activePendingId);
        activePendingId = null;
        throw new Error(`Cursor-free capture failed: ${err.message}`);
      }
    }
    const cursorStarted = cursorService.start(desc ? desc.displayBounds : null);
    const clicksAvailable = clickService.start(desc ? desc.displayBounds : null);
    if (native) recovery.updateMeta(activePendingId, { cursorStartWall: cursorStarted.startedAt });

    // Periodic cursor snapshots so a crash loses at most a few seconds.
    const pendingId = activePendingId;
    cursorFlushTimer = setInterval(() => {
      try {
        recovery.writeCursorSnapshot(pendingId, {
          ...cursorService.peek(),
          ...clickService.peek(),
        });
      } catch {
        // Never let a snapshot failure disturb the recording.
      }
    }, 5000);

    return { ok: true, clicksAvailable, native };
  });

  // When the renderer's audio / webcam recorders actually started (wall ms).
  ipcMain.handle('recording:media-started', async (event, times) => {
    if (!activePendingId) throw new Error('No recording in progress');
    const patch = {};
    for (const key of ['audio', 'webcam']) {
      const v = times && times[key];
      if (v == null) continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v - Date.now()) > 60_000) {
        throw new Error('Invalid start time');
      }
      patch[`${key}StartWall`] = v;
    }
    recovery.updateMeta(activePendingId, patch);
    return { ok: true };
  });

  // Native capture keeps every stream running and records the pause instead.
  ipcMain.handle('recording:pause', async () => {
    if (nativeSession && activePendingId) {
      const last = nativeSession.pauses[nativeSession.pauses.length - 1];
      if (!last || last.end != null) nativeSession.pauses.push({ start: Date.now(), end: null });
      recovery.updateMeta(activePendingId, { pauses: nativeSession.pauses });
      return { ok: true };
    }
    cursorService.pause();
    clickService.pause();
    return { ok: true };
  });

  ipcMain.handle('recording:resume', async () => {
    if (nativeSession && activePendingId) {
      const last = nativeSession.pauses[nativeSession.pauses.length - 1];
      if (last && last.end == null) last.end = Date.now();
      recovery.updateMeta(activePendingId, { pauses: nativeSession.pauses });
      return { ok: true };
    }
    cursorService.resume();
    clickService.resume();
    return { ok: true };
  });

  ipcMain.handle('recording:chunk', async (event, which, buffer) => {
    if (!activePendingId) throw new Error('No recording in progress');
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0 || buffer.byteLength > MAX_CHUNK) {
      throw new Error('Invalid chunk');
    }
    if (which !== 'screen' && which !== 'webcam' && which !== 'audio') throw new Error('Invalid chunk target');
    recovery.appendChunk(activePendingId, which, Buffer.from(buffer));
    return { ok: true };
  });

  ipcMain.handle('recording:finalize', async (event, payload) => {
    if (!activePendingId) throw new Error('No recording in progress');
    const pendingId = activePendingId;
    activePendingId = null;
    stopCursorFlush();

    if (nativeSession) {
      const last = nativeSession.pauses[nativeSession.pauses.length - 1];
      if (last && last.end == null) last.end = Date.now();
      const stopped = await nativeCapture.stop();
      recovery.updateMeta(pendingId, {
        pauses: nativeSession.pauses,
        ...(stopped && stopped.startWall ? { videoStartWall: stopped.startWall } : {}),
      });
      nativeSession = null;
    }

    const cursor = cursorService.stop();
    const input = clickService.stop();
    recovery.writeCursorSnapshot(pendingId, {
      sampleRateHint: 60,
      displayBounds: cursor.bounds,
      samples: cursor.samples,
      ...input,
    });

    const p = payload && typeof payload === 'object' ? payload : {};
    const sourceDesc = captureService.describeSelectedSource();
    const project = await buildProjectFromPending(pendingId, {
      approxDuration: Number(p.approxDuration) || null,
      micLabel: typeof p.micLabel === 'string' ? p.micLabel.slice(0, 200) : null,
      systemAudio: Boolean(p.systemAudio),
      mimeType: typeof p.mimeType === 'string' ? p.mimeType.slice(0, 100) : 'video/webm',
      cursorHidden: Boolean(p.cursorHidden),
    });
    // Patch the name from the live source (recovery path has only meta.json).
    if (sourceDesc && sourceDesc.name) {
      project.project.name = sourceDesc.name;
      storage.writeJsonAtomic(storage.projectFile(project.id), project);
    }
    return project;
  });

  ipcMain.handle('recording:discard', async () => {
    stopCursorFlush();
    cursorService.stop();
    clickService.stop();
    await nativeCapture.stop().catch(() => nativeCapture.abort());
    nativeSession = null;
    if (activePendingId) {
      recovery.discard(activePendingId);
      activePendingId = null;
    }
    return { ok: true };
  });

  // --- crash recovery -----------------------------------------------------

  ipcMain.handle('recording:list-pending', async () => {
    // The active session is not a recovery candidate.
    return recovery.listPending().filter((p) => p.id !== activePendingId);
  });

  ipcMain.handle('recording:recover', async (event, pendingId) => {
    storage.assertProjectId(pendingId);
    if (pendingId === activePendingId) throw new Error('Recording still in progress');
    const meta = recovery.readMeta(pendingId);
    const project = await buildProjectFromPending(pendingId, {
      approxDuration: null,
      micLabel: null,
      systemAudio: false,
      mimeType: 'video/webm',
    });
    if (meta.sourceName) {
      project.project.name = `${meta.sourceName} (recovered)`;
    } else {
      project.project.name = 'Recovered recording';
    }
    storage.writeJsonAtomic(storage.projectFile(project.id), project);
    return project;
  });

  ipcMain.handle('recording:discard-pending', async (event, pendingId) => {
    storage.assertProjectId(pendingId);
    if (pendingId === activePendingId) throw new Error('Recording still in progress');
    recovery.discard(pendingId);
    return { ok: true };
  });
}

// Shutdown / crashed-renderer path: never leave FFmpeg grabbing the screen.
// The pending folder stays on disk for recovery.
function abortActiveCapture() {
  nativeCapture.abort();
}

module.exports = { registerRecordingIpc, buildProjectFromPending, abortActiveCapture };
