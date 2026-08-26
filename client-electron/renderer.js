const btnStart = document.getElementById('btn-start');
const screenSelect = document.getElementById('screen-select');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const roomIdText = document.getElementById('room-id');
const btnCopy = document.getElementById('btn-copy');
const btnResetCode = document.getElementById('btn-reset-code');

const SIGNALING_SERVER = 'https://remote-project.onrender.com';
let socket = null;
let localStream = null;
let peerConnection = null;
let activeDataChannel = null;
let heartbeatInterval = null;
let roomId = '';
let isSharingStarted = false;
let pendingIceCandidates = [];
let isInitiatingOffer = false;

// STUN + TURN servers for reliable WebRTC NAT traversal across networks & CGNAT
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.nextcloud.com:443' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'stun:relay.metered.ca:80' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turns:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

const isValidCandidate = (cand) => {
  return cand && (cand.candidate !== '' && cand.candidate !== undefined) && (cand.sdpMid !== null || cand.sdpMLineIndex !== null);
};

// Generate random 6-digit access code
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Get or initialize persistent access code from main process / localStorage
async function getOrInitPermanentCode() {
  let savedCode = null;
  if (window.electronAPI && window.electronAPI.getPermanentCode) {
    try {
      savedCode = await window.electronAPI.getPermanentCode();
    } catch(e) {}
  }
  if (!savedCode || savedCode.length !== 6) {
    try {
      savedCode = localStorage.getItem('remoteg_permanent_access_code');
    } catch (e) {}
  }
  if (!savedCode || savedCode.length !== 6) {
    savedCode = generateRoomId();
  }
  roomId = String(savedCode).trim();
  if (roomIdText) {
    roomIdText.innerText = roomId;
  }
  return roomId;
}

// Reset/Regenerate permanent access code
async function resetPermanentCode() {
  const newCode = generateRoomId();
  if (window.electronAPI && window.electronAPI.setPermanentCode) {
    try {
      await window.electronAPI.setPermanentCode(newCode);
    } catch(e) {}
  }
  try {
    localStorage.setItem('remoteg_permanent_access_code', newCode);
  } catch (e) {}
  roomId = String(newCode).trim();
  if (roomIdText) {
    roomIdText.innerText = roomId;
  }
  console.log('[Host]: Permanent Access Code reset to:', roomId);
  registerHostOnServer();
}

// Update connection status indicator
function updateStatus(status, text) {
  if (statusDot) {
    statusDot.className = 'status-dot';
    if (status) {
      statusDot.classList.add(status);
    }
  }
  if (statusText) {
    statusText.innerText = text;
  }
}

// Register Host Room with Signaling Server
async function registerHostOnServer() {
  if (!roomId) {
    await getOrInitPermanentCode();
  }
  if (!socket || !socket.connected || !roomId) return;
  let systemInfo = null;
  try {
    if (window.electronAPI && window.electronAPI.getSystemInfo) {
      systemInfo = await window.electronAPI.getSystemInfo();
    }
  } catch (err) {
    console.warn('Could not fetch system info:', err);
  }
  console.log('[Host]: Registering room with signaling server. Room ID:', roomId);
  socket.emit('join-room', { roomId, role: 'host', systemInfo });
}

