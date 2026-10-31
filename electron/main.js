const path = require('path');
const { app, BrowserWindow, Menu, protocol, screen, session, shell } = require('electron');

const { registerRecordingIpc, abortActiveCapture, isRecording } = require('./ipc/recording');
const { registerUpdateIpc } = require('./ipc/update');
const { createUpdater } = require('./services/updater');
const { registerProjectsIpc } = require('./ipc/projects');
const { registerExportIpc } = require('./ipc/export');
const { registerWindowsIpc } = require('./ipc/windows');
const { registerTranscriptIpc } = require('./ipc/transcript');
const { registerToolsIpc } = require('./ipc/tools');
const windowTools = require('./services/window-tools');
const shareServer = require('./services/share-server');
const captureService = require('./services/capture-service');
const storage = require('./services/storage');
const shortcutService = require('./services/shortcut-service');
const recovery = require('./services/recovery-service');
const { fileResponse } = require('./services/media-response');

const isDev = process.env.FRAMEFLOW_DEV === '1';
const APP_ICON = path.join(__dirname, 'assets', 'icon.ico');

// Electron names the settings folder after productName. Keep the pre-rename
// folder (FrameFlow) so saved preferences survive the rename to Frame Studio.
app.setPath('userData', path.join(app.getPath('appData'), 'FrameFlow'));

// One instance only. A second launch (say, the Start menu shortcut while the
// bar is hidden) brings the running app forward instead of starting a rival
// recorder that would fight over the record shortcut and the screen grabber.
// app.exit skips will-quit, so it can't undo the first instance's state
// (hidden desktop icons, a running capture).
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.exit(0);

// The floating recorder bar (hudWindow) is the app's home; the main window
// (library + editor) is created on demand and the bar hides while it shows.
let mainWindow = null;
let hudWindow = null;
let hudWanted = true; // false while the main window is the active one

const HUD_WIDTH = 640;
// Tall enough for the panel plus its largest menu. The window never resizes:
// resizing a transparent window flashes on Windows. Its empty area is
// click-through instead (see setHudInteractive).
const HUD_HEIGHT = 660;
const HUD_BOTTOM_MARGIN = 8;

// Local diagnostics only — errors are appended to Documents/Frame Studio/logs.
// Nothing ever leaves the machine (see the plan's privacy requirements).
// The log rolls over to frame-studio.old.log at LOG_MAX_BYTES, so it stays
// bounded however long the app runs.
const LOG_MAX_BYTES = 2 * 1024 * 1024;

function logError(kind, detail) {
  try {
    const fs = require('fs');
    const dir = path.join(storage.baseDir(), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'frame-studio.log');
    try {
      if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, path.join(dir, 'frame-studio.old.log'));
    } catch {
      // No log yet.
    }
    const line = `[${new Date().toISOString()}] ${kind}: ${detail}\n`;
    fs.appendFileSync(file, line);
  } catch {
    // Logging must never crash the app.
  }
}

process.on('uncaughtException', (err) => {
  logError('uncaughtException', `${err.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
  logError('unhandledRejection', `${reason && reason.stack ? reason.stack : reason}`);
});

// frameflow-media:// serves recorded media to the renderer. It must be
// registered as privileged before app ready so <video> can stream from it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'frameflow-media',
    privileges: { standard: true, stream: true, supportFetchAPI: true, bypassCSP: false },
  },
]);

const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  // The preload only uses contextBridge/ipcRenderer, so it runs sandboxed.
  sandbox: true,
  webSecurity: true,
  // Installed builds have no DevTools; `npm start` / `npm run dev` keep them.
  devTools: !app.isPackaged,
};

// Both windows load the same renderer; the hash picks the view.
function loadRenderer(win, hash) {
  if (isDev) {
    win.loadURL(`http://localhost:5173/#${hash}`);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash });
  }
}

function hardenWindow(win) {
  // Open external links in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The app never navigates: views switch by hash. A dropped file or a stray
  // link must not replace the renderer (and the recording session with it).
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL().split('#')[0];
    if (url.split('#')[0] !== current) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('render-process-gone', (event, details) => {
    logError('render-process-gone', details.reason);
  });
}

function alive(win) {
  return win && !win.isDestroyed();
}

function createMainWindow(target) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#1b1b1b',
    show: false,
    autoHideMenuBar: true,
    title: 'Frame Studio',
    icon: APP_ICON,
    webPreferences,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  hardenWindow(mainWindow);
  loadRenderer(mainWindow, target.view === 'editor' ? `editor=${target.projectId}` : 'library');

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Closing the library/editor returns to the recorder bar.
    hudWanted = true;
    if (alive(hudWindow)) hudWindow.show();
  });
}

function createHudWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  hudWindow = new BrowserWindow({
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
    x: Math.round(workArea.x + (workArea.width - HUD_WIDTH) / 2),
    y: workArea.y + workArea.height - HUD_HEIGHT - HUD_BOTTOM_MARGIN,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    title: 'Frame Studio',
    icon: APP_ICON,
    webPreferences,
  });

  // Keep the bar out of its own recordings (Windows 10 2004+).
  hudWindow.setContentProtection(true);
  hudWindow.setIgnoreMouseEvents(true, { forward: true });
  hudWindow.once('ready-to-show', () => hudWanted && hudWindow.show());
  hardenWindow(hudWindow);
  loadRenderer(hudWindow, 'hud');
  // The bar owns the recording session; if it dies, stop the screen grabber
  // (the pending recording stays recoverable).
  hudWindow.webContents.on('render-process-gone', () => abortActiveCapture());

  hudWindow.on('closed', () => {
    hudWindow = null;
    // A hidden main window would otherwise keep the app running invisibly.
    if (!alive(mainWindow) || !mainWindow.isVisible()) app.quit();
  });
}

function openMain(target) {
  if (alive(mainWindow)) {
    mainWindow.webContents.send('app:navigate', target);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow(target);
  }
  hudWanted = false;
  if (alive(hudWindow)) hudWindow.hide();
}

function showRecorder() {
  hudWanted = true;
  if (alive(mainWindow)) mainWindow.hide();
  if (alive(hudWindow)) {
    if (hudWindow.isMinimized()) hudWindow.restore();
    hudWindow.show();
  } else {
    createHudWindow();
  }
}

// A second launch surfaces whichever window the user was last on.
app.on('second-instance', () => {
  if (alive(mainWindow) && !hudWanted) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    showRecorder();
  }
});

function isHud(sender) {
  return alive(hudWindow) && sender === hudWindow.webContents;
}

// Fixed-size window: click-through except where the renderer says the
// pointer is over the panel or one of its menus.
function setHudInteractive(sender, on) {
  if (!isHud(sender)) return;
  if (on) hudWindow.setIgnoreMouseEvents(false);
  else hudWindow.setIgnoreMouseEvents(true, { forward: true });
}

app.whenReady().then(() => {
  if (!primaryInstance) return;
  // No default menu in installed builds: its Reload (Ctrl+R) would wipe the
  // recorder bar mid-recording, and its DevTools entry is for development.
  if (app.isPackaged) Menu.setApplicationMenu(null);
  storage.ensureBaseDirs();

  // URL shape: frameflow-media://<projectId>/<relative/media/path>
  protocol.handle('frameflow-media', (request) => {
    try {
      const url = new URL(request.url);
      const projectId = storage.assertProjectId(url.hostname);
      const relPath = decodeURIComponent(url.pathname).replace(/^\//, '');
      if (!relPath || relPath.includes('..')) throw new Error('Invalid media path');
      const abs = storage.assertInsideBase(path.join(storage.projectDir(projectId), relPath));
      // Range-aware so <video> seeks fetch only the bytes they need.
      return fileResponse(abs, request.headers.get('range'));
    } catch (err) {
      return new Response('Not found', { status: 404 });
    }
  });

  // The renderer first picks a source through the capture service, then calls
  // getDisplayMedia(). This handler resolves that request to the chosen source
  // and asks Windows for loopback (system) audio.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const source = captureService.getSelectedSource();
    if (!source) {
      callback(null);
      return;
    }
    try {
      callback({ video: source, audio: 'loopback' });
    } catch {
      callback({ video: source });
    }
  });

  // Media permissions: screen capture, mic and camera only, and only for the
  // recorder bar and the library/editor window.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const ours = (alive(hudWindow) && wc === hudWindow.webContents) || (alive(mainWindow) && wc === mainWindow.webContents);
    cb(ours && (permission === 'media' || permission === 'display-capture'));
  });

  registerRecordingIpc(() => mainWindow);
  registerProjectsIpc();
  registerExportIpc(() => mainWindow);
  registerTranscriptIpc();
  registerToolsIpc();
  shareServer.resumeSharing().catch(() => {});
  registerWindowsIpc({
    openMain,
    showRecorder,
    setHudInteractive,
    minimizeHud: (sender) => isHud(sender) && hudWindow.minimize(),
    closeHud: (sender) => isHud(sender) && hudWindow.close(),
  });

  // Updates from GitHub Releases, installed builds only. Every window hears
  // the state; the library/editor window shows the notice.
  const updates = createUpdater({
    updater: require('electron-updater').autoUpdater,
    enabled: app.isPackaged,
    isBusy: isRecording,
    broadcast: (state) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('update:state', state);
    },
    log: (msg) => logError('updater', msg),
  });
  registerUpdateIpc(updates);
  updates.start();

  createHudWindow();
  // Interrupted recordings are offered for recovery in the library.
  try {
    if (recovery.listPending().length > 0) openMain({ view: 'library' });
  } catch {
    // Recovery listing must never block startup.
  }
  // The record shortcut drives the recorder bar, which owns the session.
  shortcutService.register(() => hudWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createHudWindow();
  });
});

app.on('will-quit', () => {
  shortcutService.unregister();
  abortActiveCapture();
  windowTools.restoreDesktopIconsSync();
  shareServer.stopServer();
});

app.on('window-all-closed', () => {
  app.quit();
});
