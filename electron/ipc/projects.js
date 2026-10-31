const fs = require('fs');
const path = require('path');
const { clipboard, dialog, ipcMain, nativeImage, shell } = require('electron');

const storage = require('../services/storage');
const importService = require('../services/import-service');
const mediaService = require('../services/media-service');

const SCHEMA_VERSION = 1;

// Kept in sync with src/engine (zoom-engine SCREEN_ANIMATIONS + ZOOM_STYLES, composition-engine FRAMINGS,
// cursor-track CURSOR_ANIMATIONS).
const SCREEN_ANIMATIONS = ['focused', 'smooth', 'classic'];
const ZOOM_STYLES = ['classic', 'loupe'];
const FRAMINGS = ['auto', 'fit', 'fill'];
const CURSOR_ANIMATIONS = ['smooth', 'medium', 'rapid', 'none'];

function createProjectDocument({
  projectId, duration, sourceName, micLabel, systemAudio, mimeType, hasWebcam, cursorHidden,
  screenPath = 'media/screen.webm', crop = null, clips = null, webcamOffset = 0,
}) {
  const now = new Date().toISOString();
  const assets = [
    { id: 'screen-1', type: 'screen-recording', path: screenPath, duration },
    { id: 'cursor-1', type: 'cursor-track', path: 'media/cursor.json' },
  ];
  if (hasWebcam) {
    assets.push({ id: 'webcam-1', type: 'webcam-recording', path: 'media/webcam.webm' });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: projectId,
    createdAt: now,
    updatedAt: now,
    project: {
      name: sourceName || 'Untitled recording',
      width: 1920,
      height: 1080,
      frameRate: 30,
    },
    recording: {
      micLabel: micLabel || null,
      systemAudio: Boolean(systemAudio),
      mimeType: mimeType || 'video/webm',
      cursorHidden: Boolean(cursorHidden),
      // Seconds the webcam recording started after the screen video.
      webcamOffset: Number.isFinite(webcamOffset) ? webcamOffset : 0,
    },
    assets,
    clips: clips || [{ id: 'clip-1', assetId: 'screen-1', start: 0, duration, speed: 1 }],
    zoomEvents: [],
    // The editor adds zooms from the recorded clicks on first open.
    autoZoom: { pending: true },
    captions: [],
    annotations: [],
    layouts: [],
    style: {
      background: 'wall-steel',
      backgroundImage: null,
      padding: 0.07,
      cornerRadius: 18,
      shadow: true,
      volume: 1,
      crop: crop || { l: 0, r: 0, t: 0, b: 0 },
      clipTransition: { type: 'none', duration: 0.4 },
      cursor: {
        // The smoothed overlay only makes sense when the real cursor was
        // hidden at capture time; otherwise two cursors would show.
        overlay: Boolean(cursorHidden),
        type: 'classic',
        size: 1.4,
        clickHighlights: true,
        clickEffect: 'ripple',
        clickColor: '#2680eb',
        clickSize: 1,
        clickOpacity: 0.9,
        clickDuration: 550,
        bounce: 0.5,
        bounceSpeed: 350,
        sway: 0.25,
        animation: 'medium',
        hideIdle: false,
        loop: false,
        stopAtEnd: false,
        rotate: false,
        removeShakes: false,
      },
      animation: {
        screen: 'focused',
        motionBlur: { strength: 0.5, cursor: true, zoom: true, pan: true },
      },
      zoomStyle: 'classic',
      shortcuts: { enabled: true },
      webcam: {
        enabled: Boolean(hasWebcam),
        position: 'bottom-right',
        size: 0.22,
        shape: 'circle',
        avoidCursor: false,
        hideOnSilence: false,
      },
    },
  };
}

