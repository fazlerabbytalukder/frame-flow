const { ipcMain } = require('electron');

// App updates (see services/updater.js). No channel takes arguments, so there
// is nothing from the renderer to validate.
function registerUpdateIpc(updates) {
  ipcMain.handle('update:state', () => updates.getState());
  ipcMain.handle('update:check', () => updates.check());
  ipcMain.handle('update:download', () => updates.download());
  ipcMain.handle('update:install', () => updates.install());
}

module.exports = { registerUpdateIpc };
