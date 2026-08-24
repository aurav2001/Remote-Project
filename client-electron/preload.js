const { contextBridge, ipcRenderer } = require('electron');
const io = require('socket.io-client');

let socket = null;
const pendingListeners = []; // Queue listeners registered before socket exists

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
  
  // Socket.io Signaling wrapper
  connectSocket: (url) => {
    socket = io(url);
    
    // Attach any listeners that were registered before socket was created
    pendingListeners.forEach(({ event, callback }) => {
      socket.on(event, (data) => callback(data));
    });
    console.log(`[Preload] Attached ${pendingListeners.length} pending socket listeners.`);
    pendingListeners.length = 0; // Clear the queue

    // Register basic connection event relays
    socket.on('connect', () => {
      window.dispatchEvent(new Event('socket-connected'));
    });
    socket.on('disconnect', () => {
      window.dispatchEvent(new Event('socket-disconnected'));
    });
  },
  joinRoom: (roomId, role, systemInfo) => {
    if (socket) socket.emit('join-room', { roomId, role, systemInfo });
  },
  onSystemMetricsUpdate: (callback) => {
    ipcRenderer.on('system-metrics-update', (event, metrics) => callback(metrics));
  },
  onSocket: (event, callback) => {
    if (socket) {
      socket.on(event, (data) => callback(data));
    } else {
      // Socket doesn't exist yet — queue the listener for later
      pendingListeners.push({ event, callback });
    }
  },
  emitSocket: (event, data) => {
    if (socket) {
      socket.emit(event, data);
    }
  }
});
