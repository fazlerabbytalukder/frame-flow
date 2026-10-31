const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

const storage = require('../services/storage');
const mediaService = require('../services/media-service');

// The renderer composites every frame (same engine as the preview) and streams
// raw RGBA buffers here; FFmpeg encodes them to MP4 with audio rebuilt from the
// clip sequence. GIF exports encode to a temp MP4 first, then convert with a
// generated palette. One export session at a time.

let active = null;
let starting = false;

const QUALITIES = ['high', 'balanced', 'small'];
const MIN_HW_SIDE = 144;

// GIFs above 1080p are impractically large; the short side is capped there.
const GIF_MAX_SHORT_SIDE = 1080;

// Windows file-drop clipboard via PowerShell's Set-Clipboard -LiteralPath. The
// path is passed base64-encoded inside -EncodedCommand, never interpolated into
// a shell string, and has already been validated to lie in an exports folder.
function copyFileToClipboard(absPath) {
  const { spawn } = require('child_process');
  const literal = absPath.replace(/'/g, "''");
  const script = `Set-Clipboard -LiteralPath '${literal}'`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Could not copy to clipboard'))));
  });
}

// Kill the encoder and delete its partial output. Windows refuses to delete a
// file FFmpeg still has open, so wait for the process to exit first.
async function cancelActive() {
  if (!active) return;
  const session = active;
  active = null;
  try { session.encoder.child.kill('SIGKILL'); } catch {}
  await session.encoder.done.catch(() => {});
  for (const p of [session.videoPath, session.finalPath]) {
    try { fs.rmSync(p, { force: true }); } catch {}
  }
}

// An existing exported video of this project, validated: the renderer can only
// point at files Frame Studio itself wrote into the project's exports folder.
function exportFileOf(projectId, filePath) {
  storage.assertProjectId(projectId);
  if (typeof filePath !== 'string') throw new Error('Invalid export path');
  const abs = storage.assertInsideBase(path.resolve(filePath));
  if (path.dirname(abs) !== storage.exportsDir(projectId) || !/^export-[\w-]+\.(mp4|gif)$/.test(path.basename(abs))) {
    throw new Error('Invalid export path');
  }
  if (!fs.existsSync(abs)) throw new Error('Export file not found');
  return abs;
}

const MAX_CLICK_SOUNDS = 400;

// Audio options from the renderer, validated. The music file path is never
// taken from the renderer: it is read from the saved project document.
function audioOptions(projectId, raw, clips) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const total = (clips || []).reduce((s, c) => s + c.duration / c.speed, 0);
  const out = {
    denoise: a.denoise === true,
    normalize: a.normalize === true,
    voice: mediaService.VOICE_MODES.includes(a.voice) ? a.voice : null,
    clickSounds: a.clickSounds === true,
    clickVolume: Number.isFinite(Number(a.clickVolume)) ? Number(a.clickVolume) : 0.6,
    musicVolume: Number.isFinite(Number(a.musicVolume)) ? Number(a.musicVolume) : 0.25,
    clickTimes: [],
    musicPath: null,
  };
  if (out.clickSounds && Array.isArray(a.clickTimes)) {
    let last = -1;
    for (const t of a.clickTimes.map(Number).filter((t) => Number.isFinite(t) && t >= 0 && t <= total).sort((x, y) => x - y)) {
      if (t - last < 0.05) continue; // double-click bounce: one tick
      out.clickTimes.push(t);
      last = t;
      if (out.clickTimes.length >= MAX_CLICK_SOUNDS) break;
    }
  }
  if (a.music === true) {
    try {
      const doc = storage.readJson(storage.projectFile(projectId));
      const rel = doc.style && doc.style.audio && doc.style.audio.music && doc.style.audio.music.path;
      if (typeof rel === 'string' && !rel.includes('..') && !path.isAbsolute(rel)) {
        out.musicPath = storage.assertInsideBase(path.join(storage.projectDir(projectId), rel));
      }
    } catch {
      // No music rather than a failed export.
    }
  }
  return out;
}

