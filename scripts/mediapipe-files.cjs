// Files the camera cutout's person segmenter needs at runtime, served under
// mediapipe/ (published name → source path, relative to the project root).
// vite.config.js ships them; tests/electron/segmenter.test.js loads them.
module.exports = {
  'vision_wasm_internal.js': 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js',
  'vision_wasm_internal.wasm': 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm',
  'selfie_segmenter_landscape.tflite': 'assets/models/selfie_segmenter_landscape.tflite',
};
