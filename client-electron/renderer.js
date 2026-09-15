const btnStart = document.getElementById('btn-start');
const screenSelect = document.getElementById('screen-select');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const roomIdText = document.getElementById('room-id');
const companyGroupText = document.getElementById('company-group-text');
const btnCopy = document.getElementById('btn-copy');
const btnResetCode = document.getElementById('btn-reset-code');
const btnEditGroup = document.getElementById('btn-edit-group');

const SIGNALING_SERVER = 'https://remote.uniotechit.com';
let socket = null;
let localStream = null;
let hostLocked = false; // true only while Windows is locked (drives lock-frame vs normal-frame gating)
let peerConnection = null;
let activeDataChannel = null;
let heartbeatInterval = null;
let roomId = '';
let companyGroup = 'USPL';
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
    { urls: 'stun:stun.services.mozilla.com:3478' },
    { urls: 'stun:stun.twilio.com:3478' },
    { urls: 'stun:relay.metered.ca:80' },
    {
      urls: 'turn:relay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:relay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:relay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

const isValidCandidate = (cand) => {
  return cand && (cand.candidate !== '' && cand.candidate !== undefined) && (cand.sdpMid !== null || cand.sdpMLineIndex !== null);
};

// Generate random 6-digit access code
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Get or initialize persistent company group
async function getOrInitCompanyGroup() {
  let savedGroup = null;
  if (window.electronAPI && window.electronAPI.getCompanyGroup) {
    try {
      savedGroup = await window.electronAPI.getCompanyGroup();
    } catch (e) { }
  }
  if (!savedGroup) {
    try {
      savedGroup = localStorage.getItem('remoteg_company_group');
    } catch (e) { }
  }
  companyGroup = (savedGroup || 'USPL').trim().toUpperCase();
  if (companyGroupText) {
    companyGroupText.innerText = companyGroup;
  }
  return companyGroup;
}

// Set / Update Company Group Code
async function updateCompanyGroup(newGroup) {
  if (!newGroup || !newGroup.trim()) return;
  const cleanGroup = newGroup.trim().toUpperCase();
  companyGroup = cleanGroup;
  if (companyGroupText) {
    companyGroupText.innerText = cleanGroup;
  }
  if (window.electronAPI && window.electronAPI.setCompanyGroup) {
    try {
      await window.electronAPI.setCompanyGroup(cleanGroup);
    } catch (e) { }
  }
  try {
    localStorage.setItem('remoteg_company_group', cleanGroup);
  } catch (e) { }
  if (socket && socket.connected) {
    socket.emit('update-company-group', { roomId, companyGroup: cleanGroup });
  }
  registerHostOnServer();
}

if (btnEditGroup) {
  btnEditGroup.addEventListener('click', async () => {
    const input = prompt('Enter Company / Organization Workspace Code (e.g. USPL, TechCorp, Default):', companyGroup);
    if (input && input.trim()) {
      await updateCompanyGroup(input.trim());
    }
  });
}

// Listen for remote group update from server / controller
if (window.electronAPI && window.electronAPI.onCompanyGroupUpdated) {
  window.electronAPI.onCompanyGroupUpdated((newGroup) => {
    if (newGroup) {
      companyGroup = newGroup.toUpperCase();
      if (companyGroupText) companyGroupText.innerText = companyGroup;
    }
  });
}

// Get or initialize persistent access code from main process / localStorage
async function getOrInitPermanentCode() {
  let savedCode = null;
  if (window.electronAPI && window.electronAPI.getPermanentCode) {
    try {
      savedCode = await window.electronAPI.getPermanentCode();
    } catch (e) { }
  }
  if (!savedCode || savedCode.length !== 6) {
    try {
      savedCode = localStorage.getItem('remoteg_permanent_access_code');
    } catch (e) { }
  }
  if (!savedCode || savedCode.length !== 6) {
    savedCode = generateRoomId();
  }
  roomId = String(savedCode).trim();
  if (roomIdText) {
    roomIdText.innerText = roomId;
  }
  await getOrInitCompanyGroup();
  return roomId;
}

// Reset/Regenerate permanent access code
async function resetPermanentCode() {
  const newCode = generateRoomId();
  if (window.electronAPI && window.electronAPI.setPermanentCode) {
    try {
      await window.electronAPI.setPermanentCode(newCode);
    } catch (e) { }
  }
  try {
    localStorage.setItem('remoteg_permanent_access_code', newCode);
  } catch (e) { }
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

let cachedLiveMetrics = null;

// Register Host Room with Signaling Server
async function registerHostOnServer() {
  if (!roomId) {
    await getOrInitPermanentCode();
  }
  if (!companyGroup) {
    await getOrInitCompanyGroup();
  }
  let systemInfo = null;
  try {
    if (window.electronAPI && window.electronAPI.getSystemInfo) {
      systemInfo = await window.electronAPI.getSystemInfo();
    }
  } catch (err) {
    console.warn('Could not fetch system info:', err);
  }
  if (systemInfo) {
    systemInfo.companyGroup = companyGroup;
  }

  // 1. WebSocket Join Room
  if (socket && socket.connected && roomId) {
    console.log(`[Host]: Registering room on server (Socket). Room ID: ${roomId}, Company: ${companyGroup}`);
    socket.emit('join-room', { roomId, role: 'host', systemInfo, companyGroup, liveMetrics: cachedLiveMetrics });
  }

  // 2. Guaranteed HTTP Heartbeat Post (Works even if WebSocket is proxy-delayed)
  try {
    fetch(`${SIGNALING_SERVER}/api/register-host`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, systemInfo, companyGroup, liveMetrics: cachedLiveMetrics })
    }).catch(() => { });
  } catch (e) { }
}

