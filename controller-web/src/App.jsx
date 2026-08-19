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

function App() {
  const [roomId, setRoomId] = useState('');
  const [targetRoomId, setTargetRoomId] = useState('');
  const [status, setStatus] = useState('disconnected'); // disconnected, connecting, ready, connected
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [hostSystemInfo, setHostSystemInfo] = useState(null);
  const [showSpecsModal, setShowSpecsModal] = useState(false);
  const [liveMetrics, setLiveMetrics] = useState(null);
  const [showHealthDrawer, setShowHealthDrawer] = useState(false);

  const [showTerminalDrawer, setShowTerminalDrawer] = useState(false);
  const [shellType, setShellType] = useState('powershell'); // 'powershell' or 'cmd'
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [isExecutingCmd, setIsExecutingCmd] = useState(false);
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const terminalLogsRef = useRef(null);

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

  const cleanup = () => {
    remoteStreamRef.current = null;
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

  const pendingCandidatesRef = useRef([]);

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

    socket.on('disconnect', () => {
      console.log('Disconnected from signaling server');
      cleanup();
    });

    // Receive system information from host
    socket.on('host-info', ({ systemInfo }) => {
      if (systemInfo) {
        console.log('[Controller]: Received Host System Specs:', systemInfo);
        setHostSystemInfo(systemInfo);
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
        alert('Target host disconnected');
        cleanup();
      }
    });
  };

  const handleOffer = async (offer) => {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionRef.current = pc;

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
      } else if (pc.connectionState === 'failed') {
        console.warn('WebRTC connection failed. Cleaning up...');
        cleanup();
      }
    };

    // Monitor ICE state
    pc.oniceconnectionstatechange = () => {
      console.log('ICE State Change:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        console.error('WebRTC ICE connection failed!');
      }
    };

    // Receive screen track
    pc.ontrack = (event) => {
      console.log('Received remote video track! Opening full-screen stream.');
      const stream = (event.streams && event.streams[0])
        ? event.streams[0]
        : new MediaStream([event.track]);

      remoteStreamRef.current = stream;
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
          if (data.type === 'system-metrics' && data.metrics) {
            setLiveMetrics(data.metrics);
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
    const video = videoRef.current;
    if (!video || status !== 'connected') return;

    const rect = video.getBoundingClientRect();
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    if (!videoWidth || !videoHeight || !rect.width || !rect.height) return;

    // Calculate actual rendered video dimensions inside the <video> element (accounting for letterboxing/pillarboxing)
    const containerAspect = rect.width / rect.height;
    const videoAspect = videoWidth / videoHeight;

    let renderWidth, renderHeight, offsetX, offsetY;

    if (containerAspect > videoAspect) {
      // Pillarboxed (black bars on left and right)
      renderHeight = rect.height;
      renderWidth = rect.height * videoAspect;
      offsetX = (rect.width - renderWidth) / 2;
      offsetY = 0;
    } else {
      // Letterboxed (black bars on top and bottom)
      renderWidth = rect.width;
      renderHeight = rect.width / videoAspect;
      offsetX = 0;
      offsetY = (rect.height - renderHeight) / 2;
    }

    // Position relative to the actual rendered video stream frame
    const mouseX = e.clientX - rect.left - offsetX;
    const mouseY = e.clientY - rect.top - offsetY;

    // Clamp coordinates strictly to the rendered video boundary
    const clampedX = Math.max(0, Math.min(renderWidth, mouseX));
    const clampedY = Math.max(0, Math.min(renderHeight, mouseY));

    // Map precisely to host screen resolution
    const targetX = (clampedX / renderWidth) * videoWidth;
    const targetY = (clampedY / renderHeight) * videoHeight;

    // Mouse button mapping (0 = left, 1 = middle, 2 = right)
    let button = 'left';
    if (e.button === 1) button = 'middle';
    if (e.button === 2) button = 'right';

    sendControlData({
      type,
      x: targetX,
      y: targetY,
      button
    });
  };

  const handleMouseMove = (e) => sendMouseEvent('mousemove', e);
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

  return (
    <div className="app-container">
      {status !== 'connected' ? (
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
                    <button
                      key={code}
                      onClick={() => handleConnect(null, code)}
                      disabled={status === 'connecting'}
                      style={{
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#818cf8',
                        padding: '6px 12px',
                        borderRadius: '100px',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      title={`Connect to ${code}`}
                    >
                      {code}
                    </button>
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
                  href="/RemoteG-Setup.exe"
                  download="RemoteG-Setup.exe"
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
                  📥 Download (.exe)
                </a>

                <a
                  href="/RemoteG-Setup.zip"
                  download="RemoteG-Setup.zip"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                    color: '#fff',
                    padding: '8px 16px',
                    borderRadius: '100px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    textDecoration: 'none',
                    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)'
                  }}
                >
                  📦 Download (.zip)
                </a>

                <button
                  onClick={() => {
                    const downloadUrl = `${window.location.origin}/RemoteG-Setup.zip`;
                    navigator.clipboard.writeText(downloadUrl);
                    alert(`WhatsApp Zip Download Link copied to clipboard:\n${downloadUrl}\n\nAap is link ko WhatsApp par kisi ko bhi bhej sakte hain!`);
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
            </div>
          </div>
        </div>
      ) : (
        <div className="viewer-layout">
          <div className="control-bar">
            <div className="control-bar-left">
              <span className="session-tag">Active Node: {roomId}</span>
              <span className="stream-badge">LIVE</span>

              {hostSystemInfo && (
                <button
                  onClick={() => setShowSpecsModal(prev => !prev)}
                  className={`control-btn btn-specs ${showSpecsModal ? 'active' : ''}`}
                  title="View Host Machine Specifications"
                >
                  💻 Device Specs ({hostSystemInfo.hostname || 'Host'})
                </button>
              )}

              <button
                onClick={() => setShowHealthDrawer(prev => !prev)}
                className={`control-btn btn-health ${showHealthDrawer ? 'active' : ''}`}
                title="View Live CPU, RAM, Disk, and Network Health"
              >
                📊 Live System Health {liveMetrics ? `(${liveMetrics.cpuPercent}%)` : ''}
              </button>

              <button
                onClick={() => setShowTerminalDrawer(prev => !prev)}
                className={`control-btn btn-terminal ${showTerminalDrawer ? 'active' : ''}`}
                title="Open Silent Remote PowerShell & CMD Terminal"
              >
                💻 Remote Terminal
              </button>

              <button 
                onClick={() => {
                  const directUrl = `${window.location.origin}/?code=${roomId}`;
                  navigator.clipboard.writeText(directUrl);
                  alert(`Direct Access Link copied to clipboard:\n${directUrl}\n\nYou can bookmark this link for 1-click auto-connect!`);
                }}
                className="control-btn btn-link"
                title="Copy Direct Bookmark Link"
              >
                🔗 Copy 1-Click Link
              </button>
            </div>
            <button className="btn-disconnect" onClick={cleanup}>
              Terminate Session
            </button>
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
                      <div className="info-row">
                        <span>OS Platform:</span>
                        <strong>{liveMetrics.platform}</strong>
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
                  <span style={{ color: '#94a3b8' }}>🌐 IP Address:</span>
                  <strong style={{ color: '#34d399' }}>{hostSystemInfo.ip || 'N/A'}</strong>
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
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={handleLoadedMetadata}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              onWheel={handleWheel}
              style={{ objectFit: 'contain', width: '100%', height: '100%', display: 'block' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
