// Security: Electron hardening, IPC input validation, local file access,
// imported-project handling, and the "nothing leaves the machine" promise.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const storage = require('../../electron/services/storage');
const { suite, invoke, handlers, rejects } = require('./harness');
const { makeProject } = require('./fixtures');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

module.exports = (ctx) => {
  suite('Security', (test) => {
    test('renderer is isolated: contextIsolation on, nodeIntegration off, webSecurity on', () => {
      const main = read('electron/main.js');
      assert.match(main, /contextIsolation:\s*true/);
      assert.match(main, /nodeIntegration:\s*false/);
      assert.match(main, /webSecurity:\s*true/);
      assert.match(main, /sandbox:\s*true/);
      assert.doesNotMatch(main, /sandbox:\s*false/);
      assert.match(main, /setWindowOpenHandler/);
    });

    test('production shell: one instance, no navigation, no menu or DevTools when installed', () => {
      const main = read('electron/main.js');
      assert.match(main, /requestSingleInstanceLock\(\)/);
      assert.match(main, /'will-navigate'[\s\S]{0,200}preventDefault/);
      assert.match(main, /'will-attach-webview'[\s\S]{0,80}preventDefault/);
      assert.match(main, /devTools:\s*!app\.isPackaged/);
      assert.match(main, /if \(app\.isPackaged\) Menu\.setApplicationMenu\(null\)/);
    });

    test('the built renderer ships a strict Content Security Policy', () => {
      const csp = require('../../scripts/csp.cjs');
      const directives = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
      assert.deepEqual(directives['script-src'], ["'self'", "'wasm-unsafe-eval'"], 'no inline or eval JavaScript');
      assert.deepEqual(directives['object-src'], ["'none'"]);
      assert.deepEqual(directives['base-uri'], ["'none'"]);
      for (const [name, sources] of Object.entries(directives)) {
        for (const s of sources) assert.doesNotMatch(s, /^(https?:|\*|ws)/, `${name} allows no remote origin (${s})`);
      }
      const built = path.join(ROOT, 'dist', 'index.html');
      if (fs.existsSync(built)) {
        const html = fs.readFileSync(built, 'utf8');
        assert.ok(html.includes(`http-equiv="Content-Security-Policy"`), 'dist/index.html carries the policy (run npm run build)');
        assert.ok(html.includes(csp.replace(/'/g, '&#39;')) || html.includes(csp), 'dist/index.html carries the current policy');
      }
    });

    test('preloads expose only invoke wrappers and one allow-listed event (no Node APIs)', () => {
      const preload = read('electron/preload.js');
      const areaPreload = read('electron/area-preload.js');
      for (const src of [preload, areaPreload]) {
        assert.doesNotMatch(src, /require\((?!'electron')/);
        assert.doesNotMatch(src, /ipcRenderer\.(send|sendSync)\b/);
      }
      // The only main->renderer events are the global record shortcut,
      // main-window navigation and the update state; callbacks never receive
      // the raw IPC event.
      const listeners = [...preload.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map((m) => m[1]);
      assert.deepEqual(listeners, ['app:navigate', 'shortcut:record-toggle', 'update:state']);
      assert.match(preload, /const listener = \(\) => callback\(\);/);
      assert.match(preload, /const listener = \(_event, target\) => callback\(target\);/);
      assert.match(preload, /const listener = \(_event, state\) => callback\(state\);/);
      assert.doesNotMatch(areaPreload, /ipcRenderer\.on\b/);

      const channels = [...(preload + areaPreload).matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]);
      for (const ch of channels) assert.ok(handlers.has(ch), `preload channel ${ch} has a main handler`);
      for (const ch of handlers.keys()) assert.ok(channels.includes(ch), `handler ${ch} is reachable from a preload`);
    });

    test('area overlay only accepts results from its own window, sanitized', async () => {
      const { sanitizeArea, areaToCrop } = require('../../electron/services/area-select');
      assert.deepEqual(sanitizeArea({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 }), { x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
      assert.deepEqual(sanitizeArea({ x: -1, y: 0.5, w: 5, h: 0.9 }), { x: 0, y: 0.5, w: 1, h: 0.5 });
      for (const bad of [null, 'x', { x: 0, y: 0, w: 0.05, h: 0.5 }, { x: NaN, y: 0, w: 1, h: 1 }, { x: 0.95, y: 0, w: 1, h: 1 }]) {
        assert.equal(sanitizeArea(bad), null);
      }
      const crop = areaToCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
      assert.ok(Math.abs(crop.r - 0.4) < 1e-9 && Math.abs(crop.b - 0.4) < 1e-9);
      assert.equal(areaToCrop(null), null);
      // A result from some other sender (no overlay open) is ignored.
      assert.deepEqual(await invoke('area:done', { x: 0, y: 0, w: 1, h: 1 }), { ok: false });
      await rejects(invoke('recording:select-area'), /Select a screen first/);
    });

    test('path traversal is refused on every project-scoped IPC channel', async () => {
      const p = await makeProject(ctx, { seconds: 2 });
      const evilIds = ['..', '../..', '..\\..\\Windows', 'C:', '/etc', 'A-UPPER', ''];
      const channels = [
        ['projects:load'], ['projects:read-cursor'], ['projects:reveal-exports'], ['projects:reveal-folder'],
        ['projects:rename', 'x'], ['projects:delete'], ['projects:media-url', 'media/screen.webm'],
        ['recording:recover'], ['recording:discard-pending'],
      ];
      for (const [ch, ...rest] of channels) {
        for (const id of evilIds) await rejects(invoke(ch, id, ...rest), /Invalid project id/);
      }
      for (const rel of ['../project.json', '..\\..\\x', 'C:\\Windows\\win.ini', '/etc/passwd', 'media/../../x', 7]) {
        await rejects(invoke('projects:media-url', p.id, rel), /Invalid media path/);
      }
    });

    test('a tampered project.json on disk cannot point outside its folder', async () => {
      const p = await makeProject(ctx, { seconds: 2 });
      const file = storage.projectFile(p.id);
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      doc.assets[0].path = '..\\..\\..\\..\\Windows\\win.ini';
      fs.writeFileSync(file, JSON.stringify(doc));
      await rejects(invoke('projects:load', p.id), /relative/);
      const list = await invoke('projects:list');
      assert.ok(!list.some((x) => x.id === p.id), 'tampered project hidden from library');
    });

    test('save cannot write a project to a different id/path', async () => {
      const p = await makeProject(ctx, { seconds: 2 });
      const doc = await invoke('projects:load', p.id);
      await rejects(invoke('projects:save', { ...doc, id: '../../escape' }), /Invalid project id/);
      await rejects(invoke('projects:save', { ...doc, assets: [{ path: '/abs/file' }] }), /relative/);
      await rejects(invoke('projects:save', '{"id":"x"}'));
      assert.equal(fs.existsSync(path.join(storage.baseDir(), '..', 'escape')), false);
    });

    test('clipboard image input must be a real PNG data URL', () => {
      const { imageFromDataUrl } = require('../../electron/ipc/projects');
      const { nativeImage } = require('electron');
      const png = nativeImage.createFromBuffer(Buffer.alloc(4 * 4 * 4, 200), { width: 4, height: 4 }).toDataURL();
      assert.deepEqual(imageFromDataUrl(png).getSize(), { width: 4, height: 4 });
      for (const bad of [null, 42, 'file:///C:/Windows/win.ini', 'data:image/jpeg;base64,AAAA', 'data:image/png;base64,!!notpng']) {
        assert.throws(() => imageFromDataUrl(bad), /Invalid image/);
      }
      assert.throws(() => imageFromDataUrl('data:image/png;base64,' + 'A'.repeat(81 * 1024 * 1024)), /Invalid image/);
    });

    test('oversized and hostile strings are bounded', async () => {
      await rejects(invoke('recording:select-source', 'x'.repeat(129)), /Invalid source id/);
      await rejects(invoke('recording:select-source', { id: 1 }), /Invalid source id/);
      await rejects(invoke('recording:select-source', 'screen:does-not-exist'), /Unknown capture source/);
    });

    test('no network calls anywhere in the app (recordings never uploaded)', () => {
      // The local-network share server is the one exception, checked below.
      const SHARE_SERVER = path.join(ROOT, 'electron', 'services', 'share-server.js');
      const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'electron'))].filter((f) => f !== SHARE_SERVER);
      const offenders = [];
      for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        const hits = src.match(/\bfetch\(|XMLHttpRequest|WebSocket|https?\.request|axios|navigator\.sendBeacon|require\('https?'\)/g);
        if (hits) offenders.push(`${path.relative(ROOT, f)}: ${hits.join(', ')}`);
      }
      assert.deepEqual(offenders, []);
      // Only the share server listens, and nothing else in the app does.
      for (const f of files) {
        assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /createServer\(|\.listen\(/, `${path.relative(ROOT, f)} must not listen`);
      }
    });

    test('updates: the only outgoing connection, to the fixed GitHub release feed', () => {
      // electron-updater is loaded in exactly one place, and the updater
      // service itself has no network code of its own.
      const users = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'electron'))]
        .filter((f) => /electron-updater/.test(fs.readFileSync(f, 'utf8')))
        .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
      assert.deepEqual(users, ['electron/main.js', 'electron/services/updater.js']);
      assert.match(read('electron/main.js'), /require\('electron-updater'\)\.autoUpdater/);
      assert.doesNotMatch(read('electron/services/updater.js'), /require\(/, 'the service gets its updater injected');
      assert.doesNotMatch(read('electron/main.js'), /setFeedURL|allowPrerelease|allowDowngrade/, 'the feed comes only from package.json');
      const pkg = JSON.parse(read('package.json'));
      assert.deepEqual(pkg.build.publish.map((p) => [p.provider, p.owner, p.repo]), [['github', 'fazlerabbytalukder', 'frame-flow']]);
    });

    test('share server: serves only, never calls out; its page talks only to its own link', () => {
      const src = read('electron/services/share-server.js');
      assert.doesNotMatch(src, /https?\.(request|get)\(|require\('https'\)|net\.connect|\baxios\b|sendBeacon|WebSocket/);
      assert.match(src, /http\.createServer\(/);
      // Every fetch in the viewer page goes to `base` (the share's own path).
      const fetches = [...src.matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1]);
      assert.ok(fetches.length > 0);
      for (const target of fetches) assert.match(target, /^base\+/, `viewer fetch target: ${target}`);
      // The server only starts when a link exists (on demand or at launch).
      const main = read('electron/main.js');
      assert.match(main, /shareServer\.resumeSharing\(\)/);
      assert.match(src, /async function resumeSharing\(\) {\n  if \(readShares\(\)\.length > 0\) await ensureServer\(\);/);
    });

    test('media protocol only serves validated paths inside the project folder', () => {
      const main = read('electron/main.js');
      const handler = main.slice(main.indexOf("protocol.handle('frameflow-media'"));
      assert.match(handler, /assertProjectId\(url\.hostname\)/);
      assert.match(handler, /includes\('\.\.'\)/);
      assert.match(handler, /assertInsideBase\(/);
      assert.match(handler, /status: 404/);
    });

    test('global click hook is recording-scoped (stopped on finalize/discard)', () => {
      const rec = read('electron/ipc/recording.js');
      const finalize = rec.slice(rec.indexOf("'recording:finalize'"), rec.indexOf("'recording:discard'"));
      const discard = rec.slice(rec.indexOf("'recording:discard'"), rec.indexOf('--- crash recovery'));
      assert.match(finalize, /clickService\.stop\(\)/);
      assert.match(discard, /clickService\.stop\(\)/);
    });
  });
};
