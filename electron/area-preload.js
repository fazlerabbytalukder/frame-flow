const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the area-selection overlay: it can only report a rectangle (or
// null to cancel). Nothing else is exposed.
contextBridge.exposeInMainWorld('frameflowArea', {
  done: (rect) => ipcRenderer.invoke('area:done', rect),
});
