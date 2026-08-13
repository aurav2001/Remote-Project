import { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';

const SIGNALING_SERVER = 'https://remote-desktop-signaling-syj4.onrender.com';

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

function App() {
  const [roomId, setRoomId] = useState('');
  const [targetRoomId, setTargetRoomId] = useState('');
  const [status, setStatus] = useState('disconnected'); // disconnected, connecting, ready, connected
  const [aspectRatio, setAspectRatio] = useState(16 / 9);

  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const videoRef = useRef(null);
  const containerRef = useRef(null);

  // Clean up WebRTC and socket on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
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

  const pendingCandidatesRef = useRef([]);

  const handleConnect = (e) => {
    e.preventDefault();
    if (!targetRoomId.trim()) return;

    setStatus('connecting');
    setRoomId(targetRoomId.trim());
    pendingCandidatesRef.current = [];

    // Connect to Signaling Server
    const socket = io(SIGNALING_SERVER);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to signaling server');
      socket.emit('join-room', { roomId: targetRoomId.trim(), role: 'controller' });
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from signaling server');
      cleanup();
    });

    // Both host and controller are in the room
    socket.on('ready', () => {
      console.log('Host is ready, waiting for WebRTC offer...');
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

    // Receive ICE Candidates from Host
    socket.on('ice-candidate', async ({ candidate }) => {
      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('Error adding received ICE candidate:', e);
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

    // Send local ICE candidates to host
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          roomId: targetRoomId.trim(),
          candidate: event.candidate
        });
      }
    };

    // Monitor connection state
    pc.onconnectionstatechange = () => {
      console.log('WebRTC State:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setStatus('connected');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        cleanup();
      }
    };

    // Receive screen track
    pc.ontrack = (event) => {
      console.log('Received remote video track');
      if (videoRef.current && event.streams && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
      }
    };

    // Set remote description (SDP Offer)
    const sdpOffer = new RTCSessionDescription({
      type: offer?.type || 'offer',
      sdp: offer?.sdp || (typeof offer === 'string' ? offer : offer?.offer?.sdp)
    });
    await pc.setRemoteDescription(sdpOffer);

    // Flush queued ICE candidates
    while (pendingCandidatesRef.current.length > 0) {
      const cand = pendingCandidatesRef.current.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.error('Error adding queued ICE candidate:', e);
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

  // Mouse event helper - maps browser coordinates to host screen coordinates
  const sendMouseEvent = (type, e) => {
    const video = videoRef.current;
    if (!video || status !== 'connected' || !socketRef.current) return;

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

    socketRef.current.emit('control-event', {
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

  // Keyboard events helper - emits virtual key codes
  const handleKeyDown = (e) => {
    if (status !== 'connected' || !socketRef.current) return;
    
    // Prevent default browser scrolling/navigation for key events when controlling
    e.preventDefault();

    socketRef.current.emit('control-event', {
      type: 'keydown',
      key: e.key,
      keyCode: e.keyCode
    });
  };

  const handleKeyUp = (e) => {
    if (status !== 'connected' || !socketRef.current) return;
    e.preventDefault();

    socketRef.current.emit('control-event', {
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
                <label htmlFor="roomId">Target Access Code</label>
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

            <div className="status-indicator">
              <span className={`status-dot ${status}`}></span>
              <span className="status-text">
                {status === 'disconnected' && 'Ready for Connection'}
                {status === 'connecting' && 'Connecting to Signaling Server...'}
                {status === 'ready' && 'Signaled Host. Establishing WebRTC stream...'}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="viewer-layout">
          <div className="control-bar">
            <div className="control-bar-left">
              <span className="session-tag">Active Node: {roomId}</span>
              <span className="stream-badge">LIVE</span>
            </div>
            <button className="btn-disconnect" onClick={cleanup}>
              Terminate Session
            </button>
          </div>

          <div 
            ref={containerRef}
            className="video-container"
            tabIndex={0} // Makes container focusable to receive keyboard events
            onClick={focusControl}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            style={{ aspectRatio: aspectRatio }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              onLoadedMetadata={handleLoadedMetadata}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              style={{ objectFit: 'fill', width: '100%', height: '100%' }}
            />
          </div>
          
          <div className="control-hint">
            Click inside the screen above to start controlling. Press escape or click outside to release focus.
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
