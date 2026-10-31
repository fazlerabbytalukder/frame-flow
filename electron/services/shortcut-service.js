const { globalShortcut } = require('electron');

// One system-wide shortcut to start/stop recording from anywhere (the app
// may be minimized while you record). Registration can fail when another
// program owns the combination; the status is reported to the UI.

const RECORD_ACCELERATOR = 'CommandOrControl+Alt+R';

let status = { accelerator: RECORD_ACCELERATOR, registered: false };

function register(getWindow) {
  try {
    const ok = globalShortcut.register(RECORD_ACCELERATOR, () => {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send('shortcut:record-toggle');
    });
    status = { accelerator: RECORD_ACCELERATOR, registered: Boolean(ok) };
  } catch {
    status = { accelerator: RECORD_ACCELERATOR, registered: false };
  }
  return status;
}

function unregister() {
  try {
    globalShortcut.unregister(RECORD_ACCELERATOR);
  } catch {
    // Already gone at shutdown.
  }
  status = { ...status, registered: false };
}

function getStatus() {
  return status;
}

module.exports = { register, unregister, getStatus, RECORD_ACCELERATOR };
