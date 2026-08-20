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
let roomId = '';
let isSharingStarted = false;

// STUN + TURN servers for reliable WebRTC NAT traversal across networks
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
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
    }
  ]
};

// Generate random 6-digit access code
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Get or initialize persistent access code from localStorage
function getOrInitPermanentCode() {
  let savedCode = localStorage.getItem('remoteg_permanent_access_code');
  if (!savedCode || savedCode.length !== 6) {
    savedCode = generateRoomId();
    localStorage.setItem('remoteg_permanent_access_code', savedCode);
  }
  roomId = savedCode;
  if (roomIdText) {
    roomIdText.innerText = roomId;
  }
  return roomId;
}

// Reset/Regenerate permanent access code
function resetPermanentCode() {
  const newCode = generateRoomId();
  localStorage.setItem('remoteg_permanent_access_code', newCode);
  roomId = newCode;
  if (roomIdText) {
    roomIdText.innerText = roomId;
  }
  console.log('[Host]: Permanent Access Code reset to:', roomId);
  // Re-join room on server with new ID
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

// Core function to start screen sharing
async function startSharing(sourceId) {
  if (!sourceId) return;

  try {
    // Capture desktop screen track without rigid resolution constraints
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      }
    });

    const localVideo = document.getElementById('local-video');
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.style.display = 'none';
    }

    if (btnStart) {
      btnStart.innerText = 'Streaming Screen (Auto-Started)';
      btnStart.disabled = true;
    }
    if (screenSelect) {
      screenSelect.disabled = false; // Allow user to switch monitor if they want
    }
    isSharingStarted = true;

    // Connect to Signaling Server
    window.electronAPI.connectSocket(SIGNALING_SERVER);
  } catch (error) {
    console.error('Error starting screen share:', error);
    updateStatus('', 'Screen Capture Error');
  }
}

// Load available screen and window sources into select dropdown & auto-start
async function loadSources() {
  try {
    const sources = await window.electronAPI.getScreenSources();
    if (screenSelect) {
      screenSelect.innerHTML = '';
      
      if (sources.length === 0) {
        screenSelect.innerHTML = '<option value="">No screens found</option>';
        return;
      }

      // Prioritize physical screen sources over window sources
      sources.sort((a, b) => (a.id.startsWith('screen') ? -1 : 1));

      sources.forEach(source => {
        const option = document.createElement('option');
        option.value = source.id;
        option.text = source.name;
        screenSelect.appendChild(option);
      });
    }

    if (btnStart) {
      btnStart.disabled = false;
    }

    // AUTO-START Screen Share on App Launch (Direct Unattended Access)
    if (!isSharingStarted && sources.length > 0) {
      const primarySourceId = sources[0].id;
      console.log('[Host]: Auto-starting screen capture for primary source:', primarySourceId);
      startSharing(primarySourceId);
    }
  } catch (error) {
    console.error('Error loading sources:', error);
    if (screenSelect) {
      screenSelect.innerHTML = '<option value="">Failed to load screens</option>';
    }
  }
}

// Copy Code to Clipboard
if (btnCopy) {
  btnCopy.addEventListener('click', () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId);
      
      // Quick copy indicator
      const originalSVG = btnCopy.innerHTML;
      btnCopy.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      setTimeout(() => {
        btnCopy.innerHTML = originalSVG;
      }, 2000);
    }
  });
}

// Regenerate/Reset Code Button
if (btnResetCode) {
  btnResetCode.addEventListener('click', () => {
    if (confirm('Are you sure you want to regenerate your Permanent Access Code? Controller will need the new code to connect.')) {
      resetPermanentCode();
    }
  });
}

// Setup listener for socket connection status
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

// Manual Start button click (if user wants to manually re-share or switch)
if (btnStart) {
  btnStart.addEventListener('click', () => {
    if (screenSelect) {
      const sourceId = screenSelect.value;
      startSharing(sourceId);
    }
  });
}

// When screen selection changes, switch source on the fly
if (screenSelect) {
  screenSelect.addEventListener('change', () => {
    const sourceId = screenSelect.value;
    if (sourceId) {
      console.log('[Host]: Switching stream source to:', sourceId);
      startSharing(sourceId);
    }
  });
}

// Initialize permanent access code on script load
getOrInitPermanentCode();

let activeDataChannel = null;

