const { contextBridge, ipcRenderer } = require('electron');
const io = require('socket.io-client');

let socket = null;

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  sendControlEvent: (event) => ipcRenderer.send('control-event', event),
  
  // Socket.io Signaling wrapper
  connectSocket: (url) => {
    socket = io(url);
    
    // Register basic connection event relays
    socket.on('connect', () => {
      window.dispatchEvent(new Event('socket-connected'));
    });
    socket.on('disconnect', () => {
      window.dispatchEvent(new Event('socket-disconnected'));
    });
  },
  joinRoom: (roomId, role) => {
    if (socket) socket.emit('join-room', { roomId, role });
  },
  onSocket: (event, callback) => {
    if (socket) {
      socket.on(event, (data) => callback(data));
    }
  },
  emitSocket: (event, data) => {
    if (socket) {
      socket.emit(event, data);
    }
  }
});
