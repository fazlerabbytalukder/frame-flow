// Visual regression: renders frames with the real composition engine in a
// hidden Chromium window and checks pixels at known positions (zoom framing,
// crop, rounded corners, padding, aspect presets, overlays, fade, webcam).
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

const { suite } = require('./harness');

const RENDER_HELPERS = `
  window.render = (canvasW, canvasH, style, camera, extra = {}) => {
    const c = document.createElement('canvas');
    c.width = canvasW;
    c.height = canvasH;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const src = (window._src ||= makeSource());
    engine.drawFrame(ctx, {
      video: src, videoW: src.width, videoH: src.height, canvasW, canvasH,
      style: { background: 'none', padding: 0, cornerRadius: 0, shadow: false, ...style },
      camera: camera || { cx: 0.5, cy: 0.5, scale: 1 },
      ...extra,
    });
    return ctx;
  };
  window.px = (ctx, x, y) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3));
  true;
`;

const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const YELLOW = [255, 255, 0];
const DARK = [0x1c, 0x1f, 0x26];
const LIGHT = [0xe2, 0xe8, 0xf0];

function color(actual, expected, label, tol = 10) {
  const ok = actual.every((v, i) => Math.abs(v - expected[i]) <= tol);
  assert.ok(ok, `${label}: got rgb(${actual}) expected rgb(${expected})`);
}