// Initialize Socket.io Connection Directly
function initSocket() {
  if (socket) return;
  const ioFunc = window.io;
  if (!ioFunc) {
    console.error('[Host]: window.io is not defined! Retrying in 500ms...');
    setTimeout(initSocket, 500);
    return;
  }

  console.log('[Host]: Connecting to signaling server:', SIGNALING_SERVER);
  socket = ioFunc(SIGNALING_SERVER, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
  });

  socket.on('connect', () => {
    console.log('[Host]: Connected to signaling server! Socket ID:', socket.id);
    updateStatus('connecting', 'Waiting for Controller...');
    registerHostOnServer();
  });

  socket.on('disconnect', (reason) => {
    console.warn('[Host]: Disconnected from signaling server:', reason);
    if (!peerConnection || peerConnection.connectionState !== 'connected') {
      updateStatus('', 'Reconnecting...');
    }
  });

  // When controller is ready, initiate connection
  socket.on('ready', handleControllerJoined);

  // Receive SDP Answer from Controller
  socket.on('webrtc-answer', async ({ answer }) => {
    console.log('[Host]: Received WebRTC answer from controller.');
    if (peerConnection && answer) {
      try {
        const sdpAnswer = new RTCSessionDescription({
          type: answer.type || 'answer',
          sdp: answer.sdp || (typeof answer === 'string' ? answer : answer.answer?.sdp)
        });
        await peerConnection.setRemoteDescription(sdpAnswer);
        while (pendingIceCandidates.length > 0) {
          const candidate = pendingIceCandidates.shift();
          if (isValidCandidate(candidate)) {
            try {
              await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
              console.warn('Skipping queued candidate:', e);
            }
          }
        }
      } catch (err) {
        console.error('[Host]: Failed setting remote description:', err);
      }
    }
  });

  // Receive ICE candidate from Controller
  socket.on('ice-candidate', async ({ candidate }) => {
    if (!isValidCandidate(candidate)) return;
    if (peerConnection && peerConnection.remoteDescription) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('Skipping candidate error:', e);
      }
    } else {
      pendingIceCandidates.push(candidate);
    }
  });

  // Terminal commands over socket fallback
  socket.on('terminal-command', (data) => {
    handleTerminalCommand(data);
  });

  // Incoming hardware control events over socket fallback
  socket.on('control-event', (data) => {
    if (!activeDataChannel || activeDataChannel.readyState !== 'open') {
      if (window.electronAPI && window.electronAPI.sendControlEvent) {
        window.electronAPI.sendControlEvent(data);
      }
    }
  });

  // Incoming clipboard sync over socket fallback
  socket.on('clipboard-sync', (data) => {
    if (data && data.text && window.electronAPI && window.electronAPI.writeClipboard) {
      console.log('[Host]: Received remote clipboard text via socket fallback:', data.text.substring(0, 30));
      window.electronAPI.writeClipboard(data.text);
    }
  });

  // Incoming file transfer chunks over socket fallback
  socket.on('file-transfer-chunk', (data) => {
    handleIncomingFileChunk(data);
  });

  // When controller disconnects, reset peer connection & return to waiting state
  socket.on('peer-disconnected', ({ role }) => {
    if (role === 'controller') {
      console.log('[Host]: Controller disconnected. Resetting peer connection.');
      if (peerConnection) {
        try { peerConnection.close(); } catch(e) {}
        peerConnection = null;
      }
      activeDataChannel = null;
      updateStatus('connecting', 'Waiting for Controller...');
    }
  });

  // Keep-alive heartbeat: Re-announce host presence every 15s to keep room registered on Render
  setInterval(() => {
    if (socket && socket.connected && roomId) {
      socket.emit('join-room', { roomId, role: 'host' });
    }
  }, 15000);
}

// DataChannel Heartbeat Ping to prevent CGNAT/Firewall UDP timeouts
function startDataChannelHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (activeDataChannel && activeDataChannel.readyState === 'open') {
      try {
        activeDataChannel.send(JSON.stringify({ type: 'ping' }));
      } catch (e) {}
    }
  }, 3000);
}

// Execute remote terminal command silently and return output
async function handleTerminalCommand(data) {
  if (!data || !data.command) return;
  console.log('[Host]: Received remote terminal command:', data.command);
  try {
    if (!window.electronAPI || !window.electronAPI.executeRemoteCommand) return;
    const res = await window.electronAPI.executeRemoteCommand({
      command: data.command,
      shellType: data.shellType || 'powershell'
    });
    const resultPayload = {
      type: 'terminal-result',
      id: data.id,
      command: data.command,
      shellType: data.shellType || 'powershell',
      output: res.output,
      isError: res.isError,
      timestamp: new Date().toLocaleTimeString()
    };

    if (activeDataChannel && activeDataChannel.readyState === 'open') {
      try {
        activeDataChannel.send(JSON.stringify(resultPayload));
      } catch (err) {
        console.warn('[Host]: DataChannel terminal result error:', err);
      }
    }
    if (socket && socket.connected) {
      socket.emit('terminal-result', resultPayload);
    }
  } catch (err) {
    console.error('[Host]: Failed executing terminal command:', err);
  }
}