const LAYOUT_TYPES = ['overlay', 'camera', 'split', 'screen', 'cutout'];
// Kept in sync with timeline-engine CLIP_TRANSITIONS.
const CLIP_TRANSITIONS = ['none', 'fade', 'black', 'white', 'zoom', 'slide', 'slideUp', 'blur', 'wipe'];
function transitionDuration(d) {
  const n = Number(d);
  return Number.isFinite(n) ? Math.min(2, Math.max(0.1, n)) : 0.4;
}
// Kept in sync with composition-engine CAPTION_LOOKS / CAPTION_ANIMATIONS.
const CAPTION_LOOKS = [
  'pill', 'bold', 'outline', 'minimal', 'highlight',
  'glass', 'card', 'neon', 'gradient', 'punch', 'lines', 'news',
];
const CAPTION_ANIMATIONS = ['none', 'fade', 'pop', 'rise', 'words', 'wordpop', 'karaoke'];
const MAX_TRANSCRIPT_WORDS = 200000;

// project.transcript: { words: [{ text, start, end }] in source seconds,
// language, model, captions } from local speech recognition.
function validateTranscript(t) {
  if (!t || typeof t !== 'object' || !Array.isArray(t.words) || t.words.length > MAX_TRANSCRIPT_WORDS) {
    throw new Error('Invalid transcript');
  }
  const words = [];
  for (const w of t.words) {
    if (!w || typeof w.text !== 'string' || !Number.isFinite(w.start) || !Number.isFinite(w.end)) throw new Error('Invalid transcript');
    words.push({ text: w.text.slice(0, 80), start: w.start, end: Math.max(w.start, w.end) });
  }
  return {
    words,
    language: typeof t.language === 'string' ? t.language.slice(0, 16) : null,
    model: typeof t.model === 'string' ? t.model.slice(0, 40) : null,
    captions: t.captions === true,
  };
}
const MAX_SILENCES = 10000;