function validateClips(clips) {
  if (!Array.isArray(clips) || clips.length === 0 || clips.length > 500) return null;
  const out = [];
  for (const c of clips) {
    const start = Number(c && c.start);
    const duration = Number(c && c.duration);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration <= 0) {
      return null;
    }
    const speed = Number(c && c.speed);
    out.push({
      start,
      duration,
      speed: Number.isFinite(speed) && speed >= 0.25 && speed <= 4 ? speed : 1,
      assetId: typeof c.assetId === 'string' && /^[\w-]{1,80}$/.test(c.assetId) ? c.assetId : null,
    });
  }
  return out;
}

// Clips added from other videos get the absolute path of their file, read
// from the saved project (never from the renderer). Recording clips get none:
// the encoder uses the screen recording for them.
function withClipSources(projectId, clips) {
  if (!clips) return clips;
  const files = new Map();
  try {
    const doc = storage.readJson(storage.projectFile(projectId));
    for (const a of doc.assets || []) {
      if (a && a.type === 'video' && typeof a.id === 'string' && typeof a.path === 'string' && !a.path.includes('..') && !path.isAbsolute(a.path)) {
        files.set(a.id, storage.assertInsideBase(path.join(storage.projectDir(projectId), a.path)));
      }
    }
  } catch {
    // No added clips resolvable: they export silent rather than failing.
  }
  return clips.map(({ assetId, ...c }) => (files.has(assetId) ? { ...c, path: files.get(assetId) } : c));
}

// Refuse to start an export when the disk is nearly full — a half-written
// file helps nobody.
const MIN_FREE_BYTES = 500 * 1024 * 1024;

async function assertDiskSpace(dir) {
  try {
    const stats = await fs.promises.statfs(dir);
    const free = stats.bsize * stats.bavail;
    if (free < MIN_FREE_BYTES) {
      throw new Error(
        `Not enough disk space: ${(free / 1024 / 1024).toFixed(0)} MB free, ` +
        `at least ${(MIN_FREE_BYTES / 1024 / 1024).toFixed(0)} MB needed`
      );
    }
  } catch (err) {
    if (String(err.message || '').startsWith('Not enough disk space')) throw err;
    // statfs unavailable: don't block the export over a failed check.
  }
}