// Handle incoming P2P File Transfer Chunk
async function handleIncomingFileChunk(data) {
  if (!data || !data.transferId) return;
  try {
    if (!window.electronAPI || !window.electronAPI.saveFileChunk) return;
    const res = await window.electronAPI.saveFileChunk(data);
    if (data.isLastChunk && res && res.success) {
      console.log('[Host]: Successfully received file:', res.fileName, 'Saved to:', res.filePath);
      const ackPayload = {
        type: 'file-transfer-ack',
        transferId: data.transferId,
        fileName: res.fileName,
        filePath: res.filePath,
        bytesWritten: res.bytesWritten,
        success: true
      };
      if (activeDataChannel && activeDataChannel.readyState === 'open') {
        try {
          activeDataChannel.send(JSON.stringify(ackPayload));
        } catch (e) {}
      }
      if (socket && socket.connected) {
        socket.emit('file-transfer-ack', ackPayload);
      }
    }
  } catch (err) {
    console.error('[Host]: Failed processing incoming file chunk:', err);
  }
}

// --- HYBRID JPEG FRAME STREAMER (Zero-drop fallback for WebRTC NAT blocks) ---
let frameStreamingInterval = null;
const hiddenVideo = document.createElement('video');
hiddenVideo.muted = true;
hiddenVideo.playsInline = true;
hiddenVideo.autoplay = true;
hiddenVideo.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:320px;height:240px;opacity:0.01;pointer-events:none;z-index:-1;';
try {
  if (document.body) {
    document.body.appendChild(hiddenVideo);
  } else {
    window.addEventListener('DOMContentLoaded', () => document.body.appendChild(hiddenVideo));
  }
} catch(e) {}

const streamCanvas = document.createElement('canvas');
const streamCtx = streamCanvas.getContext('2d', { alpha: false });

function startHybridFrameStreaming() {
  if (frameStreamingInterval) clearInterval(frameStreamingInterval);
  if (localStream) {
    hiddenVideo.srcObject = localStream;
    hiddenVideo.play().catch(e => {});
  }
  frameStreamingInterval = setInterval(() => {
    if (!socket || !socket.connected || !roomId) return;
    if (hiddenVideo.videoWidth > 0) {
      const targetWidth = Math.min(1280, hiddenVideo.videoWidth);
      const targetHeight = Math.round(targetWidth * (hiddenVideo.videoHeight / hiddenVideo.videoWidth));
      if (streamCanvas.width !== targetWidth || streamCanvas.height !== targetHeight) {
        streamCanvas.width = targetWidth;
        streamCanvas.height = targetHeight;
      }
      streamCtx.drawImage(hiddenVideo, 0, 0, targetWidth, targetHeight);
      const frameData = streamCanvas.toDataURL('image/jpeg', 0.60);
      socket.emit('screen-frame', { roomId, frame: frameData });
    }
  }, 100); // 10-15 FPS fast smooth fallback stream
}

function stopHybridFrameStreaming() {
  if (frameStreamingInterval) {
    clearInterval(frameStreamingInterval);
    frameStreamingInterval = null;
  }
}

// Core function to start screen sharing
async function startSharing(sourceId) {
  if (localStream && localStream.active && localStream.getVideoTracks().length > 0) {
    const activeTrack = localStream.getVideoTracks()[0];
    if (activeTrack.readyState === 'live') {
      console.log('[Host]: Screen capture stream already active:', activeTrack.id);
      startHybridFrameStreaming();
      return;
    }
  }

  try {
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          frameRate: { ideal: 60, max: 60 }
        },
        audio: false
      });
      console.log('[Host]: Screen captured via modern getDisplayMedia!');
    } catch(err) {
      console.warn('[Host]: getDisplayMedia fallback to getUserMedia with sourceId:', sourceId);
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId || 'screen:0:0',
            maxWidth: 3840,
            maxHeight: 2160,
            maxFrameRate: 60
          }
        }
      });
    }

    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = true;
        console.log('[Host]: Desktop screen video track active:', track.id, 'readyState:', track.readyState);
      });
      startHybridFrameStreaming();
    }

    if (btnStart) {
      btnStart.innerText = 'Screen Streaming Active';
      btnStart.disabled = false;
    }
    if (screenSelect) {
      screenSelect.disabled = false;
    }
    isSharingStarted = true;
  } catch (error) {
    console.error('Error starting screen share:', error);
    updateStatus('', 'Screen Capture Error');
  }
}

