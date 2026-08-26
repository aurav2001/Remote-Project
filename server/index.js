const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const fs = require('fs');

// Direct Setup & Installer Download endpoints (Handles clicks from Web Controller UI)
app.get(['/download', '/RemoteG-Setup.zip', '/UnioTechIT-Setup.zip'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const zipPath = path.join(__dirname, '../client-electron/UnioTechIT-Setup.zip');
  const altZipPath = path.join(__dirname, '../client-electron/RemoteG-Setup.zip');
  if (fs.existsSync(zipPath)) {
    return res.download(zipPath, 'UnioTechIT-Setup.zip');
  }
  if (fs.existsSync(altZipPath)) {
    return res.download(altZipPath, 'UnioTechIT-Setup.zip');
  }
  return res.redirect('https://github.com/aurav2001/Remote-Project/raw/main/client-electron/UnioTechIT-Setup.zip');
});

app.get(['/UnioTechIT-Setup.exe', '/RemoteG-Setup.exe'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const exePath = path.join(__dirname, '../client-electron/dist-build/UnioTechIT Setup 1.0.0.exe');
  const altExePath = path.join(__dirname, '../UnioTechIT Setup 1.0.0.exe');
  if (fs.existsSync(exePath)) {
    return res.download(exePath, 'UnioTechIT-Setup.exe');
  }
  if (fs.existsSync(altExePath)) {
    return res.download(altExePath, 'UnioTechIT-Setup.exe');
  }
  return res.redirect('https://github.com/aurav2001/Remote-Project/raw/main/UnioTechIT%20Setup%201.0.0.exe');
});

// Serve compiled Web Controller frontend static assets directly on Render
function getStaticDistPath() {
  const possiblePaths = [
    path.join(__dirname, 'public'),
    path.join(__dirname, '../controller-web/dist'),
    path.join(__dirname, 'dist'),
    path.join(process.cwd(), 'controller-web/dist'),
    path.join(process.cwd(), 'server/public'),
    path.join(process.cwd(), 'public')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(path.join(p, 'index.html'))) {
      return p;
    }
  }
  return path.join(__dirname, 'public');
}

const distPath = getStaticDistPath();
app.use(express.static(distPath));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, '../controller-web/dist')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.send('Signaling Server is running.');
});

// REST endpoint for active hosts list
app.get('/api/hosts', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json(getActiveHostsList());
});

