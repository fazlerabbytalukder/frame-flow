// Content Security Policy for the built renderer (dist/index.html). The app is
// offline by design: everything loads from the app itself ('self' = the
// file:// bundle), recorded media from frameflow-media://, and canvas output
// as data:/blob: URLs. 'wasm-unsafe-eval' lets the MediaPipe person segmenter
// compile its WebAssembly; no JavaScript eval is allowed. React's style={…}
// attributes need 'unsafe-inline' styles.
//
// Only the production build gets it (the Vite dev server injects inline
// scripts for hot reload). tests/electron/segmenter.test.js runs the
// segmenter under this same policy.

const MEDIA = "'self' frameflow-media: blob: data:";

module.exports = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src ${MEDIA}`,
  `media-src ${MEDIA}`,
  `connect-src ${MEDIA}`,
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
