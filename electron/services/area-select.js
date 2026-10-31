const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');

// "Record an area": a transparent, always-on-top window covering the chosen
// display where the user drags a rectangle. The full display is still
// recorded; the project simply starts cropped to the area, so the crop can be
// widened later without re-recording.

const MIN_SIZE = 0.1; // 10% of the display in each direction

// Validate and clamp a renderer-supplied rect ({x, y, w, h} in 0..1).
function sanitizeArea(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const n = ['x', 'y', 'w', 'h'].map((k) => Number(rect[k]));
  if (!n.every(Number.isFinite)) return null;
  let [x, y, w, h] = n;
  x = Math.min(1, Math.max(0, x));
  y = Math.min(1, Math.max(0, y));
  w = Math.min(1 - x, Math.max(0, w));
  h = Math.min(1 - y, Math.max(0, h));
  if (w < MIN_SIZE || h < MIN_SIZE) return null;
  return { x, y, w, h };
}

// The crop that shows exactly this area of the full recording.
function areaToCrop(area) {
  if (!area) return null;
  return {
    l: area.x,
    t: area.y,
    r: Math.max(0, 1 - area.x - area.w),
    b: Math.max(0, 1 - area.y - area.h),
  };
}

let active = null; // { win, resolve }

ipcMain.handle('area:done', (event, rect) => {
  if (!active || event.sender !== active.win.webContents) return { ok: false };
  const { win, resolve } = active;
  active = null;
  resolve(sanitizeArea(rect));
  if (!win.isDestroyed()) win.close();
  return { ok: true };
});

function selectArea(displayBounds) {
  if (active) {
    try { active.win.close(); } catch {}
    active.resolve(null);
    active = null;
  }
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      x: displayBounds.x,
      y: displayBounds.y,
      width: displayBounds.width,
      height: displayBounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreenable: false,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'area-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    active = { win, resolve };
    win.setAlwaysOnTop(true, 'screen-saver');
    win.on('closed', () => {
      if (active && active.win === win) {
        active = null;
        resolve(null);
      }
    });
    win.loadFile(path.join(__dirname, '..', 'area-select.html'));
  });
}

module.exports = { selectArea, sanitizeArea, areaToCrop, MIN_SIZE };
