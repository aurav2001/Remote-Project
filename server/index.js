const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const fs = require('fs');
const crypto = require('crypto');

// Admin Credentials & Authentication Secret
let ADMIN_USERNAME = process.env.ADMIN_USER || 'admin';
let ADMIN_PASSWORD = process.env.ADMIN_PASS || 'admin123';
const AUTH_SECRET = process.env.AUTH_SECRET || 'remoteg-unio-tech-it-auth-secret-key-2026';

function generateAuthToken(username) {
  const payload = {
    username,
    role: 'Administrator',
    issuedAt: Date.now(),
    expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days session
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
  if (signature !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// Authentication REST Endpoints
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  if (username.trim().toLowerCase() === ADMIN_USERNAME.toLowerCase() && password === ADMIN_PASSWORD) {
    const token = generateAuthToken(username.trim());
    return res.json({
      success: true,
      token,
      user: {
        username: ADMIN_USERNAME,
        role: 'Administrator',
        loginTime: new Date().toISOString()
      }
    });
  }
  
  return res.status(401).json({ error: 'Invalid username or password' });
});

app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token || '');
  const user = verifyAuthToken(token);
  if (user) {
    return res.json({
      authenticated: true,
      user: {
        username: user.username,
        role: user.role
      }
    });
  }
  return res.status(401).json({ authenticated: false, error: 'Invalid or expired session token' });
});