module.exports = () => {
  let win;
  const run = async (body) => {
    if (!win) {
      win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { contextIsolation: false } });
      await win.loadFile(path.join(__dirname, 'visual.html'));
      for (let i = 0; i < 100 && !(await win.webContents.executeJavaScript('!!window.ready')); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await win.webContents.executeJavaScript(RENDER_HELPERS);
    }
    return win.webContents.executeJavaScript(`(() => { ${body} })()`);
  };

  suite('Visual regression (composition engine in Chromium)', (test) => {
    test('no zoom: full frame, quadrants in place', async () => {
      const [tl, tr, bl, br] = await run(`
        const c = render(1280, 720, {});
        return [px(c, 320, 180), px(c, 960, 180), px(c, 320, 540), px(c, 960, 540)];`);
      color(tl, RED, 'top-left');
      color(tr, GREEN, 'top-right');
      color(bl, BLUE, 'bottom-left');
      color(br, YELLOW, 'bottom-right');
    });

    test('zoom framing: a full-strength zoom near a corner fills the frame with that quadrant', async () => {
      const pixels = await run(`
        const cam = zoom.cameraAt([{ time: 0, duration: 4, x: 0.05, y: 0.05, scale: 2, transition: 0.5 }], 2);
        const c = render(1280, 720, {}, cam);
        return { cam, p: [px(c, 3, 3), px(c, 1276, 3), px(c, 3, 716), px(c, 1276, 716), px(c, 640, 360)] };`);
      assert.deepEqual(pixels.cam, { cx: 0.25, cy: 0.25, scale: 2 });
      pixels.p.forEach((p, i) => color(p, RED, `sample ${i}`));
    });

    test('zoom mid-transition is between identity and target', async () => {
      const { cam } = await run(`
        return { cam: zoom.cameraAt([{ time: 0, duration: 4, x: 0.25, y: 0.25, scale: 2, transition: 1 }], 0.5) };`);
      assert.ok(cam.scale > 1.4 && cam.scale < 1.6, `scale ${cam.scale}`);
      assert.ok(cam.cx > 0.25 && cam.cx < 0.5);
    });

    test('crop: cropped-away source is gone and content re-fits', async () => {
      const [band, green, yellow, outside] = await run(`
        const c = render(1280, 720, { background: 'solid-dark', crop: { l: 0.45 } });
        return [px(c, 300, 100), px(c, 600, 100), px(c, 600, 600), px(c, 100, 360)];`);
      color(band, RED, 'remaining red band');
      color(green, GREEN, 'green');
      color(yellow, YELLOW, 'yellow');
      color(outside, DARK, 'background beside cropped content');
    });

    test('rounded corners and padding', async () => {
      const [corner, edge, pad, center] = await run(`
        const c = render(1280, 720, { background: 'solid-light', padding: 0.1, cornerRadius: 60 });
        return [px(c, 130, 74), px(c, 200, 76), px(c, 64, 36), px(c, 400, 200)];`);
      color(corner, LIGHT, 'rounded-off corner shows background');
      color(edge, RED, 'top edge inside video');
      color(pad, LIGHT, 'padding area');
      color(center, RED, 'video content');
    });

    test('fit framing letterboxes portrait and square presets without cropping the recording', async () => {
      const res = await run(`
        const p = render(720, 1280, { background: 'solid-dark', framing: 'fit' });
        const s = render(720, 720, { background: 'solid-dark', framing: 'fit' });
        return {
          portrait: [px(p, 360, 200), px(p, 5, 442), px(p, 714, 838), px(p, 360, 1000)],
          square: [px(s, 360, 100), px(s, 5, 165), px(s, 714, 553)],
        };`);
      color(res.portrait[0], DARK, 'portrait top bar');
      color(res.portrait[1], RED, 'portrait content top-left corner');
      color(res.portrait[2], YELLOW, 'portrait content bottom-right corner');
      color(res.portrait[3], DARK, 'portrait bottom bar');
      color(res.square[0], DARK, 'square top bar');
      color(res.square[1], RED, 'square content top-left');
      color(res.square[2], YELLOW, 'square content bottom-right');
    });

    test('auto framing fills tall and square posts and pans after the cursor', async () => {
      const res = await run(`
        // Quadrant source: red | green over blue | yellow. Fill shows a
        // frame-shaped window of it; unzoomed it centres on camera.rest.
        const tall = (rest) => render(720, 1280, { background: 'solid-dark' }, { cx: 0.5, cy: 0.5, scale: 1, rest });
        const left = tall({ x: 0, y: 0.5 });
        const right = tall({ x: 1, y: 0.5 });
        const wide = render(1280, 720, { background: 'solid-dark' }, { cx: 0.5, cy: 0.5, scale: 1, rest: { x: 0, y: 0.5 } });
        const zoomed = render(720, 1280, { background: 'solid-dark' }, { cx: 0.9, cy: 0.5, scale: 2, rest: { x: 0, y: 0.5 } });
        return {
          top: px(left, 360, 20), leftTop: px(left, 360, 300), leftBottom: px(left, 360, 1000),
          rightTop: px(right, 360, 300), wideCenter: px(wide, 320, 180), zoomed: px(zoomed, 360, 300),
        };`);
      color(res.top, RED, 'no letterbox bar: the frame fills the tall canvas');
      color(res.leftTop, RED, 'resting on the left shows the left half');
      color(res.leftBottom, BLUE, '...top to bottom');
      color(res.rightTop, GREEN, 'the cursor on the right pans the frame there');
      color(res.wideCenter, RED, 'a 16:9 canvas still fits the whole screen (red quadrant top-left)');
      color(res.zoomed, GREEN, 'a zoom aims where it was pointed, not at the resting cursor');
    });

    test('captions: centred under the screen beside the camera, beside a corner bubble, above the reel bar', async () => {
      const res = await run(`
        const text = 'Hit save and the sprint board updates for everyone';
        const box = (ctx, y) => {
          // Caption boxes darken what is under them; find the dark run along row y.
          const row = ctx.getImageData(0, y, ctx.canvas.width, 1).data;
          let a = -1, b = -1;
          for (let x = 0; x < ctx.canvas.width; x++) {
            const dark = Math.max(row[x * 4], row[x * 4 + 1], row[x * 4 + 2]) < 100;
            if (dark && a < 0) a = x;
            if (dark) b = x;
          }
          return [a, b];
        };
        const split = render(1280, 720, { background: 'solid-light' }, null, {
          captionText: text, screenArea: { x: 0, y: 0, w: 800, h: 720 },
          webcamRect: { x: 820, y: 40, w: 440, h: 640, radius: 20, alpha: 1 },
        });
        const reel = render(720, 1280, { background: 'solid-light', framing: 'fit' }, null, { captionText: 'Short' });
        let reelBottom = 0;
        for (let y = 1279; y > 0; y--) { const p = px(reel, 360, y); if (Math.max(...p) < 100) { reelBottom = y; break; } }
        return { split: box(split, 665), reelBottom };`);
      const mid = (res.split[0] + res.split[1]) / 2;
      assert.ok(Math.abs(mid - 400) < 30, `caption centred under the screen area (${res.split})`);
      assert.ok(res.split[1] < 820, `and clear of the camera (${res.split})`);
      assert.ok(res.reelBottom > 0 && res.reelBottom <= 1280 * 0.8, `above the reel caption bar (${res.reelBottom})`);
    });

    test('overlays: annotation box, cursor and click ripple land on the right content', async () => {
      const res = await run(`
        const c = render(1280, 720, { cursor: { overlay: true, size: 1, clickHighlights: true } }, null, {
          annotations: [{ type: 'rect', x: 0.6, y: 0.1, x2: 0.9, y2: 0.4, color: '#ef4444' }],
          cursor: { x: 0.75, y: 0.75 },
          clicks: [{ x: 0.25, y: 0.75, age: 0 }],
        });
        return [px(c, 960, 72), px(c, 960, 200), px(c, 963, 553), px(c, 320 + 8.6, 540)];`);
      color(res[0], [0xef, 0x44, 0x44], 'annotation stroke', 30);
      color(res[1], GREEN, 'inside annotation box is untouched');
      assert.ok(res[2].every((v) => v > 200), `cursor should be white, got rgb(${res[2]})`);
      assert.ok(res[3][0] > 150 && res[3][1] > 120, `click ripple should be yellow over blue, got rgb(${res[3]})`);
    });

    test('annotations stay attached to content under zoom', async () => {
      const res = await run(`
        const style = {};
        const cam = { cx: 0.75, cy: 0.25, scale: 2 };
        const c = render(1280, 720, style, cam, {
          annotations: [{ type: 'rect', x: 0.6, y: 0.1, x2: 0.9, y2: 0.4, color: '#ef4444' }],
        });
        // At 2x on the green quadrant, crop-UV (0.75, 0.1) maps to canvas (640, 144).
        return [px(c, 640, 144), px(c, 640, 360)];`);
      color(res[0], [0xef, 0x44, 0x44], 'zoomed annotation edge', 30);
      color(res[1], GREEN, 'zoomed content');
    });

    test('fade transition at 0 shows only the background', async () => {
      const p = await run(`return px(render(1280, 720, { background: 'solid-dark' }, null, { fade: 0 }), 640, 360);`);
      color(p, DARK, 'faded frame');
    });

    test('clip transitions move the screen layer; dips cover the frame; settled frames are untouched', async () => {
      const r = await run(`
        const style = { background: 'solid-dark', padding: 0.1 };
        const sig = (ctx) => { const d = ctx.getImageData(0, 0, 1280, 720).data; let s = 0; for (let i = 0; i < d.length; i += 97) s = (s * 31 + d[i]) % 1000000007; return s; };
        const plain = sig(render(1280, 720, style));
        const out = {};
        for (const type of ['zoom', 'slide', 'slideUp', 'blur', 'wipe', 'black', 'white']) {
          out[type] = {
            mid: sig(render(1280, 720, style, null, { transition: { type, p: 0.4, dir: 'out' } })) !== plain,
            done: sig(render(1280, 720, style, null, { transition: { type, p: 1, dir: 'in' } })) === plain,
          };
        }
        out.black0 = px(render(1280, 720, style, null, { transition: { type: 'black', p: 0, dir: 'out' } }), 640, 360);
        out.white0 = px(render(1280, 720, style, null, { transition: { type: 'white', p: 0, dir: 'in' } }), 40, 40);
        // Slide out to the left: the left edge of the frame shows background.
        out.slideEdge = px(render(1280, 720, style, null, { transition: { type: 'slide', p: 0.3, dir: 'out' } }), 1100, 360);
        // Wipe in: the left part is the new clip, the right part background.
        out.wipeLeft = px(render(1280, 720, style, null, { transition: { type: 'wipe', p: 0.5, dir: 'in' } }), 300, 200);
        out.wipeRight = px(render(1280, 720, style, null, { transition: { type: 'wipe', p: 0.5, dir: 'in' } }), 1000, 200);
        return out;`);
      for (const type of ['zoom', 'slide', 'slideUp', 'blur', 'wipe', 'black', 'white']) {
        assert.ok(r[type].mid, `${type} changes the frame mid-transition`);
        assert.ok(r[type].done, `${type} leaves a settled frame untouched`);
      }
      color(r.black0, [0, 0, 0], 'dip to black at the cut');
      color(r.white0, [255, 255, 255], 'flash at the cut');
      color(r.slideEdge, DARK, 'slid-away frame reveals the background');
      color(r.wipeLeft, RED, 'wiped-on part shows the clip');
      color(r.wipeRight, DARK, 'not yet wiped part shows the background');
    });

    test('webcam PiP is fixed to the canvas, unaffected by zoom', async () => {
      const res = await run(`
        const cam = document.createElement('canvas');
        cam.width = 640; cam.height = 480;
        const x = cam.getContext('2d'); x.fillStyle = '#ff00ff'; x.fillRect(0, 0, 640, 480);
        Object.assign(cam, { readyState: 4, videoWidth: 640, videoHeight: 480 });
        const style = { webcam: { enabled: true, position: 'bottom-right', size: 0.22, shape: 'circle' } };
        const a = render(1280, 720, style, null, { webcamVideo: cam });
        const b = render(1280, 720, style, { cx: 0.3, cy: 0.3, scale: 2.5 }, { webcamVideo: cam });
        const off = render(1280, 720, { webcam: { enabled: false } }, null, { webcamVideo: cam });
        return [px(a, 1176, 616), px(b, 1176, 616), px(off, 1176, 616), px(a, 1050, 500)];`);
      color(res[0], [255, 0, 255], 'webcam center');
      color(res[1], [255, 0, 255], 'webcam center under zoom');
      color(res[2], YELLOW, 'webcam disabled');
      color(res[3], YELLOW, 'outside the circle mask');
    });

    test('captions render as a bottom-centered block', async () => {
      const res = await run(`
        const a = render(1280, 720, {}, null, { captionText: 'Click Save to continue' });
        return [px(a, 640, 620), px(a, 300, 300)];`);
      assert.ok(res[0].every((v) => v < 120), `caption backdrop should darken, got rgb(${res[0]})`);
      color(res[1], RED, 'caption leaves upper frame alone');
    });

    test('rendering is deterministic and resolution independent (preview == export framing)', async () => {
      const res = await run(`
        const style = { background: 'gradient-1', padding: 0.06, cornerRadius: 18, shadow: true, crop: { l: 0.05, t: 0.1 } };
        const cam = { cx: 0.6, cy: 0.4, scale: 1.5 };
        const extra = { annotations: [{ type: 'arrow', x: 0.2, y: 0.2, x2: 0.5, y2: 0.5 }], captionText: 'Hello' };
        const a1 = render(1920, 1080, style, cam, extra).getImageData(0, 0, 1920, 1080).data;
        const a2 = render(1920, 1080, style, cam, extra).getImageData(0, 0, 1920, 1080).data;
        let identical = a1.length === a2.length;
        for (let i = 0; identical && i < a1.length; i++) if (a1[i] !== a2[i]) identical = false;

        const big = render(1920, 1080, style, cam);
        const small = render(960, 540, style, cam);
        let mismatches = 0, total = 0;
        for (let y = 0.03; y < 0.97; y += 0.047) {
          for (let x = 0.03; x < 0.97; x += 0.047) {
            const p = px(big, x * 1920, y * 1080);
            const q = px(small, x * 960, y * 540);
            total++;
            if (p.some((v, i) => Math.abs(v - q[i]) > 24)) mismatches++;
          }
        }
        return { identical, mismatches, total };`);
      assert.equal(res.identical, true, 'same inputs must produce identical pixels');
      assert.ok(res.mismatches / res.total < 0.03, `${res.mismatches}/${res.total} sample points differ across resolutions`);
    });

    test('preview and exporter both draw through the shared engine', () => {
      const root = path.join(__dirname, '..', '..', 'src');
      const editor = fs.readFileSync(path.join(root, 'features/editor/EditorView.jsx'), 'utf8');
      const exporter = fs.readFileSync(path.join(root, 'engine/export-planner.js'), 'utf8');
      // Both must render only through frame-state's composeFrame, never by
      // assembling their own camera/cursor/overlay inputs.
      for (const [name, src] of [['EditorView', editor], ['export-planner', exporter]]) {
        assert.match(src, /composeFrame\(/, `${name} calls composeFrame`);
        assert.doesNotMatch(src, /\bdrawFrame\(|\bcameraAt\(|\bsmoothedCursorAt\(/, `${name} bypasses frame-state`);
      }
    });

    test('performance: 1080p composite + readback per frame', async () => {
      const r = await run(`
        const style = { background: 'gradient-2', padding: 0.06, cornerRadius: 18, shadow: true, cursor: { overlay: true } };
        const extra = { cursor: { x: 0.5, y: 0.5 }, clicks: [{ x: 0.5, y: 0.5, age: 0.1 }], captionText: 'Perf' };
        const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        const src = window._src;
        const t0 = performance.now();
        for (let i = 0; i < 60; i++) {
          engine.drawFrame(ctx, { video: src, videoW: src.width, videoH: src.height, canvasW: 1920, canvasH: 1080,
            style, camera: zoom.cameraAt([{ time: 0, duration: 2, x: 0.3, y: 0.3, scale: 2, transition: 0.5 }], i / 30), ...extra });
          ctx.getImageData(0, 0, 1920, 1080);
        }
        const draw = (performance.now() - t0) / 60;
        const t1 = performance.now();
        for (let i = 0; i < 60; i++) engine.drawFrame(ctx, { video: src, videoW: src.width, videoH: src.height, canvasW: 1920, canvasH: 1080, style, camera: { cx: 0.5, cy: 0.5, scale: 1 }, ...extra });
        const preview = (performance.now() - t1) / 60;
        return { draw, preview, heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null };`);
      console.log(`      perf: export frame ${r.draw.toFixed(1)} ms (draw+readback), preview frame ${r.preview.toFixed(2)} ms, renderer heap ${r.heapMB?.toFixed(0)} MB`);
      assert.ok(r.preview < 16, `preview draw ${r.preview.toFixed(1)} ms exceeds a 60 fps budget`);
      assert.ok(r.draw < 100, `export frame ${r.draw.toFixed(1)} ms`);
    });

    test('motion blur smears a fast pan; a still frame stays sharp', async () => {
      const res = await run(`
        const src = window._src;
        const project = {
          clips: [{ id: 'c', start: 0, duration: 4, speed: 1 }],
          zoomEvents: [
            { id: 'a', time: 0, duration: 1, x: 0.25, y: 0.25, scale: 2, follow: false },
            { id: 'b', time: 1, duration: 3, x: 0.75, y: 0.25, scale: 2, follow: false },
          ],
          captions: [], annotations: [],
          style: { background: 'none', padding: 0, cornerRadius: 0, shadow: false,
                   cursor: { overlay: false }, clipTransition: { type: 'none' },
                   animation: { screen: 'focused', motionBlur: { strength: 1 } } },
        };
        const media = { video: src, videoW: src.width, videoH: src.height, canvasW: 640, canvasH: 360 };
        const mk = () => { const c = document.createElement('canvas'); c.width = 640; c.height = 360; return c.getContext('2d', { willReadFrequently: true }); };
        // Count pixels along the middle row that are neither pure red nor pure green.
        const mixed = (ctx) => {
          const row = ctx.getImageData(0, 90, 640, 1).data;
          let n = 0;
          for (let i = 0; i < row.length; i += 4) {
            const red = row[i] > 245 && row[i + 1] < 10, green = row[i] < 10 && row[i + 1] > 245;
            if (!red && !green) n++;
          }
          return n;
        };
        const sharp = mk(); const blurred = mk(); const still = mk();
        const panT = 1.12; // mid-pan between the two zooms
        frame.composeFrame(sharp, project, null, panT, media, { blurSamples: 1 });
        const used = frame.composeFrame(blurred, project, null, panT, media, { blurSamples: 8 });
        const stillUsed = frame.composeFrame(still, project, null, 3.5, media, { blurSamples: 8 }); // long settled
        return { sharp: mixed(sharp), blurred: mixed(blurred), used, stillUsed, still: mixed(still) };`);
      assert.equal(res.used, 8, 'pan should use all blur sub-frames');
      assert.equal(res.stillUsed, 1, 'a settled camera should not be blurred');
      assert.ok(res.sharp <= 4, `sharp frame has ${res.sharp} mixed pixels`);
      assert.ok(res.blurred > 20, `blurred frame should have a smeared seam, got ${res.blurred}`);
    });

    test('keyboard shortcut keycaps render bottom-center and fade out', async () => {
      const res = await run(`
        const sc = (age) => [{ keys: ['Ctrl', 'Shift', 'S'], age, hold: 1.2 }];
        const on = render(1280, 720, {}, null, { shortcuts: sc(0.5) });
        const gone = render(1280, 720, {}, null, { shortcuts: sc(1.25) });
        return [px(on, 640, 663), px(gone, 640, 663), px(on, 100, 663)];`);
      assert.ok(res[0].every((v) => v < 60), `keycap should be dark, got rgb(${res[0]})`);
      color(res[1], YELLOW, 'keycap gone after hold');
      color(res[2], BLUE, 'keycaps leave the sides alone');
    });

    test('cursor overlay honours opacity (idle hide) and tilt', async () => {
      const res = await run(`
        const style = { cursor: { overlay: true, size: 2 } };
        const visible = render(1280, 720, style, null, { cursor: { x: 0.75, y: 0.75, opacity: 1 } });
        const hidden = render(1280, 720, style, null, { cursor: { x: 0.75, y: 0.75, opacity: 0 } });
        const tilted = render(1280, 720, style, null, { cursor: { x: 0.75, y: 0.75, opacity: 1, rotation: -0.35 } });
        return [px(visible, 963, 556), px(hidden, 963, 556), px(tilted, 963, 556)];`);
      assert.ok(res[0].every((v) => v > 200), `cursor visible, got rgb(${res[0]})`);
      color(res[1], YELLOW, 'cursor hidden at opacity 0');
      assert.notDeepEqual(res[2], res[0], 'tilt changes the drawn pointer');
    });

    test('cursor styles, click bounce and click effects render', async () => {
      const res = await run(`
        const at = { x: 0.75, y: 0.75, opacity: 1 };
        const classic = render(1280, 720, { cursor: { overlay: true, size: 2, type: 'classic' } }, null, { cursor: at });
        const dark = render(1280, 720, { cursor: { overlay: true, size: 2, type: 'dark' } }, null, { cursor: at });
        const squeezed = render(1280, 720, { cursor: { overlay: true, size: 2 } }, null, { cursor: { ...at, scale: 0.5 } });
        const fx = { clickEffect: 'ring', clickColor: '#2680eb', clickOpacity: 1, clickDuration: 1500 };
        const click = [{ x: 0.75, y: 0.75, age: 0.1 }];
        const ring = render(1280, 720, { cursor: { overlay: false, ...fx } }, null, { clicks: click });
        const none = render(1280, 720, { cursor: { overlay: false, ...fx, clickEffect: 'none' } }, null, { clicks: click });
        return {
          classic: px(classic, 963, 556), dark: px(dark, 963, 556),
          tip: px(classic, 963, 570), squeezedTip: px(squeezed, 963, 570),
          ring: px(ring, 971, 540), none: px(none, 971, 540),
        };`);
      assert.ok(res.classic.every((v) => v > 200), `classic arrow is white: ${res.classic}`);
      assert.ok(res.dark.every((v) => v < 60), `dark arrow is dark: ${res.dark}`);
      assert.ok(res.tip.every((v) => v > 200), `full-size arrow reaches the sample: ${res.tip}`);
      color(res.squeezedTip, YELLOW, 'a pressed (bounced) cursor is smaller');
      assert.ok(res.ring[2] > 180 && res.ring[0] < 90, `ring drawn in the effect color: ${res.ring}`);
      color(res.none, YELLOW, 'no effect');
    });

    test('blur mask pixelates the region irreversibly; cursor stays sharp on top', async () => {
      const res = await run(`
        // Fine detail: 1-px stripes inside the red quadrant stand in for text.
        const src = window._detail ||= (() => {
          const c = makeSource();
          const x = c.getContext('2d');
          x.fillStyle = '#ffffff';
          for (let i = 0; i < 200; i += 2) x.fillRect(100 + i, 100, 1, 200);
          return c;
        })();
        const draw = (annotations, cursor) => {
          const c = document.createElement('canvas'); c.width = 1600; c.height = 900;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          engine.drawFrame(ctx, { video: src, videoW: 1600, videoH: 900, canvasW: 1600, canvasH: 900,
            style: { background: 'none', padding: 0, cornerRadius: 0, shadow: false, cursor: { overlay: Boolean(cursor), size: 2 } },
            camera: { cx: 0.5, cy: 0.5, scale: 1 }, annotations, cursor });
          return ctx;
        };
        // Count stripe edges along a row: detail survives as many alternations.
        const edges = (ctx) => {
          const row = ctx.getImageData(100, 200, 200, 1).data;
          let n = 0;
          for (let i = 4; i < row.length; i += 4) if (Math.abs(row[i + 1] - row[i - 3]) > 60) n++;
          return n;
        };
        const plain = draw([]);
        const masked = draw([{ type: 'blur', x: 0.05, y: 0.1, x2: 0.2, y2: 0.35 }]);
        const withCursor = draw([{ type: 'blur', x: 0.05, y: 0.1, x2: 0.2, y2: 0.35 }], { x: 0.1, y: 0.2 });
        return { plain: edges(plain), masked: edges(masked), outside: px(masked, 500, 600), cursor: px(withCursor, 168, 214) };`);
      assert.ok(res.plain > 150, `fixture should have fine detail (${res.plain} edges)`);
      assert.ok(res.masked < 25, `detail should be destroyed, still ${res.masked} edges`);
      color(res.outside, BLUE, 'pixels outside the mask untouched');
      assert.ok(res.cursor.every((v) => v > 200), `cursor drawn over the mask, got rgb(${res.cursor})`);
    });

    test('spotlight dims everything except the highlighted region', async () => {
      const res = await run(`
        const c = render(1280, 720, {}, null, { annotations: [{ type: 'spotlight', x: 0.1, y: 0.1, x2: 0.4, y2: 0.4, dim: 0.6 }] });
        return [px(c, 320, 180), px(c, 960, 180), px(c, 960, 540)];`);
      color(res[0], RED, 'inside the spotlight');
      color(res[1], [0, 102, 0], 'green outside, dimmed 60%', 6);
      color(res[2], [102, 102, 0], 'yellow outside, dimmed 60%', 6);
    });

    test('loupe magnifies inside the lens only, bends like glass, and cannot reveal blurred content', async () => {
      const res = await run(`
        const src = window._detail; // 1-px stripes at source x 100..300, y 100..300
        const draw = (opts) => {
          const c = document.createElement('canvas'); c.width = 1600; c.height = 900;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          engine.drawFrame(ctx, { video: src, videoW: 1600, videoH: 900, canvasW: 1600, canvasH: 900,
            style: { background: 'none', padding: 0, cornerRadius: 0, shadow: false },
            camera: { cx: 0.5, cy: 0.5, scale: 1 }, ...opts });
          return ctx;
        };
        // Stripe transitions after thresholding (smoothing spreads one edge
        // over several pixels, so raw gradients would over-count).
        const edges = (ctx, x, y, w) => {
          const row = ctx.getImageData(x, y, w, 1).data;
          let n = 0;
          for (let i = 4; i < row.length; i += 4) if ((row[i + 1] > 128) !== (row[i - 3] > 128)) n++;
          return n;
        };
        // Colour fringing: white-on-red stripes have equal green and blue
        // unless the lens samples those channels at different points.
        const split = (ctx, x0, x1, y) => {
          const row = ctx.getImageData(x0, y, x1 - x0, 1).data;
          let max = 0;
          for (let i = 0; i < row.length; i += 4) max = Math.max(max, Math.abs(row[i + 1] - row[i + 2]));
          return max;
        };
        const lens = { x: 200 / 1600, y: 200 / 900, scale: 4, radius: 0.12, strength: 1 };
        const plain = draw({});
        const loupe = draw({ loupe: lens });
        const masked = draw({ loupe: lens, annotations: [{ type: 'blur', x: 0.05, y: 0.1, x2: 0.2, y2: 0.35 }] });
        return {
          plainIn: edges(plain, 170, 200, 60), loupeIn: edges(loupe, 170, 200, 60),
          outside: px(loupe, 800, 600), maskedIn: edges(masked, 170, 200, 60),
          rim: px(loupe, 200 + 107, 200), plainRim: px(plain, 200 + 107, 200),
          splitCentre: split(loupe, 190, 210, 200), splitEdge: split(loupe, 280, 304, 200),
          splitPlain: split(plain, 100, 300, 200),
        };`);
      assert.ok(res.plainIn >= 50, `fixture stripes (${res.plainIn})`);
      assert.ok(res.loupeIn <= res.plainIn / 3 + 2, `4x lens should widen stripes: ${res.loupeIn} vs ${res.plainIn}`);
      assert.ok(res.loupeIn >= 8, `stripes still visible (magnified) inside the lens: ${res.loupeIn}`);
      color(res.outside, YELLOW, 'outside the lens untouched');
      assert.ok(res.maskedIn <= 6, `lens must not reveal masked detail (${res.maskedIn} edges)`);
      assert.notDeepEqual(res.rim, res.plainRim, 'the rim is shaded glass');
      assert.ok(res.splitPlain <= 2, `fixture has no colour split (${res.splitPlain})`);
      assert.ok(res.splitCentre <= 12, `no fringes at the lens centre (${res.splitCentre})`);
      assert.ok(res.splitEdge >= 30, `colour fringes near the rim (${res.splitEdge})`);
    });

    test('reel safe zones shade the platform UI areas only', async () => {
      const res = await run(`
        const c = render(1080, 1920, { background: 'solid-dark' });
        const before = [px(c, 540, 60), px(c, 1000, 1100), px(c, 540, 1800), px(c, 540, 1000)];
        drawSafeZones(c, 1080, 1920);
        const after = [px(c, 540, 60), px(c, 1000, 1100), px(c, 540, 1800), px(c, 540, 1000)];
        return { before, after };`);
      for (const i of [0, 1, 2]) {
        const shift = res.after[i].reduce((sum, v, k) => sum + Math.abs(v - res.before[i][k]), 0);
        assert.ok(shift > 30, `zone ${i} tinted: ${res.before[i]} -> ${res.after[i]}`);
      }
      assert.deepEqual(res.after[3], res.before[3], 'center of the frame stays clear');
    });

    test('camera layouts: split, full camera, screen only, and the overlay bubble', async () => {
      const res = await run(`
        const src = window._src;
        const cam = document.createElement('canvas');
        cam.width = 640; cam.height = 480;
        const cx = cam.getContext('2d'); cx.fillStyle = '#ff00ff'; cx.fillRect(0, 0, 640, 480);
        Object.assign(cam, { readyState: 4, videoWidth: 640, videoHeight: 480 });
        const project = {
          assets: [{ type: 'webcam-recording' }],
          clips: [{ id: 'c', start: 0, duration: 20, speed: 1 }],
          zoomEvents: [], captions: [], annotations: [],
          layouts: [
            { id: 'a', time: 2, duration: 2, layout: 'split' },
            { id: 'b', time: 6, duration: 2, layout: 'camera' },
            { id: 'c', time: 10, duration: 2, layout: 'screen' },
          ],
          style: { background: 'solid-dark', padding: 0, cornerRadius: 0, shadow: false, cursor: { overlay: false },
                   clipTransition: { type: 'none' }, animation: { screen: 'classic' },
                   webcam: { enabled: true, position: 'bottom-right', size: 0.22 } },
        };
        const media = { video: src, videoW: 1600, videoH: 900, canvasW: 1280, canvasH: 720, webcamVideo: cam };
        const at = (t) => {
          const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          frame.composeFrame(ctx, project, null, t, media);
          return ctx;
        };
        const split = at(3), camera = at(7), screen = at(11), overlay = at(1);
        return {
          splitLeft: px(split, 200, 300), splitRight: px(split, 1100, 360),
          camera: [px(camera, 50, 50), px(camera, 640, 360)],
          screen: px(screen, 1176, 616), overlay: px(overlay, 1176, 616),
        };`);
      color(res.splitLeft, RED, 'split: screen content on the left');
      color(res.splitRight, [255, 0, 255], 'split: camera on the right');
      res.camera.forEach((p) => color(p, [255, 0, 255], 'camera layout fills the canvas'));
      color(res.screen, YELLOW, 'screen-only hides the camera');
      color(res.overlay, [255, 0, 255], 'default overlay bubble');
    });

    test('inset bezel rings the video; shadow follows its angle', async () => {
      const res = await run(`
        const style = { background: 'solid-light', padding: 0.1, cornerRadius: 0, inset: { size: 0.02, color: 'dark' } };
        const c = render(1280, 720, style);
        // Frame spans x 128..1152; a 14.4 px dark bezel sits inside it.
        const bezel = px(c, 132, 360), video = px(c, 160, 300);
        const right = render(1280, 720, { background: 'solid-light', padding: 0.1, shadow: true,
          shadowStyle: { angle: 0, distance: 0.05, blur: 0, opacity: 1 } });
        const left = render(1280, 720, { background: 'solid-light', padding: 0.1, shadow: true,
          shadowStyle: { angle: 180, distance: 0.05, blur: 0, opacity: 1 } });
        return { bezel, video, rightOfFrame: px(right, 1160, 360), leftOfFrameR: px(right, 120, 360),
                 leftOfFrame: px(left, 120, 360) };`);
      color(res.bezel, [0x0f, 0x11, 0x15], 'dark bezel');
      color(res.video, RED, 'video inside the bezel');
      color(res.rightOfFrame, [0, 0, 0], 'angle 0 casts the shadow to the right');
      color(res.leftOfFrameR, LIGHT, 'nothing on the left for angle 0');
      color(res.leftOfFrame, [0, 0, 0], 'angle 180 casts it to the left');
    });

    test('backgrounds: solid color, custom gradient direction, wallpapers and blur', async () => {
      const r = await run(`
        const color = render(400, 200, { background: 'color', backgroundColor: '#336699', padding: 0.2 });
        const grad = render(400, 200, {
          background: 'gradient', backgroundGradient: { from: '#ff0000', to: '#0000ff', angle: 90 }, padding: 0.2,
        });
        const wp = render(400, 200, { background: 'wall-steel', padding: 0.2 });
        const sharp = render(400, 200, { background: 'wall-nebula', padding: 0.2 });
        const soft = render(400, 200, { background: 'wall-nebula', backgroundBlur: 1, padding: 0.2 });
        let diff = 0;
        for (const [x, y] of [[10, 10], [390, 10], [10, 190], [390, 190], [200, 10], [30, 100]]) {
          const a = px(sharp, x, y), b = px(soft, x, y);
          diff += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
        }
        return { color: px(color, 5, 5), left: px(grad, 2, 100), right: px(grad, 397, 100), wp: px(wp, 5, 195), diff };`);
      color(r.color, [0x33, 0x66, 0x99], 'solid color background');
      assert.ok(r.left[0] > 200 && r.left[2] < 60, `90deg gradient starts red on the left: ${r.left}`);
      assert.ok(r.right[2] > 200 && r.right[0] < 60, `and ends blue on the right: ${r.right}`);
      assert.ok(r.wp[2] > r.wp[0], `steel wallpaper is blue-toned: ${r.wp}`);
      assert.ok(r.diff > 30, `blur changes the wallpaper (diff ${r.diff})`);
    });

    test('camera cutout keeps the camera only where the mask says person', async () => {
      const r = await run(`
        const cam = document.createElement('canvas'); cam.width = 640; cam.height = 360;
        const cx = cam.getContext('2d'); cx.fillStyle = '#ff00ff'; cx.fillRect(0, 0, 640, 360);
        Object.assign(cam, { videoWidth: 640, videoHeight: 360, readyState: 4 });
        // "Person" on the left half of the frame only.
        const mask = document.createElement('canvas'); mask.width = 64; mask.height = 36;
        const mx = mask.getContext('2d'); mx.fillStyle = '#fff'; mx.fillRect(0, 0, 32, 36);
        const rect = { x: 800, y: 300, w: 640, h: 360, radius: 0, alpha: 1, cutout: 1 };
        const style = { webcam: { enabled: true } };
        const cut = render(1600, 900, style, null, { webcamVideo: cam, webcamRect: rect, webcamMask: mask });
        const framed = render(1600, 900, style, null, { webcamVideo: cam, webcamRect: rect });
        const half = render(1600, 900, style, null, { webcamVideo: cam, webcamRect: { ...rect, cutout: 0.5 }, webcamMask: mask });
        return {
          personSide: px(cut, 900, 480), backgroundSide: px(cut, 1350, 480),
          framedRight: px(framed, 1350, 480), halfRight: px(half, 1350, 480),
        };`);
      color(r.personSide, [255, 0, 255], 'camera pixels where the mask is opaque');
      color(r.backgroundSide, YELLOW, 'the screen shows through where the mask is clear', 30);
      color(r.framedRight, [255, 0, 255], 'without a mask the framed camera is shown');
      assert.ok(r.halfRight[2] > 60 && r.halfRight[2] < 200, `mid-switch the frame is fading out: ${r.halfRight}`);
    });

    test('layered wallpapers: every built-in paints, tilted ribbons cover the corners', async () => {
      const r = await run(`
        const out = {};
        for (const wp of engine.WALLPAPERS) {
          const c = document.createElement('canvas');
          c.width = 320;
          c.height = 180;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          engine.paintWallpaper(ctx, 320, 180, wp);
          const grid = [];
          for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 5; gx++) grid.push(px(ctx, 2 + gx * 79, 2 + gy * 44));
          out[wp.id] = grid;
        }
        const tall = render(180, 320, { background: 'silk-citrus', padding: 0.25 });
        out.tall = [px(tall, 1, 1), px(tall, 178, 318)];
        out.categories = engine.WALLPAPERS.map((w) => w.category);
        out.ids = engine.WALLPAPERS.map((w) => w.id);
        return out;`);
      const categories = new Set(r.categories);
      assert.ok(['silk', 'horizon', 'mesh', 'glow'].every((c) => categories.has(c)), 'all categories populated');
      assert.equal(new Set(r.ids).size, r.ids.length, 'wallpaper ids are unique');
      for (const id of r.ids) {
        const pts = r[id];
        const spread = Math.max(...pts.map((p) => p[0] + p[1] + p[2])) - Math.min(...pts.map((p) => p[0] + p[1] + p[2]));
        assert.ok(spread > 12, `${id} is not a flat fill (spread ${spread})`);
      }
      // Sky above, darker hills along the bottom row.
      const sum = (p) => p[0] + p[1] + p[2];
      const dawn = r['horizon-dawn'];
      assert.ok(sum(dawn[12]) > sum(dawn[22]), `dawn sky is brighter than its hills`);
      // A tilted field in a portrait canvas still has no transparent corners.
      for (const p of r.tall) assert.ok(p[0] + p[1] + p[2] > 30, `portrait corner painted: ${p}`);
    });

    test('remove background: the recording fills the canvas with square corners', async () => {
      const [corner, center] = await run(`
        const c = render(1280, 720, { background: 'solid-light', padding: 0.1, cornerRadius: 60, frameless: true });
        return [px(c, 1, 1), px(c, 320, 180)];`);
      color(corner, RED, 'corner pixel is video, not background');
      color(center, RED, 'video content');
    });

    test('separate vertical padding', async () => {
      const [top, side] = await run(`
        const c = render(1280, 720, { background: 'solid-light', padding: 0.02, paddingY: 0.2 });
        return [px(c, 640, 100), px(c, 340, 250)];`);
      color(top, LIGHT, 'tall vertical padding shows background above the video');
      color(side, RED, 'video content');
    });

    test('device frames: laptop shell and base, browser bar, phone island', async () => {
      const r = await run(`
        const style = { background: 'solid-light', padding: 0.12, device: 'laptop', shadow: false };
        const c = render(1280, 720, style);
        const g = engine.computeGeometry({ videoW: 1600, videoH: 900, canvasW: 1280, canvasH: 720, style, camera: { cx: 0.5, cy: 0.5, scale: 1 } });
        const out = {
          bezel: px(c, g.frame.x + (g.rect.x - g.frame.x) / 2, g.frame.y + g.frame.h / 2),
          screen: px(c, g.rect.x + 20, g.rect.y + 20),
          base: px(c, g.frame.x + g.frame.w / 2 - g.frame.w * 0.2, g.frame.y + g.frame.h + g.device.base * g.device.u * 0.5),
        };
        const bstyle = { background: 'solid-light', padding: 0.1, device: 'browser', shadow: false };
        const b = render(1280, 720, bstyle);
        const bg = engine.computeGeometry({ videoW: 1600, videoH: 900, canvasW: 1280, canvasH: 720, style: bstyle, camera: { cx: 0.5, cy: 0.5, scale: 1 } });
        const barH = bg.rect.y - bg.frame.y;
        out.dot = px(b, bg.frame.x + barH * 0.55, bg.frame.y + barH / 2);
        out.bar = px(b, bg.frame.x + bg.frame.w * 0.9, bg.frame.y + barH / 2);
        const pstyle = { background: 'solid-light', padding: 0.05, device: 'phone', shadow: false };
        const ph = render(720, 1280, pstyle);
        const pg = engine.computeGeometry({ videoW: 1600, videoH: 900, canvasW: 720, canvasH: 1280, style: pstyle, camera: { cx: 0.5, cy: 0.5, scale: 1 } });
        // 9:16 canvas: the 16:9 recording fills a portrait phone screen, island on top.
        out.portrait = pg.rect.h > pg.rect.w;
        out.island = px(ph, pg.rect.x + pg.rect.w / 2, pg.rect.y + 0.03 * pg.device.u + 0.0375 * pg.device.u);
        return out;`);
      assert.ok(r.bezel.every((v) => v < 60), `dark laptop bezel: ${r.bezel}`);
      color(r.screen, RED, 'screen inside the bezel');
      assert.ok(r.base[0] > 110 && Math.abs(r.base[0] - r.base[2]) < 30, `aluminium base below the lid: ${r.base}`);
      color(r.dot, [0xff, 0x5f, 0x57], 'browser close dot', 30);
      assert.ok(r.bar.every((v) => v < 80), `browser bar: ${r.bar}`);
      assert.ok(r.portrait, 'portrait phone screen');
      assert.ok(r.island.every((v) => v < 30), `phone camera island at the top: ${r.island}`);
    });

    test('caption looks and animations: words appear in time, karaoke and highlight use the accent', async () => {
      const r = await run(`
        const count = (ctx, test) => {
          const d = ctx.getImageData(0, 560, 1280, 160).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (test(d[i], d[i + 1], d[i + 2])) n++;
          return n;
        };
        const white = (r, g, b) => r > 235 && g > 235 && b > 235;
        const accent = (r, g, b) => r < 30 && g > 225 && b < 30;
        const cap = (age) => ({ text: 'Hello world again', duration: 3, age,
          words: [{ text: 'Hello', t: 0, d: 0.4 }, { text: 'world', t: 1, d: 0.4 }, { text: 'again', t: 2, d: 0.4 }] });
        const look = (captions, age) => render(1280, 720, { background: 'solid-dark', captions }, null, { caption: cap(age) });
        return {
          early: count(look({ animation: 'words' }, 0.2), white),
          late: count(look({ animation: 'words' }, 2.5), white),
          karaoke: count(look({ animation: 'karaoke', color: '#00ff00' }, 1.1), accent),
          karaokeGap: count(look({ animation: 'karaoke', color: '#00ff00' }, 0.7), accent),
          highlight: count(look({ look: 'highlight', color: '#00ff00' }, 0), accent),
          pill: count(look({ look: 'pill' }, 0), accent),
          upper: count(look({ uppercase: true }, 0), white) > count(look({}, 0), white),
        };`);
      assert.ok(r.early > 0 && r.late > r.early * 2, `words appear over time: ${r.early} -> ${r.late}`);
      assert.ok(r.karaoke > 200, `karaoke marks the word being spoken: ${r.karaoke}`);
      assert.equal(r.karaokeGap, 0, 'no word is marked between words');
      assert.ok(r.highlight > 2000, `highlight bar in the accent colour: ${r.highlight}`);
      assert.equal(r.pill, 0);
      assert.ok(r.upper, 'uppercase text is larger');
    });

    test('every caption look draws, each looks different, and accent looks use the accent', async () => {
      const r = await run(`
        const LOOKS = ['pill', 'bold', 'outline', 'minimal', 'highlight', 'glass', 'card', 'neon', 'gradient', 'punch', 'lines', 'news'];
        const base = render(1280, 720, { background: 'solid-dark' }, null, {}).getImageData(0, 560, 1280, 160).data;
        const out = {};
        for (const look of LOOKS) {
          const d = render(1280, 720, { background: 'solid-dark', captions: { look, color: '#00ff00' } }, null,
            { caption: { text: 'Hello world again', duration: 3, age: 1 } }).getImageData(0, 560, 1280, 160).data;
          let changed = 0, green = 0, sum = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (Math.abs(d[i] - base[i]) + Math.abs(d[i + 1] - base[i + 1]) + Math.abs(d[i + 2] - base[i + 2]) > 30) changed++;
            if (d[i + 1] > 150 && d[i] < 120 && d[i + 2] < 120) green++;
            sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000000007;
          }
          out[look] = { changed, green, sum };
        }
        return out;`);
      for (const [look, v] of Object.entries(r)) assert.ok(v.changed > 1500, `${look} draws a caption: ${v.changed}`);
      assert.equal(new Set(Object.values(r).map((v) => v.sum)).size, Object.keys(r).length, 'every look renders differently');
      for (const look of ['highlight', 'neon', 'gradient', 'news']) assert.ok(r[look].green > 100, `${look} uses the accent: ${r[look].green}`);
      for (const look of ['pill', 'card', 'lines', 'punch']) assert.equal(r[look].green, 0, `${look} ignores the accent`);
    });

    test('camera look and sharpen change the webcam picture; sharpening restores zoomed edges', async () => {
      const r = await run(`
        const cam = document.createElement('canvas');
        cam.width = 640; cam.height = 480;
        const x = cam.getContext('2d'); x.fillStyle = '#ff00ff'; x.fillRect(0, 0, 640, 480);
        Object.assign(cam, { readyState: 4, videoWidth: 640, videoHeight: 480 });
        const wc = { enabled: true, position: 'bottom-right', size: 0.22, shape: 'circle' };
        const mono = render(1280, 720, { webcam: { ...wc, look: 'mono', lookStrength: 1 } }, null, { webcamVideo: cam });
        const half = render(1280, 720, { webcam: { ...wc, look: 'mono', lookStrength: 0.5 } }, null, { webcamVideo: cam });
        // Screen sharpening: a soft grey step, zoomed 3x.
        const src = document.createElement('canvas');
        src.width = 1600; src.height = 900;
        const s = src.getContext('2d'); s.fillStyle = 'rgb(100,100,100)'; s.fillRect(0, 0, 800, 900); s.fillStyle = 'rgb(160,160,160)'; s.fillRect(800, 0, 800, 900);
        const draw = (sharpen) => {
          const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          engine.drawFrame(ctx, { video: src, videoW: 1600, videoH: 900, canvasW: 1280, canvasH: 720,
            style: { background: 'none', padding: 0, cornerRadius: 0, shadow: false, enhance: { sharpen } }, camera: { cx: 0.5, cy: 0.5, scale: 3 } });
          return Array.from(ctx.getImageData(600, 360, 80, 1).data).filter((_, i) => i % 4 === 0);
        };
        return { mono: px(mono, 1176, 616), half: px(half, 1176, 616), soft: draw(0), sharp: draw(1) };`);
      assert.ok(Math.abs(r.mono[0] - r.mono[1]) < 6 && Math.abs(r.mono[1] - r.mono[2]) < 6, `mono webcam is grey: ${r.mono}`);
      assert.ok(r.half[1] > 20 && r.half[0] - r.half[1] > 40, `half strength keeps some colour: ${r.half}`);
      const range = (row) => Math.max(...row) - Math.min(...row);
      assert.ok(range(r.sharp) > range(r.soft) + 8, `edge contrast ${range(r.soft)} -> ${range(r.sharp)}`);
      assert.ok(Math.max(...r.sharp) <= 160 + 0.09 * 255 * 1.4 + 2, 'overshoot is limited (no halos)');
    });

    test('debanding breaks up the steps in a blurred background without shifting the colour', async () => {
      const r = await run(`
        const img = document.createElement('canvas');
        img.width = 640; img.height = 360;
        const g = img.getContext('2d');
        g.fillStyle = '#202020'; g.fillRect(0, 0, 320, 360); g.fillStyle = '#262626'; g.fillRect(320, 0, 320, 360);
        const strip = (deband) => {
          const c = render(1280, 720, { background: 'image', backgroundBlur: 1, padding: 0.3, enhance: { deband } }, null, { backgroundImage: img });
          return Array.from(c.getImageData(440, 30, 400, 1).data).filter((_, i) => i % 4 === 1);
        };
        return { off: strip(false), on: strip(true) };`);
      const changes = (row) => row.reduce((n, v, i) => n + (i > 0 && v !== row[i - 1] ? 1 : 0), 0);
      const mean = (row) => row.reduce((a, b) => a + b, 0) / row.length;
      assert.ok(changes(r.off) < 12, `blurred step shows as a few flat bands: ${changes(r.off)}`);
      assert.ok(changes(r.on) > 60, `dithered: ${changes(r.on)}`);
      assert.ok(Math.abs(mean(r.on) - mean(r.off)) < 0.6, `average colour unchanged: ${mean(r.off)} vs ${mean(r.on)}`);
    });

    test('(cleanup) close render window', () => {
      if (win) win.destroy();
      win = null;
    });
  });
};
