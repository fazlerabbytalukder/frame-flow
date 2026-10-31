const { spawn } = require('child_process');
const { desktopCapturer, screen } = require('electron');
const mediaService = require('./media-service');

// Cursor-free screen capture on Windows. Chromium's capturer always paints the
// system cursor into the video (it ignores `cursor: 'never'`), which makes a
// restyled cursor impossible. FFmpeg's ddagrab (Desktop Duplication API)
// can leave it out, so screen recordings capture video here while audio,
// webcam and input tracking keep running in their usual places. Windows
// excluded from capture (the recorder bar) stay invisible here too.
//
// The video is written as Matroska, which stays readable if the app crashes
// mid-recording; it is muxed with the audio into an MP4 when the recording is
// finalized.

const FPS = 30;
const PROBE_W = 32;
const PROBE_H = 18;
const MAX_OUTPUTS = 8;
const START_TIMEOUT_MS = 8000;

let availability = null; // Promise<boolean>, probed once
let active = null; // { child, startWall, closed }

function captureArgs(outputIndex, outFile) {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostats',
    '-progress', 'pipe:1', '-stats_period', '0.1',
    '-f', 'lavfi', '-i', `ddagrab=output_idx=${outputIndex}:draw_mouse=0:framerate=${FPS}`,
    '-vf', 'hwdownload,format=bgra,scale=trunc(iw/2)*2:trunc(ih/2)*2',
    // Low-latency x264 keeps the progress clock (used to align audio and the
    // cursor track) within a frame of the captured picture.
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-g', String(FPS * 2),
    '-f', 'matroska', '-y', outFile,
  ];
}

// One tiny grayscale frame from a DXGI output, plus its size; null if the
// output does not exist (or Desktop Duplication is unavailable).
function probeOutput(index) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        mediaService.ffmpegPath(),
        [
          '-hide_banner', '-v', 'verbose',
          '-f', 'lavfi', '-i', `ddagrab=output_idx=${index}:draw_mouse=0:framerate=10`,
          '-frames:v', '1',
          '-vf', `hwdownload,format=bgra,scale=${PROBE_W}:${PROBE_H}:flags=area,format=gray`,
          '-f', 'rawvideo', 'pipe:1',
        ],
        { windowsHide: true }
      );
    } catch {
      resolve(null);
      return;
    }
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 32768) stderr = stderr.slice(-16384);
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      const gray = Buffer.concat(chunks);
      const m = /dimensions (\d+)x(\d+)/.exec(stderr);
      if (code !== 0 || gray.length < PROBE_W * PROBE_H || !m) return resolve(null);
      resolve({ index, width: Number(m[1]), height: Number(m[2]), gray: gray.subarray(0, PROBE_W * PROBE_H) });
    });
  });
}

async function listOutputs() {
  const outputs = [];
  for (let i = 0; i < MAX_OUTPUTS; i++) {
    const o = await probeOutput(i);
    if (!o) break;
    outputs.push(o);
  }
  return outputs;
}

function available() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  if (!availability) availability = probeOutput(0).then(Boolean);
  return availability;
}

// Which DXGI output shows a display. Outputs whose pixel size matches the
// display are candidates; when several match (identical monitors), the one
// whose current picture looks most like the display's thumbnail wins.
function matchOutput(target, outputs) {
  const sameSize = outputs.filter((o) => o.width === target.width && o.height === target.height);
  const pool = sameSize.length > 0 ? sameSize : outputs;
  if (pool.length === 0) return null;
  if (pool.length === 1 || !target.gray) return pool[0];
  let best = pool[0];
  let bestErr = Infinity;
  for (const o of pool) {
    let err = 0;
    for (let i = 0; i < target.gray.length; i++) {
      const d = target.gray[i] - o.gray[i];
      err += d * d;
    }
    if (err < bestErr) {
      bestErr = err;
      best = o;
    }
  }
  return best;
}

// Grayscale probe-sized image of a desktopCapturer screen source.
async function displayFingerprint(sourceId) {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: PROBE_W * 4, height: PROBE_H * 4 },
  });
  const src = sources.find((s) => s.id === sourceId);
  if (!src || src.thumbnail.isEmpty()) return null;
  const bgra = src.thumbnail.resize({ width: PROBE_W, height: PROBE_H, quality: 'good' }).toBitmap();
  const gray = Buffer.alloc(PROBE_W * PROBE_H);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(bgra[i * 4 + 2] * 0.299 + bgra[i * 4 + 1] * 0.587 + bgra[i * 4] * 0.114);
  }
  return { gray, displayId: src.display_id };
}

