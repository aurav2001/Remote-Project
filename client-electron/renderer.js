const btnStart = document.getElementById('btn-start');
const screenSelect = document.getElementById('screen-select');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const roomIdText = document.getElementById('room-id');
const btnCopy = document.getElementById('btn-copy');
const btnResetCode = document.getElementById('btn-reset-code');

const SIGNALING_SERVER = 'https://remote-desktop-signaling-syj4.onrender.com';
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

// Get or initialize persistent access code from localStorage
function getOrInitPermanentCode() {
  let savedCode = null;
  try {
    savedCode = localStorage.getItem('remoteg_permanent_access_code');
  } catch (e) {
    console.warn('localStorage read warning:', e);
  }
  if (!savedCode || savedCode.length !== 6) {
    savedCode = generateRoomId();
    try {
      localStorage.setItem('remoteg_permanent_access_code', savedCode);
    } catch (e) {}
  }
  roomId = savedCode;
  if (roomIdText) {
    roomIdText.innerText = roomId;
  }
  return roomId;
}

// Initialize code immediately on load
getOrInitPermanentCode();

// Reset/Regenerate permanent access code
function resetPermanentCode() {
  const newCode = generateRoomId();
  localStorage.setItem('remoteg_permanent_access_code', newCode);
  roomId = newCode;
  if (roomIdText) {
    roomIdText.innerText = roomId;
  }
  console.log('[Host]: Permanent Access Code reset to:', roomId);
  if (window.electronAPI && roomId) {
    window.electronAPI.joinRoom(roomId, 'host');
  }
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
    if (roomId) {
      window.electronAPI.emitSocket('terminal-result', resultPayload);
    }
  } catch (err) {
    console.error('[Host]: Failed executing terminal command:', err);
  }
}

// Handle incoming P2P File Transfer Chunk
async function handleIncomingFileChunk(data) {
  if (!data || !data.transferId) return;
  try {
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
      if (roomId) {
        window.electronAPI.emitSocket('file-transfer-ack', ackPayload);
      }
    }
  } catch (err) {
    console.error('[Host]: Failed processing incoming file chunk:', err);
  }
}

let frameInterval = null;
const relayCanvas = document.createElement('canvas');
const relayCtx = relayCanvas.getContext('2d');

function startSocketFrameRelay() {
  // Light fallback - disabled by default to save 100% CPU for smooth WebRTC 60fps streaming
}

function stopSocketFrameRelay() {
  if (frameInterval) {
    clearInterval(frameInterval);
    frameInterval = null;
  }
}

// Core function to start screen sharing
async function startSharing(sourceId) {
  if (!sourceId) return;

  // Do not re-capture if we already have a live captured stream
  if (localStream && localStream.active && localStream.getVideoTracks().length > 0) {
    const activeTrack = localStream.getVideoTracks()[0];
    if (activeTrack.readyState === 'live') {
      console.log('[Host]: Screen capture stream already active:', activeTrack.id);
      startSocketFrameRelay();
      window.electronAPI.connectSocket(SIGNALING_SERVER);
      return;
    }
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: 60
        }
      }
    });

    const localVideo = document.getElementById('local-video');
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.style.display = 'none';
      localVideo.play().catch(e => {});
    }

    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = true;
        console.log('[Host]: Desktop screen video track active:', track.id, 'readyState:', track.readyState);
      });
    }

    if (btnStart) {
      btnStart.innerText = 'Screen Streaming Active';
      btnStart.disabled = false;
    }
    if (screenSelect) {
      screenSelect.disabled = false;
    }
    isSharingStarted = true;

    window.electronAPI.connectSocket(SIGNALING_SERVER);
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
    // Attempt fallback capture on error
    try {
      await startSharing('screen:0:0');
    } catch (e) {}
  }
}

let hasAutoMinimized = false;

function onStreamConnected() {
  updateStatus('connected', 'Connected & Streaming');
  stopSocketFrameRelay();
  if (!hasAutoMinimized && window.electronAPI && window.electronAPI.minimizeHostWindow) {
    hasAutoMinimized = true;
    console.log('[Host]: Triggering auto-minimize on stream connection...');
    window.electronAPI.minimizeHostWindow().catch(err => console.warn('Minimize warning:', err));
  }
}