// Background 5s HTTP Keepalive Heartbeat
setInterval(() => {
  if (roomId) {
    registerHostOnServer();
  }
}, 5000);

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
    timeout: 20000,
    transports: ['polling', 'websocket']
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
    if (!data) return;
    if (data.type === 'system-reboot') {
      console.log('[Host]: Received remote system reboot command from controller (socket)!');
      if (window.electronAPI && window.electronAPI.executeSystemReboot) {
        window.electronAPI.executeSystemReboot({ force: true, delaySec: 3 });
      }
      return;
    }
    if (data.type === 'video-live') {
      onControllerVideoLive();
      return;
    }
    if (data.type === 'get-screens-list') {
      sendScreensListToController();
      return;
    }
    if (data.type === 'switch-screen' && data.screenId) {
      handleSwitchScreen(data.screenId);
      return;
    }
    if (data.type === 'annotation-event') {
      if (window.electronAPI && window.electronAPI.showAnnotation) {
        window.electronAPI.showAnnotation(data.payload);
      }
      return;
    }
    if (data.type === 'unlockwithpin' || data.type === 'trigger-sas-unlock' || data.type === 'wake-lock-screen' || data.type === 'unlock-screen') {
      console.log('[Host]: Processing unlock/wake command via socket:', data.type);
      if (window.electronAPI && window.electronAPI.sendControlEvent) {
        window.electronAPI.sendControlEvent(data);
      }
      return;
    }
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

  // Incoming file explorer requests over socket fallback
  socket.on('file-explorer-event', (data) => {
    if (!data) return;
    const payload = data.payload || data;
    if (payload.type === 'file-explorer-list-req') {
      handleFileExplorerListRequest(payload);
    } else if (payload.type === 'file-explorer-download-req') {
      handleFileExplorerDownloadRequest(payload);
    }
  });

  // Incoming system diagnostics report request (for Excel export)
  socket.on('request-system-diagnostics', (data) => {
    handleRequestSystemDiagnostics(data);
  });

  // When controller disconnects, reset peer connection & return to waiting state
  socket.on('peer-disconnected', ({ role }) => {
    if (role === 'controller') {
      console.log('[Host]: Controller disconnected. Resetting peer connection.');
      isControllerConnected = false;
      stopHybridFrameStreaming();
      if (peerConnection) {
        try { peerConnection.close(); } catch (e) { }
        peerConnection = null;
      }
      activeDataChannel = null;
      updateStatus('connecting', 'Waiting for Controller...');
    }
  });

  // Keep-alive heartbeat: Re-announce host presence every 10s without resetting active WebRTC session
  setInterval(() => {
    if (socket && socket.connected && roomId) {
      socket.emit('host-heartbeat', { roomId, companyGroup, liveMetrics: cachedLiveMetrics });
    }
  }, 10000);
}