// Load available screen sources
async function loadSources() {
  try {
    updateStatus('connecting', 'Waiting for Controller...');
    if (btnStart) btnStart.disabled = false;

    let sources = [];
    if (window.electronAPI && window.electronAPI.getScreenSources) {
      sources = await window.electronAPI.getScreenSources();
    }
    
    if (screenSelect) {
      screenSelect.innerHTML = '';
      if (!sources || sources.length === 0) {
        screenSelect.innerHTML = '<option value="screen:0:0">Primary Screen (Auto)</option>';
        await startSharing('screen:0:0');
        return;
      }
      sources.sort((a, b) => (a.id.startsWith('screen') ? -1 : 1));
      sources.forEach(source => {
        const option = document.createElement('option');
        option.value = source.id;
        option.text = source.name;
        screenSelect.appendChild(option);
      });
    }

    if (btnStart) btnStart.disabled = false;

    if (!isSharingStarted && sources && sources.length > 0) {
      const primarySourceId = sources[0].id;
      console.log('[Host]: Auto-starting screen capture for primary source:', primarySourceId);
      await startSharing(primarySourceId);
    }
  } catch (error) {
    console.error('Error loading sources:', error);
    if (screenSelect) {
      screenSelect.innerHTML = '<option value="screen:0:0">Default Screen</option>';
    }
    if (btnStart) {
      btnStart.disabled = false;
      btnStart.innerText = 'Start Screen Sharing';
    }
    try {
      await startSharing('screen:0:0');
    } catch (e) {}
  }
}

function onStreamConnected() {
  updateStatus('connected', 'Connected & Streaming');
  if (window.electronAPI && window.electronAPI.minimizeHostWindow) {
    console.log('[Host]: Triggering auto-minimize on stream connection...');
    window.electronAPI.minimizeHostWindow().catch(err => console.warn('Minimize warning:', err));
  }
}

function setupDataChannel(channel) {
  if (!channel) return;
  activeDataChannel = channel;
  startDataChannelHeartbeat();
  channel.onopen = () => {
    console.log('[Host]: DataChannel opened!');
    onStreamConnected();
  };
  channel.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'ping') {
        if (channel.readyState === 'open') {
          channel.send(JSON.stringify({ type: 'pong' }));
        }
        return;
      }
      if (data.type === 'pong') return;
      if (data.type === 'clipboard-sync' && data.text) {
        console.log('[Host]: Received remote controller clipboard text:', data.text.substring(0, 30));
        if (window.electronAPI && window.electronAPI.writeClipboard) {
          window.electronAPI.writeClipboard(data.text);
        }
        return;
      }
      if (data.type === 'file-transfer-chunk') {
        handleIncomingFileChunk(data);
        return;
      }
      if (data.type === 'terminal-command') {
        handleTerminalCommand(data);
      } else {
        if (window.electronAPI && window.electronAPI.sendControlEvent) {
          window.electronAPI.sendControlEvent(data);
        }
      }
    } catch (err) {
      console.error('[Host]: Error parsing DataChannel event:', err);
    }
  };
}

// Setup WebRTC Peer Connection
async function createPeerConnection() {
  if (peerConnection) {
    try {
      peerConnection.close();
    } catch (e) {}
  }

  if (!localStream || !localStream.active || localStream.getVideoTracks().length === 0) {
    console.warn('[Host]: localStream missing or inactive. Re-capturing screen...');
    if (screenSelect && screenSelect.value) {
      await startSharing(screenSelect.value);
    }
  }

  if (!localStream) {
    console.error('[Host]: CRITICAL - localStream is NULL when creating PeerConnection!');
    return false;
  }

  peerConnection = new RTCPeerConnection(rtcConfig);

  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length === 0) {
    console.error('[Host]: CRITICAL - localStream has 0 video tracks!');
    return false;
  }

  videoTracks.forEach(track => {
    track.enabled = true;
    if ('contentHint' in track) {
      track.contentHint = 'detail';
    }
    console.log('[Host]: Adding Crisp HD screen video track to PeerConnection:', track.id);
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && isValidCandidate(event.candidate)) {
      if (socket && socket.connected) {
        socket.emit('ice-candidate', {
          roomId,
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
        });
      }
    }
  };

  try {
    const dc = peerConnection.createDataChannel('controlEvents');
    setupDataChannel(dc);
  } catch (e) {
    console.warn('Host createDataChannel error:', e);
  }

  peerConnection.ondatachannel = (event) => {
    console.log('[Host]: Direct P2P WebRTC DataChannel established via ondatachannel!');
    setupDataChannel(event.channel);
  };

  peerConnection.onconnectionstatechange = () => {
    console.log(`[Host]: Connection state changed to: ${peerConnection.connectionState}`);
    if (peerConnection.connectionState === 'connected') {
      onStreamConnected();
    } else if (peerConnection.connectionState === 'disconnected') {
      updateStatus('connecting', 'Network blip. Reconnecting stream...');
    } else if (peerConnection.connectionState === 'failed') {
      console.warn('[Host]: WebRTC connection state failed. Attempting ICE restart...');
      updateStatus('connecting', 'Connection failed. Re-establishing...');
      if (peerConnection.restartIce) {
        peerConnection.restartIce();
      }
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log(`[Host]: ICE connection state changed to: ${peerConnection.iceConnectionState}`);
    if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
      onStreamConnected();
    }
  };
}

