// Person masks for the camera cutout layout. MediaPipe's selfie segmenter
// runs locally (Wasm runtime and model ship under mediapipe/, see
// vite.config.js) on the CPU in IMAGE mode, so the preview and the export get
// the same mask for the same webcam frame.

const MASK_WIDTH = 256; // segment a downscaled copy; the mask is upscaled when drawn

let loading = null;

// Resolves to a PersonMasker; the model loads once per window.
export function loadPersonSegmenter() {
  if (!loading) {
    loading = (async () => {
      // Loaded on first use so the editor bundle stays small.
      const { ImageSegmenter } = await import('@mediapipe/tasks-vision');
      const base = new URL('mediapipe/', document.baseURI).href;
      const segmenter = await ImageSegmenter.createFromOptions(
        { wasmLoaderPath: `${base}vision_wasm_internal.js`, wasmBinaryPath: `${base}vision_wasm_internal.wasm` },
        {
          baseOptions: { modelAssetPath: `${base}selfie_segmenter_landscape.tflite`, delegate: 'CPU' },
          runningMode: 'IMAGE',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        }
      );
      return new PersonMasker(segmenter);
    })().catch((err) => {
      loading = null; // allow a retry
      throw err;
    });
  }
  return loading;
}

// Confidence → mask alpha. A narrow ramp above 0.5 keeps edges soft without
// letting the background bleed through.
export function maskAlpha(confidence) {
  const t = Math.min(1, Math.max(0, (confidence - 0.5) / 0.3));
  return Math.round(t * t * (3 - 2 * t) * 255);
}

class PersonMasker {
  constructor(segmenter) {
    this.segmenter = segmenter;
    this.input = document.createElement('canvas');
    this.mask = document.createElement('canvas');
    this.key = null;
  }

  // A canvas the size of a downscaled frame whose alpha is the person, or
  // null if the frame isn't ready. Cached per webcam frame, so motion-blur
  // sub-frames reuse it.
  maskFor(video) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return null;
    const key = `${video.currentSrc}|${video.currentTime}`;
    if (key === this.key) return this.mask;

    const w = MASK_WIDTH;
    const h = Math.max(1, Math.round((MASK_WIDTH * vh) / vw));
    if (this.input.width !== w || this.input.height !== h) {
      this.input.width = w;
      this.input.height = h;
    }
    this.input.getContext('2d').drawImage(video, 0, 0, w, h);

    const result = this.segmenter.segment(this.input);
    try {
      const conf = result.confidenceMasks?.[0];
      if (!conf) return null;
      const values = conf.getAsFloat32Array();
      const mw = conf.width;
      const mh = conf.height;
      if (this.mask.width !== mw || this.mask.height !== mh) {
        this.mask.width = mw;
        this.mask.height = mh;
      }
      const mctx = this.mask.getContext('2d');
      const img = mctx.createImageData(mw, mh);
      for (let i = 0; i < values.length; i++) {
        const o = i * 4;
        img.data[o] = 255;
        img.data[o + 1] = 255;
        img.data[o + 2] = 255;
        img.data[o + 3] = maskAlpha(values[i]);
      }
      mctx.putImageData(img, 0, 0);
    } finally {
      result.close();
    }
    this.key = key;
    return this.mask;
  }
}

// --- face tracking ------------------------------------------------------------

// The head in a person mask (alpha bytes, w x h, row-major): the topmost
// rows of the silhouette until it widens into the shoulders. Returns
// { x, y, size } in 0..1 of the frame (size = head width), or null.
export function headFromMask(alpha, w, h) {
  const minRun = Math.max(2, Math.round(w * 0.02));
  const rows = [];
  for (let y = 0; y < h; y++) {
    let x0 = -1;
    let x1 = -1;
    let count = 0;
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > 127) {
        if (x0 < 0) x0 = x;
        x1 = x;
        count++;
      }
    }
    rows.push(count >= minRun ? { x0, x1 } : null);
  }
  const top = rows.findIndex(Boolean);
  if (top < 0) return null;
  const widths = [];
  const centres = [];
  let bottom = top;
  for (let y = top; y < h && y < top + h * 0.4; y++) {
    const r = rows[y];
    if (!r) break;
    const width = r.x1 - r.x0 + 1;
    // Head width: the median of what we've seen so far (ignores hair wisps).
    const sorted = [...widths].sort((a, b) => a - b);
    const head = sorted.length ? sorted[sorted.length >> 1] : width;
    if (widths.length >= 4 && width > head * 1.6) break;
    widths.push(width);
    centres.push((r.x0 + r.x1 + 1) / 2);
    bottom = y;
  }
  if (widths.length < 3) return null;
  const sorted = [...widths].sort((a, b) => a - b);
  return {
    x: centres.reduce((s, c) => s + c, 0) / centres.length / w,
    y: (top + bottom + 1) / 2 / h,
    size: sorted[sorted.length >> 1] / w,
  };
}

// Smooths a face track so the framing glides instead of jittering: a
// centred moving average over `radius` samples on each side; gaps (no face)
// take the nearest known position.
export function smoothFaceTrack(points, radius = 3) {
  const filled = points.slice();
  let last = null;
  for (let i = 0; i < filled.length; i++) {
    if (filled[i]) last = filled[i];
    else filled[i] = last;
  }
  last = null;
  for (let i = filled.length - 1; i >= 0; i--) {
    if (filled[i]) last = filled[i];
    else filled[i] = last;
  }
  if (!filled[0]) return null;
  return filled.map((_, i) => {
    let sx = 0;
    let sy = 0;
    let ss = 0;
    let n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(filled.length - 1, i + radius); j++) {
      sx += filled[j][0];
      sy += filled[j][1];
      ss += filled[j][2];
      n++;
    }
    return [+(sx / n).toFixed(4), +(sy / n).toFixed(4), +(ss / n).toFixed(4)];
  });
}

const FACE_STEP = 0.25; // seconds between samples

function seekTo(video, t) {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

// Walks the webcam recording and finds the face every FACE_STEP seconds.
// Returns project.faceTrack { step, points } or null when no face is seen.
export async function analyzeFaceTrack(url, { onProgress, signal } = {}) {
  const masker = await loadPersonSegmenter();
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = () => reject(new Error('Could not open the camera recording'));
  });
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const count = Math.max(1, Math.floor(duration / FACE_STEP) + 1);
  const raw = [];
  const read = document.createElement('canvas');
  for (let i = 0; i < count; i++) {
    if (signal?.aborted) throw new Error('Cancelled');
    await seekTo(video, Math.min(duration - 0.01, i * FACE_STEP));
    const mask = masker.maskFor(video);
    let head = null;
    if (mask) {
      read.width = mask.width;
      read.height = mask.height;
      const c = read.getContext('2d', { willReadFrequently: true });
      c.clearRect(0, 0, read.width, read.height);
      c.drawImage(mask, 0, 0);
      const data = c.getImageData(0, 0, read.width, read.height).data;
      const alpha = new Uint8Array(read.width * read.height);
      for (let k = 0; k < alpha.length; k++) alpha[k] = data[k * 4 + 3];
      head = headFromMask(alpha, read.width, read.height);
    }
    raw.push(head ? [head.x, head.y, head.size] : null);
    if (onProgress) onProgress((i + 1) / count);
  }
  video.removeAttribute('src');
  video.load();
  const points = smoothFaceTrack(raw);
  return points ? { step: FACE_STEP, points } : null;
}
