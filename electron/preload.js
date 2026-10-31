const { contextBridge, ipcRenderer } = require('electron');

// The only bridge between the renderer and the main process. Every method maps
// to a validated IPC handler; no Node APIs are exposed.

contextBridge.exposeInMainWorld('frameflow', {
  app: {
    // target: { view: 'library' } | { view: 'editor', projectId }
    openMain: (target) => ipcRenderer.invoke('app:open-main', target),
    showRecorder: () => ipcRenderer.invoke('app:show-recorder'),
    // Main window navigation requested by the recorder bar. The listener
    // receives only the validated target, never the IPC event.
    onNavigate: (callback) => {
      const listener = (_event, target) => callback(target);
      ipcRenderer.on('app:navigate', listener);
      return () => ipcRenderer.removeListener('app:navigate', listener);
    },
  },
  hud: {
    setInteractive: (on) => ipcRenderer.invoke('hud:set-interactive', on),
    minimize: () => ipcRenderer.invoke('hud:minimize'),
    close: () => ipcRenderer.invoke('hud:close'),
  },
  recording: {
    listSources: () => ipcRenderer.invoke('recording:list-sources'),
    selectSource: (sourceId) => ipcRenderer.invoke('recording:select-source', sourceId),
    captureMode: () => ipcRenderer.invoke('recording:capture-mode'),
    begin: (opts) => ipcRenderer.invoke('recording:begin', opts),
    mediaStarted: (times) => ipcRenderer.invoke('recording:media-started', times),
    pause: () => ipcRenderer.invoke('recording:pause'),
    resume: () => ipcRenderer.invoke('recording:resume'),
    chunk: (which, buffer) => ipcRenderer.invoke('recording:chunk', which, buffer),
    finalize: (payload) => ipcRenderer.invoke('recording:finalize', payload),
    discard: () => ipcRenderer.invoke('recording:discard'),
    listPending: () => ipcRenderer.invoke('recording:list-pending'),
    recover: (pendingId) => ipcRenderer.invoke('recording:recover', pendingId),
    discardPending: (pendingId) => ipcRenderer.invoke('recording:discard-pending', pendingId),
    selectArea: () => ipcRenderer.invoke('recording:select-area'),
    clearArea: () => ipcRenderer.invoke('recording:clear-area'),
    shortcutStatus: () => ipcRenderer.invoke('recording:shortcut-status'),
    // The global start/stop shortcut. Only this one event is forwarded, and
    // the listener never receives the IPC event object. Returns an unsubscribe.
    onShortcut: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('shortcut:record-toggle', listener);
      return () => ipcRenderer.removeListener('shortcut:record-toggle', listener);
    },
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    load: (projectId) => ipcRenderer.invoke('projects:load', projectId),
    save: (project) => ipcRenderer.invoke('projects:save', project),
    mediaUrl: (projectId, relPath) => ipcRenderer.invoke('projects:media-url', projectId, relPath),
    thumbnail: (projectId) => ipcRenderer.invoke('projects:thumbnail', projectId),
    readCursor: (projectId) => ipcRenderer.invoke('projects:read-cursor', projectId),
    detectSilence: (projectId) => ipcRenderer.invoke('projects:detect-silence', projectId),
    revealExports: (projectId) => ipcRenderer.invoke('projects:reveal-exports', projectId),
    revealFolder: (projectId) => ipcRenderer.invoke('projects:reveal-folder', projectId),
    rename: (projectId, name) => ipcRenderer.invoke('projects:rename', projectId, name),
    remove: (projectId) => ipcRenderer.invoke('projects:delete', projectId),
    chooseBackground: (projectId) => ipcRenderer.invoke('projects:choose-background', projectId),
    chooseBackgroundVideo: (projectId) => ipcRenderer.invoke('projects:choose-background-video', projectId),
    chooseMusic: (projectId) => ipcRenderer.invoke('projects:choose-music', projectId),
    importVideo: () => ipcRenderer.invoke('projects:import-video'),
    addClipVideo: (projectId) => ipcRenderer.invoke('projects:add-clip-video', projectId),
  },
  transcript: {
    available: () => ipcRenderer.invoke('transcript:available'),
    start: (projectId, language) => ipcRenderer.invoke('transcript:start', projectId, language),
    status: (projectId) => ipcRenderer.invoke('transcript:status', projectId),
  },
  tools: {
    windowSizes: () => ipcRenderer.invoke('tools:window-sizes'),
    resizeWindow: (width, height) => ipcRenderer.invoke('tools:resize-window', width, height),
    desktopIcons: (hidden) => ipcRenderer.invoke('tools:desktop-icons', hidden),
  },
  share: {
    list: () => ipcRenderer.invoke('share:list'),
    create: (projectId, filePath, opts) => ipcRenderer.invoke('share:create', projectId, filePath, opts),
    stop: (id) => ipcRenderer.invoke('share:stop', id),
    removeComment: (id, commentId) => ipcRenderer.invoke('share:remove-comment', id, commentId),
    copyLink: (id) => ipcRenderer.invoke('share:copy-link', id),
  },
  themes: {
    list: () => ipcRenderer.invoke('themes:list'),
    save: (name, style, canvas) => ipcRenderer.invoke('themes:save', name, style, canvas),
    rename: (from, to) => ipcRenderer.invoke('themes:rename', from, to),
    remove: (name) => ipcRenderer.invoke('themes:delete', name),
    exportFile: (name) => ipcRenderer.invoke('themes:export', name),
    importFile: () => ipcRenderer.invoke('themes:import'),
  },
  clipboard: {
    writeImage: (dataUrl) => ipcRenderer.invoke('clipboard:write-image', dataUrl),
  },
  export: {
    start: (opts) => ipcRenderer.invoke('export:start', opts),
    frame: (buffer) => ipcRenderer.invoke('export:frame', buffer),
    finish: () => ipcRenderer.invoke('export:finish'),
    cancel: () => ipcRenderer.invoke('export:cancel'),
    encoders: () => ipcRenderer.invoke('export:encoders'),
    copyToClipboard: (projectId, filePath) => ipcRenderer.invoke('export:copy-to-clipboard', projectId, filePath),
    writeSrt: (projectId, videoPath, srt) => ipcRenderer.invoke('export:write-srt', projectId, videoPath, srt),
  },
});
