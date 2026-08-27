const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  onRenderAnnotation: (callback) => {
    ipcRenderer.on('render-annotation', (event, data) => callback(data));
  }
});
