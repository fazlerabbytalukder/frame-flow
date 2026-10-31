const { clipboard, ipcMain } = require('electron');

const captureService = require('../services/capture-service');
const windowTools = require('../services/window-tools');
const shareServer = require('../services/share-server');
const { exportFileOf } = require('./export');

// Recording utilities (resize the recorded window, hide desktop icons) and
// shareable links on the local network.

const SIZE_PRESETS = [
  [1280, 720], [1920, 1080], [2560, 1440], [1440, 900], [1280, 800], [1080, 1080], [1080, 1350], [1080, 1920],
];

function registerToolsIpc() {
  // Only the window the user selected as the recording source can be resized.
  ipcMain.handle('tools:resize-window', async (event, width, height) => {
    const desc = captureService.describeSelectedSource();
    if (!desc || desc.kind !== 'window') throw new Error('Pick a window to resize');
    if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error('Invalid window size');
    return windowTools.resizeWindow(windowTools.hwndFromSourceId(desc.id), width, height);
  });

  ipcMain.handle('tools:window-sizes', async () => SIZE_PRESETS.map(([width, height]) => ({ width, height })));

  ipcMain.handle('tools:desktop-icons', async (event, hidden) => {
    if (typeof hidden !== 'boolean') throw new Error('Invalid flag');
    return hidden ? windowTools.hideDesktopIcons() : windowTools.restoreDesktopIcons();
  });

  ipcMain.handle('share:list', async () => ({ shares: shareServer.listShares(), status: shareServer.status() }));

  ipcMain.handle('share:create', async (event, projectId, filePath, opts) => {
    const abs = exportFileOf(projectId, filePath);
    const o = opts && typeof opts === 'object' ? opts : {};
    return shareServer.createShare(projectId, abs, {
      title: typeof o.title === 'string' ? o.title : '',
      passcode: typeof o.passcode === 'string' ? o.passcode : '',
      showViews: o.showViews !== false,
    });
  });

  ipcMain.handle('share:stop', async (event, id) => {
    if (typeof id !== 'string' || id.length > 64) throw new Error('Invalid share');
    return shareServer.stopShare(id);
  });

  ipcMain.handle('share:remove-comment', async (event, id, commentId) => {
    if (typeof id !== 'string' || typeof commentId !== 'string' || id.length > 64 || commentId.length > 64) {
      throw new Error('Invalid comment');
    }
    return shareServer.removeComment(id, commentId);
  });

  ipcMain.handle('share:copy-link', async (event, id) => {
    const share = shareServer.listShares().find((s) => s.id === id);
    if (!share || !share.url) throw new Error('This link is not active');
    clipboard.writeText(share.url);
    return share.url;
  });
}

module.exports = { registerToolsIpc, SIZE_PRESETS };