// Setup WebRTC Peer Connection
async function createPeerConnection() {
  hasAutoMinimized = false;
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
    // Set contentHint to 'detail' for ultra-sharp text and crisp desktop graphics
    if ('contentHint' in track) {
      track.contentHint = 'detail';
    }
    console.log('[Host]: Adding Crisp HD screen video track to PeerConnection:', track.id);
    const sender = peerConnection.addTrack(track, localStream);
    if (sender && sender.setParameters) {
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = 8000000; // 8 Mbps High Quality Bitrate
        params.encodings[0].maxFramerate = 60;
        params.degradationPreference = 'maintain-framerate'; // Ensures smooth 60fps framerate never holds/freezes on minimize
        sender.setParameters(params).catch(e => console.warn('Bitrate param error:', e));
      } catch (err) {}
    }
  });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && isValidCandidate(event.candidate)) {
      window.electronAPI.emitSocket('ice-candidate', {
        roomId,
        candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
      });
    }
  };

  peerConnection.ondatachannel = (event) => {
    console.log('[Host]: Direct P2P WebRTC DataChannel established!');
    activeDataChannel = event.channel;
    startDataChannelHeartbeat();
    onStreamConnected();
    activeDataChannel.onopen = () => {
      console.log('[Host]: DataChannel opened!');
      onStreamConnected();
    };
    activeDataChannel.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'ping') {
          if (activeDataChannel && activeDataChannel.readyState === 'open') {
            activeDataChannel.send(JSON.stringify({ type: 'pong' }));
          }
          return;
        }
        if (data.type === 'pong') return;
        if (data.type === 'clipboard-sync' && data.text) {
          console.log('[Host]: Received remote controller clipboard text:', data.text.substring(0, 30));
          window.electronAPI.writeClipboard(data.text);
          return;
        }
        if (data.type === 'file-transfer-chunk') {
          handleIncomingFileChunk(data);
          return;
        }
        if (data.type === 'terminal-command') {
          handleTerminalCommand(data);
        } else {
          window.electronAPI.sendControlEvent(data);
        }
      } catch (err) {
        console.error('[Host]: Error parsing DataChannel event:', err);
      }
    };
  };

  peerConnection.onconnectionstatechange = () => {
    console.log(`[Host]: Connection state changed to: ${peerConnection.connectionState}`);
    if (peerConnection.connectionState === 'connected') {
      onStreamConnected();
    } else if (peerConnection.connectionState === 'disconnected') {
      updateStatus('connecting', 'Network blip. Reconnecting stream...');
      startSocketFrameRelay();
    } else if (peerConnection.connectionState === 'failed') {
      console.warn('[Host]: WebRTC connection state failed. Attempting ICE restart...');
      updateStatus('connecting', 'Connection failed. Re-establishing...');
      startSocketFrameRelay();
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

  // Prevent destroying active connected peer session on duplicate ready signals
  if (peerConnection && (peerConnection.connectionState === 'connected' || peerConnection.iceConnectionState === 'connected')) {
    console.log('[Host]: PeerConnection is already CONNECTED and streaming. Ignoring duplicate offer trigger.');
    return;
  }

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

    window.electronAPI.emitSocket('webrtc-offer', {
      roomId,
      offer: {
        type: offer.type || 'offer',
        sdp: offer.sdp
      }
    });
  } catch (err) {
    console.error('Error initiating WebRTC offer:', err);
  } finally {
    isInitiatingOffer = false;
  }
}

// Global Socket Listeners
window.addEventListener('socket-connected', async () => {
  console.log('Connected to signaling server as Host with ID:', roomId);
  updateStatus('connecting', 'Waiting for Controller...');
  let systemInfo = null;
  try {
    if (window.electronAPI && window.electronAPI.getSystemInfo) {
      systemInfo = await window.electronAPI.getSystemInfo();
    }
  } catch (err) {
    console.warn('Could not fetch system info:', err);
  }
  window.electronAPI.joinRoom(roomId, 'host', systemInfo);
});

window.addEventListener('socket-disconnected', () => {
  console.log('Disconnected from signaling server');
  if (!peerConnection || peerConnection.connectionState !== 'connected') {
    updateStatus('', 'Disconnected');
  } else {
    console.warn('[Host]: Signaling socket blip, maintaining WebRTC P2P stream.');
  }
});

// Terminal commands over socket fallback
window.electronAPI.onSocket('terminal-command', (data) => {
  handleTerminalCommand(data);
});

// Incoming hardware control events over socket fallback (only process if DataChannel is NOT open)
window.electronAPI.onSocket('control-event', (data) => {
  if (!activeDataChannel || activeDataChannel.readyState !== 'open') {
    window.electronAPI.sendControlEvent(data);
  }
});

// Incoming clipboard sync over socket fallback
window.electronAPI.onSocket('clipboard-sync', (data) => {
  if (data && data.text) {
    console.log('[Host]: Received remote clipboard text via socket fallback:', data.text.substring(0, 30));
    window.electronAPI.writeClipboard(data.text);
  }
});

// Incoming file transfer chunks over socket fallback
window.electronAPI.onSocket('file-transfer-chunk', (data) => {
  handleIncomingFileChunk(data);
});

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
    if (roomId) {
      window.electronAPI.emitSocket('clipboard-sync', { roomId, text });
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
    if (roomId) {
      window.electronAPI.emitSocket('system-metrics', { roomId, metrics });
    }
  });
}

// When controller is ready, initiate connection
window.electronAPI.onSocket('ready', handleControllerJoined);

// Receive SDP Answer from Controller
window.electronAPI.onSocket('webrtc-answer', async ({ answer }) => {
  console.log('Received WebRTC answer from controller.');
  if (peerConnection && answer) {
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
  }
});

// Receive ICE candidate from Controller
window.electronAPI.onSocket('ice-candidate', async ({ candidate }) => {
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
    if (confirm('Are you sure you want to regenerate your Permanent Access Code?')) {
      resetPermanentCode();
    }
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

getOrInitPermanentCode();

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', loadSources);
} else {
  loadSources();
}
