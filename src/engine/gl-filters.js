// GPU image filters shared by the compositor (preview and export alike):
// an edge-limited unsharp mask used to sharpen the webcam and to restore
// detail when a zoom upscales the screen recording. Returns null when WebGL
// is unavailable, and callers then draw the source unfiltered.

const VERTEX = `
attribute vec2 pos;
varying vec2 uv;
void main() {
  uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

// `src` is the source window in texture UV (x, y, w, h); `texel` one source
// pixel. The high-pass detail is clamped so strong edges don't ring (no
// bright or dark halos around text and faces).
const SHARPEN = `
precision mediump float;
uniform sampler2D img;
uniform vec4 src;
uniform vec2 texel;
uniform float amount;
varying vec2 uv;
void main() {
  vec2 p = src.xy + uv * src.zw;
  vec4 c = texture2D(img, p);
  vec3 blur = (texture2D(img, p + vec2(texel.x, 0.0)).rgb + texture2D(img, p - vec2(texel.x, 0.0)).rgb
             + texture2D(img, p + vec2(0.0, texel.y)).rgb + texture2D(img, p - vec2(0.0, texel.y)).rgb) * 0.25;
  vec3 detail = clamp(c.rgb - blur, -0.09, 0.09);
  gl_FragColor = vec4(clamp(c.rgb + detail * amount, 0.0, 1.0), 1.0);
}`;

let state; // undefined: not tried yet; null: unavailable

function renderer() {
  if (state !== undefined) return state;
  state = null;
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : document.createElement('canvas');
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    const compile = (type, text) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, text);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, SHARPEN));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const u = (n) => gl.getUniformLocation(prog, n);
    state = { canvas, gl, src: u('src'), texel: u('texel'), amount: u('amount') };
  } catch {
    state = null;
  }
  return state;
}

// Sharpened copy of source window (sx, sy, sw, sh) of `source` (video,
// canvas or image of size srcW x srcH), rendered at outW x outH. The result
// is in the top-left outW x outH of the returned canvas, or null.
export function sharpen(source, srcW, srcH, sx, sy, sw, sh, outW, outH, amount) {
  const R = renderer();
  if (!R || !(srcW > 0) || !(srcH > 0)) return null;
  const { gl, canvas } = R;
  const w = Math.max(1, Math.round(outW));
  const h = Math.max(1, Math.round(outH));
  if (canvas.width < w || canvas.height < h) {
    canvas.width = Math.max(canvas.width, w);
    canvas.height = Math.max(canvas.height, h);
  }
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  } catch {
    return null;
  }
  gl.viewport(0, canvas.height - h, w, h);
  gl.uniform4f(R.src, sx / srcW, sy / srcH, sw / srcW, sh / srcH);
  gl.uniform2f(R.texel, 1 / srcW, 1 / srcH);
  gl.uniform1f(R.amount, amount);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return canvas;
}