// Listen for incoming hardware input events from controller
window.electronAPI.onSocket('control-event', (data) => {
  window.electronAPI.sendControlEvent(data);
});

// Relay system metrics to controller over DataChannel and Socket
if (window.electronAPI && window.electronAPI.onSystemMetricsUpdate) {
  window.electronAPI.onSystemMetricsUpdate((metrics) => {
    const payload = JSON.stringify({ type: 'system-metrics', metrics });
    if (activeDataChannel && activeDataChannel.readyState === 'open') {
      try {
        activeDataChannel.send(payload);
      } catch (e) {
        console.warn('[Host]: DataChannel metrics send error:', e);
      }
    }
    if (roomId) {
      window.electronAPI.emitSocket('system-metrics', { roomId, metrics });
    }
  });
}

// Setup WebRTC Peer Connection
async function createPeerConnection() {
  if (peerConnection) {
    peerConnection.close();
  }

  peerConnection = new RTCPeerConnection(rtcConfig);

  if (!localStream) {
    console.error('No localStream available to share!');
    return;
  }

  // Add all local screen tracks to peer connection
  localStream.getTracks().forEach(track => {
    track.enabled = true;
    peerConnection.addTrack(track, localStream);
  });

  const isValidCandidate = (cand) => {
    return cand && (cand.candidate !== '' && cand.candidate !== undefined) && (cand.sdpMid !== null || cand.sdpMLineIndex !== null);
  };

  // Handle ICE Candidates generated locally
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && isValidCandidate(event.candidate)) {
      window.electronAPI.emitSocket('ice-candidate', {
        roomId,
        candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
      });
    }
  };

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

// Listen for terminal commands over socket signaling
window.electronAPI.onSocket('terminal-command', (data) => {
  handleTerminalCommand(data);
});

// Listen for WebRTC DataChannel created by controller
peerConnection.ondatachannel = (event) => {
  console.log('[Host]: Direct P2P WebRTC DataChannel established!');
  activeDataChannel = event.channel;
  activeDataChannel.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'terminal-command') {
        handleTerminalCommand(data);
      } else {
        window.electronAPI.sendControlEvent(data);
      }
    } catch (err) {
      console.error('[Host]: Error parsing DataChannel control event:', err);
    }
  };
};

  // Monitor Connection State
  peerConnection.onconnectionstatechange = () => {
    console.log(`Connection state: ${peerConnection.connectionState}`);
    if (peerConnection.connectionState === 'connected') {
      updateStatus('connected', 'Connected & Streaming');
    } else if (peerConnection.connectionState === 'failed') {
      updateStatus('connecting', 'Controller Disconnected. Waiting...');
    }
  };
}

let pendingIceCandidates = [];
let isInitiatingOffer = false;

const isValidCandidate = (cand) => {
  return cand && (cand.candidate !== '' && cand.candidate !== undefined) && (cand.sdpMid !== null || cand.sdpMLineIndex !== null);
};

async function handleControllerJoined() {
  if (isInitiatingOffer) return;
  isInitiatingOffer = true;

  try {
    console.log('Controller connected! Initiating SDP offer.');
    updateStatus('connecting', 'Establishing connection...');
    pendingIceCandidates = [];
    
    await createPeerConnection();

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

// When controller is ready, initiate connection with WebRTC Offer
window.electronAPI.onSocket('ready', handleControllerJoined);

// Receive WebRTC SDP Answer from controller
window.electronAPI.onSocket('webrtc-answer', async ({ answer }) => {
  console.log('Received WebRTC answer from controller.');
  if (peerConnection && answer) {
    const sdpAnswer = new RTCSessionDescription({
      type: answer.type || 'answer',
      sdp: answer.sdp || (typeof answer === 'string' ? answer : answer.answer?.sdp)
    });
    await peerConnection.setRemoteDescription(sdpAnswer);
    // Flush queued ICE candidates
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

// Receive WebRTC ICE Candidate from controller
window.electronAPI.onSocket('ice-candidate', async ({ candidate }) => {
  console.log('Received ICE candidate from controller.');
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

// Listen for incoming hardware input events from controller
window.electronAPI.onSocket('control-event', (data) => {
  window.electronAPI.sendControlEvent(data);
});

// Load screen sources on startup
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', loadSources);
} else {
  loadSources();
}