function registerExportIpc() {
  ipcMain.handle('export:start', async (event, opts) => {
    if (active || starting) throw new Error('An export is already running');
    // Reserve the slot before any await so two quick starts can't both pass.
    starting = true;
    try {
      return await startExport(opts);
    } finally {
      starting = false;
    }
  });

  ipcMain.handle('export:encoders', async () => ({ hardware: await mediaService.detectHardwareEncoder() }));

  // Put the exported file on the clipboard as a file (paste into chat, mail,
  // Explorer). Only files inside a project's exports folder are allowed.
  ipcMain.handle('export:copy-to-clipboard', async (event, projectId, filePath) => {
    await copyFileToClipboard(exportFileOf(projectId, filePath));
    return { ok: true };
  });

  // Save captions as an .srt next to an exported video (same base name).
  ipcMain.handle('export:write-srt', async (event, projectId, videoPath, srt) => {
    const abs = exportFileOf(projectId, videoPath);
    if (typeof srt !== 'string' || srt.length > 5 * 1024 * 1024) throw new Error('Invalid captions');
    const srtPath = abs.replace(/\.(mp4|gif)$/, '.srt');
    fs.writeFileSync(srtPath, srt, 'utf8');
    return { srtPath };
  });

  async function startExport(opts) {
    if (!opts || typeof opts !== 'object') throw new Error('Invalid export options');

    const { projectId, width, height, fps, format, clips, volume } = opts;
    storage.assertProjectId(projectId);
    const w = Math.floor(Number(width));
    const h = Math.floor(Number(height));
    const rate = Math.floor(Number(fps));
    if (!(w >= 16 && w <= 7680 && h >= 16 && h <= 7680)) throw new Error('Invalid export dimensions');
    // yuv420p H.264 (also the GIF intermediate) needs even dimensions.
    if (w % 2 || h % 2) throw new Error('Export dimensions must be even');
    if (!(rate >= 1 && rate <= 120)) throw new Error('Invalid frame rate');
    const fmt = format === 'gif' ? 'gif' : 'mp4';
    const clipWindows = withClipSources(projectId, validateClips(clips));

    const exportsDir = storage.exportsDir(projectId);
    fs.mkdirSync(exportsDir, { recursive: true });
    await assertDiskSpace(exportsDir);
    // Suffix -2, -3, ... so exports within the same second never overwrite.
    const base = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const taken = (s) => ['mp4', 'gif'].some((ext) => fs.existsSync(path.join(exportsDir, `export-${s}.${ext}`)));
    let stamp = base;
    for (let n = 2; taken(stamp); n++) stamp = `${base}-${n}`;

    const finalPath = path.join(exportsDir, `export-${stamp}.${fmt}`);
    // GIF renders go through an intermediate MP4 next to the final file.
    const videoPath = fmt === 'gif' ? path.join(exportsDir, `export-${stamp}.tmp.mp4`) : finalPath;
    const audioSourcePath = storage.screenMediaPath(projectId);

    const quality = QUALITIES.includes(opts.quality) ? opts.quality : 'high';
    // GPU encoding unless the user turned it off. GIF intermediates always use
    // x264: they are re-encoded anyway and need predictable quality.
    // GPU encoders reject tiny frames (AMF fails at 64 px), so very small
    // exports always use x264.
    let codec = 'libx264';
    if (fmt === 'mp4' && opts.hardware !== false && Math.min(w, h) >= MIN_HW_SIDE) {
      codec = (await mediaService.detectHardwareEncoder()) || 'libx264';
    }

    const encoder = await mediaService.startRawFrameEncoder({
      width: w,
      height: h,
      fps: rate,
      // GIFs have no audio; skip the filter graph entirely.
      audioSourcePath: fmt === 'gif' ? null : audioSourcePath,
      clips: clipWindows,
      volume: Number.isFinite(Number(volume)) ? Number(volume) : 1,
      outputPath: videoPath,
      encoder: codec,
      quality: fmt === 'gif' ? 'high' : quality,
      audio: fmt === 'gif' ? {} : audioOptions(projectId, opts.audio, clipWindows),
    });

    active = {
      encoder,
      format: fmt,
      videoPath,
      finalPath,
      width: w,
      height: h,
      expectedBytes: w * h * 4,
    };

    // Surface encoder failures to the frame/finish handlers.
    encoder.done.catch(() => {});

    return { outputPath: finalPath, encoder: codec };
  }

  ipcMain.handle('export:frame', async (event, frame) => {
    if (!active) throw new Error('No export in progress');
    if (!(frame instanceof ArrayBuffer) || frame.byteLength !== active.expectedBytes) {
      throw new Error('Bad frame size');
    }
    const session = active;
    const stdin = session.encoder.child.stdin;
    try {
      if (stdin.destroyed) throw new Error('Encoder closed unexpectedly');
      const ok = stdin.write(Buffer.from(frame));
      if (!ok) {
        // Remove whichever listener did not fire, or one leaks per frame.
        await new Promise((resolve, reject) => {
          const onDrain = () => {
            stdin.off('error', onError);
            resolve();
          };
          const onError = (err) => {
            stdin.off('drain', onDrain);
            reject(err);
          };
          stdin.once('drain', onDrain);
          stdin.once('error', onError);
        });
      }
    } catch (err) {
      // A dead pipe means FFmpeg exited: report its error, not "write EOF".
      await session.encoder.done;
      throw new Error(`Encoder stopped before all frames were written (${err.message})`);
    }
    return { ok: true };
  });

  ipcMain.handle('export:finish', async () => {
    if (!active) throw new Error('No export in progress');
    const session = active;
    active = null;
    session.encoder.child.stdin.end();
    await session.encoder.done;

    if (session.format === 'gif') {
      try {
        await mediaService.mp4ToGif(session.videoPath, session.finalPath, {
          fps: 15,
          width:
            Math.round((session.width * Math.min(1, GIF_MAX_SHORT_SIDE / Math.min(session.width, session.height))) / 2) * 2,
        });
      } finally {
        try { fs.rmSync(session.videoPath, { force: true }); } catch {}
      }
    }

    const stats = fs.statSync(session.finalPath);
    if (stats.size === 0) throw new Error('Export produced an empty file');
    return { outputPath: session.finalPath, bytes: stats.size };
  });

  ipcMain.handle('export:cancel', async () => {
    await cancelActive();
    return { ok: true };
  });
}

module.exports = { registerExportIpc, exportFileOf };
