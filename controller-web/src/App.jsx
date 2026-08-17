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

    // Create WebRTC DataChannel for direct P2P low-latency control events
    try {
      const dataChannel = pc.createDataChannel('controlEvents');
      dataChannelRef.current = dataChannel;
      dataChannel.onopen = () => {
        console.log('[Controller]: Direct P2P WebRTC DataChannel opened! Ultra-low latency mode active.');
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

  // Mouse event helper - maps browser coordinates to host screen coordinates
  const sendMouseEvent = (type, e) => {
    const video = videoRef.current;
    if (!video || status !== 'connected') return;

    const rect = video.getBoundingClientRect();
    
    // Position relative to the video element viewport
    const relativeX = e.clientX - rect.left;
    const relativeY = e.clientY - rect.top;

    // Aspect ratio scaling logic: maps viewport pixels directly to host screen resolution
    const scaleX = video.videoWidth / rect.width;
    const scaleY = video.videoHeight / rect.height;

    const targetX = relativeX * scaleX;
    const targetY = relativeY * scaleY;

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
                  style={{
                    background: 'rgba(129, 140, 248, 0.25)',
                    border: '1px solid rgba(129, 140, 248, 0.4)',
                    color: '#a5b4fc',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginLeft: '10px'
                  }}
                  title="View Host Machine Specifications"
                >
                  💻 Device Specs ({hostSystemInfo.hostname || 'Host'})
                </button>
              )}

              <button 
                onClick={() => {
                  const directUrl = `${window.location.origin}/?code=${roomId}`;
                  navigator.clipboard.writeText(directUrl);
                  alert(`Direct Access Link copied to clipboard:\n${directUrl}\n\nYou can bookmark this link for 1-click auto-connect!`);
                }}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#fff',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  marginLeft: '10px'
                }}
                title="Copy Direct Bookmark Link"
              >
                🔗 Copy 1-Click Link
              </button>
            </div>
            <button className="btn-disconnect" onClick={cleanup}>
              Terminate Session
            </button>
          </div>

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
