const { screen } = require('electron');

// Samples the global cursor position while a recording is running. Samples are
// stored normalized (0..1) against the recorded display's bounds, with
// timestamps that exclude paused periods so they stay aligned with the media
// (MediaRecorder also splices out pauses).

const SAMPLE_INTERVAL_MS = 16; // ~60 Hz

let timer = null;
let samples = [];
let startedAt = 0;
let pausedTotal = 0;
let pausedAt = null;
let bounds = null;

function start(displayBounds) {
  stop();
  bounds = displayBounds || screen.getPrimaryDisplay().bounds;
  samples = [];
  startedAt = Date.now();
  pausedTotal = 0;
  pausedAt = null;

  timer = setInterval(() => {
    if (pausedAt !== null) return;
    const p = screen.getCursorScreenPoint();
    samples.push({
      t: (Date.now() - startedAt - pausedTotal) / 1000,
      x: clamp01((p.x - bounds.x) / bounds.width),
      y: clamp01((p.y - bounds.y) / bounds.height),
    });
  }, SAMPLE_INTERVAL_MS);

  return { startedAt };
}

function pause() {
  if (pausedAt === null) pausedAt = Date.now();
}

function resume() {
  if (pausedAt !== null) {
    pausedTotal += Date.now() - pausedAt;
    pausedAt = null;
  }
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const result = { samples, startedAt, bounds };
  samples = [];
  pausedAt = null;
  pausedTotal = 0;
  return result;
}

// Snapshot of the samples collected so far, without stopping the sampler.
// Used for periodic crash-recovery flushes.
function peek() {
  return {
    sampleRateHint: 60,
    displayBounds: bounds,
    samples: samples.slice(),
  };
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

module.exports = { start, pause, resume, stop, peek };
