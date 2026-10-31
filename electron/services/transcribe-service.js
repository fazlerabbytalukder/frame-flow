const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { ffmpegPath } = require('./media-service');

// Local speech-to-text (Whisper base, word timestamps) through transformers.js
// and onnxruntime-node. The model ships in assets/models/whisper and remote
// model downloads are switched off, so audio never leaves the machine.

const MODEL_ID = 'onnx-community/whisper-base_timestamped';
const SAMPLE_RATE = 16000;

function modelRoot() {
  let root = path.join(__dirname, '..', '..', 'assets', 'models', 'whisper');
  if (root.includes('app.asar') && !root.includes('app.asar.unpacked')) root = root.replace('app.asar', 'app.asar.unpacked');
  return root;
}

function modelAvailable() {
  return fs.existsSync(path.join(modelRoot(), MODEL_ID, 'onnx', 'encoder_model_quantized.onnx'));
}

// Mono 16 kHz float samples of a media file's first audio stream.
function decodeAudio(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'], {
      windowsHide: true,
    });
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Could not read the audio: ${stderr.slice(-400)}`));
      const buf = Buffer.concat(chunks);
      const out = new Float32Array(buf.length >> 2);
      for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
      resolve(out);
    });
  });
}

let pipelinePromise = null;
function loadPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      // The CommonJS build: loads from inside app.asar like any dependency.
      const { pipeline, env } = require('@huggingface/transformers');
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = modelRoot() + path.sep;
      env.useBrowserCache = false;
      // With the FS cache on, transformers hands onnxruntime a file PATH, and
      // onnxruntime can't open paths over Windows' 260-character MAX_PATH.
      // The model folder sits ~165 characters under the install directory,
      // so a long username or install path broke transcription with "File
      // doesn't exist". Off, the model is read into memory and passed as bytes
      // (we never download, so there is nothing to cache anyway).
      env.useFSCache = false;
      return pipeline('automatic-speech-recognition', MODEL_ID, { dtype: 'q8', device: 'cpu' });
    })().catch((err) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

// Splits Whisper's word chunks into { text, start, end } (seconds), dropping
// empty pieces and keeping times monotonic.
function wordsFromChunks(chunks, offset = 0) {
  const words = [];
  for (const c of chunks || []) {
    const text = String(c.text || '').trim();
    if (!text) continue;
    let [start, end] = c.timestamp || [];
    if (!Number.isFinite(start)) continue;
    if (!Number.isFinite(end) || end < start) end = start + 0.2;
    start += offset;
    end += offset;
    const prev = words[words.length - 1];
    if (prev && start < prev.end) start = prev.end;
    if (end < start) end = start;
    words.push({ text, start: +start.toFixed(3), end: +end.toFixed(3) });
  }
  return words;
}

const WINDOW = 30; // seconds per pass (Whisper's context)

// Cut long audio into ≤30 s windows at the quietest 0.1 s inside the last
// 5 s of each window, so words aren't split between passes.
function cutPoints(samples) {
  const total = samples.length / SAMPLE_RATE;
  const cuts = [0];
  let at = 0;
  while (total - at > WINDOW) {
    const hop = SAMPLE_RATE / 10;
    let best = at + WINDOW;
    let bestEnergy = Infinity;
    for (let t = at + WINDOW - 5; t <= at + WINDOW - 0.1; t += 0.1) {
      const i0 = Math.floor(t * SAMPLE_RATE);
      let e = 0;
      for (let i = i0; i < i0 + hop && i < samples.length; i++) e += samples[i] * samples[i];
      if (e < bestEnergy) {
        bestEnergy = e;
        best = t;
      }
    }
    at = best;
    cuts.push(at);
  }
  cuts.push(total);
  return cuts;
}

// Transcribes a media file. onProgress(fraction) is called after each window.
async function transcribeFile(file, { language = null, onProgress } = {}) {
  if (!modelAvailable()) throw new Error('The speech model is missing from this installation');
  const samples = await decodeAudio(file);
  const asr = await loadPipeline();
  const cuts = cutPoints(samples);
  const words = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = Math.floor(cuts[k] * SAMPLE_RATE);
    const b = Math.min(samples.length, Math.floor(cuts[k + 1] * SAMPLE_RATE));
    const piece = samples.subarray(a, b);
    if (piece.length > SAMPLE_RATE / 4 && rms(piece) > 0.002) {
      const out = await asr(piece, {
        return_timestamps: 'word',
        ...(language ? { language, task: 'transcribe' } : {}),
      });
      words.push(...wordsFromChunks(out.chunks, cuts[k]));
    }
    if (onProgress) onProgress((k + 1) / (cuts.length - 1));
  }
  return { words, language: language || 'en', model: 'whisper-base', duration: samples.length / SAMPLE_RATE };
}

function rms(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
}

module.exports = { transcribeFile, decodeAudio, wordsFromChunks, cutPoints, modelAvailable, modelRoot, SAMPLE_RATE };