async function handleControllerJoined() {
  if (isInitiatingOffer) return;

  isInitiatingOffer = true;

  try {
    console.log('[Host]: Controller ready! Initiating WebRTC SDP offer.');
    updateStatus('connecting', 'Establishing WebRTC connection...');
    pendingIceCandidates = [];

    const pcCreated = await createPeerConnection();
    if (pcCreated === false) {
      console.error('[Host]: PeerConnection creation aborted because no active video tracks exist!');
      return;
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    if (socket && socket.connected) {
      socket.emit('webrtc-offer', {
        roomId,
        offer: {
          type: offer.type || 'offer',
          sdp: offer.sdp
        }
      });
    }

    if (window.electronAPI && window.electronAPI.minimizeHostWindow) {
      window.electronAPI.minimizeHostWindow().catch(err => {});
    }
  } catch (err) {
    console.error('Error initiating WebRTC offer:', err);
  } finally {
    isInitiatingOffer = false;
  }
}

// Sync Host OS Clipboard changes to Controller
if (window.electronAPI && window.electronAPI.onHostClipboardChanged) {
  window.electronAPI.onHostClipboardChanged((text) => {
    console.log('[Host]: Host OS clipboard changed, syncing to remote controller:', text.substring(0, 30));
    const payload = JSON.stringify({ type: 'clipboard-sync', text });
    if (activeDataChannel && activeDataChannel.readyState === 'open') {
      try {
        activeDataChannel.send(payload);
      } catch (e) {}
    }
    if (socket && socket.connected && roomId) {
      socket.emit('clipboard-sync', { roomId, text });
    }
  });
}

// System metrics updates
if (window.electronAPI && window.electronAPI.onSystemMetricsUpdate) {
  window.electronAPI.onSystemMetricsUpdate((metrics) => {
    const payload = JSON.stringify({ type: 'system-metrics', metrics });
    if (activeDataChannel && activeDataChannel.readyState === 'open') {
      try {
        activeDataChannel.send(payload);
      } catch (e) {}
    }
    if (socket && socket.connected && roomId) {
      socket.emit('system-metrics', { roomId, metrics });
    }
  });
}

// Buttons & Event listeners
if (btnCopy) {
  btnCopy.addEventListener('click', () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId);
      const originalSVG = btnCopy.innerHTML;
      btnCopy.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      setTimeout(() => {
        btnCopy.innerHTML = originalSVG;
      }, 2000);
    }
  });
}

if (btnResetCode) {
  btnResetCode.addEventListener('click', () => {
    resetPermanentCode();
    btnResetCode.style.transform = 'rotate(360deg)';
    setTimeout(() => {
      btnResetCode.style.transform = 'none';
    }, 400);
  });
}

if (btnStart) {
  btnStart.addEventListener('click', () => {
    if (screenSelect) {
      startSharing(screenSelect.value);
    }
  });
}

if (screenSelect) {
  screenSelect.addEventListener('change', () => {
    if (screenSelect.value) {
      startSharing(screenSelect.value);
    }
  });
}

// Bootstrapping Host Application
async function bootstrap() {
  await getOrInitPermanentCode();
  initSocket();
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', loadSources);
  } else {
    loadSources();
  }
}

bootstrap();