// Minimal structural validation before anything from disk or the renderer is
// trusted. Imported project files are untrusted input.
function validateProject(p) {
  if (!p || typeof p !== 'object') throw new Error('Project is not an object');
  if (p.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported schema version: ${p.schemaVersion}`);
  storage.assertProjectId(p.id);
  if (!p.project || typeof p.project.name !== 'string') throw new Error('Missing project metadata');
  if (!Array.isArray(p.assets) || !Array.isArray(p.clips) || !Array.isArray(p.zoomEvents)) {
    throw new Error('Missing project collections');
  }
  for (const a of p.assets) {
    if (typeof a.path !== 'string' || a.path.includes('..') || path.isAbsolute(a.path)) {
      throw new Error('Asset paths must be relative to the project folder');
    }
  }
  for (const z of p.zoomEvents) {
    for (const key of ['time', 'duration', 'x', 'y', 'scale']) {
      if (typeof z[key] !== 'number' || !Number.isFinite(z[key])) {
        throw new Error('Invalid zoom event');
      }
    }
    if (z.type != null && z.type !== 'screen' && z.type !== 'loupe') throw new Error('Invalid zoom type');
    if (z.radius != null && (typeof z.radius !== 'number' || !Number.isFinite(z.radius))) {
      throw new Error('Invalid zoom event');
    }
  }
  // Older schema-1 projects predate captions/volume/webcam/etc: default them in.
  if (!Array.isArray(p.captions)) p.captions = [];
  for (const c of p.captions) {
    if (
      typeof c.text !== 'string' ||
      c.text.length > 500 ||
      typeof c.time !== 'number' ||
      typeof c.duration !== 'number' ||
      !Number.isFinite(c.time) ||
      !Number.isFinite(c.duration)
    ) {
      throw new Error('Invalid caption');
    }
    if (c.words != null) {
      if (!Array.isArray(c.words) || c.words.length > 200) throw new Error('Invalid caption');
      c.words = c.words
        .filter((w) => w && typeof w.text === 'string' && Number.isFinite(w.t) && Number.isFinite(w.d))
        .map((w) => ({ text: w.text.slice(0, 80), t: w.t, d: w.d }));
    }
    if (c.auto != null) c.auto = c.auto === true;
  }
  if (p.transcript != null) p.transcript = validateTranscript(p.transcript);
  if (p.faceTrack != null) {
    const f = p.faceTrack;
    const ok =
      f && typeof f === 'object' && Number.isFinite(f.step) && f.step >= 0.05 && f.step <= 2 &&
      Array.isArray(f.points) && f.points.length <= 100000 &&
      f.points.every((pt) => Array.isArray(pt) && pt.length === 3 && pt.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
    if (!ok) throw new Error('Invalid face track');
    p.faceTrack = { step: f.step, points: f.points };
  }
  const cap = p.style.captions && typeof p.style.captions === 'object' ? p.style.captions : {};
  const capSize = Number(cap.size);
  p.style.captions = {
    look: CAPTION_LOOKS.includes(cap.look) ? cap.look : 'pill',
    animation: CAPTION_ANIMATIONS.includes(cap.animation) ? cap.animation : 'none',
    size: Number.isFinite(capSize) ? Math.min(1.8, Math.max(0.6, capSize)) : 1,
    color: HEX_COLOR.test(String(cap.color)) ? cap.color : '#2680eb',
    uppercase: cap.uppercase === true,
  };
  if (!Array.isArray(p.layouts)) p.layouts = [];
  for (const l of p.layouts) {
    if (!l || !LAYOUT_TYPES.includes(l.layout)) throw new Error('Invalid camera layout');
    if (!Number.isFinite(l.time) || !Number.isFinite(l.duration)) throw new Error('Invalid camera layout');
  }
  if (p.audioAnalysis != null) {
    const s = p.audioAnalysis.silences;
    if (
      !Array.isArray(s) ||
      s.length > MAX_SILENCES ||
      !s.every((x) => x && Number.isFinite(x.start) && Number.isFinite(x.end))
    ) {
      throw new Error('Invalid audio analysis');
    }
  }
  if (!Array.isArray(p.annotations)) p.annotations = [];
  for (const a of p.annotations) {
    if (!['text', 'arrow', 'rect', 'blur', 'spotlight'].includes(a.type)) throw new Error('Invalid annotation type');
    for (const key of ['time', 'duration', 'x', 'y']) {
      if (typeof a[key] !== 'number' || !Number.isFinite(a[key])) throw new Error('Invalid annotation');
    }
    if (a.text != null && (typeof a.text !== 'string' || a.text.length > 200)) {
      throw new Error('Invalid annotation text');
    }
  }
  for (const c of p.clips) {
    const s = Number(c.speed);
    c.speed = Number.isFinite(s) && s >= 0.25 && s <= 4 ? s : 1;
    // The transition into this clip from the one before (unset = default).
    if (c.transition != null) {
      if (c.transition && CLIP_TRANSITIONS.includes(c.transition.type)) {
        c.transition = { type: c.transition.type, duration: transitionDuration(c.transition.duration) };
      } else {
        delete c.transition;
      }
    }
  }
  if (typeof p.style.volume !== 'number' || !Number.isFinite(p.style.volume)) p.style.volume = 1;
  p.style.volume = Math.min(2, Math.max(0, p.style.volume));
  if (!p.style.crop || typeof p.style.crop !== 'object') p.style.crop = { l: 0, r: 0, t: 0, b: 0 };
  if (!p.style.clipTransition || typeof p.style.clipTransition !== 'object' || !CLIP_TRANSITIONS.includes(p.style.clipTransition.type)) {
    p.style.clipTransition = { type: 'none', duration: 0.4 };
  }
  p.style.clipTransition.duration = transitionDuration(p.style.clipTransition.duration);
  if (!p.style.cursor || typeof p.style.cursor !== 'object') {
    p.style.cursor = { overlay: false, size: 1, clickHighlights: true };
  }
  if (!CURSOR_ANIMATIONS.includes(p.style.cursor.animation)) p.style.cursor.animation = 'medium';
  // Projects from before spring animation keep their original look.
  const anim = p.style.animation && typeof p.style.animation === 'object' ? p.style.animation : {};
  const mb = anim.motionBlur && typeof anim.motionBlur === 'object' ? anim.motionBlur : {};
  const strength = Number(mb.strength);
  p.style.animation = {
    screen: SCREEN_ANIMATIONS.includes(anim.screen) ? anim.screen : 'classic',
    motionBlur: {
      strength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0,
      cursor: mb.cursor !== false,
      zoom: mb.zoom !== false,
      pan: mb.pan !== false,
    },
  };
  if (!ZOOM_STYLES.includes(p.style.zoomStyle)) p.style.zoomStyle = 'classic';
  if (!FRAMINGS.includes(p.style.framing)) p.style.framing = 'auto';
  if (!p.style.shortcuts || typeof p.style.shortcuts !== 'object') p.style.shortcuts = { enabled: true };
  const audio = p.style.audio && typeof p.style.audio === 'object' ? p.style.audio : {};
  const unit = (v, d) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : d);
  let music = null;
  if (audio.music && typeof audio.music === 'object') {
    if (typeof audio.music.path !== 'string' || audio.music.path.includes('..') || path.isAbsolute(audio.music.path)) {
      throw new Error('Invalid music path');
    }
    music = { path: audio.music.path, name: String(audio.music.name || '').slice(0, 200), volume: unit(audio.music.volume, 0.25) };
  }
  p.style.audio = {
    voice: mediaService.VOICE_MODES.includes(audio.voice) ? audio.voice : audio.denoise === true ? 'noise' : 'standard',
    denoise: audio.denoise === true,
    normalize: audio.normalize === true,
    clickSounds: audio.clickSounds === true,
    clickVolume: unit(audio.clickVolume, 0.6),
    music,
  };
  for (const key of ['backgroundImage', 'backgroundVideo']) {
    const v = p.style[key];
    if (v != null && (typeof v !== 'string' || v.includes('..') || path.isAbsolute(v))) {
      throw new Error('Invalid background media path');
    }
  }
  if (p.style.backgroundColor != null && !HEX_COLOR.test(String(p.style.backgroundColor))) {
    p.style.backgroundColor = '#2a2a2a';
  }
  if (p.style.backgroundGradient != null) {
    const g = typeof p.style.backgroundGradient === 'object' ? p.style.backgroundGradient : {};
    const angle = Number(g.angle);
    p.style.backgroundGradient = {
      from: HEX_COLOR.test(String(g.from)) ? g.from : '#1473e6',
      to: HEX_COLOR.test(String(g.to)) ? g.to : '#0b2a52',
      angle: Number.isFinite(angle) ? ((angle % 360) + 360) % 360 : 135,
    };
  }
  const blur = Number(p.style.backgroundBlur);
  p.style.backgroundBlur = Number.isFinite(blur) ? Math.min(1, Math.max(0, blur)) : 0;
  if (p.style.paddingY != null) {
    const py = Number(p.style.paddingY);
    if (Number.isFinite(py)) p.style.paddingY = Math.min(0.35, Math.max(0, py));
    else delete p.style.paddingY;
  }
  p.style.frameless = p.style.frameless === true;
  if (p.recording && typeof p.recording === 'object') {
    const off = Number(p.recording.webcamOffset);
    p.recording.webcamOffset = Number.isFinite(off) ? Math.min(30, Math.max(-30, off)) : 0;
  }
  if (p.autoZoom != null && (typeof p.autoZoom !== 'object' || Array.isArray(p.autoZoom))) delete p.autoZoom;
  return p;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const BACKGROUND_VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v'];
const MAX_BACKGROUND_VIDEO_BYTES = 300 * 1024 * 1024;

// Copy a background video into the project. Returns its relative path.
function importBackgroundVideo(projectId, src) {
  const ext = path.extname(src).toLowerCase().slice(1);
  if (!BACKGROUND_VIDEO_EXTENSIONS.includes(ext)) throw new Error('Unsupported video format');
  if (fs.statSync(src).size > MAX_BACKGROUND_VIDEO_BYTES) throw new Error('Video larger than 300 MB');
  const relPath = `media/background-video-${Date.now()}.${ext}`;
  const dest = storage.assertInsideBase(path.join(storage.projectDir(projectId), relPath));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return relPath;
}

const MUSIC_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'];
const MAX_MUSIC_BYTES = 100 * 1024 * 1024;

// Copy a music file into the project (keeps projects portable). Returns the
// style.audio.music object to store.
function importMusic(projectId, src) {
  const ext = path.extname(src).toLowerCase().slice(1);
  if (!MUSIC_EXTENSIONS.includes(ext)) throw new Error('Unsupported audio format');
  const stats = fs.statSync(src);
  if (stats.size > MAX_MUSIC_BYTES) throw new Error('Audio file larger than 100 MB');
  const relPath = `media/music.${ext}`;
  const dest = storage.assertInsideBase(path.join(storage.projectDir(projectId), relPath));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return { path: relPath, name: path.basename(src).slice(0, 200), volume: 0.25 };
}

const MAX_IMAGE_DATA_URL = 80 * 1024 * 1024;
const PNG_PREFIX = 'data:image/png;base64,';

// Validates a PNG data URL from the renderer and returns the decoded image.
function imageFromDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIX) || dataUrl.length > MAX_IMAGE_DATA_URL) {
    throw new Error('Invalid image');
  }
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error('Invalid image');
  return image;
}

function writeImageToClipboard(dataUrl) {
  clipboard.writeImage(imageFromDataUrl(dataUrl));
}

// --- themes -------------------------------------------------------------------

// Style fields a theme carries. Never project media (background images,
// music) — themes must apply cleanly to any project.
const THEME_FIELDS = [
  'background', 'backgroundColor', 'backgroundGradient', 'backgroundBlur',
  'padding', 'paddingY', 'frameless', 'cornerRadius', 'shadow', 'shadowStyle', 'inset', 'clipTransition',
  'cursor', 'animation', 'shortcuts', 'webcam', 'zoomStyle', 'framing',
];

// A preset may also carry the canvas size (e.g. a 9:16 "TikTok" preset).
function themeCanvas(canvas) {
  if (!canvas || typeof canvas !== 'object') return null;
  const ok = (v) => Number.isInteger(v) && v >= 240 && v <= 7680;
  return ok(canvas.width) && ok(canvas.height) ? { width: canvas.width, height: canvas.height } : null;
}

function makeTheme(name, style, canvas) {
  if (typeof name !== 'string' || !name.trim() || name.length > 60) {
    throw new Error('Invalid theme name');
  }
  if (!style || typeof style !== 'object' || Array.isArray(style)) throw new Error('Invalid theme style');
  const picked = {};
  for (const f of THEME_FIELDS) {
    if (style[f] !== undefined) picked[f] = style[f];
  }
  if (picked.background === 'image' || picked.background === 'video') delete picked.background;
  const theme = { name: name.trim(), style: picked };
  const size = themeCanvas(canvas);
  if (size) theme.canvas = size;
  return theme;
}

function themeFileContents(theme) {
  return { format: 'frameflow-theme', version: 1, name: theme.name, style: theme.style, ...(theme.canvas ? { canvas: theme.canvas } : {}) };
}

// Imported theme files are untrusted: check the envelope, keep known fields.
function themeFromFile(json) {
  if (!json || typeof json !== 'object' || json.format !== 'frameflow-theme' || json.version !== 1) {
    throw new Error('Not a Frame Studio theme file');
  }
  return makeTheme(json.name, json.style, json.canvas);
}

function registerProjectsIpc() {
  ipcMain.handle('projects:list', async () => {
    const dir = storage.projectsDir();
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const projects = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const p = validateProject(storage.readJson(storage.projectFile(e.name)));
        const screen = p.assets.find((a) => a.type === 'screen-recording');
        projects.push({
          id: p.id,
          name: p.project.name,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          duration: screen ? screen.duration : 0,
          zoomCount: p.zoomEvents.length,
          width: p.project.width,
          height: p.project.height,
          hasWebcam: p.assets.some((a) => a.type === 'webcam-recording'),
          hasTranscript: Boolean(p.transcript && p.transcript.words.length),
          captionCount: p.captions.length,
        });
      } catch {
        // Unreadable/corrupt projects are skipped, never deleted.
      }
    }
    projects.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return projects;
  });

  ipcMain.handle('projects:load', async (event, projectId) => {
    storage.assertProjectId(projectId);
    return validateProject(storage.readJson(storage.projectFile(projectId)));
  });

  ipcMain.handle('projects:save', async (event, project) => {
    const p = validateProject(project);
    p.updatedAt = new Date().toISOString();
    storage.writeJsonAtomic(storage.projectFile(p.id), p);
    return { ok: true, updatedAt: p.updatedAt };
  });

  // Media is served through the frameflow-media:// protocol (see main.js),
  // which only resolves validated paths inside the project's folder.
  ipcMain.handle('projects:media-url', async (event, projectId, relPath) => {
    storage.assertProjectId(projectId);
    if (typeof relPath !== 'string' || relPath.includes('..') || path.isAbsolute(relPath)) {
      throw new Error('Invalid media path');
    }
    const abs = storage.assertInsideBase(path.join(storage.projectDir(projectId), relPath));
    if (!fs.existsSync(abs)) throw new Error('Media file not found');
    return `frameflow-media://${projectId}/${relPath.replace(/\\/g, '/')}`;
  });

  // A small poster frame for the library, cached in the project's media
  // folder and refreshed when the recording is newer than it.
  ipcMain.handle('projects:thumbnail', async (event, projectId) => {
    storage.assertProjectId(projectId);
    const src = storage.screenMediaPath(projectId);
    if (!fs.existsSync(src)) return null;
    const thumb = path.join(storage.mediaDir(projectId), 'thumb.jpg');
    const stale = !fs.existsSync(thumb) || fs.statSync(thumb).mtimeMs < fs.statSync(src).mtimeMs;
    if (stale) {
      const grab = (at) => mediaService.run(['-y', '-ss', at, '-i', src, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', thumb]);
      // A second in skips a black first frame; very short clips use frame 0.
      await grab('1').catch(() => {});
      if (!fs.existsSync(thumb) || fs.statSync(thumb).size === 0) await grab('0');
    }
    return `frameflow-media://${projectId}/media/thumb.jpg?v=${Math.round(fs.statSync(thumb).mtimeMs)}`;
  });

  // Pauses in the recording's audio (for hiding the camera during silence).
  ipcMain.handle('projects:detect-silence', async (event, projectId) => {
    storage.assertProjectId(projectId);
    return mediaService.detectSilences(storage.screenMediaPath(projectId));
  });

  ipcMain.handle('projects:read-cursor', async (event, projectId) => {
    storage.assertProjectId(projectId);
    const file = path.join(storage.mediaDir(projectId), 'cursor.json');
    if (!fs.existsSync(file)) return null;
    return storage.readJson(file);
  });

  ipcMain.handle('projects:reveal-exports', async (event, projectId) => {
    storage.assertProjectId(projectId);
    const dir = storage.exportsDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return { ok: true };
  });

  ipcMain.handle('projects:reveal-folder', async (event, projectId) => {
    storage.assertProjectId(projectId);
    shell.openPath(storage.projectDir(projectId));
    return { ok: true };
  });

  ipcMain.handle('projects:rename', async (event, projectId, name) => {
    storage.assertProjectId(projectId);
    if (typeof name !== 'string' || !name.trim() || name.length > 120) {
      throw new Error('Invalid project name');
    }
    const p = validateProject(storage.readJson(storage.projectFile(projectId)));
    p.project.name = name.trim();
    p.updatedAt = new Date().toISOString();
    storage.writeJsonAtomic(storage.projectFile(projectId), p);
    return { ok: true, name: p.project.name };
  });

  // Delete moves the whole project folder to the Recycle Bin, never a hard rm.
  ipcMain.handle('projects:delete', async (event, projectId) => {
    storage.assertProjectId(projectId);
    const dir = storage.projectDir(projectId);
    if (!fs.existsSync(dir)) return { ok: true };
    await shell.trashItem(dir);
    return { ok: true };
  });

  // Pick an image and copy it into the project so the project stays portable.
  ipcMain.handle('projects:choose-background', async (event, projectId) => {
    storage.assertProjectId(projectId);
    const result = await dialog.showOpenDialog({
      title: 'Choose background image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const src = result.filePaths[0];
    const stats = fs.statSync(src);
    if (stats.size > 30 * 1024 * 1024) throw new Error('Image larger than 30 MB');
    const ext = path.extname(src).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.png';
    const relPath = `media/background-${Date.now()}${ext}`;
    fs.copyFileSync(src, storage.assertInsideBase(path.join(storage.projectDir(projectId), relPath)));
    return relPath;
  });

  // Pick a looping background video and copy it into the project.
  ipcMain.handle('projects:choose-background-video', async (event, projectId) => {
    storage.assertProjectId(projectId);
    const result = await dialog.showOpenDialog({
      title: 'Choose background video',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: BACKGROUND_VIDEO_EXTENSIONS }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return importBackgroundVideo(projectId, result.filePaths[0]);
  });

  // Import an existing video file as a new project.
  ipcMain.handle('projects:import-video', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import a video',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: importService.VIDEO_EXTENSIONS }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return importService.importVideo(result.filePaths[0], { createProjectDocument });
  });

  // Add another video file to this project, to be placed as a clip.
  ipcMain.handle('projects:add-clip-video', async (event, projectId) => {
    storage.assertProjectId(projectId);
    const result = await dialog.showOpenDialog({
      title: 'Add a video clip',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: importService.VIDEO_EXTENSIONS }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return importService.importClipVideo(projectId, result.filePaths[0]);
  });

  // Copy the current preview frame to the clipboard as an image.
  ipcMain.handle('clipboard:write-image', async (event, dataUrl) => {
    writeImageToClipboard(dataUrl);
    return { ok: true };
  });

  // Pick a background music file and copy it into the project.
  ipcMain.handle('projects:choose-music', async (event, projectId) => {
    storage.assertProjectId(projectId);
    const result = await dialog.showOpenDialog({
      title: 'Choose background music',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: MUSIC_EXTENSIONS }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return importMusic(projectId, result.filePaths[0]);
  });

  // --- reusable style themes (stored once, applied to any project) ---------

  const themesFile = () => path.join(storage.baseDir(), 'themes.json');

  function readThemes() {
    try {
      const t = storage.readJson(themesFile());
      return Array.isArray(t) ? t : [];
    } catch {
      return [];
    }
  }

  // Saving an existing name updates that preset in place (its number in the
  // list stays the same); a new name is added at the end.
  function saveTheme(name, style, canvas) {
    const theme = makeTheme(name, style, canvas);
    const themes = readThemes();
    const i = themes.findIndex((t) => t.name === theme.name);
    if (i >= 0) themes[i] = theme;
    else themes.push(theme);
    if (themes.length > 50) themes.shift();
    storage.writeJsonAtomic(themesFile(), themes);
    return readThemes();
  }

  ipcMain.handle('themes:list', async () => readThemes());

  ipcMain.handle('themes:save', async (event, name, style, canvas) => saveTheme(name, style, canvas));

  ipcMain.handle('themes:rename', async (event, from, to) => {
    const themes = readThemes();
    const theme = themes.find((t) => t.name === from);
    if (!theme) throw new Error('Preset not found');
    const renamed = makeTheme(to, theme.style, theme.canvas);
    if (renamed.name !== from && themes.some((t) => t.name === renamed.name)) {
      throw new Error('A preset with that name already exists');
    }
    theme.name = renamed.name;
    storage.writeJsonAtomic(themesFile(), themes);
    return readThemes();
  });

  // Share a theme with teammates as a small JSON file.
  ipcMain.handle('themes:export', async (event, name) => {
    const theme = readThemes().find((t) => t.name === name);
    if (!theme) throw new Error('Theme not found');
    const result = await dialog.showSaveDialog({
      title: 'Export theme',
      defaultPath: `${theme.name.replace(/[^\w -]/g, '_')}.frameflow-theme.json`,
      filters: [{ name: 'Frame Studio theme', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, JSON.stringify(themeFileContents(theme), null, 2), 'utf8');
    return { ok: true };
  });

  ipcMain.handle('themes:import', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import theme',
      properties: ['openFile'],
      filters: [{ name: 'Frame Studio theme', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const file = result.filePaths[0];
    if (fs.statSync(file).size > 1024 * 1024) throw new Error('Theme file too large');
    const theme = themeFromFile(JSON.parse(fs.readFileSync(file, 'utf8')));
    return saveTheme(theme.name, theme.style, theme.canvas);
  });

  ipcMain.handle('themes:delete', async (event, name) => {
    const themes = readThemes().filter((t) => t.name !== name);
    storage.writeJsonAtomic(themesFile(), themes);
    return themes;
  });
}

module.exports = {
  registerProjectsIpc, createProjectDocument, validateProject, importMusic, makeTheme, themeFromFile, themeFileContents,
  imageFromDataUrl,
};
