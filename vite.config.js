import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import MEDIAPIPE_FILES from './scripts/mediapipe-files.cjs';
import CSP from './scripts/csp.cjs';

// The production renderer gets a strict Content Security Policy (see
// scripts/csp.cjs). Dev builds skip it: Vite's hot reload injects inline code.
function contentSecurityPolicy() {
  return {
    name: 'frameflow-csp',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }];
    },
  };
}

// Person segmentation (camera cutout) runs locally: the MediaPipe Wasm
// runtime and the model ship inside the app under mediapipe/, served by the
// dev server and copied into dist/ at build time. Nothing is downloaded at
// runtime.

function mediapipeAssets() {
  const CONTENT_TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream' };
  return {
    name: 'frameflow-mediapipe-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/mediapipe\/([^/?#]+)/.exec(req.url || '');
        const src = m && MEDIAPIPE_FILES[m[1]];
        if (!src) return next();
        res.setHeader('Content-Type', CONTENT_TYPES[path.extname(m[1])]);
        fs.createReadStream(path.resolve(src)).pipe(res);
      });
    },
    generateBundle() {
      for (const [name, src] of Object.entries(MEDIAPIPE_FILES)) {
        this.emitFile({ type: 'asset', fileName: `mediapipe/${name}`, source: fs.readFileSync(path.resolve(src)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mediapipeAssets(), contentSecurityPolicy()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
