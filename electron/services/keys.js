// Classifies global key presses for recording, with privacy as the first
// rule: only shortcuts (Ctrl/Alt/Win + key) are stored by name; ordinary
// typing is reduced to a bare timestamp so no text is ever recorded.
//
// Ctrl+Alt without Win is treated as typing: on many layouts that is AltGr,
// which produces characters (e.g. '@', '€') that may be part of a password.

const MODIFIER_NAMES = new Set(['Ctrl', 'CtrlRight', 'Alt', 'AltRight', 'Shift', 'ShiftRight', 'Meta', 'MetaRight']);

// Keys that are neither text nor worth showing on their own.
const NAVIGATION = new Set([
  'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End',
  'Insert', 'CapsLock', 'Escape',
]);

const LABELS = {
  Space: 'Space', Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Delete: 'Del', Escape: 'Esc',
  ArrowLeft: '←', ArrowUp: '↑', ArrowRight: '→', ArrowDown: '↓',
  Semicolon: ';', Equal: '=', Comma: ',', Minus: '-', Period: '.', Slash: '/', Backquote: '`',
  BracketLeft: '[', Backslash: '\\', BracketRight: ']', Quote: "'",
  NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/',
};

function nameTable(keyEnum) {
  const byCode = new Map();
  for (const [name, code] of Object.entries(keyEnum || {})) {
    if (!byCode.has(code)) byCode.set(code, name);
  }
  return byCode;
}

// e: uiohook keyboard event { keycode, ctrlKey, altKey, shiftKey, metaKey }.
// Returns { kind: 'shortcut', keys: [...] } | { kind: 'typing' } | null.
function classifyKey(e, byCode) {
  const name = byCode.get(e.keycode);
  if (!name || MODIFIER_NAMES.has(name)) return null;

  const altGr = e.ctrlKey && e.altKey && !e.metaKey;
  const isShortcut = (e.ctrlKey || e.altKey || e.metaKey) && !altGr;
  if (isShortcut) {
    const keys = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (e.metaKey) keys.push('Win');
    keys.push(LABELS[name] || name);
    return { kind: 'shortcut', keys };
  }
  if (NAVIGATION.has(name) || /^F\d+$/.test(name)) return null;
  return { kind: 'typing' };
}

module.exports = { classifyKey, nameTable };
