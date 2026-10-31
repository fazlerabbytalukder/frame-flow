const { screen } = require('electron');

const { classifyKey, nameTable } = require('./keys');

// Global mouse-click and keyboard capture during recording, via the
// uiohook-napi native hook. The hook only runs while a recording is active
// (narrow scope, per the plan's consent/cursor-privacy requirements), and the
// module is optional: if the native binding is unavailable the app records
// without click/key data and the editor falls back to dwell heuristics.
//
// Keyboard data is privacy-reduced in keys.js: shortcut names only, and bare
// timestamps for typing (used to find typing stretches worth speeding up).

let uiohook = null;
let keyNames = new Map();
try {
  const mod = require('uiohook-napi');
  uiohook = mod.uIOhook;
  keyNames = nameTable(mod.UiohookKey);
} catch {
  uiohook = null;
}

const MAX_EVENTS = 50_000;

let clicks = [];
let shortcuts = [];
let typing = [];
let startedAt = 0;
let pausedTotal = 0;
let pausedAt = null;
let bounds = null;
let running = false;
let mouseListener = null;
let keyListener = null;

function available() {
  return Boolean(uiohook);
}

function now() {
  return (Date.now() - startedAt - pausedTotal) / 1000;
}

function pushCapped(list, item) {
  list.push(item);
  if (list.length > MAX_EVENTS) list.shift();
}

function start(displayBounds) {
  stop();
  if (!uiohook) return false;
  bounds = displayBounds || screen.getPrimaryDisplay().bounds;
  clicks = [];
  shortcuts = [];
  typing = [];
  startedAt = Date.now();
  pausedTotal = 0;
  pausedAt = null;

  mouseListener = (e) => {
    if (pausedAt !== null) return;
    pushCapped(clicks, {
      t: now(),
      x: clamp01((e.x - bounds.x) / bounds.width),
      y: clamp01((e.y - bounds.y) / bounds.height),
      button: e.button,
    });
  };
  keyListener = (e) => {
    if (pausedAt !== null) return;
    const k = classifyKey(e, keyNames);
    if (!k) return;
    if (k.kind === 'shortcut') pushCapped(shortcuts, { t: now(), keys: k.keys });
    else pushCapped(typing, Math.round(now() * 1000) / 1000);
  };
  uiohook.on('mousedown', mouseListener);
  uiohook.on('keydown', keyListener);
  try {
    uiohook.start();
    running = true;
  } catch {
    detach();
    running = false;
  }
  return running;
}

function detach() {
  if (!uiohook) return;
  if (mouseListener) uiohook.off('mousedown', mouseListener);
  if (keyListener) uiohook.off('keydown', keyListener);
  mouseListener = null;
  keyListener = null;
}

function pause() {
  if (pausedAt === null) pausedAt = Date.now();
}

function resume() {
  if (pausedAt !== null) {
    pausedTotal += Date.now() - pausedAt;
    pausedAt = null;
  }
}

// Snapshot without stopping (periodic crash-recovery flushes).
function peek() {
  return { clicks: clicks.slice(), shortcuts: shortcuts.slice(), typing: typing.slice() };
}

function stop() {
  const result = { clicks, shortcuts, typing };
  if (uiohook && running) {
    try {
      detach();
      uiohook.stop();
    } catch {
      // The hook must never take the app down.
    }
  }
  detach();
  running = false;
  clicks = [];
  shortcuts = [];
  typing = [];
  return result;
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

module.exports = { available, start, pause, resume, peek, stop };