app.post('/api/auth/change-password', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token || '');
  const user = verifyAuthToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Valid admin session required' });
  }

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (currentPassword !== ADMIN_PASSWORD) {
    return res.status(400).json({ error: 'Current password does not match' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters long' });
  }

  ADMIN_PASSWORD = newPassword;
  return res.json({ success: true, message: 'Admin password successfully updated' });
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

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

// Serve compiled Web Controller frontend static assets
function getStaticDistPath() {
  const possiblePaths = [
    path.join(__dirname, '../controller-web/dist'),
    path.join(process.cwd(), 'controller-web/dist'),
    path.join(__dirname, 'dist'),
    path.join(__dirname, 'public'),
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
app.use(express.static(path.join(__dirname, '../controller-web/dist')));
app.use(express.static(distPath));
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.send('Signaling Server is running.');
});

// REST endpoint for active hosts list (Supports optional ?company=GROUP filter)
app.get('/api/hosts', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const company = req.query.company ? String(req.query.company).trim().toUpperCase() : null;
  const list = getActiveHostsList();
  if (company && company !== 'ALL') {
    return res.json(list.filter(h => (h.companyGroup || 'USPL').toUpperCase() === company));
  }
  res.json(list);
});

// Permanent In-Memory Storage for Assigned Company Groups & Public WAN IPs
const persistentCompanyGroups = new Map([['953924', 'G-TECH']]);
const persistentHostPublicIps = new Map([['953924', '49.249.21.134']]);

// Host Agent Registration & Telemetry Heartbeat (Works with HTTP POST from Electron / C#)
app.post('/api/register-host', (req, res) => {
  const { roomId, systemInfo, liveMetrics, companyGroup } = req.body || {};
  if (!roomId) {
    return res.status(400).json({ error: 'roomId is required' });
  }
  const cleanRoomId = String(roomId).trim();
  if (!rooms.has(cleanRoomId)) {
    const initialGroup = persistentCompanyGroups.get(cleanRoomId) || (companyGroup ? String(companyGroup).trim().toUpperCase() : 'USPL');
    rooms.set(cleanRoomId, { host: null, controller: null, systemInfo: null, liveMetrics: null, companyGroup: initialGroup, lastSeen: Date.now() });
  }
  const room = rooms.get(cleanRoomId);
  room.lastSeen = Date.now();
  const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
  const cleanPublicIp = rawIp.replace(/^::ffff:/, '');

  if (cleanPublicIp && !cleanPublicIp.includes('127.0.0.1') && !cleanPublicIp.includes('localhost') && cleanPublicIp !== '::1' && cleanPublicIp.length >= 7) {
    persistentHostPublicIps.set(cleanRoomId, cleanPublicIp);
  }

  const lockedPublicIp = persistentHostPublicIps.get(cleanRoomId) || (cleanPublicIp && !cleanPublicIp.includes('127.0.0.1') ? cleanPublicIp : null);

  if (systemInfo) {
    if (lockedPublicIp) {
      systemInfo.publicIp = lockedPublicIp;
    }
    if (systemInfo.ip === '127.0.0.1' && room.systemInfo?.ip && room.systemInfo.ip !== '127.0.0.1') {
      systemInfo.ip = room.systemInfo.ip;
    }
    room.systemInfo = { ...(room.systemInfo || {}), ...systemInfo };
  }
  if (liveMetrics) {
    if (lockedPublicIp) {
      liveMetrics.publicIp = lockedPublicIp;
    }
    room.liveMetrics = { ...(room.liveMetrics || {}), ...liveMetrics };
  }

  if (persistentCompanyGroups.has(cleanRoomId)) {
    room.companyGroup = persistentCompanyGroups.get(cleanRoomId);
  } else if (companyGroup) {
    room.companyGroup = String(companyGroup).trim().toUpperCase();
    persistentCompanyGroups.set(cleanRoomId, room.companyGroup);
  } else if (systemInfo && systemInfo.companyGroup) {
    room.companyGroup = String(systemInfo.companyGroup).trim().toUpperCase();
    persistentCompanyGroups.set(cleanRoomId, room.companyGroup);
  }
  if (room.systemInfo) room.systemInfo.companyGroup = room.companyGroup;

  broadcastActiveHosts();
  res.json({ success: true, roomId: cleanRoomId, companyGroup: room.companyGroup });
});

// Set / Update Company Group for a Host Node
app.post('/api/set-company-group', (req, res) => {
  const { roomId, companyGroup } = req.body || {};
  if (!roomId || !companyGroup) {
    return res.status(400).json({ error: 'roomId and companyGroup are required' });
  }
  const cleanRoomId = String(roomId).trim();
  const cleanGroup = String(companyGroup).trim().toUpperCase();
  persistentCompanyGroups.set(cleanRoomId, cleanGroup);
  if (!rooms.has(cleanRoomId)) {
    rooms.set(cleanRoomId, { host: null, controller: null, systemInfo: null, liveMetrics: null, companyGroup: cleanGroup, lastSeen: Date.now() });
  }
  const room = rooms.get(cleanRoomId);
  room.companyGroup = cleanGroup;
  if (room.systemInfo) room.systemInfo.companyGroup = cleanGroup;
  if (room.host) {
    io.to(room.host).emit('company-group-updated', { companyGroup: cleanGroup });
  }
  broadcastActiveHosts();
  res.json({ success: true, roomId: cleanRoomId, companyGroup: cleanGroup });
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
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    const isAlive = (room.host && room.host !== null) || (room.lastSeen && (now - room.lastSeen < 25000));
    if (isAlive) {
      const company = room.companyGroup || room.systemInfo?.companyGroup || 'USPL';
      const lockedPublicIp = persistentHostPublicIps.get(roomId) || room.systemInfo?.publicIp || room.liveMetrics?.publicIp || null;

      const cleanSysInfo = room.systemInfo ? { ...room.systemInfo } : null;
      if (cleanSysInfo && lockedPublicIp && lockedPublicIp !== 'N/A') {
        cleanSysInfo.publicIp = lockedPublicIp;
      }
      const cleanMetrics = room.liveMetrics ? { ...room.liveMetrics } : null;
      if (cleanMetrics && lockedPublicIp && lockedPublicIp !== 'N/A') {
        cleanMetrics.publicIp = lockedPublicIp;
      }

      list.push({
        roomId,
        companyGroup: company,
        systemInfo: cleanSysInfo,
        liveMetrics: cleanMetrics,
        isOnline: true,
        lastSeen: room.lastSeen ? new Date(room.lastSeen).toISOString() : new Date().toISOString()
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
  socket.on('join-room', ({ roomId, role, systemInfo, companyGroup }) => {
    if (!roomId) return;
    const cleanRoomId = String(roomId).trim();
    console.log(`Socket ${socket.id} joined room ${cleanRoomId} as ${role}`);
    
    // Join socket.io room
    socket.join(cleanRoomId);
    socket.roomId = cleanRoomId;
    socket.role = role;

    if (!rooms.has(cleanRoomId)) {
      const initialGroup = persistentCompanyGroups.get(cleanRoomId) || (companyGroup ? String(companyGroup).trim().toUpperCase() : 'USPL');
      rooms.set(cleanRoomId, { host: null, controller: null, systemInfo: null, companyGroup: initialGroup, lastSeen: Date.now() });
    }

    const room = rooms.get(cleanRoomId);
    if (persistentCompanyGroups.has(cleanRoomId)) {
      room.companyGroup = persistentCompanyGroups.get(cleanRoomId);
    } else if (companyGroup) {
      room.companyGroup = String(companyGroup).trim().toUpperCase();
      persistentCompanyGroups.set(cleanRoomId, room.companyGroup);
    } else if (systemInfo && systemInfo.companyGroup) {
      room.companyGroup = String(systemInfo.companyGroup).trim().toUpperCase();
      persistentCompanyGroups.set(cleanRoomId, room.companyGroup);
    }
    if (room.systemInfo) room.systemInfo.companyGroup = room.companyGroup;

    if (role === 'host') {
      room.host = socket.id;
      const socketRawIp = (socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim() || socket.handshake.address || '';
      const cleanSocketPublicIp = socketRawIp.replace(/^::ffff:/, '');

      if (systemInfo) {
        if (cleanSocketPublicIp && !cleanSocketPublicIp.includes('127.0.0.1')) {
          systemInfo.publicIp = cleanSocketPublicIp;
        } else if (systemInfo.publicIp === 'N/A' && room.systemInfo?.publicIp && room.systemInfo.publicIp !== 'N/A') {
          systemInfo.publicIp = room.systemInfo.publicIp;
        }
        room.systemInfo = { ...(room.systemInfo || {}), ...systemInfo };
      }
      console.log(`Host registered for room ${cleanRoomId} (Group: ${room.companyGroup}) with info:`, room.systemInfo);
      // If host's local group is different from persistent server group, inform the host
      if (persistentCompanyGroups.has(cleanRoomId) && persistentCompanyGroups.get(cleanRoomId) !== companyGroup) {
        socket.emit('company-group-updated', { companyGroup: room.companyGroup });
      }
      broadcastActiveHosts();
    } else if (role === 'controller') {
      room.controller = socket.id;
      console.log(`Controller registered for room ${cleanRoomId}`);
      socket.emit('active-hosts-list', getActiveHostsList());
      // Send host info to controller if available
      if (room.systemInfo) {
        socket.emit('host-info', { systemInfo: room.systemInfo, companyGroup: room.companyGroup });
      }
    }

    // If both host and controller are in the room, notify them.
    if (room.host && room.controller) {
      io.to(cleanRoomId).emit('ready', { host: room.host, controller: room.controller, systemInfo: room.systemInfo, companyGroup: room.companyGroup });
      console.log(`Room ${cleanRoomId} is ready for WebRTC connection`);
    }
  });

  // Reassign or update company group via socket
  socket.on('update-company-group', ({ roomId, companyGroup }) => {
    const targetRoom = String(roomId || socket.roomId || '').trim();
    if (targetRoom && companyGroup) {
      const cleanGroup = String(companyGroup).trim().toUpperCase();
      persistentCompanyGroups.set(targetRoom, cleanGroup);
      if (!rooms.has(targetRoom)) {
        rooms.set(targetRoom, { host: null, controller: null, systemInfo: null, companyGroup: cleanGroup, lastSeen: Date.now() });
      }
      const room = rooms.get(targetRoom);
      room.companyGroup = cleanGroup;
      if (room.systemInfo) room.systemInfo.companyGroup = cleanGroup;
      if (room.host) {
        io.to(room.host).emit('company-group-updated', { companyGroup: cleanGroup });
      }
      broadcastActiveHosts();
    }
  });

  // Allow controllers to explicitly request current active host nodes anytime
  socket.on('get-active-hosts', (query) => {
    const company = query && query.company ? String(query.company).trim().toUpperCase() : null;
    const list = getActiveHostsList();
    if (company && company !== 'ALL') {
      socket.emit('active-hosts-list', list.filter(h => (h.companyGroup || 'USPL').toUpperCase() === company));
    } else {
      socket.emit('active-hosts-list', list);
    }
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
    const targetRoom = String(roomId || socket.roomId || '').trim();
    if (targetRoom && frame) {
      socket.to(targetRoom).emit('screen-frame', { frame });
    }
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
    const cleanRoomId = String(roomId || socket.roomId || '').trim();
    if (cleanRoomId && rooms.has(cleanRoomId)) {
      const room = rooms.get(cleanRoomId);
      const lockedIp = persistentHostPublicIps.get(cleanRoomId);
      if (lockedIp && metrics) {
        metrics.publicIp = lockedIp;
      }
      room.liveMetrics = { ...(room.liveMetrics || {}), ...(metrics || {}) };
    }
    // O(1) targeted relay to the controller in this room (bypasses global broadcast CPU overhead)
    socket.to(cleanRoomId).emit('system-metrics', { metrics });
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

  // Relay File Explorer Events (requests & chunk download streaming bidirectional)
  socket.on('file-explorer-event', (data) => {
    const targetRoom = String(socket.roomId || data?.roomId || '').trim();
    if (targetRoom) {
      socket.to(targetRoom).emit('file-explorer-event', data);
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

        // Clean up room if both host and controller are empty and no recent HTTP heartbeat
        if (!room.host && !room.controller) {
          if (!room.lastSeen || (Date.now() - room.lastSeen >= 30000)) {
            rooms.delete(roomId);
            console.log(`Room ${roomId} deleted`);
          }
        }
        broadcastActiveHosts();
      }, 3000);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling Server is listening on port ${PORT}`);
});