// DataChannel Heartbeat Ping to prevent CGNAT/Firewall UDP timeouts
function startDataChannelHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (activeDataChannel && activeDataChannel.readyState === 'open') {
      try {
        activeDataChannel.send(JSON.stringify({ type: 'ping' }));
      } catch (e) { }
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

// Gather full system diagnostics and return to controller (for Excel Export)
async function handleRequestSystemDiagnostics(data) {
  console.log('[Host]: Generating full system diagnostics report for controller...');
  try {
    if (!window.electronAPI || !window.electronAPI.getFullSystemDiagnostics) {
      console.warn('[Host]: getFullSystemDiagnostics API not available in preload.');
      return;
    }
    const diagnostics = await window.electronAPI.getFullSystemDiagnostics();
    const resultPayload = {
      type: 'system-diagnostics-response',
      requestId: data?.requestId || null,
      roomId: data?.roomId || roomId || null,
      diagnostics: diagnostics,
      timestamp: new Date().toISOString()
    };

    if (activeDataChannel && activeDataChannel.readyState === 'open') {
      try {
        activeDataChannel.send(JSON.stringify(resultPayload));
      } catch (dcErr) {
        console.warn('[Host]: DataChannel diagnostics send failed, falling back to socket:', dcErr);
      }
    }
    if (socket && socket.connected) {
      socket.emit('system-diagnostics-response', resultPayload);
    }
    console.log('[Host]: Full system diagnostics successfully sent to controller.');
  } catch (err) {
    console.error('[Host]: Error generating system diagnostics report:', err);
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
        } catch (e) { }
      }
      if (socket && socket.connected) {
        socket.emit('file-transfer-ack', ackPayload);
      }
    }
  } catch (err) {
    console.error('[Host]: Failed processing incoming file chunk:', err);
  }
}

// Send File Explorer responses to controller (prefers WebRTC DataChannel, falls back to Socket)
function sendFileExplorerData(payload) {
  let sent = false;
  if (activeDataChannel && activeDataChannel.readyState === 'open') {
    try {
      activeDataChannel.send(JSON.stringify(payload));
      sent = true;
    } catch (e) { }
  }
  if (!sent && socket && socket.connected && roomId) {
    socket.emit('file-explorer-event', { roomId, payload });
    sent = true;
  }
  return sent;
}

// Handle File Explorer directory listing request
async function handleFileExplorerListRequest(data) {
  if (!data || !window.electronAPI) return;
  try {
    const targetPath = data.path || null;
    const dirRes = await window.electronAPI.readDirectory(targetPath);
    let drivesInfo = null;
    if (data.includeDrives || !targetPath) {
      drivesInfo = await window.electronAPI.getDrivesAndQuickPaths();
    }
    const responsePayload = {
      type: 'file-explorer-list-res',
      reqId: data.reqId,
      ...dirRes,
      drivesInfo: drivesInfo || undefined
    };
    sendFileExplorerData(responsePayload);
  } catch (err) {
    console.error('[Host]: File Explorer list error:', err);
    sendFileExplorerData({
      type: 'file-explorer-list-res',
      reqId: data.reqId,
      success: false,
      error: err.message,
      items: []
    });
  }
}

