// Smoke test of the PACKAGED app, run after `npm run dist` (npm run
// test:packaged). It loads the services, native modules, Whisper and the
// renderer straight out of win-unpacked/resources/app.asar, in hidden windows,
// to catch what only breaks once packaged: asar/asarUnpack paths, native
// binaries, the CSP, the sandboxed preload. Run it from a deep folder too:
// paths over 260 characters once broke Whisper (see transcribe-service.js).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const arg = process.argv.slice(2).find((a) => !a.startsWith('-') && a !== __filename);
const unpacked = path.resolve(arg || path.join(__dirname, '..', '..', 'release', 'win-unpacked'));
if (!fs.existsSync(path.join(unpacked, 'resources', 'app.asar'))) {
  console.error(`No packaged app at ${unpacked} (run npm run dist, or pass the win-unpacked folder).`);
  process.exit(1);
}
const ASAR = path.join(unpacked, 'resources', 'app.asar');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-smoke-'));
app.setPath('documents', path.join(tmp, 'Documents'));
app.setPath('userData', path.join(tmp, 'userData'));

const results = [];
const ok = (name, detail = '') => results.push(['PASS', name, detail]);
const bad = (name, detail = '') => results.push(['FAIL', name, String(detail).slice(0, 400)]);
async function check(name, fn) {
  try { ok(name, (await fn()) || ''); } catch (e) { bad(name, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e); }
}
const req = (rel) => require(path.join(ASAR, rel));

app.whenReady().then(async () => {
  await check('asar contains dist + mediapipe', () => {
    for (const f of ['dist/index.html', 'dist/mediapipe/vision_wasm_internal.wasm', 'dist/mediapipe/selfie_segmenter_landscape.tflite', 'electron/preload.js', 'electron/assets/icon.ico']) {
      if (!fs.existsSync(path.join(ASAR, f))) throw new Error(`missing ${f}`);
    }
    const html = fs.readFileSync(path.join(ASAR, 'dist/index.html'), 'utf8');
    if (!html.includes('Content-Security-Policy')) throw new Error('no CSP in packaged index.html');
  });
  await check('no dev-only files packaged', () => {
    for (const f of ['src', 'tests', 'scripts', 'node_modules/electron', 'node_modules/vite', 'node_modules/@mediapipe']) {
      if (fs.existsSync(path.join(ASAR, f))) throw new Error(`packaged ${f}`);
    }
  });

  const media = req('electron/services/media-service.js');
  await check('ffmpeg runs from app.asar.unpacked', async () => {
    const p = media.ffmpegPath();
    if (!p.includes('app.asar.unpacked')) throw new Error(`path not unpacked: ${p}`);
    const out = require('child_process').execFileSync(p, ['-hide_banner', '-version'], { encoding: 'utf8' });
    return out.split('\n')[0];
  });
  await check('ffmpeg ddagrab filter available (native capture)', () => {
    const out = require('child_process').execFileSync(media.ffmpegPath(), ['-hide_banner', '-filters'], { encoding: 'utf8' });
    if (!/ddagrab/.test(out)) throw new Error('ddagrab missing');
  });
  await check('hardware encoder detection', async () => String(await media.detectHardwareEncoder()));
  await check('uiohook-napi native module loads', () => { const m = req('node_modules/uiohook-napi'); if (!m.uIOhook) throw new Error('no uIOhook export'); });
  await check('sharp native module loads', async () => {
    const sharp = req('node_modules/sharp');
    const buf = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#2680eb' } }).png().toBuffer();
    return `${buf.length} byte png`;
  });

  const transcribe = req('electron/services/transcribe-service.js');
  await check('Whisper model shipped unpacked', () => {
    if (!transcribe.modelAvailable()) throw new Error(`model not found under ${transcribe.modelRoot()}`);
    return transcribe.modelRoot();
  });
  await check('Whisper runs (onnxruntime-node from asar)', async () => {
    const wav = path.join(tmp, 'tone.wav');
    require('child_process').execFileSync(media.ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', wav]);
    const t0 = Date.now();
    const r = await transcribe.transcribeFile(wav, { language: 'en' });
    return `${Date.now() - t0} ms, ${JSON.stringify(r).length} bytes result`;
  });

  // Renderer: real preload, sandbox, CSP, real IPC handlers.
  const storage = req('electron/services/storage.js');
  storage.ensureBaseDirs();
  req('electron/ipc/projects.js').registerProjectsIpc();
  req('electron/ipc/tools.js').registerToolsIpc();
  req('electron/ipc/transcript.js').registerTranscriptIpc();
  req('electron/ipc/recording.js').registerRecordingIpc(() => null);

  // Windows stay alive (as in the app: the bar lives while the editor opens).
  const keep = [];
  for (const hash of ['hud', 'library']) {
    await check(`renderer #${hash} loads from asar under CSP + sandbox`, async () => {
      const win = new BrowserWindow({
        show: false, width: 1440, height: 900,
        webPreferences: { preload: path.join(ASAR, 'electron', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
      });
      const msgs = [];
      win.webContents.on('console-message', (e, level, message) => { if (level >= 2 || /Security Policy/.test(message)) msgs.push(message); });
      const remote = [];
      win.webContents.session.webRequest.onBeforeRequest((d, cb) => { if (!/^(file|data|blob|devtools|frameflow-media):/.test(d.url)) remote.push(d.url); cb({}); });
      try {
        await win.loadFile(path.join(ASAR, 'dist', 'index.html'), { hash });
        await new Promise((r) => setTimeout(r, 2500));
        const info = await win.webContents.executeJavaScript(`(async () => {
          const root = document.getElementById('root');
          const wasm = await WebAssembly.compileStreaming(fetch('./mediapipe/vision_wasm_internal.wasm'));
          const model = await (await fetch('./mediapipe/selfie_segmenter_landscape.tflite')).arrayBuffer();
          return { kids: root.childElementCount, text: root.innerText.slice(0, 80).replace(/\\s+/g, ' '), bridge: typeof window.frameflow, wasm: !!wasm, model: model.byteLength };
        })()`);
        const csp = msgs.filter((m) => /Security Policy/.test(m));
        if (csp.length) throw new Error(`CSP violations: ${csp.join(' || ')}`);
        if (remote.length) throw new Error(`network requests: ${remote.join(', ')}`);
        if (!info.kids) throw new Error('React rendered nothing');
        if (info.bridge !== 'object') throw new Error('preload bridge missing');
        return `${JSON.stringify(info)}${msgs.length ? `; console errors: ${msgs.join(' || ').slice(0, 300)}` : ''}`;
      } finally {
        keep.push(win);
      }
    });
  }

  for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? `  — ${d}` : ''}`);
  console.log(`\n${results.filter((r) => r[0] === 'PASS').length} passed, ${results.filter((r) => r[0] === 'FAIL').length} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  app.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
});
