const { ipcMain } = require('electron');
const storage = require('../services/storage');

// Two-window shell: the floating recorder bar (HUD) is the app's home, and
// the main window hosts the library and editor on demand. The window objects
// live in main.js; this module only validates renderer requests and hands
// them to the `shell` callbacks.

function sanitizeTarget(target) {
  if (!target || typeof target !== 'object') throw new Error('Invalid view');
  if (target.view === 'library') return { view: 'library' };
  if (target.view === 'editor') {
    return { view: 'editor', projectId: storage.assertProjectId(target.projectId) };
  }
  throw new Error('Invalid view');
}

// shell: { openMain(target), showRecorder(), setHudInteractive(sender, on),
//          minimizeHud(sender), closeHud(sender) }
function registerWindowsIpc(shell) {
  ipcMain.handle('app:open-main', async (event, target) => {
    shell.openMain(sanitizeTarget(target));
    return true;
  });

  ipcMain.handle('app:show-recorder', async () => {
    shell.showRecorder();
    return true;
  });

  // The bar's window never resizes (resizing a transparent window flickers
  // on Windows); instead its transparent parts are click-through, and the
  // renderer reports whether the pointer is over something solid.
  ipcMain.handle('hud:set-interactive', async (event, on) => {
    if (typeof on !== 'boolean') throw new Error('Invalid interactive flag');
    shell.setHudInteractive(event.sender, on);
    return true;
  });

  ipcMain.handle('hud:minimize', async (event) => {
    shell.minimizeHud(event.sender);
    return true;
  });

  ipcMain.handle('hud:close', async (event) => {
    shell.closeHud(event.sender);
    return true;
  });
}

module.exports = { registerWindowsIpc, sanitizeTarget };