// Wildcard fallback for Single Page Application (SPA) routes
app.get('*', (req, res) => {
  const currentDist = getStaticDistPath();
  const indexPath = path.join(currentDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.send(`<!DOCTYPE html>
<html>
  <head>
    <title>UnioTechIT Remote Desktop</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
    <div style="text-align:center;padding:40px 30px;background:#1e293b;border:1px solid rgba(129,140,248,0.3);border-radius:20px;box-shadow:0 20px 40px rgba(0,0,0,0.6);max-width:400px;">
      <h1 style="background:linear-gradient(135deg, #38bdf8, #818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin:0 0 10px 0;font-size:1.8rem;">UnioTechIT Server</h1>
      <p style="color:#94a3b8;margin:0 0 24px 0;font-size:0.9rem;">Signaling & Remote Desktop Core is Online ⚡</p>
      <a href="/download" style="display:inline-block;background:linear-gradient(135deg, #10b981, #059669);color:#fff;padding:12px 24px;border-radius:100px;text-decoration:none;font-weight:600;font-size:0.9rem;box-shadow:0 4px 14px rgba(16,185,129,0.4);">📥 Download UnioTechIT Setup</a>
    </div>
  </body>
</html>`);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for development
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Track rooms and their peers
// Map room ID to { host: socketId, controller: socketId }
const rooms = new Map();

// Helper to compile list of active live host nodes
function getActiveHostsList() {
  const list = [];
  for (const [roomId, room] of rooms.entries()) {
    if (room.host) {
      list.push({
        roomId,
        systemInfo: room.systemInfo || null,
        liveMetrics: room.liveMetrics || null,
        isOnline: true,
        lastSeen: new Date().toISOString()
      });
    }
  }
  return list;
}

function broadcastActiveHosts() {
  const hosts = getActiveHostsList();
  io.emit('active-hosts-list', hosts);
}

// Throttled 5-second background interval for central dashboard telemetry updates
// (Runs O(N) once every 5s instead of O(N*M) 50 times per second on every packet pulse)
setInterval(() => {
  if (rooms.size > 0) {
    broadcastActiveHosts();
  }
}, 5000);

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Join Room
  socket.on('join-room', ({ roomId, role, systemInfo }) => {
    if (!roomId) return;
    const cleanRoomId = String(roomId).trim();
    console.log(`Socket ${socket.id} joined room ${cleanRoomId} as ${role}`);
    
    // Join socket.io room
    socket.join(cleanRoomId);
    socket.roomId = cleanRoomId;
    socket.role = role;

    if (!rooms.has(cleanRoomId)) {
      rooms.set(cleanRoomId, { host: null, controller: null, systemInfo: null });
    }

    const room = rooms.get(cleanRoomId);
    if (role === 'host') {
      room.host = socket.id;
      if (systemInfo) {
        room.systemInfo = systemInfo;
      }
      console.log(`Host registered for room ${cleanRoomId} with info:`, room.systemInfo);
      broadcastActiveHosts();
    } else if (role === 'controller') {
      room.controller = socket.id;
      console.log(`Controller registered for room ${cleanRoomId}`);
      socket.emit('active-hosts-list', getActiveHostsList());
      // Send host info to controller if available
      if (room.systemInfo) {
        socket.emit('host-info', { systemInfo: room.systemInfo });
      }
    }

    // If both host and controller are in the room, notify them.
    if (room.host && room.controller) {
      io.to(cleanRoomId).emit('ready', { host: room.host, controller: room.controller, systemInfo: room.systemInfo });
      console.log(`Room ${cleanRoomId} is ready for WebRTC connection`);
    }
  });

  // Allow controllers to explicitly request current active host nodes anytime
  socket.on('get-active-hosts', () => {
    socket.emit('active-hosts-list', getActiveHostsList());
  });

  // Relay WebRTC Offer
  socket.on('webrtc-offer', ({ roomId, offer }) => {
    const targetRoom = String(roomId || socket.roomId || '').trim();
    console.log(`Relaying WebRTC offer for room ${targetRoom}`);
    socket.to(targetRoom).emit('webrtc-offer', { offer });
  });

  // Relay WebRTC Answer
  socket.on('webrtc-answer', ({ roomId, answer }) => {
    const targetRoom = String(roomId || socket.roomId || '').trim();
    console.log(`Relaying WebRTC answer for room ${targetRoom}`);
    socket.to(targetRoom).emit('webrtc-answer', { answer });
  });

  // Relay ICE Candidates
  socket.on('ice-candidate', ({ roomId, candidate }) => {
    const targetRoom = String(roomId || socket.roomId || '').trim();
    console.log(`Relaying ICE candidate for room ${targetRoom}`);
    socket.to(targetRoom).emit('ice-candidate', { candidate });
  });

  // Relay Hybrid Canvas Screen Frame Fallback (host -> controller)
  socket.on('screen-frame', ({ roomId, frame }) => {
    socket.to(roomId).emit('screen-frame', { frame });
  });

  // Relay Input Control Events (mouse movement, click, keyboard press)
  // These go from controller -> host
  socket.on('control-event', (data) => {
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      if (room.host) {
        io.to(room.host).emit('control-event', data);
      }
    }
  });

  // Relay System Metrics from host to controller (O(1) Constant Time Complexity)
  socket.on('system-metrics', ({ roomId, metrics }) => {
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.liveMetrics = metrics;
    }
    // O(1) targeted relay to the controller in this room (bypasses global broadcast CPU overhead)
    socket.to(roomId).emit('system-metrics', { metrics });
  });

  // Relay Terminal Command (controller -> host)
  socket.on('terminal-command', (data) => {
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      if (room.host) {
        io.to(room.host).emit('terminal-command', data);
      }
    }
  });

  // Relay Terminal Result (host -> controller)
  socket.on('terminal-result', (data) => {
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      socket.to(roomId).emit('terminal-result', data);
    }
  });

  // Relay Clipboard Sync (bidirectional controller <-> host)
  socket.on('clipboard-sync', (data) => {
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      socket.to(roomId).emit('clipboard-sync', data);
    }
  });

  // Relay File Transfer Chunk (controller -> host)
  socket.on('file-transfer-chunk', (data) => {
    const roomId = socket.roomId || data?.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      if (room.host) {
        io.to(room.host).emit('file-transfer-chunk', data);
      }
    }
  });

  // Relay File Transfer Acknowledgment (host -> controller)
  socket.on('file-transfer-ack', (data) => {
    const roomId = socket.roomId || data?.roomId;
    if (roomId && rooms.has(roomId)) {
      socket.to(roomId).emit('file-transfer-ack', data);
    }
  });

  // Handle Disconnect with brief grace period for Wi-Fi reconnects
  socket.on('disconnect', (reason) => {
    console.log(`User disconnected: ${socket.id}, reason: ${reason}`);
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      const targetSocketId = socket.id;
      const targetRole = socket.role;

      setTimeout(() => {
        const room = rooms.get(roomId);
        if (!room) return;

        if (targetRole === 'host' && room.host === targetSocketId) {
          console.log(`Host permanently disconnected from room ${roomId}`);
          room.host = null;
          socket.to(roomId).emit('peer-disconnected', { role: 'host' });
          broadcastActiveHosts();
        } else if (targetRole === 'controller' && room.controller === targetSocketId) {
          console.log(`Controller permanently disconnected from room ${roomId}`);
          room.controller = null;
          socket.to(roomId).emit('peer-disconnected', { role: 'controller' });
        }

        // Clean up room if both host and controller are empty
        if (!room.host && !room.controller) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted`);
          broadcastActiveHosts();
        }
      }, 3000);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling Server is listening on port ${PORT}`);
});