// Handle File Explorer file download streaming request (Target PC -> Admin Controller)
async function handleFileExplorerDownloadRequest(data) {
  if (!data || !data.filePath || !window.electronAPI) return;
  const transferId = data.transferId || `dl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const filePath = data.filePath;
  const fileName = data.fileName || filePath.split(/[\/\\]/).pop();

  console.log(`[Host]: Starting file download streaming for: ${filePath} (Transfer ID: ${transferId})`);

  let offset = 0;
  const CHUNK_SIZE = 64 * 1024; // 64 KB chunks

  async function sendNextChunk() {
    try {
      const chunkRes = await window.electronAPI.readFileChunk({
        filePath,
        offset,
        chunkSize: CHUNK_SIZE
      });

      if (!chunkRes || !chunkRes.success) {
        sendFileExplorerData({
          type: 'file-download-chunk',
          transferId,
          fileName,
          error: chunkRes?.error || 'Failed reading file chunk',
          isLastChunk: true
        });
        return;
      }

      const isFirstChunk = offset === 0;
      const isLastChunk = chunkRes.isLastChunk;

      sendFileExplorerData({
        type: 'file-download-chunk',
        transferId,
        fileName,
        totalSize: chunkRes.totalSize,
        offset,
        base64Chunk: chunkRes.base64Chunk,
        bytesRead: chunkRes.bytesRead,
        isFirstChunk,
        isLastChunk
      });

      if (!isLastChunk) {
        offset += chunkRes.bytesRead;
        // Non-blocking micro-delay for smooth pacing
        setTimeout(sendNextChunk, 8);
      } else {
        console.log(`[Host]: Completed streaming file: ${fileName} (${chunkRes.totalSize} bytes)`);
      }
    } catch (err) {
      console.error('[Host]: Error streaming file chunk:', err);
      sendFileExplorerData({
        type: 'file-download-chunk',
        transferId,
        fileName,
        error: err.message,
        isLastChunk: true
      });
    }
  }

  sendNextChunk();
}

// --- HYBRID JPEG FRAME STREAMER (Zero-drop lightweight fallback for strict NAT/Firewalls) ---
let frameStreamingInterval = null;
let isControllerConnected = false;
// During a post-unlock recovery the WebRTC peer connection is still "connected" (it never
// closed during lock), so the hybrid fallback would normally kill itself on the first tick
// and send ZERO recovery frames. This flag keeps the fallback alive through the transition.
let allowHybridDuringRecovery = false;
// Only stop the socket fallback once the CONTROLLER confirms its WebRTC <video> is actually
// painting live frames (a 'video-live' message). ICE reporting "connected" is NOT enough —
// media can lag behind, and stopping the fallback then leaves the controller on a frozen
// first frame ("initial image then freeze"). Until confirmed, the fallback keeps streaming.
let controllerVideoConfirmed = false;
let videoConfirmSafetyTimer = null;
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
} catch (e) { }

const streamCanvas = document.createElement('canvas');
const streamCtx = streamCanvas.getContext('2d', { alpha: false });

function startHybridFrameStreaming() {
  // If WebRTC direct P2P is already active and healthy, do not waste bandwidth on socket frames.
  // EXCEPTION: during post-unlock recovery keep the fallback alive even though the peer is
  // still "connected" — otherwise there are zero recovery frames while the video is black.
  if (!allowHybridDuringRecovery && controllerVideoConfirmed && peerConnection && (peerConnection.connectionState === 'connected' || peerConnection.iceConnectionState === 'connected')) {
    stopHybridFrameStreaming();
    return;
  }

  if (frameStreamingInterval) clearInterval(frameStreamingInterval);
  if (localStream) {
    hiddenVideo.srcObject = localStream;
    hiddenVideo.play().catch(e => { });
  }

  console.log('[Host]: Hybrid frame stream active (lightweight fallback mode)...');
  let isSendingFrame = false;

  frameStreamingInterval = setInterval(() => {
    if (!socket || !socket.connected || !roomId || !isControllerConnected) return;
    if (!allowHybridDuringRecovery && controllerVideoConfirmed && peerConnection && (peerConnection.connectionState === 'connected' || peerConnection.iceConnectionState === 'connected')) {
      stopHybridFrameStreaming();
      return;
    }
    if (isSendingFrame) return; // Prevent frame backlog in socket buffer
    if (hostLocked) return; // While locked, only the SYSTEM worker's lock frames go out (no competing black frames)

    if (hiddenVideo.videoWidth > 0) {
      isSendingFrame = true;
      const maxWidth = 960; // Lightweight resolution for ultra-low latency & zero lag
      const targetWidth = Math.min(maxWidth, hiddenVideo.videoWidth);
      const targetHeight = Math.round(targetWidth * (hiddenVideo.videoHeight / hiddenVideo.videoWidth));
      if (streamCanvas.width !== targetWidth || streamCanvas.height !== targetHeight) {
        streamCanvas.width = targetWidth;
        streamCanvas.height = targetHeight;
      }
      streamCtx.drawImage(hiddenVideo, 0, 0, targetWidth, targetHeight);
      const frameData = streamCanvas.toDataURL('image/jpeg', 0.40); // 40% quality reduces payload size by 85%
      socket.emit('screen-frame', { roomId, frame: frameData });
      setTimeout(() => { isSendingFrame = false; }, 120);
    }
  }, 140); // ~7 FPS smooth fallback without congesting socket control clicks
}

function stopHybridFrameStreaming() {
  if (frameStreamingInterval) {
    console.log('[Host]: Stopping hybrid frame stream (WebRTC P2P active - 0ms latency mode)');
    clearInterval(frameStreamingInterval);
    frameStreamingInterval = null;
  }
}

// Called when the controller confirms its WebRTC <video> is painting live frames.
function onControllerVideoLive() {
  if (controllerVideoConfirmed) return;
  controllerVideoConfirmed = true;
  if (videoConfirmSafetyTimer) { clearTimeout(videoConfirmSafetyTimer); videoConfirmSafetyTimer = null; }
  console.log('[Host]: Controller confirmed WebRTC video is live — stopping socket fallback.');
  stopHybridFrameStreaming();
}

// Core function to start screen sharing
async function startSharing(sourceId) {
  if (localStream && localStream.active && localStream.getVideoTracks().length > 0) {
    const activeTrack = localStream.getVideoTracks()[0];
    if (activeTrack.readyState === 'live') {
      console.log('[Host]: Screen capture stream already active:', activeTrack.id);
      return;
    }
  }

  try {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId || 'screen:0:0',
            minWidth: 1920,
            maxWidth: 1920,
            minHeight: 1080,
            maxHeight: 1080,
            minFrameRate: 30,
            maxFrameRate: 60
          }
        }
      });
      console.log('[Host]: Screen captured via native desktopCapturer at true 1080p 60FPS Crisp HD!');
    } catch (err) {
      console.warn('[Host]: Primary capture fallback:', err);
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId || 'screen:0:0',
            minWidth: 1280,
            maxWidth: 1920,
            minHeight: 720,
            maxHeight: 1080,
            maxFrameRate: 60
          }
        }
      });
    }

    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = true;
        if ('contentHint' in track) {
          track.contentHint = 'motion'; // continuous screen video (don't drop small cursor/typing changes)
        }
        console.log('[Host]: Desktop screen video track active (Ultra Sharp HD Mode):', track.id, 'readyState:', track.readyState);
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
  } catch (error) {
    console.error('Error starting screen share:', error);
    updateStatus('', 'Screen Capture Error');
  }
}

let cachedScreenSources = [];
let currentScreenSourceId = 'screen:0:0';

async function handleSwitchScreen(screenId) {
  if (!screenId) return;
  console.log('[Host]: Switching active screen to:', screenId);
  currentScreenSourceId = screenId;

  // Find monitor info and update input-helper display bounds
  const matchedScreen = cachedScreenSources.find(s => s.id === screenId);
  if (matchedScreen && matchedScreen.bounds && window.electronAPI && window.electronAPI.setActiveDisplay) {
    window.electronAPI.setActiveDisplay(matchedScreen.bounds);
  }

  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenId,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080,
          minFrameRate: 30,
          maxFrameRate: 60
        }
      }
    });

    if (newStream && newStream.getVideoTracks().length > 0) {
      const newTrack = newStream.getVideoTracks()[0];
      newTrack.enabled = true;
      if ('contentHint' in newTrack) {
        newTrack.contentHint = 'motion';
      }

      // Hot swap video track on active WebRTC PeerConnection seamlessly
      if (peerConnection) {
        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(newTrack);
          console.log('[Host]: WebRTC video track hot-swapped seamlessly to screen:', screenId);
        }
      }

      // Stop old tracks
      if (localStream) {
        localStream.getVideoTracks().forEach(t => t.stop());
      }
      localStream = newStream;
      currentScreenSourceId = screenId; // remember active monitor (used for post-unlock re-capture)

      // Notify controller
      const notifyPayload = {
        type: 'screen-switched',
        screenId,
        label: matchedScreen ? matchedScreen.label : 'Monitor'
      };
      if (activeDataChannel && activeDataChannel.readyState === 'open') {
        activeDataChannel.send(JSON.stringify(notifyPayload));
      } else if (socket && socket.connected) {
        socket.emit('control-event', notifyPayload);
      }
    }
  } catch (err) {
    console.error('[Host]: Failed to switch screen:', err);
  }
}

function sendScreensListToController() {
  if (!cachedScreenSources || cachedScreenSources.length === 0) return;
  const payload = {
    type: 'screens-list',
    screens: cachedScreenSources,
    currentScreenId: currentScreenSourceId
  };
  if (activeDataChannel && activeDataChannel.readyState === 'open') {
    activeDataChannel.send(JSON.stringify(payload));
  } else if (socket && socket.connected) {
    socket.emit('control-event', payload);
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
      cachedScreenSources = sources;
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
        option.text = source.label || source.name;
        screenSelect.appendChild(option);
      });
    }

    if (btnStart) btnStart.disabled = false;

    if (!isSharingStarted && sources && sources.length > 0) {
      const primarySourceId = sources[0].id;
      currentScreenSourceId = primarySourceId;
      console.log('[Host]: Auto-starting screen capture for primary source:', primarySourceId);
      if (sources[0].bounds && window.electronAPI && window.electronAPI.setActiveDisplay) {
        window.electronAPI.setActiveDisplay(sources[0].bounds);
      }
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
    } catch (e) { }
  }
}

function onStreamConnected() {
  updateStatus('connected', 'Connected & Streaming');
  sendScreensListToController();
}

function setupDataChannel(channel) {
  if (!channel) return;
  activeDataChannel = channel;
  startDataChannelHeartbeat();
  channel.onopen = async () => {
    console.log('[Host]: DataChannel opened!');
    onStreamConnected();
    if (window.electronAPI && window.electronAPI.getLockStatus) {
      try {
        const lockRes = await window.electronAPI.getLockStatus();
        if (channel.readyState === 'open') {
          channel.send(JSON.stringify({
            type: 'host-lock-status',
            isLocked: !!lockRes?.isLocked
          }));
        }
      } catch (e) { }
    }
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
      if (data.type === 'video-live') { onControllerVideoLive(); return; }
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
      if (data.type === 'file-explorer-list-req') {
        handleFileExplorerListRequest(data);
        return;
      }
      if (data.type === 'file-explorer-download-req') {
        handleFileExplorerDownloadRequest(data);
        return;
      }
      if (data.type === 'get-screens-list') {
        sendScreensListToController();
        return;
      }
      if (data.type === 'switch-screen' && data.screenId) {
        handleSwitchScreen(data.screenId);
        return;
      }
      if (data.type === 'annotation-event') {
        if (window.electronAPI && window.electronAPI.showAnnotation) {
          window.electronAPI.showAnnotation(data.payload);
        }
        return;
      }
      if (data.type === 'trigger-sas-unlock' || data.type === 'unlock-screen' || data.type === 'wake-lock-screen') {
        console.log('[Host]: Received SAS unlock / wake lock screen trigger from controller');
        if (window.electronAPI && window.electronAPI.triggerSasUnlock) {
          window.electronAPI.triggerSasUnlock();
        }
        return;
      }
      if (data.type === 'system-reboot') {
        console.log('[Host]: Received remote system reboot command from controller (DataChannel)!');
        if (window.electronAPI && window.electronAPI.executeSystemReboot) {
          window.electronAPI.executeSystemReboot({ force: true, delaySec: 3 });
        }
        const ack = {
          type: 'reboot-initiated',
          delaySec: 3,
          message: 'Target PC is rebooting in 3 seconds...'
        };
        if (channel.readyState === 'open') {
          channel.send(JSON.stringify(ack));
        }
        return;
      }
      if (data.type === 'terminal-command') {
        handleTerminalCommand(data);
      } else if (data.type === 'request-system-diagnostics') {
        handleRequestSystemDiagnostics(data);
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

// Power / Screen Lock Event Listeners
if (window.electronAPI && window.electronAPI.onHostLockStatus) {
  window.electronAPI.onHostLockStatus((data) => {
    console.log('[Host]: Lock status changed:', data);
    const lockPayload = {
      type: 'host-lock-status',
      isLocked: !!data?.isLocked,
      roomId: roomId
    };
    if (activeDataChannel && activeDataChannel.readyState === 'open') {
      try {
        activeDataChannel.send(JSON.stringify(lockPayload));
      } catch (e) { }
    }
    if (socket && socket.connected && roomId) {
      socket.emit('host-lock-status', lockPayload);
      socket.emit('control-event', lockPayload);
    }
    // IMPORTANT: do NOT disable the WebRTC video track or tear down the stream here.
    // Doing that caused a permanent black screen. The controller already hides the
    // live <video> while locked and shows the lock image instead, so we only need to
    // stop the user-session SOCKET fallback frames from competing with the worker's
    // lock frames — handled by the `hostLocked` gate inside the hybrid loop below.
    hostLocked = !!data?.isLocked;
    if (!hostLocked) {
      // After unlock the user-session desktop capture is usually frozen/black and does
      // NOT recover on its own — that is why a page refresh (which re-captures) fixed it.
      // So here we re-acquire the desktop and hot-swap it onto the live WebRTC sender
      // (exactly what handleSwitchScreen does), recovering the picture WITHOUT a refresh.
      if (localStream) {
        localStream.getVideoTracks().forEach(track => { track.enabled = true; });
      }
      try { if (typeof hiddenVideo !== 'undefined' && hiddenVideo) hiddenVideo.play().catch(() => { }); } catch (e) { }

      // Keep sending socket fallback frames through the WHOLE transition. allowHybridDuringRecovery
      // forces them out even though the peer connection is still "connected" (see the guards).
      allowHybridDuringRecovery = true;
      if (isControllerConnected) {
        startHybridFrameStreaming();
      }

      // After ~500ms (desktop fully restored), REFRESH the Chromium desktopCapturer source IDs
      // — after a lock the old id goes stale and re-capturing with it yields a black frame. Use
      // the FRESH first source id, not the stale currentScreenSourceId. Then hot-swap the fresh
      // capture onto the live WebRTC sender; handleSwitchScreen sends 'screen-switched' when
      // replaceTrack completes → controller confirms real frames → reveals video (no black gap).
      setTimeout(async () => {
        try { await loadSources(); } catch (e) { }
        let freshId = currentScreenSourceId || 'screen:0:0';
        try {
          if (cachedScreenSources && cachedScreenSources.length > 0 && cachedScreenSources[0].id) {
            freshId = cachedScreenSources[0].id;
          }
        } catch (e) { }
        try { await handleSwitchScreen(freshId); } catch (e) { console.warn('[Host]: post-unlock recapture failed', e); }
        // WebRTC now carries the fresh live track — stop the recovery fallback.
        allowHybridDuringRecovery = false;
        stopHybridFrameStreaming();
      }, 500);
      // Safety: never leave recovery mode stuck on.
      setTimeout(() => { allowHybridDuringRecovery = false; }, 6000);
    }
  });
}

// Live Lock Screen Frame Streamer
if (window.electronAPI && window.electronAPI.onLockScreenFrame) {
  window.electronAPI.onLockScreenFrame((data) => {
    if (data && data.frame) {
      if (socket && socket.connected && roomId) {
        socket.emit('screen-frame', { roomId: roomId, frame: data.frame });
      }
      if (activeDataChannel && activeDataChannel.readyState === 'open') {
        try {
          activeDataChannel.send(JSON.stringify({
            type: 'screen-frame',
            frame: data.frame
          }));
        } catch (e) { }
      }
    }
  });
}

// Low-Latency & High-Clarity WebRTC SDP & Sender Bitrate Optimizers
function optimizeSdp(sdp) {
  if (!sdp) return sdp;
  try {
    let lines = sdp.split('\r\n');
    let mLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('m=video')) {
        mLineIndex = i;
        break;
      }
    }
    if (mLineIndex !== -1) {
      lines.splice(mLineIndex + 1, 0, 'b=AS:10000', 'b=TIAS:10000000');
    }
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('a=fmtp:')) {
        if (!lines[i].includes('x-google-min-bitrate')) {
          lines[i] += ';x-google-min-bitrate=2500;x-google-max-bitrate=10000;x-google-start-bitrate=4000';
        }
      }
    }
    return lines.join('\r\n');
  } catch (e) {
    return sdp;
  }
}

async function tuneVideoSenderBitrate(pc) {
  if (!pc) return;
  try {
    const senders = pc.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (videoSender && videoSender.setParameters) {
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].minBitrate = 2500000;   // 2.5 Mbps crisp floor (zero blur/pixelation)
      params.encodings[0].maxBitrate = 10000000;  // 10 Mbps ceiling for true 1080p 60FPS HD
      params.encodings[0].maxFramerate = 60;
      params.encodings[0].networkPriority = 'high';
      params.encodings[0].priority = 'high';
      params.degradationPreference = 'maintain-resolution'; // NEVER downscale resolution or blur text!
      await videoSender.setParameters(params);
      console.log('[Host]: Video sender tuned to 10 Mbps / 60 FPS Ultra-Crisp HD profile!');
    }
  } catch (e) {
    console.warn('[Host]: Error tuning video sender parameters:', e);
  }
}

// Setup WebRTC Peer Connection
async function createPeerConnection() {
  if (peerConnection) {
    try {
      peerConnection.close();
    } catch (e) { }
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
      track.contentHint = 'motion'; // continuous screen video (don't drop small cursor/typing changes)
    }
    console.log('[Host]: Adding Ultra-Sharp 1080p 60FPS video track to PeerConnection:', track.id);
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
    const dc = peerConnection.createDataChannel('controlEvents', {
      ordered: false,
      maxRetransmits: 0
    });
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
      if (isControllerConnected) startHybridFrameStreaming();
    } else if (peerConnection.connectionState === 'failed') {
      console.warn('[Host]: WebRTC connection state failed. Attempting ICE restart...');
      updateStatus('connecting', 'Connection fallback active...');
      if (isControllerConnected) startHybridFrameStreaming();
      if (peerConnection.restartIce) {
        peerConnection.restartIce();
      }
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log(`[Host]: ICE connection state changed to: ${peerConnection.iceConnectionState}`);
    if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
      onStreamConnected();
    } else if (peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'disconnected') {
      if (isControllerConnected) startHybridFrameStreaming();
    }
  };
}

async function handleControllerJoined() {
  if (isInitiatingOffer) return;

  // If WebRTC connection is already active and healthy, do NOT tear it down or send duplicate offers!
  if (peerConnection && (peerConnection.connectionState === 'connected' || peerConnection.iceConnectionState === 'connected')) {
    console.log('[Host]: Controller ready signal received, but WebRTC connection is ALREADY connected & healthy. Retaining active session.');
    return;
  }

  isInitiatingOffer = true;
  isControllerConnected = true;

  // New controller session: the WebRTC video isn't confirmed live yet, so keep the socket
  // fallback running until the controller sends 'video-live'. Safety net: assume it's fine
  // after 12s (so the fallback doesn't run forever if the confirm message is ever missed).
  controllerVideoConfirmed = false;
  if (videoConfirmSafetyTimer) clearTimeout(videoConfirmSafetyTimer);
  videoConfirmSafetyTimer = setTimeout(() => { controllerVideoConfirmed = true; }, 12000);

  // Start the lightweight socket fallback IMMEDIATELY so the controller sees the
  // screen within ~1s instead of waiting for WebRTC ICE. It keeps running until the
  // controller confirms its live video is actually painting (no "freeze on first frame").
  if (!hostLocked) {
    startHybridFrameStreaming();
  }

  try {
    console.log('[Host]: Controller ready! Initiating WebRTC SDP offer.');
    updateStatus('connecting', 'Establishing WebRTC connection...');
    pendingIceCandidates = [];

    const pcCreated = await createPeerConnection();
    if (pcCreated === false) {
      console.error('[Host]: PeerConnection creation aborted because no active video tracks exist!');
      return;
    }

    const rawOffer = await peerConnection.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    });
    const optimizedOfferSdp = optimizeSdp(rawOffer.sdp);
    const finalOffer = { type: rawOffer.type || 'offer', sdp: optimizedOfferSdp };
    await peerConnection.setLocalDescription(finalOffer);
    await tuneVideoSenderBitrate(peerConnection);

    if (socket && socket.connected) {
      socket.emit('webrtc-offer', {
        roomId,
        offer: finalOffer
      });
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
      } catch (e) { }
    }
    if (socket && socket.connected && roomId) {
      socket.emit('clipboard-sync', { roomId, text });
    }
  });
}

// System metrics updates
if (window.electronAPI && window.electronAPI.onSystemMetricsUpdate) {
  window.electronAPI.onSystemMetricsUpdate((metrics) => {
    cachedLiveMetrics = metrics;
    const payload = JSON.stringify({ type: 'system-metrics', metrics });
    if (activeDataChannel && activeDataChannel.readyState === 'open') {
      try {
        activeDataChannel.send(payload);
      } catch (e) { }
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