async function resolveOutput(sourceId) {
  const outputs = await listOutputs();
  if (outputs.length === 0) throw new Error('Desktop Duplication is not available');
  if (outputs.length === 1) return outputs[0].index;
  const fp = await displayFingerprint(sourceId).catch(() => null);
  const display =
    screen.getAllDisplays().find((d) => fp && String(d.id) === String(fp.displayId)) || screen.getPrimaryDisplay();
  const target = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
    gray: fp ? fp.gray : null,
  };
  return matchOutput(target, outputs).index;
}

// Start capturing the screen `sourceId` into `outFile`. Resolves once frames
// are flowing, with `startWall`: the wall-clock time (ms) of video time 0.
async function start({ sourceId, outFile }) {
  if (active) await stop().catch(() => {});
  const outputIndex = await resolveOutput(sourceId);
  const child = spawn(mediaService.ffmpegPath(), captureArgs(outputIndex, outFile), { windowsHide: true });
  const session = { child, startWall: null, closed: null, outputIndex };
  active = session;

  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 16384) stderr = stderr.slice(-8192);
  });
  session.closed = new Promise((resolve) => child.on('close', resolve));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('Screen capture did not start')), START_TIMEOUT_MS);
    function fail(err) {
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // already gone
      }
      if (active === session) active = null;
      reject(err);
    }
    // Each progress report gives video time vs. wall time; reports arrive a
    // little after the frame, so the earliest estimate is the most accurate.
    let buffered = '';
    child.stdout.on('data', (d) => {
      buffered += d.toString();
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) {
        const m = /^out_time_us=(\d+)/.exec(line.trim());
        if (!m || Number(m[1]) <= 0) continue;
        const estimate = Date.now() - Number(m[1]) / 1000;
        const first = session.startWall == null;
        session.startWall = first ? estimate : Math.min(session.startWall, estimate);
        if (first) {
          clearTimeout(timer);
          resolve();
        }
      }
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (session.startWall == null) fail(new Error(`FFmpeg exited (${code}): ${stderr.trim().slice(-300)}`));
    });
  });
  return { startWall: session.startWall, outputIndex };
}

// Stop gracefully ('q' lets FFmpeg finish the file). Resolves with the
// refined start time.
async function stop() {
  const session = active;
  if (!session) return null;
  active = null;
  try {
    session.child.stdin.write('q');
    session.child.stdin.end();
  } catch {
    // The process may already be gone.
  }
  const killer = setTimeout(() => {
    try {
      session.child.kill();
    } catch {
      // ignore
    }
  }, 6000);
  await session.closed;
  clearTimeout(killer);
  return { startWall: session.startWall };
}

// Synchronous best effort for shutdown paths: never leave FFmpeg grabbing
// the screen after the app is gone.
function abort() {
  if (!active) return;
  try {
    active.child.kill();
  } catch {
    // ignore
  }
  active = null;
}

function isRunning() {
  return Boolean(active);
}

// --- pure helpers (tested) ---------------------------------------------------

// The recording keeps running while paused; pauses become cuts. `pauses` are
// [{ start, end }] in video seconds.
function clipsExcludingPauses(duration, pauses) {
  const sorted = (pauses || [])
    .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start)
    .sort((a, b) => a.start - b.start);
  const clips = [];
  let t = 0;
  for (const p of sorted) {
    const start = Math.max(0, Math.min(duration, p.start));
    if (start - t > 0.05) clips.push({ start: t, duration: start - t });
    t = Math.max(t, Math.min(duration, p.end));
  }
  if (duration - t > 0.05) clips.push({ start: t, duration: duration - t });
  if (clips.length === 0) clips.push({ start: 0, duration });
  return clips.map((c, i) => ({ id: `clip-${i + 1}`, assetId: 'screen-1', start: c.start, duration: c.duration, speed: 1 }));
}

// Move every timestamp in a cursor/input track by `delta` seconds (samples,
// clicks and shortcuts are { t }, typing is a list of times).
function shiftTrack(track, delta) {
  const out = { ...track };
  for (const [key, value] of Object.entries(track)) {
    if (!Array.isArray(value)) continue;
    out[key] = value.map((item) => {
      if (typeof item === 'number') return Math.round((item + delta) * 1000) / 1000;
      if (item && typeof item.t === 'number') return { ...item, t: item.t + delta };
      return item;
    });
  }
  return out;
}

module.exports = {
  available, start, stop, abort, isRunning,
  matchOutput, clipsExcludingPauses, shiftTrack, captureArgs, FPS,
};
