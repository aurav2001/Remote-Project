const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  executeRemoteCommand: (data) => ipcRenderer.invoke('execute-remote-command', data),
  sendControlEvent: (event) => ipcRenderer.send('control-event', event),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  writeClipboard: (text) => ipcRenderer.send('write-clipboard', text),
  minimizeHostWindow: () => ipcRenderer.invoke('minimize-host-window'),
  saveFileChunk: (data) => ipcRenderer.invoke('save-file-chunk', data),
  onHostClipboardChanged: (callback) => {
    ipcRenderer.on('host-clipboard-changed', (event, text) => callback(text));
  },
  onSystemMetricsUpdate: (callback) => {
    ipcRenderer.on('system-metrics-update', (event, metrics) => callback(metrics));
  },
  getPermanentCode: () => ipcRenderer.invoke('get-permanent-code'),
  setPermanentCode: (code) => ipcRenderer.invoke('set-permanent-code', code),
  getCompanyGroup: () => ipcRenderer.invoke('get-company-group'),
  setCompanyGroup: (group) => ipcRenderer.invoke('set-company-group', group),
  onCompanyGroupUpdated: (callback) => {
    ipcRenderer.on('company-group-updated', (event, group) => callback(group));
  }
});
