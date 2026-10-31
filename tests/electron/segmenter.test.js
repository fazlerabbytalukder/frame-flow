// Camera cutout: the person segmenter loads from the files the app ships
// (scripts/mediapipe-files.cjs → mediapipe/) with no network, runs on a
// webcam-sized frame, and caches its mask per frame.
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { BrowserWindow } = require('electron');

const { suite } = require('./harness');

const ROOT = path.join(__dirname, '..', '..');
const MEDIAPIPE_FILES = require('../../scripts/mediapipe-files.cjs');
const CSP = require('../../scripts/csp.cjs');

module.exports = (ctx) => {
  suite('Person segmenter (camera cutout)', (test) => {
    test('loads the shipped model and masks a webcam frame', async () => {
      // A page whose base has a mediapipe/ folder, like dist/ in the app.
      const dir = path.join(ctx.tmpRoot, 'segmenter');
      fs.mkdirSync(path.join(dir, 'mediapipe'), { recursive: true });
      for (const [name, src] of Object.entries(MEDIAPIPE_FILES)) {
        fs.copyFileSync(path.join(ROOT, src), path.join(dir, 'mediapipe', name));
      }
      const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
      // The app's own CSP, plus hashes for this page's two inline scripts:
      // WebAssembly and model loading must work under the shipped policy.
      const importMap = JSON.stringify({ imports: { '@mediapipe/tasks-vision': url('node_modules/@mediapipe/tasks-vision/vision_bundle.mjs') } });
      const boot = `
import { loadPersonSegmenter } from '${url('src/engine/person-mask.js')}';
window.loadPersonSegmenter = loadPersonSegmenter;
window.ready = true;
`;
      const hash = (s) => `'sha256-${crypto.createHash('sha256').update(s).digest('base64')}'`;
      const csp = CSP.replace("script-src 'self'", `script-src 'self' ${hash(importMap)} ${hash(boot)}`);
      fs.writeFileSync(
        path.join(dir, 'page.html'),
        `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<script type="importmap">${importMap}</script>
</head><body><script type="module">${boot}</script></body></html>`
      );

      const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false } });
      const requests = [];
      win.webContents.session.webRequest.onBeforeRequest((details, cb) => {
        requests.push(details.url);
        cb({});
      });
      const violations = [];
      win.webContents.on('console-message', (e, level, message) => {
        if (/Content Security Policy/i.test(message)) violations.push(message);
      });
      try {
        await win.loadFile(path.join(dir, 'page.html'));
        for (let i = 0; i < 100 && !(await win.webContents.executeJavaScript('!!window.ready')); i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
        const res = await win.webContents.executeJavaScript(`(async () => {
          const masker = await loadPersonSegmenter();
          // An empty room: flat wall and a desk, nobody in frame.
          const cam = document.createElement('canvas');
          cam.width = 1280; cam.height = 720;
          const x = cam.getContext('2d');
          x.fillStyle = '#c9c2b8'; x.fillRect(0, 0, 1280, 720);
          x.fillStyle = '#6b4f3a'; x.fillRect(0, 560, 1280, 160);
          Object.assign(cam, { videoWidth: 1280, videoHeight: 720, readyState: 4, currentSrc: 'cam', currentTime: 0 });
          const mask = masker.maskFor(cam);
          const data = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
          let sum = 0;
          for (let i = 3; i < data.length; i += 4) sum += data[i];
          const again = masker.maskFor(cam);
          cam.currentTime = 0.5;
          const next = masker.maskFor(cam);
          return {
            w: mask.width, h: mask.height, meanAlpha: sum / (data.length / 4),
            cached: again === mask, sameCanvas: next === mask,
            notReady: masker.maskFor(Object.assign(document.createElement('canvas'), { videoWidth: 0, videoHeight: 0, readyState: 0 })),
          };
        })()`);
        assert.ok(res.w > 0 && res.h > 0, `mask has a size (${res.w}x${res.h})`);
        assert.ok(Math.abs(res.w / res.h - 16 / 9) < 0.1, `mask keeps the camera aspect (${res.w}x${res.h})`);
        assert.ok(res.meanAlpha < 10, `an empty room is not a person (mean alpha ${res.meanAlpha})`);
        assert.ok(res.cached, 'the same frame reuses its mask');
        assert.ok(res.sameCanvas, 'later frames reuse one canvas');
        assert.equal(res.notReady, null, 'no mask before the camera has a frame');
        const remote = requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:'));
        assert.deepEqual(remote, [], 'the segmenter never touches the network');
        assert.deepEqual(violations, [], 'the segmenter runs under the shipped CSP');
      } finally {
        win.destroy();
      }
    });
  });
};
