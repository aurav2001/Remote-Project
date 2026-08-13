const btnStart = document.getElementById('btn-start');
const screenSelect = document.getElementById('screen-select');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const roomIdText = document.getElementById('room-id');
const btnCopy = document.getElementById('btn-copy');

const SIGNALING_SERVER = 'https://remote-desktop-signaling-syj4.onrender.com';
let localStream = null;
let peerConnection = null;
let roomId = '';

// STUN + TURN servers for reliable WebRTC NAT traversal across networks
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
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

// Update connection status indicator
function updateStatus(status, text) {
  statusDot.className = 'status-dot';
  if (status) {
    statusDot.classList.add(status);
  }
  statusText.innerText = text;
}

// Load screen and window sources
async function loadSources() {
  try {
    const sources = await window.electronAPI.getScreenSources();
    screenSelect.innerHTML = '';
    
    if (sources.length === 0) {
      screenSelect.innerHTML = '<option value="">No screens found</option>';
      return;
    }

    sources.forEach(source => {
      const option = document.createElement('option');
      option.value = source.id;
      option.text = source.name;
      screenSelect.appendChild(option);
    });
    btnStart.disabled = false;
  } catch (error) {
    console.error('Error loading sources:', error);
    screenSelect.innerHTML = '<option value="">Failed to load screens</option>';
  }
}

// Copy Code to Clipboard
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

// Setup listener for socket connection status
window.addEventListener('socket-connected', () => {
  console.log('Connected to signaling server');
  updateStatus('connecting', 'Waiting for Controller...');
  window.electronAPI.joinRoom(roomId, 'host');
});

window.addEventListener('socket-disconnected', () => {
  console.log('Disconnected from signaling server');
  updateStatus('', 'Disconnected');
});

// Start streaming screen
btnStart.addEventListener('click', async () => {
  const sourceId = screenSelect.value;
  if (!sourceId) return;

  try {
    // Capture desktop screen track
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080,
          minFrameRate: 30,
          maxFrameRate: 60
        }
      }
    });

    const localVideo = document.getElementById('local-video');
    localVideo.srcObject = localStream;
    localVideo.style.display = 'block';

    btnStart.innerText = 'Sharing Screen...';
    btnStart.disabled = true;
    screenSelect.disabled = true;

    // Generate Access Code
    roomId = generateRoomId();
    roomIdText.innerText = roomId;

    // Connect to Signaling Server
    window.electronAPI.connectSocket(SIGNALING_SERVER);
  } catch (error) {
    console.error('Error starting screen share:', error);
    alert('Failed to share screen: ' + error.message);
  }
});

// Setup WebRTC Peer Connection
async function createPeerConnection() {
  if (peerConnection) {
    peerConnection.close();
  }

  peerConnection = new RTCPeerConnection(rtcConfig);

  // Add all local screen tracks to peer connection
  localStream.getTracks().forEach(track => {
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

  // Monitor Connection State
  peerConnection.onconnectionstatechange = () => {
    console.log(`Connection state: ${peerConnection.connectionState}`);
    if (peerConnection.connectionState === 'connected') {
      updateStatus('connected', 'Connected & Streaming');
    } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
      updateStatus('connecting', 'Controller Disconnected. Waiting...');
    }
  };
}

let pendingIceCandidates = [];

const isValidCandidate = (cand) => {
  return cand && (cand.candidate !== '' && cand.candidate !== undefined) && (cand.sdpMid !== null || cand.sdpMLineIndex !== null);
};

async function handleControllerJoined() {
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
}

// When controller is ready, initiate connection with WebRTC Offer
window.electronAPI.onSocket('ready', handleControllerJoined);
window.electronAPI.onSocket('controller-joined', handleControllerJoined);

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
