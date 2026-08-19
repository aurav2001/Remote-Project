const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Signaling Server is running.');
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

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Join Room
  socket.on('join-room', ({ roomId, role, systemInfo }) => {
    console.log(`Socket ${socket.id} joined room ${roomId} as ${role}`);
    
    // Join socket.io room
    socket.join(roomId);
    socket.roomId = roomId;
    socket.role = role;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { host: null, controller: null, systemInfo: null });
    }

    const room = rooms.get(roomId);
    if (role === 'host') {
      room.host = socket.id;
      if (systemInfo) {
        room.systemInfo = systemInfo;
      }
      console.log(`Host registered for room ${roomId} with info:`, room.systemInfo);
      broadcastActiveHosts();
    } else if (role === 'controller') {
      room.controller = socket.id;
      console.log(`Controller registered for room ${roomId}`);
      socket.emit('active-hosts-list', getActiveHostsList());
      // Send host info to controller if available
      if (room.systemInfo) {
        socket.emit('host-info', { systemInfo: room.systemInfo });
      }
    }

    // Allow controllers to explicitly request current active host nodes
    socket.on('get-active-hosts', () => {
      socket.emit('active-hosts-list', getActiveHostsList());
    });

    // If both host and controller are in the room, notify them.
    if (room.host && room.controller) {
      io.to(roomId).emit('ready', { host: room.host, controller: room.controller, systemInfo: room.systemInfo });
      console.log(`Room ${roomId} is ready for WebRTC connection`);
    }
  });

  // Relay WebRTC Offer
  socket.on('webrtc-offer', ({ roomId, offer }) => {
    console.log(`Relaying WebRTC offer for room ${roomId}`);
    socket.to(roomId).emit('webrtc-offer', { offer });
  });

  // Relay WebRTC Answer
  socket.on('webrtc-answer', ({ roomId, answer }) => {
    console.log(`Relaying WebRTC answer for room ${roomId}`);
    socket.to(roomId).emit('webrtc-answer', { answer });
  });

  // Relay ICE Candidates
  socket.on('ice-candidate', ({ roomId, candidate }) => {
    console.log(`Relaying ICE candidate for room ${roomId}`);
    socket.to(roomId).emit('ice-candidate', { candidate });
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

  // Relay System Metrics from host to controller
  socket.on('system-metrics', ({ roomId, metrics }) => {
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.liveMetrics = metrics;
      broadcastActiveHosts();
    }
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

  // Handle Disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      
      if (socket.id === room.host) {
        console.log(`Host disconnected from room ${roomId}`);
        room.host = null;
        socket.to(roomId).emit('peer-disconnected', { role: 'host' });
        broadcastActiveHosts();
      } else if (socket.id === room.controller) {
        console.log(`Controller disconnected from room ${roomId}`);
        room.controller = null;
        socket.to(roomId).emit('peer-disconnected', { role: 'controller' });
      }

      // Clean up room if both disconnected
      if (!room.host && !room.controller) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} deleted`);
        broadcastActiveHosts();
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling Server is listening on port ${PORT}`);
});
