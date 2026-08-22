import { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';

const SIGNALING_SERVER = 'https://remote-desktop-signaling-syj4.onrender.com';

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

function App() {
  const [roomId, setRoomId] = useState('');
  const [targetRoomId, setTargetRoomId] = useState('');
  const [status, setStatus] = useState('disconnected'); // disconnected, connecting, ready, connected
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [hostSystemInfo, setHostSystemInfo] = useState(null);
  const [showSpecsModal, setShowSpecsModal] = useState(false);
  const [liveMetrics, setLiveMetrics] = useState(null);
  const [showHealthDrawer, setShowHealthDrawer] = useState(false);
  const [socketFrame, setSocketFrame] = useState(null);
  const [isWebRtcActive, setIsWebRtcActive] = useState(false);
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);

  // Central Dashboard RMM States
  const [activeHosts, setActiveHosts] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' or 'connect'
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'online', 'offline'
  const [isServerConnected, setIsServerConnected] = useState(false);

  const [showTerminalDrawer, setShowTerminalDrawer] = useState(false);
  const [showToolsDropdown, setShowToolsDropdown] = useState(false);
  const [clipboardToast, setClipboardToast] = useState(null);
  const [isSyncingClipboard, setIsSyncingClipboard] = useState(false);
  const [shellType, setShellType] = useState('powershell'); // 'powershell' or 'cmd'
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [isExecutingCmd, setIsExecutingCmd] = useState(false);
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const terminalLogsRef = useRef(null);

  // Connect to signaling server on mount to receive real-time active hosts
  useEffect(() => {
    const globalSocket = io(SIGNALING_SERVER, {
      pingTimeout: 60000,
      pingInterval: 25000
    });

    globalSocket.on('connect', () => {
      console.log('[Controller]: Global dashboard socket connected');
      setIsServerConnected(true);
      globalSocket.emit('get-active-hosts');
    });

    globalSocket.on('disconnect', () => {
      setIsServerConnected(false);
    });

    globalSocket.on('active-hosts-list', (hosts) => {
      console.log('[Controller]: Received live active hosts update:', hosts);
      setActiveHosts(hosts || []);
    });

    return () => {
      globalSocket.disconnect();
    };
  }, []);

  // Auto-scroll terminal log window to bottom on new output
  useEffect(() => {
    if (terminalLogsRef.current) {
      terminalLogsRef.current.scrollTop = terminalLogsRef.current.scrollHeight;
    }
  }, [terminalLogs]);

  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);

  // Clean up WebRTC and socket on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  // Guarantee that whenever status becomes 'connected', the video tag receives the stream and plays
  useEffect(() => {
    if (status === 'connected' && videoRef.current && remoteStreamRef.current) {
      console.log('Binding remote stream to video element srcObject and invoking play()');
      videoRef.current.srcObject = remoteStreamRef.current;
      videoRef.current.play().catch(err => console.warn('Video autoplay warning:', err));
    }
  }, [status]);

  // Check URL query parameters (?code=123456 or ?id=123456) for instant auto-connect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = params.get('code') || params.get('id') || params.get('room') || window.location.hash.replace('#', '');
    if (codeFromUrl && codeFromUrl.trim().length === 6) {
      console.log('[Controller]: Found direct access code in URL:', codeFromUrl);
      setTargetRoomId(codeFromUrl.trim());
      handleConnect(null, codeFromUrl.trim());
    }
  }, []);

  const handleReceiveRemoteClipboard = (text) => {
    if (!text || typeof text !== 'string' || !text.trim()) return;
    console.log('[Controller]: Received Remote Host Clipboard Sync:', text.substring(0, 30));
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(err => console.warn('Browser clipboard write warning:', err));
    }
    
    setClipboardToast({
      text,
      timestamp: new Date().toLocaleTimeString()
    });
  };

  const syncLocalClipboardToRemote = async () => {
    try {
      setIsSyncingClipboard(true);
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        const payload = { type: 'clipboard-sync', text };
        if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
          dataChannelRef.current.send(JSON.stringify(payload));
        } else if (socketRef.current) {
          socketRef.current.emit('clipboard-sync', payload);
        }
        setClipboardToast({ text: `Pushed local text to remote: "${text.substring(0, 30)}..."`, isSelf: true });
        setTimeout(() => setClipboardToast(null), 3000);
      } else {
        alert('Your local browser clipboard is empty!');
      }
    } catch (err) {
      console.warn('Clipboard read error:', err);
      alert('Click anywhere on the stream video area first to grant browser clipboard permission.');
    } finally {
      setIsSyncingClipboard(false);
    }
  };

  const setVideoRef = (el) => {
    videoRef.current = el;
    if (el) {
      el.muted = true;
      el.defaultMuted = true;
      if (remoteStreamRef.current) {
        console.log('[Controller]: Callback ref attaching remoteStream to video element!');
        el.srcObject = remoteStreamRef.current;
        el.play().catch(err => console.warn('Video play warning:', err));
      }
    }
  };

  // Close tools dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (showToolsDropdown && !e.target.closest('.tools-dropdown-wrapper')) {
        setShowToolsDropdown(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [showToolsDropdown]);

  // Ensure video element plays live stream cleanly without flickering interval
  useEffect(() => {
    if (status === 'connected' && videoRef.current && remoteStreamRef.current) {
      const el = videoRef.current;
      el.muted = true;
      el.defaultMuted = true;
      if (el.srcObject !== remoteStreamRef.current) {
        el.srcObject = remoteStreamRef.current;
      }
      el.play().catch(e => console.warn('Video play warning:', e));
    }
  }, [status]);

  // Global Keyboard Listener for Arrow Keys & controls across viewer
  useEffect(() => {
    if (status !== 'connected' && status !== 'ready') return;

    const handleGlobalKeyDown = (e) => {
      // Ignore inputs if typing inside drawers, inputs, or textareas
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
        return;
      }

      let vk = e.keyCode || e.which;
      if (!vk) return;

      // Prevent default browser scroll for arrow keys (37-40), Space (32), Tab (9), Backspace (8)
      if ([37, 38, 39, 40, 32, 33, 34, 35, 36, 8, 9, 13, 46].includes(vk)) {
        e.preventDefault();
      }

      sendControlData({
        type: 'keydown',
        key: e.key,
        keyCode: vk
      });
    };

    const handleGlobalKeyUp = (e) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
        return;
      }

      let vk = e.keyCode || e.which;
      if (!vk) return;

      if ([37, 38, 39, 40, 32, 33, 34, 35, 36, 8, 9, 13, 46].includes(vk)) {
        e.preventDefault();
      }

      sendControlData({
        type: 'keyup',
        key: e.key,
        keyCode: vk
      });
    };

    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });
    window.addEventListener('keyup', handleGlobalKeyUp, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
      window.removeEventListener('keyup', handleGlobalKeyUp, { capture: true });
    };
  }, [status]);

  const cleanup = () => {
    remoteStreamRef.current = null;
    pendingCandidatesRef.current = [];
    setLiveMetrics(null);
    setTerminalLogs([]);
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setStatus('disconnected');
  };

  const [recentDevices, setRecentDevices] = useState(() => {
    try {
      const saved = localStorage.getItem('remoteg_recent_devices');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const saveRecentDevice = (code) => {
    if (!code) return;
    setRecentDevices(prev => {
      const updated = [code, ...prev.filter(d => d !== code)].slice(0, 5);
      localStorage.setItem('remoteg_recent_devices', JSON.stringify(updated));
      return updated;
    });
  };

  const removeDevice = (codeToRemove) => {
    if (!codeToRemove) return;
    setRecentDevices(prev => {
      const updated = prev.filter(c => c !== codeToRemove);
      localStorage.setItem('remoteg_recent_devices', JSON.stringify(updated));
      return updated;
    });
    setActiveHosts(prev => prev.filter(h => h.roomId !== codeToRemove));
  };

  const handleConnect = (e, codeToConnect) => {
    if (e) e.preventDefault();
    const finalRoomId = (codeToConnect || targetRoomId).trim();
    if (!finalRoomId) return;

    saveRecentDevice(finalRoomId);
    setStatus('connecting');
    setRoomId(finalRoomId);
    setTargetRoomId(finalRoomId);
    pendingCandidatesRef.current = [];

    // Connect to Signaling Server
    const socket = io(SIGNALING_SERVER, {
      pingTimeout: 60000,
      pingInterval: 25000
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to signaling server');
      socket.emit('join-room', { roomId: finalRoomId, role: 'controller' });
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from signaling server:', reason);
      // Do not kill active WebRTC P2P stream on temporary signaling socket drop
    });

    // Receive system information from host
    socket.on('host-info', ({ systemInfo }) => {
      if (systemInfo) {
        console.log('[Controller]: Received Host System Specs:', systemInfo);
        setHostSystemInfo(systemInfo);
      }
    });

    // Receive Hybrid Canvas JPEG Frame Stream Fallback (only process if WebRTC video is inactive)
    socket.on('screen-frame', ({ frame }) => {
      if (frame && !isWebRtcActive) {
        setSocketFrame(frame);
        setStatus('connected');
      }
    });

    // Receive live system metrics from host via signaling fallback
    socket.on('system-metrics', ({ metrics }) => {
      if (metrics) {
        setLiveMetrics(metrics);
      }
    });

    // Receive remote terminal execution results via signaling fallback
    socket.on('terminal-result', (data) => {
      if (data) {
        setTerminalLogs(prev => {
          const exists = prev.some(item => item.id === data.id);
          if (exists) {
            return prev.map(item => item.id === data.id ? { ...data, pending: false } : item);
          }
          return [...prev, { ...data, pending: false }];
        });
        setIsExecutingCmd(false);
      }
    });

    // Receive clipboard sync via signaling fallback
    socket.on('clipboard-sync', (data) => {
      if (data && data.text) {
        handleReceiveRemoteClipboard(data.text);
      }
    });

    // Both host and controller are in the room
    socket.on('ready', ({ systemInfo } = {}) => {
      console.log('Host is ready, waiting for WebRTC offer...');
      if (systemInfo) {
        setHostSystemInfo(systemInfo);
      }
      setStatus('ready');
    });

    // Receive WebRTC offer from Host
    socket.on('webrtc-offer', async ({ offer }) => {
      console.log('Received WebRTC offer from host');
      try {
        await handleOffer(offer);
      } catch (err) {
        console.error('Error handling WebRTC offer:', err);
        cleanup();
        alert('Failed to establish WebRTC connection');
      }
    });

    const isValidCandidate = (cand) => {
      return cand && (cand.candidate !== '' && cand.candidate !== undefined) && (cand.sdpMid !== null || cand.sdpMLineIndex !== null);
    };

    // Receive WebRTC ICE candidate from Host
    socket.on('ice-candidate', async ({ candidate }) => {
      console.log('Received ICE candidate from host');
      if (!isValidCandidate(candidate)) return;

      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('Error adding received ICE candidate:', err);
        }
      } else {
        pendingCandidatesRef.current.push(candidate);
      }
    });

    // Handle peer disconnect
    socket.on('peer-disconnected', ({ role }) => {
      if (role === 'host') {
        const isPeerActive = peerConnectionRef.current && peerConnectionRef.current.connectionState === 'connected';
        if (!isPeerActive) {
          alert('Target host disconnected');
          cleanup();
        } else {
          console.warn('[Controller]: Host signaling socket reconnected, maintaining active P2P stream.');
        }
      }
    });
  };

  const handleOffer = async (offer) => {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionRef.current = pc;

    try {
      pc.addTransceiver('video', { direction: 'recvonly' });
    } catch (e) {}

    const isValidCandidate = (cand) => {
      return cand && (cand.candidate !== '' && cand.candidate !== undefined) && (cand.sdpMid !== null || cand.sdpMLineIndex !== null);
    };

    // Send local ICE candidates to host
    pc.onicecandidate = (event) => {
      if (event.candidate && isValidCandidate(event.candidate) && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          roomId: targetRoomId.trim(),
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
        });
      }
    };

    // Monitor connection state
    pc.onconnectionstatechange = () => {
      console.log('WebRTC State:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setStatus('connected');
      } else if (pc.connectionState === 'disconnected') {
        setStatus('connecting');
        console.warn('WebRTC state disconnected. Waiting for auto-reconnect...');
      } else if (pc.connectionState === 'failed') {
        console.warn('WebRTC connection failed. Attempting ICE restart...');
        if (pc.restartIce) {
          pc.restartIce();
        }
      }
    };

    // Monitor ICE state
    pc.oniceconnectionstatechange = () => {
      console.log('ICE State Change:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        console.error('WebRTC ICE connection failed. Attempting ICE restart...');
        if (pc.restartIce) {
          pc.restartIce();
        }
      }
    };

    // Receive screen track
    pc.ontrack = (event) => {
      console.log('[Controller]: Received remote video track! Opening full-screen stream.', event);
      const stream = (event.streams && event.streams[0])
        ? event.streams[0]
        : new MediaStream([event.track]);

      remoteStreamRef.current = stream;

      if (event.track) {
        event.track.enabled = true;
        event.track.onunmute = () => {
          console.log('[Controller]: Remote video track unmuted!');
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(e => {});
          }
        };
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(e => console.warn('Video play warning:', e));
      }
      setStatus('connected');
    };

    // Create WebRTC DataChannel for direct P2P low-latency control events & live system metrics & terminal
    try {
      const dataChannel = pc.createDataChannel('controlEvents');
      dataChannelRef.current = dataChannel;
      dataChannel.onopen = () => {
        console.log('[Controller]: Direct P2P WebRTC DataChannel opened! Ultra-low latency mode active.');
      };
      dataChannel.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'ping') {
            if (dataChannel.readyState === 'open') {
              dataChannel.send(JSON.stringify({ type: 'pong' }));
            }
            return;
          }
          if (data.type === 'pong') return;
          if (data.type === 'system-metrics' && data.metrics) {
            setLiveMetrics(data.metrics);
          } else if (data.type === 'clipboard-sync' && data.text) {
            handleReceiveRemoteClipboard(data.text);
          } else if (data.type === 'terminal-result') {
            setTerminalLogs(prev => {
              const exists = prev.some(item => item.id === data.id);
              if (exists) {
                return prev.map(item => item.id === data.id ? { ...data, pending: false } : item);
              }
              return [...prev, { ...data, pending: false }];
            });
            setIsExecutingCmd(false);
          }
        } catch (err) {}
      };
      dataChannel.onclose = () => {
        console.log('[Controller]: WebRTC DataChannel closed.');
      };
    } catch (err) {
      console.warn('Failed to create WebRTC DataChannel:', err);
    }

    // Set remote description (SDP Offer)
    const sdpOffer = new RTCSessionDescription({
      type: offer?.type || 'offer',
      sdp: offer?.sdp || (typeof offer === 'string' ? offer : offer?.offer?.sdp)
    });
    await pc.setRemoteDescription(sdpOffer);

    // Flush queued ICE candidates
    while (pendingCandidatesRef.current.length > 0) {
      const cand = pendingCandidatesRef.current.shift();
      if (isValidCandidate(cand)) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Skipping queued candidate error:', e);
        }
      }
    }

    // Create SDP Answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Send SDP Answer to Host
    socketRef.current.emit('webrtc-answer', {
      roomId: targetRoomId.trim(),
      answer: {
        type: answer.type || 'answer',
        sdp: answer.sdp
      }
    });
  };

  // Execute remote terminal command
  const handleExecuteTerminalCommand = (cmdToRun) => {
    const command = (cmdToRun || terminalInput).trim();
    if (!command) return;

    const id = 'cmd_' + Date.now();
    const newLog = {
      id,
      command,
      shellType,
      pending: true,
      timestamp: new Date().toLocaleTimeString()
    };

    setTerminalLogs(prev => [...prev, newLog]);
    setCommandHistory(prev => [command, ...prev.filter(c => c !== command)]);
    setHistoryIdx(-1);
    setTerminalInput('');
    setIsExecutingCmd(true);

    const payload = {
      type: 'terminal-command',
      id,
      command,
      shellType
    };

    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      try {
        dataChannelRef.current.send(JSON.stringify(payload));
      } catch (e) {
        if (socketRef.current) socketRef.current.emit('terminal-command', payload);
      }
    } else if (socketRef.current) {
      socketRef.current.emit('terminal-command', payload);
    }
  };

  const handleTerminalInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleExecuteTerminalCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const nextIdx = Math.min(commandHistory.length - 1, historyIdx + 1);
        setHistoryIdx(nextIdx);
        setTerminalInput(commandHistory[nextIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx > 0) {
        const prevIdx = historyIdx - 1;
        setHistoryIdx(prevIdx);
        setTerminalInput(commandHistory[prevIdx]);
      } else if (historyIdx === 0) {
        setHistoryIdx(-1);
        setTerminalInput('');
      }
    }
  };

  // Adjust aspect ratio based on loaded video metadata
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const width = videoRef.current.videoWidth;
      const height = videoRef.current.videoHeight;
      if (width && height) {
        setAspectRatio(width / height);
      }
    }
  };

  // Low latency event emitter: prefers direct P2P WebRTC DataChannel, falls back to Socket.IO signaling
  const sendControlData = (eventData) => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify(eventData));
    } else if (socketRef.current) {
      socketRef.current.emit('control-event', eventData);
    }
  };

  // Mouse event helper - maps browser coordinates to host screen coordinates with exact aspect-ratio alignment
  const sendMouseEvent = (type, e) => {
    const targetEl = e.currentTarget || videoRef.current;
    if (!targetEl || (status !== 'connected' && status !== 'ready')) return;

    const rect = targetEl.getBoundingClientRect();
    const width = targetEl.videoWidth || targetEl.naturalWidth || 1280;
    const height = targetEl.videoHeight || targetEl.naturalHeight || 720;

    if (!width || !height || !rect.width || !rect.height) return;

    // Calculate actual rendered dimensions inside the element
    const containerAspect = rect.width / rect.height;
    const streamAspect = width / height;

    let renderWidth, renderHeight, offsetX, offsetY;

    if (containerAspect > streamAspect) {
      renderHeight = rect.height;
      renderWidth = rect.height * streamAspect;
      offsetX = (rect.width - renderWidth) / 2;
      offsetY = 0;
    } else {
      renderWidth = rect.width;
      renderHeight = rect.width / streamAspect;
      offsetX = 0;
      offsetY = (rect.height - renderHeight) / 2;
    }

    const mouseX = e.clientX - rect.left - offsetX;
    const mouseY = e.clientY - rect.top - offsetY;

    const clampedX = Math.max(0, Math.min(renderWidth, mouseX));
    const clampedY = Math.max(0, Math.min(renderHeight, mouseY));

    const normX = clampedX / renderWidth;
    const normY = clampedY / renderHeight;

    const targetX = normX * width;
    const targetY = normY * height;

    let button = 'left';
    if (e.button === 1) button = 'middle';
    if (e.button === 2) button = 'right';

    sendControlData({
      type,
      x: targetX,
      y: targetY,
      nx: normX,
      ny: normY,
      button
    });
  };

  const lastMoveTimeRef = useRef(0);
  const handleMouseMove = (e) => {
    const now = Date.now();
    if (now - lastMoveTimeRef.current > 16) {
      lastMoveTimeRef.current = now;
      sendMouseEvent('mousemove', e);
    }
  };
  const handleClick = (e) => sendMouseEvent('click', e);
  const handleMouseDown = (e) => sendMouseEvent('mousedown', e);
  const handleMouseUp = (e) => sendMouseEvent('mouseup', e);
  const handleDoubleClick = (e) => sendMouseEvent('doubleclick', e);
  
  const handleContextMenu = (e) => {
    e.preventDefault(); // Prevent browser right-click context menu
    sendMouseEvent('click', e); // Simulate right click
  };

  const handleWheel = (e) => {
    if (status !== 'connected') return;
    e.preventDefault();
    sendMouseEvent('mousemove', e);
    sendControlData({
      type: 'wheel',
      deltaY: e.deltaY,
      deltaX: e.deltaX
    });
  };

  // Keyboard events helper - emits virtual key codes
  const handleKeyDown = (e) => {
    if (status !== 'connected') return;
    
    // Prevent default browser scrolling/navigation for key events when controlling
    e.preventDefault();

    sendControlData({
      type: 'keydown',
      key: e.key,
      keyCode: e.keyCode
    });
  };

  const handleKeyUp = (e) => {
    if (status !== 'connected') return;
    e.preventDefault();

    sendControlData({
      type: 'keyup',
      key: e.key,
      keyCode: e.keyCode
    });
  };

  // Focus container to capture keyboard inputs
  const focusControl = () => {
    if (containerRef.current) {
      containerRef.current.focus();
    }
  };

  // Combine live active hosts from signaling server with saved recent devices
  const allTrackedDevices = Array.from(new Set([
    ...activeHosts.map(h => h.roomId),
    ...recentDevices
  ])).map(id => {
    const liveHost = activeHosts.find(h => h.roomId === id);
    if (liveHost) {
      return {
        roomId: id,
        hostname: liveHost.systemInfo?.hostname || `Host-${id}`,
        isOnline: true,
        systemInfo: liveHost.systemInfo,
        liveMetrics: liveHost.liveMetrics,
        lastSeen: 'Just Now'
      };
    }
    return {
      roomId: id,
      hostname: `Host-${id}`,
      isOnline: false,
      systemInfo: null,
      liveMetrics: null,
      lastSeen: 'Offline'
    };
  });

  const filteredDevices = allTrackedDevices.filter(device => {
    const matchesSearch = device.hostname.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          device.roomId.includes(searchQuery);
    if (statusFilter === 'online') return matchesSearch && device.isOnline;
    if (statusFilter === 'offline') return matchesSearch && !device.isOnline;
    return matchesSearch;
  });

  const totalCount = allTrackedDevices.length;
  const onlineCount = allTrackedDevices.filter(d => d.isOnline).length;
  const onlineWithMetrics = allTrackedDevices.filter(d => d.isOnline && d.liveMetrics);
  const avgCpu = onlineWithMetrics.length > 0 
    ? Math.round(onlineWithMetrics.reduce((acc, curr) => acc + (curr.liveMetrics.cpuPercent || 0), 0) / onlineWithMetrics.length) 
    : 0;
  const avgRam = onlineWithMetrics.length > 0 
    ? Math.round(onlineWithMetrics.reduce((acc, curr) => acc + (curr.liveMetrics.ramPercent || 0), 0) / onlineWithMetrics.length) 
    : 0;

  return (
    <div className="app-container">
      <div className="dashboard-root" style={{ display: status === 'connected' ? 'none' : 'block' }}>
          {/* Top Navbar Header */}
          <div className="dashboard-nav">
            <div className="dashboard-brand">
              <div className="dashboard-brand-icon">⚡</div>
              <div>
                <h2>RemoteG Central Portal</h2>
              </div>
            </div>

            <div className="nav-tabs">
              <button 
                className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('dashboard')}
              >
                🖥️ Devices Dashboard
                <span style={{ 
                  background: activeHosts.length > 0 ? 'rgba(52, 211, 153, 0.25)' : 'rgba(255, 255, 255, 0.1)',
                  color: activeHosts.length > 0 ? '#34d399' : '#94a3b8',
                  padding: '2px 8px',
                  borderRadius: '100px',
                  fontSize: '0.75rem',
                  fontWeight: 700
                }}>
                  {activeHosts.length} Live
                </span>
              </button>

              <button 
                className={`tab-btn ${activeTab === 'connect' ? 'active' : ''}`}
                onClick={() => setActiveTab('connect')}
              >
                ⚡ Code Connect
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: isServerConnected ? '#34d399' : '#f87171' }}>
              <span className={`status-dot ${isServerConnected ? 'ready' : ''}`} style={{ width: '8px', height: '8px' }}></span>
              <span>{isServerConnected ? 'Cloud Online' : 'Connecting...'}</span>
            </div>
          </div>

          {/* Main View Area */}
          {activeTab === 'dashboard' ? (
            <div className="dashboard-content">
              {/* Summary Stats Row */}
              <div className="dashboard-stats-grid">
                <div className="rmm-stat-card">
                  <div className="stat-info">
                    <h4>Total Managed Nodes</h4>
                    <span>{totalCount}</span>
                  </div>
                  <div className="stat-icon-wrapper" style={{ background: 'rgba(129, 140, 248, 0.15)', color: '#818cf8' }}>🖥️</div>
                </div>

                <div className="rmm-stat-card">
                  <div className="stat-info">
                    <h4>Online Streaming</h4>
                    <span style={{ color: '#34d399' }}>{onlineCount}</span>
                  </div>
                  <div className="stat-icon-wrapper" style={{ background: 'rgba(52, 211, 153, 0.15)', color: '#34d399' }}>🟢</div>
                </div>

                <div className="rmm-stat-card">
                  <div className="stat-info">
                    <h4>Avg CPU Utilization</h4>
                    <span style={{ color: '#38bdf8' }}>{avgCpu}%</span>
                  </div>
                  <div className="stat-icon-wrapper" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>⚡</div>
                </div>

                <div className="rmm-stat-card">
                  <div className="stat-info">
                    <h4>Avg Memory Usage</h4>
                    <span style={{ color: '#a5b4fc' }}>{avgRam}%</span>
                  </div>
                  <div className="stat-icon-wrapper" style={{ background: 'rgba(165, 180, 252, 0.15)', color: '#a5b4fc' }}>📊</div>
                </div>
              </div>

              {/* Toolbar & Search Header */}
              <div className="rmm-toolbar">
                <div className="search-box-wrapper">
                  <span className="search-icon">🔍</span>
                  <input
                    type="text"
                    placeholder="Search machines by Hostname, ID, or OS..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <select 
                    value={statusFilter} 
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="filter-select"
                  >
                    <option value="all">All Devices ({totalCount})</option>
                    <option value="online">Online Only ({onlineCount})</option>
                    <option value="offline">Offline Only ({totalCount - onlineCount})</option>
                  </select>
                </div>
              </div>

              {/* Devices Card Grid */}
              <div className="devices-card-grid">
                {filteredDevices.map(device => (
                  <div key={device.roomId} className="device-node-card">
                    <div>
                      <div className="node-card-header">
                        <div className="node-title-group">
                          <span className="node-icon">💻</span>
                          <div>
                            <h3 className="node-name">{device.hostname}</h3>
                            <span className="node-code">ID: {device.roomId}</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="stream-badge" style={{
                            background: device.isOnline ? 'rgba(52, 211, 153, 0.18)' : 'rgba(148, 163, 184, 0.15)',
                            borderColor: device.isOnline ? 'rgba(52, 211, 153, 0.4)' : 'rgba(148, 163, 184, 0.3)',
                            color: device.isOnline ? '#34d399' : '#94a3b8'
                          }}>
                            {device.isOnline ? '🟢 LIVE ONLINE' : '🔴 OFFLINE'}
                          </span>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Remove host "${device.hostname}" (${device.roomId}) from dashboard?`)) {
                                removeDevice(device.roomId);
                              }
                            }}
                            className="btn-remove-device"
                            title="Remove Host PC from Dashboard"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>

                      {/* OS info */}
                      <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <div>🖥️ {device.systemInfo ? `${device.systemInfo.platform || 'Windows'}` : 'Windows Remote Machine'}</div>
                        {(device.systemInfo?.loggedUser || device.liveMetrics?.loggedUser) && (
                          <div style={{ color: '#38bdf8', fontWeight: 600 }}>👤 {device.systemInfo?.loggedUser || device.liveMetrics?.loggedUser}</div>
                        )}
                        {(device.systemInfo?.publicIp || device.liveMetrics?.publicIp) && (
                          <div style={{ color: '#a5b4fc', fontSize: '0.74rem' }}>
                            🌐 WAN: <span style={{ color: '#34d399' }}>{device.systemInfo?.publicIp || device.liveMetrics?.publicIp}</span> • LAN: {device.systemInfo?.ip || device.liveMetrics?.ip || '127.0.0.1'}
                          </div>
                        )}
                      </div>

                      {/* Live Telemetry Gauges */}
                      {device.isOnline && device.liveMetrics ? (
                        <div className="node-metrics-list">
                          <div className="metric-bar-group">
                            <div className="metric-bar-header">
                              <span>CPU Load</span>
                              <span style={{ color: '#38bdf8' }}>{device.liveMetrics.cpuPercent}%</span>
                            </div>
                            <div className="metric-progress-track">
                              <div 
                                className="metric-progress-fill" 
                                style={{ 
                                  width: `${device.liveMetrics.cpuPercent}%`,
                                  background: 'linear-gradient(90deg, #38bdf8, #818cf8)'
                                }}
                              ></div>
                            </div>
                          </div>

                          <div className="metric-bar-group">
                            <div className="metric-bar-header">
                              <span>RAM ({device.liveMetrics.ramUsedGB} / {device.liveMetrics.ramTotalGB} GB)</span>
                              <span style={{ color: '#a5b4fc' }}>{device.liveMetrics.ramPercent}%</span>
                            </div>
                            <div className="metric-progress-track">
                              <div 
                                className="metric-progress-fill" 
                                style={{ 
                                  width: `${device.liveMetrics.ramPercent}%`,
                                  background: 'linear-gradient(90deg, #818cf8, #c084fc)'
                                }}
                              ></div>
                            </div>
                          </div>

                          <div className="metric-bar-header" style={{ marginTop: '2px' }}>
                            <span>Disk C: Free: <strong style={{ color: '#34d399' }}>{device.liveMetrics.diskFreeGB} GB</strong></span>
                            <span>Speed: {device.liveMetrics.downloadMbps} Mbps</span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: '16px', textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', fontSize: '0.8rem', color: '#64748b' }}>
                          Machine offline. Launch setup client on target PC to stream live RMM metrics.
                        </div>
                      )}
                    </div>

                    {/* Card Action Buttons */}
                    <div className="node-card-footer">
                      <button
                        onClick={() => handleConnect(null, device.roomId)}
                        disabled={!device.isOnline || status === 'connecting'}
                        className="btn-card-action"
                        style={{
                          background: device.isOnline ? 'linear-gradient(135deg, #818cf8 0%, #6366f1 100%)' : 'rgba(255,255,255,0.05)',
                          color: device.isOnline ? '#fff' : '#64748b',
                          boxShadow: device.isOnline ? '0 4px 12px rgba(129, 140, 248, 0.3)' : 'none'
                        }}
                      >
                        ⚡ 1-Click Connect
                      </button>

                      {device.systemInfo && (
                        <button
                          onClick={() => {
                            setHostSystemInfo(device.systemInfo);
                            setShowSpecsModal(true);
                          }}
                          className="btn-card-action"
                          style={{
                            background: 'rgba(255,255,255,0.08)',
                            color: '#a5b4fc',
                            flex: '0 0 auto'
                          }}
                          title="View Hardware Specifications"
                        >
                          💻 Specs
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="login-wrapper">
              <div className="glow-sphere sphere-1"></div>
              <div className="glow-sphere sphere-2"></div>
              
              <div className="login-card">
                <div className="card-header">
                  <h1>RemoteG Control</h1>
                  <p>Connect to a Remote System Node</p>
                </div>

                <form onSubmit={handleConnect} className="login-form">
                  <div className="input-group">
                    <label htmlFor="roomId">Target Access Code (Host ID)</label>
                    <input
                      id="roomId"
                      type="text"
                      placeholder="Enter 6-digit code"
                      value={targetRoomId}
                      onChange={(e) => setTargetRoomId(e.target.value)}
                      maxLength={6}
                      disabled={status === 'connecting'}
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn-connect"
                    disabled={status === 'connecting' || !targetRoomId.trim()}
                  >
                    {status === 'connecting' ? 'Establishing Handshake...' : 'Establish Session'}
                  </button>
                </form>

                {recentDevices.length > 0 && (
                  <div style={{ marginTop: '20px', textAlign: 'left' }}>
                    <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                      ⚡ Quick Connect (Recent Devices):
                    </span>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {recentDevices.map(code => (
                        <div
                          key={code}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: 'rgba(255,255,255,0.08)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: '100px',
                            padding: '3px 6px 3px 12px'
                          }}
                        >
                          <button
                            onClick={() => handleConnect(null, code)}
                            disabled={status === 'connecting'}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#818cf8',
                              fontSize: '0.85rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              padding: 0
                            }}
                            title={`Connect to ${code}`}
                          >
                            {code}
                          </button>
                          <button
                            onClick={() => removeDevice(code)}
                            title={`Remove ${code}`}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#94a3b8',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                              padding: '2px 4px',
                              borderRadius: '50%',
                              lineHeight: 1
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="status-indicator" style={{ marginBottom: '20px' }}>
                  <span className={`status-dot ${status}`}></span>
                  <span className="status-text">
                    {status === 'disconnected' && 'Ready for Connection'}
                    {status === 'connecting' && 'Connecting to Signaling Server...'}
                    {status === 'ready' && 'Signaled Host. Establishing WebRTC stream...'}
                  </span>
                </div>

                <div style={{ 
                  background: 'rgba(255, 255, 255, 0.04)', 
                  border: '1px solid rgba(255, 255, 255, 0.1)', 
                  borderRadius: '16px', 
                  padding: '16px',
                  textAlign: 'center'
                }}>
                  <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.8)', fontWeight: 600, display: 'block', marginBottom: '10px' }}>
                    💻 Need to control a new PC?
                  </span>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <a
                      href="https://github.com/aurav2001/Remote-Project/releases/download/v1.0.0/RemoteG-Setup.zip"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        color: '#fff',
                        padding: '8px 16px',
                        borderRadius: '100px',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        textDecoration: 'none',
                        boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                      }}
                    >
                      📥 Download Setup (72 MB .zip)
                    </a>

                    <button
                      onClick={() => {
                        const downloadUrl = `https://github.com/aurav2001/Remote-Project/releases/download/v1.0.0/RemoteG-Setup.zip`;
                        navigator.clipboard.writeText(downloadUrl);
                        alert(`WhatsApp Direct Download Link copied to clipboard:\n${downloadUrl}\n\nAap is link ko WhatsApp par kisi ko bhi bhej sakte hain!`);
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: '#38bdf8',
                        padding: '8px 14px',
                        borderRadius: '100px',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                      title="Copy WhatsApp Direct Download Link"
                    >
                      💬 Copy WhatsApp Link
                    </button>
                  </div>
                  <div style={{ marginTop: '10px', fontSize: '0.76rem', color: '#94a3b8', background: 'rgba(255, 255, 255, 0.03)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    💡 <b>Tip:</b> Agar Chrome <i>"Not commonly downloaded"</i> warning dikhaye, toh <b>📦 Download (.zip)</b> button use kijiye ya Chrome downloads me <b>Keep anyway</b> par click kijiye.
                  </div>
                </div>
              </div>
            </div>
          )}
      </div>

      <div className="viewer-layout" style={{ display: status === 'connected' ? 'flex' : 'none' }}>
          <div className={`control-bar ${isNavCollapsed ? 'collapsed' : ''}`}>
            <div className="control-bar-header">
              {!isNavCollapsed && (
                <div className="session-info-pill">
                  <span className="session-tag">🟢 Node: {roomId}</span>
                  <span className="stream-badge">LIVE</span>
                </div>
              )}
              <button 
                onClick={() => setIsNavCollapsed(prev => !prev)} 
                className="btn-collapse-toggle"
                title={isNavCollapsed ? "Expand Navigation Toolbar" : "Collapse Navigation Toolbar"}
              >
                {isNavCollapsed ? '▶' : '◀'}
              </button>
            </div>

            {!isNavCollapsed && (
              <>
                <div className="control-bar-left">
                  {/* Compact Quick Action Buttons */}
                  <button
                    onClick={() => setShowHealthDrawer(prev => !prev)}
                    className={`control-btn btn-health ${showHealthDrawer ? 'active' : ''}`}
                    title="View Live CPU, RAM, Disk, and Network Health"
                  >
                    📊 Health {liveMetrics ? `(${liveMetrics.cpuPercent}%)` : ''}
                  </button>

                  <button
                    onClick={() => setShowTerminalDrawer(prev => !prev)}
                    className={`control-btn btn-terminal ${showTerminalDrawer ? 'active' : ''}`}
                    title="Open Remote PowerShell & CMD Terminal"
                  >
                    💻 Terminal
                  </button>

                  {/* Sleek Compact Action Menu Dropdown */}
                  <div className="tools-dropdown-wrapper">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowToolsDropdown(prev => !prev);
                      }}
                      className={`control-btn btn-tools ${showToolsDropdown ? 'active' : ''}`}
                      title="Open Actions & Utilities Menu"
                    >
                      ⚡ Actions <span style={{ fontSize: '0.7rem', opacity: 0.85 }}>▼</span>
                    </button>

                    {showToolsDropdown && (
                      <div className="tools-dropdown-menu">
                        {hostSystemInfo && (
                          <button 
                            onClick={() => { setShowSpecsModal(true); setShowToolsDropdown(false); }} 
                            className="dropdown-item"
                          >
                            <span className="dropdown-icon">💻</span>
                            <div>
                              <strong>Hardware Specs</strong>
                              <small>{hostSystemInfo.hostname || 'Device Specs'}</small>
                            </div>
                          </button>
                        )}

                        <button 
                          onClick={() => { syncLocalClipboardToRemote(); setShowToolsDropdown(false); }} 
                          className="dropdown-item"
                        >
                          <span className="dropdown-icon">📋</span>
                          <div>
                            <strong>Sync Clipboard</strong>
                            <small>Push local text to Remote PC</small>
                          </div>
                        </button>

                        <button 
                          onClick={() => {
                            const directUrl = `${window.location.origin}/?code=${roomId}`;
                            navigator.clipboard.writeText(directUrl);
                            alert(`Direct Access Link copied to clipboard:\n${directUrl}`);
                            setShowToolsDropdown(false);
                          }} 
                          className="dropdown-item"
                        >
                          <span className="dropdown-icon">🔗</span>
                          <div>
                            <strong>Copy Direct Link</strong>
                            <small>1-Click bookmark link</small>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <button className="btn-disconnect" onClick={cleanup}>
                  Terminate Session
                </button>
              </>
            )}
          </div>

          {/* Silent Remote Terminal Drawer */}
          {showTerminalDrawer && (
            <div className="terminal-drawer">
              <div className="drawer-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#34d399', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    💻 Silent Remote Shell
                  </h3>
                  <select 
                    value={shellType}
                    onChange={(e) => setShellType(e.target.value)}
                    className="shell-selector"
                  >
                    <option value="powershell">PowerShell</option>
                    <option value="cmd">CMD Prompt</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setTerminalLogs([])} className="btn-clear-logs" title="Clear Console History">
                    🧹 Clear
                  </button>
                  <button onClick={() => setShowTerminalDrawer(false)} className="drawer-close-btn">✕</button>
                </div>
              </div>

              {/* Quick Script Presets */}
              <div className="preset-commands-bar">
                <span className="preset-label">⚡ Quick Presets:</span>
                <button onClick={() => handleExecuteTerminalCommand('ipconfig /all')} className="preset-btn">
                  Network (`ipconfig`)
                </button>
                <button onClick={() => handleExecuteTerminalCommand('systeminfo')} className="preset-btn">
                  System Info
                </button>
                <button onClick={() => handleExecuteTerminalCommand(shellType === 'powershell' ? 'Get-Process | Select-Object -First 20 Name, CPU, WorkingSet64' : 'tasklist')} className="preset-btn">
                  Running Tasks
                </button>
                <button onClick={() => handleExecuteTerminalCommand('ping 8.8.8.8 -n 4')} className="preset-btn">
                  Ping Test
                </button>
                <button onClick={() => handleExecuteTerminalCommand('ipconfig /flushdns')} className="preset-btn">
                  Flush DNS
                </button>
              </div>

              {/* Console Output Window */}
              <div className="terminal-output" ref={terminalLogsRef}>
                <div className="terminal-welcome">
                  RemoteG Silent Background Shell [{shellType.toUpperCase()}] connected.<br />
                  Commands run silently on host machine without displaying any windows on the target PC screen.
                </div>

                {terminalLogs.map((log) => (
                  <div key={log.id} className="terminal-log-entry">
                    <div className="terminal-prompt">
                      <span className="prompt-symbol">PS {hostSystemInfo?.hostname || 'HOST'}&gt;</span>
                      <span className="prompt-command">{log.command}</span>
                      <span className="prompt-time">[{log.timestamp}]</span>
                    </div>

                    {log.pending ? (
                      <div className="terminal-pending">
                        <span className="spinner-sm"></span> Executing command silently on remote PC...
                      </div>
                    ) : (
                      <pre className={`terminal-result-text ${log.isError ? 'error' : ''}`}>
                        {log.output}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
              <div className="terminal-input-bar">
                <span className="input-prompt-symbol">{shellType === 'powershell' ? 'PS>' : 'CMD>'}</span>
                <input
                  type="text"
                  placeholder={`Type ${shellType} command and press Enter (Use ↑/↓ for history)...`}
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  onKeyDown={handleTerminalInputKeyDown}
                  disabled={isExecutingCmd}
                  autoFocus
                />
                <button 
                  onClick={() => handleExecuteTerminalCommand()}
                  disabled={isExecutingCmd || !terminalInput.trim()}
                  className="btn-send-cmd"
                >
                  {isExecutingCmd ? 'Executing...' : 'Run ▶'}
                </button>
              </div>
            </div>
          )}

          {/* Live System Health Drawer */}
          {showHealthDrawer && (
            <div className="health-drawer">
              <div className="drawer-header">
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    📊 Live System Health & Telemetry
                  </h3>
                  <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                    {liveMetrics?.hostname || 'Host Machine'} • IP: {liveMetrics?.ip || '127.0.0.1'}
                  </span>
                </div>
                <button onClick={() => setShowHealthDrawer(false)} className="drawer-close-btn">✕</button>
              </div>

              {liveMetrics ? (
                <div className="drawer-body">
                  {/* CPU Card */}
                  <div className="metric-card">
                    <div className="metric-header">
                      <span className="metric-title">⚡ Processor (CPU)</span>
                      <span className="metric-value">{liveMetrics.cpuPercent}%</span>
                    </div>
                    <div className="metric-subtext" title={liveMetrics.cpuModel}>{liveMetrics.cpuModel}</div>
                    <div className="progress-bar-track">
                      <div 
                        className="progress-bar-fill" 
                        style={{ 
                          width: `${liveMetrics.cpuPercent}%`,
                          background: liveMetrics.cpuPercent > 85 ? 'linear-gradient(90deg, #ef4444, #f87171)' : liveMetrics.cpuPercent > 60 ? 'linear-gradient(90deg, #f59e0b, #fbbf24)' : 'linear-gradient(90deg, #10b981, #34d399)'
                        }}
                      />
                    </div>
                  </div>

                  {/* RAM Card */}
                  <div className="metric-card">
                    <div className="metric-header">
                      <span className="metric-title">💾 RAM Memory</span>
                      <span className="metric-value">{liveMetrics.ramPercent}%</span>
                    </div>
                    <div className="metric-subtext">{liveMetrics.ramUsedGb} GB used of {liveMetrics.ramTotalGb} GB</div>
                    <div className="progress-bar-track">
                      <div 
                        className="progress-bar-fill" 
                        style={{ 
                          width: `${liveMetrics.ramPercent}%`,
                          background: liveMetrics.ramPercent > 85 ? 'linear-gradient(90deg, #ef4444, #f87171)' : 'linear-gradient(90deg, #6366f1, #818cf8)'
                        }}
                      />
                    </div>
                  </div>

                  {/* Disk Card */}
                  <div className="metric-card">
                    <div className="metric-header">
                      <span className="metric-title">💽 Disk Space (C:)</span>
                      <span className="metric-value">{liveMetrics.diskPercent}%</span>
                    </div>
                    <div className="metric-subtext">{liveMetrics.diskFreeGb} GB free of {liveMetrics.diskTotalGb} GB</div>
                    <div className="progress-bar-track">
                      <div 
                        className="progress-bar-fill" 
                        style={{ 
                          width: `${liveMetrics.diskPercent}%`,
                          background: liveMetrics.diskPercent > 90 ? 'linear-gradient(90deg, #ef4444, #f87171)' : 'linear-gradient(90deg, #0ea5e9, #38bdf8)'
                        }}
                      />
                    </div>
                  </div>

                  {/* Network Speed Card */}
                  <div className="metric-card">
                    <div className="metric-header">
                      <span className="metric-title">🌐 Network Traffic</span>
                    </div>
                    <div className="network-speed-grid">
                      <div className="speed-box download">
                        <span className="speed-label">↓ Download</span>
                        <span className="speed-val">{liveMetrics.downloadSpeed}</span>
                      </div>
                      <div className="speed-box upload">
                        <span className="speed-label">↑ Upload</span>
                        <span className="speed-val">{liveMetrics.uploadSpeed}</span>
                      </div>
                    </div>
                  </div>

                  {/* Battery & System Info */}
                  <div className="metric-card">
                    <div className="metric-header">
                      <span className="metric-title">🔋 Power & System Status</span>
                    </div>
                    <div className="info-rows">
                      <div className="info-row">
                        <span>Battery:</span>
                        <strong>
                          {liveMetrics.batteryPercent !== null && liveMetrics.batteryPercent !== undefined
                            ? `${liveMetrics.batteryPercent}% ${liveMetrics.isCharging ? '⚡ (Charging)' : '🔋'}`
                            : '🔌 Desktop AC Power'}
                        </strong>
                      </div>
                      <div className="info-row">
                        <span>System Uptime:</span>
                        <strong>⏱️ {liveMetrics.uptime}</strong>
                      </div>
                      {liveMetrics.lastReboot && (
                        <div className="info-row">
                          <span>Last Reboot:</span>
                          <strong style={{ fontSize: '0.78rem' }}>📅 {liveMetrics.lastReboot}</strong>
                        </div>
                      )}
                      <div className="info-row">
                        <span>OS Platform:</span>
                        <strong>{liveMetrics.platform}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Identity & Network Card */}
                  <div className="metric-card">
                    <div className="metric-header">
                      <span className="metric-title">👤 Identity & Network Details</span>
                    </div>
                    <div className="info-rows">
                      <div className="info-row">
                        <span>Domain User:</span>
                        <strong style={{ color: '#38bdf8' }}>{liveMetrics.loggedUser || 'N/A'}</strong>
                      </div>
                      <div className="info-row">
                        <span>Domain / Host:</span>
                        <strong>{liveMetrics.domain || 'WORKGROUP'}</strong>
                      </div>
                      <div className="info-row">
                        <span>Public IP (WAN):</span>
                        <strong style={{ color: '#34d399' }}>🌐 {liveMetrics.publicIp || 'N/A'}</strong>
                      </div>
                      <div className="info-row">
                        <span>Private IP (LAN):</span>
                        <strong style={{ color: '#a5b4fc' }}>🔌 {liveMetrics.ip || 'N/A'}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="drawer-loading">
                  <div className="spinner"></div>
                  <p>Connecting to Host Telemetry Stream...</p>
                </div>
              )}
            </div>
          )}

          {/* System Specs Popup Modal */}
          {showSpecsModal && hostSystemInfo && (
            <div style={{
              position: 'absolute',
              top: '75px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(15, 23, 42, 0.95)',
              border: '1px solid rgba(129, 140, 248, 0.3)',
              borderRadius: '16px',
              padding: '20px 24px',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
              zIndex: 300,
              minWidth: '340px',
              color: '#fff',
              textAlign: 'left'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#818cf8', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  🖥️ Host Device Specifications
                </h3>
                <button 
                  onClick={() => setShowSpecsModal(false)}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
                  <span style={{ color: '#94a3b8' }}>🖥️ PC Hostname:</span>
                  <strong style={{ color: '#38bdf8' }}>{hostSystemInfo.hostname || 'N/A'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
                  <span style={{ color: '#94a3b8' }}>👤 Logged-in User:</span>
                  <strong style={{ color: '#38bdf8' }}>{hostSystemInfo.loggedUser || 'N/A'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
                  <span style={{ color: '#94a3b8' }}>🌐 Public IP (WAN):</span>
                  <strong style={{ color: '#34d399' }}>{hostSystemInfo.publicIp || 'N/A'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
                  <span style={{ color: '#94a3b8' }}>🔌 Private IP (LAN):</span>
                  <strong style={{ color: '#a5b4fc' }}>{hostSystemInfo.ip || 'N/A'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
                  <span style={{ color: '#94a3b8' }}>⚡ Processor (CPU):</span>
                  <strong style={{ color: '#f8fafc', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={hostSystemInfo.cpu}>
                    {hostSystemInfo.cpu || 'N/A'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
                  <span style={{ color: '#94a3b8' }}>💾 RAM Memory:</span>
                  <strong style={{ color: '#f8fafc' }}>{hostSystemInfo.ram || 'N/A'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
                  <span style={{ color: '#94a3b8' }}>📅 Last Reboot:</span>
                  <strong style={{ color: '#f8fafc', fontSize: '0.8rem' }}>{hostSystemInfo.lastReboot || 'N/A'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
                  <span style={{ color: '#94a3b8' }}>📦 Agent Version:</span>
                  <strong style={{ color: '#818cf8' }}>v{hostSystemInfo.agentVersion || '1.0.0'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>💻 OS Platform:</span>
                  <strong style={{ color: '#f8fafc' }}>{hostSystemInfo.platform || 'N/A'}</strong>
                </div>
              </div>
            </div>
          )}

          <div 
            ref={containerRef}
            className="video-container"
            tabIndex={0} // Makes container focusable to receive keyboard events
            onClick={focusControl}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onWheel={handleWheel}
          >
            <video
              ref={setVideoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={(e) => {
                handleLoadedMetadata();
                setIsWebRtcActive(true);
                if (e.target && e.target.paused) e.target.play().catch(err => {});
              }}
              onPlaying={() => setIsWebRtcActive(true)}
              onCanPlay={(e) => {
                setIsWebRtcActive(true);
                if (e.target && e.target.paused) e.target.play().catch(err => {});
              }}
              onLoadedData={(e) => {
                setIsWebRtcActive(true);
                if (e.target && e.target.paused) e.target.play().catch(err => {});
              }}
              onMouseMove={handleMouseMove}
              onClick={handleClick}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              onWheel={handleWheel}
              style={{
                objectFit: 'contain',
                width: '100%',
                height: '100%',
                display: isWebRtcActive ? 'block' : 'none',
                background: '#000'
              }}
            />

            {(!isWebRtcActive && socketFrame) && (
              <img
                src={socketFrame}
                alt="Remote Screen Stream Fallback"
                onMouseMove={handleMouseMove}
                onClick={handleClick}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
                style={{
                  objectFit: 'contain',
                  width: '100%',
                  height: '100%',
                  display: 'block',
                  userSelect: 'none',
                  background: '#000'
                }}
              />
            )}
          </div>
        </div>

      {/* Bidirectional Clipboard Toast Notification Banner */}
      {clipboardToast && (
        <div className="clipboard-toast">
          <span className="toast-icon">📋</span>
          <div className="toast-body">
            <strong>{clipboardToast.isSelf ? 'Clipboard Sent to Remote' : 'Clipboard Synced from Remote PC'}</strong>
            <p>{clipboardToast.text}</p>
          </div>
          <button 
            onClick={() => {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(clipboardToast.text);
              }
            }}
            className="btn-toast-copy"
          >
            Copy
          </button>
          <button onClick={() => setClipboardToast(null)} className="btn-toast-close">✕</button>
        </div>
      )}
    </div>
  );
}

export default App;
