import { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';

const SIGNALING_SERVER = (typeof window !== 'undefined' && window.location?.origin && !window.location.origin.includes('file://')) 
  ? window.location.origin 
  : 'https://remoteg-all-in-one-production-6122.up.railway.app';

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

  // Central Dashboard RMM States (Cached for 0-second instant display)
  const [activeHosts, setActiveHosts] = useState(() => {
    try {
      const saved = localStorage.getItem('unio_cached_active_hosts');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' or 'connect'
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'online', 'offline'
  const [selectedWorkspace, setSelectedWorkspace] = useState(() => {
    try {
      return localStorage.getItem('unio_selected_workspace') || 'ALL';
    } catch (e) {
      return 'ALL';
    }
  });
  const [customWorkspaces, setCustomWorkspaces] = useState(() => {
    try {
      const saved = localStorage.getItem('unio_custom_workspaces');
      return saved ? JSON.parse(saved) : ['USPL'];
    } catch(e) {
      return ['USPL'];
    }
  });
  const [savedDeviceGroups, setSavedDeviceGroups] = useState(() => {
    try {
      const saved = localStorage.getItem('unio_saved_device_groups');
      return saved ? JSON.parse(saved) : {};
    } catch(e) {
      return {};
    }
  });
  const [isServerConnected, setIsServerConnected] = useState(false);
  const [myLocalHostCode, setMyLocalHostCode] = useState(() => {
    try {
      return localStorage.getItem('remoteg_permanent_access_code') || localStorage.getItem('unio_my_host_code') || '';
    } catch(e) {
      return '';
    }
  });
  const [hideSelfDevice, setHideSelfDevice] = useState(false);

  // Authentication & Session Security States
  const [authToken, setAuthToken] = useState(() => {
    try {
      return localStorage.getItem('unio_auth_token') || sessionStorage.getItem('unio_auth_token') || '';
    } catch (e) {
      return '';
    }
  });
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('unio_current_user');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    try {
      return Boolean(localStorage.getItem('unio_auth_token') || sessionStorage.getItem('unio_auth_token'));
    } catch (e) {
      return false;
    }
  });
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginShake, setLoginShake] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showLandingView, setShowLandingView] = useState(false);

  // Persistent WAN IP Cache to guarantee zero flickering
  const [cachedDeviceWanIps, setCachedDeviceWanIps] = useState(() => {
    try {
      const saved = localStorage.getItem('unio_cached_wan_ips');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  // Change Password Modal States
  const [showChangePassModal, setShowChangePassModal] = useState(false);
  const [currentPassInput, setCurrentPassInput] = useState('');
  const [newPassInput, setNewPassInput] = useState('');
  const [confirmPassInput, setConfirmPassInput] = useState('');
  const [changePassError, setChangePassError] = useState('');
  const [changePassSuccess, setChangePassSuccess] = useState('');
  const [isChangingPass, setIsChangingPass] = useState(false);

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

  // P2P File Transfer States
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [fileTransfer, setFileTransfer] = useState(null);
  const fileInputRef = useRef(null);

  // Screen Annotation & Laser Pointer Suite States
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [annotationTool, setAnnotationTool] = useState('laser'); // 'laser', 'pen', 'arrow', 'rect', 'highlighter'
  const [annotationColor, setAnnotationColor] = useState('#ef4444');
  const [annotationSize, setAnnotationSize] = useState(4);
  const [annotations, setAnnotations] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentDrawItem, setCurrentDrawItem] = useState(null);
  const [laserPos, setLaserPos] = useState({ x: -100, y: -100, active: false });
  const annotationCanvasRef = useRef(null);

  // Multi-Monitor Dual/Triple Display Switcher States
  const [availableScreens, setAvailableScreens] = useState([]);
  const [currentScreenId, setCurrentScreenId] = useState('screen:0:0');
  const [showScreenDropdown, setShowScreenDropdown] = useState(false);

  // Remote File Explorer & 1-Click File Downloader States
  const [showFileExplorerDrawer, setShowFileExplorerDrawer] = useState(false);
  const [remoteCurrentPath, setRemoteCurrentPath] = useState('');
  const [remoteParentPath, setRemoteParentPath] = useState(null);
  const [remoteFiles, setRemoteFiles] = useState([]);
  const [remoteDrives, setRemoteDrives] = useState(['C:\\']);
  const [remoteQuickPaths, setRemoteQuickPaths] = useState([]);
  const [isLoadingRemoteFiles, setIsLoadingRemoteFiles] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [pathInputValue, setPathInputValue] = useState('');
  const [activeDownloadTransfer, setActiveDownloadTransfer] = useState(null);
  const downloadChunksMapRef = useRef({});
  const activeFallbackTimerRef = useRef(null);
  const explorerFileInputRef = useRef(null);

  // Low latency event emitter: prefers direct P2P WebRTC DataChannel, falls back to Socket.IO signaling
  function sendControlData(eventData) {
    let sent = false;
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      try {
        dataChannelRef.current.send(JSON.stringify(eventData));
        sent = true;
      } catch (err) {
        console.warn('[Controller]: DataChannel send warning:', err);
      }
    }
    if (!sent && socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('control-event', eventData);
      sent = true;
    }
    return sent;
  }

  const handleSwitchScreen = (screenId) => {
    if (!screenId || screenId === currentScreenId) {
      setShowScreenDropdown(false);
      return;
    }
    setCurrentScreenId(screenId);
    setShowScreenDropdown(false);
    sendControlData({
      type: 'switch-screen',
      screenId
    });
    const matched = availableScreens.find(s => s.id === screenId);
    setClipboardToast({
      text: `🖥️ Switching to ${matched?.label || 'Monitor'}...`,
      isSelf: true
    });
    setTimeout(() => setClipboardToast(null), 3000);
  };

  // Remote Reboot & Auto-Reconnect States
  const [showRebootModal, setShowRebootModal] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);
  const [rebootAttemptCount, setRebootAttemptCount] = useState(0);
  const isRebootingRef = useRef(false);
  isRebootingRef.current = isRebooting;

  // Auto-Reconnect Polling Engine while target machine restarts
  useEffect(() => {
    let rebootPoll = null;
    if (isRebooting) {
      rebootPoll = setInterval(() => {
        setRebootAttemptCount(prev => prev + 1);
        const room = activeRoomIdRef.current || targetRoomId.trim();
        if (socketRef.current && socketRef.current.connected) {
          socketRef.current.emit('join-room', { roomId: room, role: 'controller' });
        } else {
          initSocket();
        }
      }, 3500);
    }
    return () => {
      if (rebootPoll) clearInterval(rebootPoll);
    };
  }, [isRebooting]);

  const handleInitiateReboot = () => {
    sendControlData({
      type: 'system-reboot'
    });
    setIsRebooting(true);
    setRebootAttemptCount(1);
    setClipboardToast({
      text: '🔄 Remote Reboot command sent to target machine!',
      isSelf: true
    });
    setTimeout(() => setClipboardToast(null), 4000);
  };

  const handleCancelRebootWaiting = () => {
    setIsRebooting(false);
    setShowRebootModal(false);
    cleanup();
  };

  // --- Remote File Explorer & Target-to-Admin Downloader Engine ---
  const requestRemoteDirectory = (targetPath = '', includeDrives = false) => {
    setIsLoadingRemoteFiles(true);
    const room = activeRoomIdRef.current || targetRoomId.trim();
    const req = {
      type: 'file-explorer-list-req',
      path: targetPath,
      includeDrives: includeDrives || remoteDrives.length === 0,
      reqId: 'req_' + Date.now()
    };
    sendControlData(req);
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('file-explorer-event', { roomId: room, payload: req });
    }

    // Fallback for older host clients: if host doesn't respond in 1200ms, use silent PowerShell terminal query
    if (activeFallbackTimerRef.current) clearTimeout(activeFallbackTimerRef.current);
    activeFallbackTimerRef.current = setTimeout(() => {
      const escapedPath = targetPath ? targetPath.replace(/"/g, '\\"') : '';
      const psCmd = `$p = "${escapedPath}"; if (-not $p) { $p = [Environment]::GetFolderPath('Desktop') }; if (-not (Test-Path -LiteralPath $p)) { $p = 'C:\\' }; $entries = Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue | Select-Object Name, FullName, Length, LastWriteTime, @{Name='IsDirectory';Expression={$_.PSIsContainer}}; $parent = Split-Path -Path $p -Parent; $drives = [System.IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name }; $desk = [Environment]::GetFolderPath('Desktop'); $down = [IO.Path]::Combine($env:USERPROFILE, 'Downloads'); $docs = [Environment]::GetFolderPath('MyDocuments'); $out = @{ currentPath = $p; parentPath = $parent; drives = $drives; desktop = $desk; downloads = $down; documents = $docs; items = $entries }; $json = $out | ConvertTo-Json -Compress -Depth 3; Write-Output "---FE_LIST_JSON_START---$json---FE_LIST_JSON_END---"`;

      const cmdPayload = {
        type: 'terminal-command',
        id: 'fe_list_' + Date.now(),
        command: psCmd,
        shellType: 'powershell',
        isSilent: true
      };
      sendControlData(cmdPayload);
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('terminal-command', cmdPayload);
      }
    }, 1200);
  };

  const handleReceiveFileList = (data) => {
    if (activeFallbackTimerRef.current) {
      clearTimeout(activeFallbackTimerRef.current);
      activeFallbackTimerRef.current = null;
    }
    setIsLoadingRemoteFiles(false);
    if (data.success) {
      setRemoteCurrentPath(data.currentPath || '');
      setPathInputValue(data.currentPath || '');
      setRemoteParentPath(data.parentPath || null);
      setRemoteFiles(data.items || []);
      if (data.drivesInfo && data.drivesInfo.drives) {
        setRemoteDrives(data.drivesInfo.drives);
        setRemoteQuickPaths(data.drivesInfo.quickPaths || []);
      }
    } else {
      setClipboardToast({
        text: `⚠️ File Explorer: ${data.error || 'Failed to read directory'}`,
        isSelf: true
      });
      setTimeout(() => setClipboardToast(null), 4000);
    }
  };

  const requestDownloadRemoteFile = (filePath, fileName) => {
    if (!filePath) return;
    const transferId = 'dl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    downloadChunksMapRef.current[transferId] = {
      chunks: [],
      totalBytes: 0,
      receivedBytes: 0,
      fileName: fileName || filePath.split(/[\/\\]/).pop(),
      startTime: Date.now()
    };

    setActiveDownloadTransfer({
      transferId,
      fileName: fileName || filePath.split(/[\/\\]/).pop(),
      progress: 5,
      receivedFormatted: '0 KB',
      totalFormatted: '...',
      speed: '...',
      isComplete: false,
      error: null
    });

    const req = {
      type: 'file-explorer-download-req',
      transferId,
      filePath,
      fileName: fileName || filePath.split(/[\/\\]/).pop()
    };
    sendControlData(req);

    // Fallback timer for download on older host clients
    setTimeout(() => {
      const stateObj = downloadChunksMapRef.current[transferId];
      if (stateObj && stateObj.receivedBytes === 0) {
        const cleanPath = filePath.replace(/"/g, '\\"');
        const cleanName = (fileName || filePath.split(/[\/\\]/).pop()).replace(/"/g, '\\"');
        const psCmd = `$p = "${cleanPath}"; if (Test-Path -LiteralPath $p) { $bytes = [System.IO.File]::ReadAllBytes($p); $b64 = [Convert]::ToBase64String($bytes); $meta = @{ transferId = '${transferId}'; fileName = '${cleanName}'; totalSize = $bytes.Length } | ConvertTo-Json -Compress; Write-Output ("---FE_DL_START---" + $meta + [Environment]::NewLine + $b64 + "---FE_DL_END---") } else { Write-Output "File not found" }`;
        sendControlData({
          type: 'terminal-command',
          id: 'fe_dl_' + Date.now(),
          command: psCmd,
          shellType: 'powershell',
          isSilent: true
        });
      }
    }, 1500);
  };

  const handleProcessTerminalOutput = (data) => {
    if (!data) return;
    const out = data.output || '';

    // 1. Check for File Explorer Directory Listing fallback
    if (out.includes('---FE_LIST_JSON_START---')) {
      try {
        const jsonStr = out.split('---FE_LIST_JSON_START---')[1].split('---FE_LIST_JSON_END---')[0].trim();
        const parsed = JSON.parse(jsonStr);
        const formatBytes = (bytes) => {
          if (!bytes || bytes === 0) return '0 B';
          const k = 1024;
          const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)) + ' ' + sizes[i];
        };

        const rawItems = Array.isArray(parsed.items) ? parsed.items : (parsed.items ? [parsed.items] : []);
        const items = rawItems.filter(it => it && it.Name).map(it => {
          const isDir = Boolean(it.IsDirectory);
          const sizeBytes = it.Length || 0;
          return {
            name: it.Name,
            path: it.FullName || (parsed.currentPath + '\\' + it.Name),
            isDirectory: isDir,
            sizeBytes: sizeBytes,
            sizeFormatted: isDir ? '--' : formatBytes(sizeBytes),
            mtime: it.LastWriteTime,
            ext: isDir ? '' : (it.Name.includes('.') ? '.' + it.Name.split('.').pop().toLowerCase() : '')
          };
        });

        items.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });

        handleReceiveFileList({
          success: true,
          currentPath: parsed.currentPath,
          parentPath: parsed.parentPath,
          items,
          drivesInfo: {
            drives: parsed.drives || ['C:\\'],
            quickPaths: [
              { label: 'Desktop', path: parsed.desktop || 'C:\\Users\\' + (hostSystemInfo?.loggedUser || 'Public') + '\\Desktop', icon: '🖥️' },
              { label: 'Downloads', path: parsed.downloads || 'C:\\Users\\' + (hostSystemInfo?.loggedUser || 'Public') + '\\Downloads', icon: '📥' },
              { label: 'Documents', path: parsed.documents || 'C:\\Users\\' + (hostSystemInfo?.loggedUser || 'Public') + '\\Documents', icon: '📄' }
            ]
          }
        });
        return;
      } catch (e) {
        console.error('Error parsing FE list fallback:', e);
      }
    }

    // 2. Check for File Explorer Download fallback
    if (out.includes('---FE_DL_START---')) {
      try {
        const body = out.split('---FE_DL_START---')[1].split('---FE_DL_END---')[0].trim();
        const firstLineIdx = body.indexOf('\n');
        const metaStr = body.substring(0, firstLineIdx).trim();
        const base64Chunk = body.substring(firstLineIdx + 1).replace(/\r?\n/g, '');
        const meta = JSON.parse(metaStr);

        handleReceiveDownloadChunk({
          transferId: meta.transferId,
          fileName: meta.fileName,
          totalSize: meta.totalSize,
          base64Chunk,
          bytesRead: meta.totalSize,
          isFirstChunk: true,
          isLastChunk: true
        });
        return;
      } catch (e) {
        console.error('Error parsing FE download fallback:', e);
      }
    }

    // 3. Regular Terminal Logs (skip silent commands)
    if (!data.isSilent && !out.includes('---FE_')) {
      setTerminalLogs(prev => {
        const exists = prev.some(item => item.id === data.id);
        if (exists) {
          return prev.map(item => item.id === data.id ? { ...data, pending: false } : item);
        }
        return [...prev, { ...data, pending: false }];
      });
      setIsExecutingCmd(false);
    }
  };

  const handleReceiveDownloadChunk = (chunkData) => {
    if (!chunkData || !chunkData.transferId) return;
    const { transferId, totalSize, base64Chunk, isLastChunk, error } = chunkData;

    if (error) {
      setActiveDownloadTransfer(prev => prev && prev.transferId === transferId ? {
        ...prev,
        error,
        isComplete: false
      } : prev);
      delete downloadChunksMapRef.current[transferId];
      return;
    }

    const stateObj = downloadChunksMapRef.current[transferId];
    if (!stateObj) return;

    if (totalSize) stateObj.totalBytes = totalSize;

    if (base64Chunk) {
      try {
        const binaryString = atob(base64Chunk);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        stateObj.chunks.push(bytes);
        stateObj.receivedBytes += bytes.length;
      } catch (e) {
        console.error('Error decoding download chunk:', e);
      }
    }

    const total = stateObj.totalBytes || 1;
    const pct = Math.min(100, Math.round((stateObj.receivedBytes / total) * 100));
    const elapsedSec = (Date.now() - stateObj.startTime) / 1000 || 0.1;
    const speedBytes = stateObj.receivedBytes / elapsedSec;
    const speedStr = speedBytes > 1024 * 1024 
      ? `${(speedBytes / (1024 * 1024)).toFixed(1)} MB/s` 
      : `${Math.round(speedBytes / 1024)} KB/s`;

    setActiveDownloadTransfer({
      transferId,
      fileName: stateObj.fileName,
      progress: pct,
      receivedFormatted: stateObj.receivedBytes > 1024 * 1024 ? `${(stateObj.receivedBytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(stateObj.receivedBytes / 1024)} KB`,
      totalFormatted: total > 1024 * 1024 ? `${(total / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(total / 1024)} KB`,
      speed: speedStr,
      isComplete: isLastChunk,
      error: null
    });

    if (isLastChunk) {
      try {
        const blob = new Blob(stateObj.chunks);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = stateObj.fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          if (document.body.contains(a)) document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1000);

        setClipboardToast({
          text: `🎉 Downloaded "${stateObj.fileName}" to your Admin PC!`,
          isSelf: true
        });
        setTimeout(() => setClipboardToast(null), 5000);
      } catch (e) {
        console.error('Failed triggering browser download:', e);
      }
      delete downloadChunksMapRef.current[transferId];
      setTimeout(() => {
        setActiveDownloadTransfer(prev => prev && prev.transferId === transferId ? null : prev);
      }, 4000);
    }
  };

  // Single-instance download protection to avoid duplicate downloads
  const [isDownloading, setIsDownloading] = useState(false);
  const GITHUB_DOWNLOAD_URL = 'https://github.com/aurav2001/Remote-Project/raw/main/client-electron/UnioTechIT-Setup.zip';

  const handleDownloadSetup = () => {
    if (isDownloading) return;
    setIsDownloading(true);

    const tempLink = document.createElement('a');
    tempLink.href = GITHUB_DOWNLOAD_URL;
    tempLink.setAttribute('download', 'UnioTechIT-Setup.zip');
    tempLink.style.display = 'none';
    document.body.appendChild(tempLink);
    tempLink.click();
    setTimeout(() => {
      if (document.body.contains(tempLink)) {
        document.body.removeChild(tempLink);
      }
    }, 200);

    setTimeout(() => {
      setIsDownloading(false);
    }, 4000);
  };

  // Verify authentication session on load
  useEffect(() => {
    const verifySession = async () => {
      const token = localStorage.getItem('unio_auth_token') || sessionStorage.getItem('unio_auth_token');
      if (!token) {
        setIsAuthenticated(false);
        return;
      }
      try {
        const res = await fetch(`${SIGNALING_SERVER}/api/auth/verify`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated) {
            setIsAuthenticated(true);
            setCurrentUser(data.user);
            localStorage.setItem('unio_current_user', JSON.stringify(data.user));
          } else {
            handleLogout(false);
          }
        } else if (res.status === 401) {
          handleLogout(false);
        }
      } catch (err) {
        // If server is warming up, retain active token
        console.warn('[Auth]: Verification network notice:', err);
      }
    };
    verifySession();
  }, []);

  const triggerLoginShake = () => {
    setLoginShake(true);
    setTimeout(() => setLoginShake(false), 600);
  };

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    setLoginError('');
    if (!loginUsername.trim() || !loginPassword) {
      setLoginError('Please enter both Administrator ID and Password.');
      triggerLoginShake();
      return;
    }

    setIsLoggingIn(true);
    try {
      const res = await fetch(`${SIGNALING_SERVER}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword })
      });
      const data = await res.json();
      if (res.ok && data.success && data.token) {
        setAuthToken(data.token);
        setCurrentUser(data.user);
        setIsAuthenticated(true);
        setShowAuthModal(false);
        setShowLandingView(false);
        if (rememberMe) {
          localStorage.setItem('unio_auth_token', data.token);
          localStorage.setItem('unio_current_user', JSON.stringify(data.user));
        } else {
          sessionStorage.setItem('unio_auth_token', data.token);
          sessionStorage.setItem('unio_current_user', JSON.stringify(data.user));
        }
      } else {
        setLoginError(data.error || 'Invalid credentials. Please verify your login info.');
        triggerLoginShake();
      }
    } catch (err) {
      // Local fallback for quick offline demo testing
      if (loginUsername.trim().toLowerCase() === 'admin' && loginPassword === 'admin123') {
        const mockUser = { username: 'admin', role: 'Administrator' };
        setIsAuthenticated(true);
        setCurrentUser(mockUser);
        setShowAuthModal(false);
        setShowLandingView(false);
        localStorage.setItem('unio_auth_token', 'local_demo_token');
        localStorage.setItem('unio_current_user', JSON.stringify(mockUser));
      } else {
        setLoginError('Authentication server connection error. Please try again.');
        triggerLoginShake();
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async (callApi = true) => {
    if (callApi && authToken) {
      try {
        await fetch(`${SIGNALING_SERVER}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` }
        });
      } catch (e) {}
    }
    localStorage.removeItem('unio_auth_token');
    localStorage.removeItem('unio_current_user');
    sessionStorage.removeItem('unio_auth_token');
    sessionStorage.removeItem('unio_current_user');
    setAuthToken('');
    setCurrentUser(null);
    setIsAuthenticated(false);
    setShowAuthModal(false);
    setShowLandingView(true);
  };

  const handleChangePassword = async (e) => {
    if (e) e.preventDefault();
    setChangePassError('');
    setChangePassSuccess('');

    if (!currentPassInput || !newPassInput || !confirmPassInput) {
      setChangePassError('All fields are required.');
      return;
    }
    if (newPassInput !== confirmPassInput) {
      setChangePassError('New passwords do not match.');
      return;
    }
    if (newPassInput.length < 4) {
      setChangePassError('New password must be at least 4 characters long.');
      return;
    }

    setIsChangingPass(true);
    try {
      const res = await fetch(`${SIGNALING_SERVER}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          currentPassword: currentPassInput,
          newPassword: newPassInput
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setChangePassSuccess('Admin password successfully updated!');
        setCurrentPassInput('');
        setNewPassInput('');
        setConfirmPassInput('');
        setTimeout(() => {
          setShowChangePassModal(false);
          setChangePassSuccess('');
        }, 2000);
      } else {
        setChangePassError(data.error || 'Failed to update password.');
      }
    } catch (err) {
      setChangePassError('Network error while updating password.');
    } finally {
      setIsChangingPass(false);
    }
  };

  // High-performance unified host synchronization engine
  useEffect(() => {
    let isMounted = true;

    const commitHosts = (data) => {
      if (isMounted && Array.isArray(data)) {
        setActiveHosts(data);
        try {
          localStorage.setItem('unio_cached_active_hosts', JSON.stringify(data));
        } catch (e) {}

        setCachedDeviceWanIps(prev => {
          let changed = false;
          const next = { ...prev };
          data.forEach(h => {
            const hId = String(h.roomId || '').trim();
            const ip = (h.systemInfo?.publicIp && h.systemInfo.publicIp !== 'N/A' && !h.systemInfo.publicIp.includes('127.0.0.1'))
              ? h.systemInfo.publicIp
              : ((h.liveMetrics?.publicIp && h.liveMetrics.publicIp !== 'N/A' && !h.liveMetrics.publicIp.includes('127.0.0.1')) ? h.liveMetrics.publicIp : null);
            if (hId && ip && next[hId] !== ip) {
              next[hId] = ip;
              changed = true;
            }
          });
          if (changed) {
            try { localStorage.setItem('unio_cached_wan_ips', JSON.stringify(next)); } catch (e) {}
            return next;
          }
          return prev;
        });
      }
    };

    // 1. Instant REST fetch for active hosts with cache busting
    const fetchHostsRest = async () => {
      try {
        const res = await fetch(`${SIGNALING_SERVER}/api/hosts?_t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            commitHosts(data);
            if (isMounted) setIsServerConnected(true);
          }
        }
      } catch (e) {
        // Server might still be waking up from sleep
      }
    };

    // Initial instant fetch
    fetchHostsRest();

    // 2. Real-time WebSocket connection
    const globalSocket = io(SIGNALING_SERVER, {
      pingTimeout: 30000,
      pingInterval: 10000,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling']
    });

    globalSocket.on('connect', () => {
      console.log('[Controller]: Global dashboard socket connected');
      if (isMounted) setIsServerConnected(true);
      globalSocket.emit('get-active-hosts');
      fetchHostsRest();
    });

    globalSocket.on('disconnect', () => {
      if (isMounted) setIsServerConnected(false);
    });

    globalSocket.on('active-hosts-list', (hosts) => {
      commitHosts(hosts || []);
    });

    // 3. Fast polling interval (2.5s) to guarantee continuous live sync & quick cold-start recovery
    const pollInterval = setInterval(() => {
      if (globalSocket.connected) {
        globalSocket.emit('get-active-hosts');
      } else {
        fetchHostsRest();
      }
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
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
  const activeRoomIdRef = useRef('');
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const localCursorRef = useRef(null);

  // Clean up WebRTC and socket on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  // Guarantee that whenever status becomes 'connected', the video tag receives the stream and plays
  useEffect(() => {
    if (status === 'connected' && videoRef.current && remoteStreamRef.current) {
      if (videoRef.current.srcObject !== remoteStreamRef.current) {
        console.log('Binding remote stream to video element srcObject and invoking play()');
        videoRef.current.srcObject = remoteStreamRef.current;
      }
      if (videoRef.current.paused) {
        videoRef.current.play().catch(err => console.warn('Video autoplay warning:', err));
      }
    }
  }, [status]);

  // Low-latency video buffer sync: prevents video drift behind real-time
  useEffect(() => {
    if (status !== 'connected' || !videoRef.current) return;
    const v = videoRef.current;
    const syncInterval = setInterval(() => {
      if (v && v.buffered && v.buffered.length > 0) {
        const liveEdge = v.buffered.end(v.buffered.length - 1);
        if (liveEdge - v.currentTime > 0.10) {
          v.currentTime = liveEdge;
        }
      }
    }, 400);
    return () => clearInterval(syncInterval);
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

  // --- Screen Annotation & Laser Pointer Canvas Handlers ---
  const lastLaserEmitTimeRef = useRef(0);

  const getCanvasCoords = (e) => {
    const targetEl = videoRef.current || annotationCanvasRef.current;
    if (!targetEl) return { x: 0, y: 0, nx: 0, ny: 0 };
    const rect = targetEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0, nx: 0, ny: 0 };

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const nx = Math.max(0, Math.min(1, x / rect.width));
    const ny = Math.max(0, Math.min(1, y / rect.height));
    return { x, y, nx, ny, width: rect.width, height: rect.height };
  };

  const handleAnnotationMouseDown = (e) => {
    if (!isAnnotating) return;
    const coords = getCanvasCoords(e);
    if (annotationTool === 'laser') {
      setLaserPos({ x: coords.x, y: coords.y, active: true });
      sendControlData({
        type: 'annotation-event',
        payload: {
          type: 'laser',
          x: coords.nx,
          y: coords.ny,
          color: annotationColor,
          active: true
        }
      });
      return;
    }

    setIsDrawing(true);
    if (annotationTool === 'pen' || annotationTool === 'highlighter') {
      setCurrentDrawItem({
        id: Date.now(),
        type: annotationTool,
        color: annotationColor,
        size: annotationSize,
        points: [{ x: coords.x, y: coords.y }],
        npoints: [{ x: coords.nx, y: coords.ny }]
      });
    } else if (annotationTool === 'arrow' || annotationTool === 'rect') {
      setCurrentDrawItem({
        id: Date.now(),
        type: annotationTool,
        color: annotationColor,
        size: annotationSize,
        start: { x: coords.x, y: coords.y },
        end: { x: coords.x, y: coords.y },
        nstart: { x: coords.nx, y: coords.ny },
        nend: { x: coords.nx, y: coords.ny }
      });
    }
  };

  const handleAnnotationMouseMove = (e) => {
    if (!isAnnotating) return;
    const coords = getCanvasCoords(e);

    if (annotationTool === 'laser') {
      setLaserPos({ x: coords.x, y: coords.y, active: true });
      const now = performance.now();
      if (now - lastLaserEmitTimeRef.current >= 16) {
        lastLaserEmitTimeRef.current = now;
        sendControlData({
          type: 'annotation-event',
          payload: {
            type: 'laser',
            x: coords.nx,
            y: coords.ny,
            color: annotationColor,
            active: true
          }
        });
      }
      return;
    }

    if (!isDrawing || !currentDrawItem) return;

    if (currentDrawItem.type === 'pen' || currentDrawItem.type === 'highlighter') {
      setCurrentDrawItem(prev => prev ? {
        ...prev,
        points: [...prev.points, { x: coords.x, y: coords.y }],
        npoints: [...(prev.npoints || []), { x: coords.nx, y: coords.ny }]
      } : null);
    } else if (currentDrawItem.type === 'arrow' || currentDrawItem.type === 'rect') {
      setCurrentDrawItem(prev => prev ? {
        ...prev,
        end: { x: coords.x, y: coords.y },
        nend: { x: coords.nx, y: coords.ny }
      } : null);
    }
  };

  const handleAnnotationMouseUp = () => {
    if (!isAnnotating) return;
    if (annotationTool === 'laser') return;
    if (isDrawing && currentDrawItem) {
      setAnnotations(prev => [...prev, currentDrawItem]);

      // Broadcast completed shape to Host PC
      const normItem = {
        type: currentDrawItem.type,
        color: currentDrawItem.color,
        size: currentDrawItem.size,
        points: currentDrawItem.npoints,
        start: currentDrawItem.nstart,
        end: currentDrawItem.nend
      };
      sendControlData({
        type: 'annotation-event',
        payload: {
          type: 'draw',
          item: normItem
        }
      });

      setCurrentDrawItem(null);
      setIsDrawing(false);
    }
  };

  const handleAnnotationMouseLeave = () => {
    if (annotationTool === 'laser') {
      setLaserPos(prev => ({ ...prev, active: false }));
      sendControlData({
        type: 'annotation-event',
        payload: {
          type: 'laser',
          active: false
        }
      });
    }
    if (isDrawing && currentDrawItem) {
      setAnnotations(prev => [...prev, currentDrawItem]);
      const normItem = {
        type: currentDrawItem.type,
        color: currentDrawItem.color,
        size: currentDrawItem.size,
        points: currentDrawItem.npoints,
        start: currentDrawItem.nstart,
        end: currentDrawItem.nend
      };
      sendControlData({
        type: 'annotation-event',
        payload: {
          type: 'draw',
          item: normItem
        }
      });
      setCurrentDrawItem(null);
      setIsDrawing(false);
    }
  };

  // Re-render canvas on every change to annotations, active draw, or laser pos
  useEffect(() => {
    const canvas = annotationCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Only render the item actively being dragged by technician before mouseup
    const activeItems = currentDrawItem ? [currentDrawItem] : [];

    activeItems.forEach(item => {
      ctx.save();
      ctx.strokeStyle = item.color;
      ctx.fillStyle = item.color;
      ctx.lineWidth = item.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (item.type === 'pen') {
        if (item.points && item.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(item.points[0].x, item.points[0].y);
          for (let i = 1; i < item.points.length; i++) {
            ctx.lineTo(item.points[i].x, item.points[i].y);
          }
          ctx.stroke();
        }
      } else if (item.type === 'highlighter') {
        if (item.points && item.points.length > 0) {
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = item.size * 3.5;
          ctx.beginPath();
          ctx.moveTo(item.points[0].x, item.points[0].y);
          for (let i = 1; i < item.points.length; i++) {
            ctx.lineTo(item.points[i].x, item.points[i].y);
          }
          ctx.stroke();
        }
      } else if (item.type === 'rect') {
        if (item.start && item.end) {
          ctx.beginPath();
          const x = Math.min(item.start.x, item.end.x);
          const y = Math.min(item.start.y, item.end.y);
          const w = Math.abs(item.end.x - item.start.x);
          const h = Math.abs(item.end.y - item.start.y);
          ctx.strokeRect(x, y, w, h);
        }
      } else if (item.type === 'arrow') {
        if (item.start && item.end) {
          const fromX = item.start.x;
          const fromY = item.start.y;
          const toX = item.end.x;
          const toY = item.end.y;
          const headlen = Math.max(12, item.size * 3.5);
          const angle = Math.atan2(toY - fromY, toX - fromX);

          ctx.beginPath();
          ctx.moveTo(fromX, fromY);
          ctx.lineTo(toX, toY);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(toX, toY);
          ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    });
  }, [annotations, currentDrawItem, laserPos, isAnnotating, annotationTool, annotationColor]);

  // Capture Annotated Screenshot
  const handleCaptureScreenshot = () => {
    try {
      const video = videoRef.current;
      const canvas = annotationCanvasRef.current;
      if (!canvas) return;

      const mergeCanvas = document.createElement('canvas');
      const w = canvas.width || 1920;
      const h = canvas.height || 1080;
      mergeCanvas.width = w;
      mergeCanvas.height = h;
      const ctx = mergeCanvas.getContext('2d');

      if (video && video.readyState >= 2) {
        try {
          ctx.drawImage(video, 0, 0, w, h);
        } catch(e) {}
      }

      ctx.drawImage(canvas, 0, 0, w, h);

      const dataUrl = mergeCanvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `RemoteG-Annotation-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.warn('Could not export annotated screenshot:', err);
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
    setAvailableScreens([]);
    setCurrentScreenId('screen:0:0');
    setShowScreenDropdown(false);
    if (!isRebootingRef.current) {
      setShowRebootModal(false);
      setIsRebooting(false);
    }
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
    const finalRoomId = String(codeToConnect || targetRoomId || '').trim();
    if (!finalRoomId) return;

    activeRoomIdRef.current = finalRoomId;
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
      console.log('Connected to signaling server for room:', finalRoomId);
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

    // Receive Hybrid Canvas JPEG Frame Stream Fallback
    socket.on('screen-frame', ({ frame }) => {
      if (frame) {
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
        handleProcessTerminalOutput(data);
      }
    });

    // Receive clipboard sync via signaling fallback
    socket.on('clipboard-sync', (data) => {
      if (data && data.text) {
        handleReceiveRemoteClipboard(data.text);
      }
    });

    // Receive file transfer completion acknowledgment via signaling fallback
    socket.on('file-transfer-ack', (data) => {
      if (data && data.success) {
        setFileTransfer(prev => prev && prev.transferId === data.transferId ? {
          ...prev,
          isUploading: false,
          isComplete: true,
          progress: 100,
          savedFileName: data.fileName,
          savedPath: data.filePath
        } : prev);
        setClipboardToast({
          text: `📁 File "${data.fileName}" saved to remote Downloads folder!`,
          isSelf: true
        });
      }
    });

    // Receive File Explorer responses & download streaming via signaling fallback
    socket.on('file-explorer-event', (data) => {
      if (!data) return;
      const payload = data.payload || data;
      if (payload.type === 'file-explorer-list-res') {
        handleReceiveFileList(payload);
      } else if (payload.type === 'file-download-chunk') {
        handleReceiveDownloadChunk(payload);
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
        if (isRebootingRef.current) {
          console.log('[Controller]: Host went offline due to reboot. Keeping auto-reconnect engine active...');
          return;
        }
        const isPeerActive = peerConnectionRef.current && peerConnectionRef.current.connectionState === 'connected';
        if (!isPeerActive) {
          alert('Target host disconnected');
          cleanup();
        } else {
          console.warn('[Controller]: Host signaling socket reconnected, maintaining active P2P stream.');
        }
      }
    });

    socket.on('peer-connected', ({ role }) => {
      if (role === 'host') {
        console.log('[Controller]: Host peer joined the room!');
        if (isRebootingRef.current) {
          console.log('[Controller]: Host is BACK ONLINE after reboot! Triggering instant auto-reconnect...');
          setIsRebooting(false);
          setShowRebootModal(false);
          setClipboardToast({
            text: '🎉 Target PC rebooted successfully! Reconnected to session.',
            isSelf: true
          });
          setTimeout(() => setClipboardToast(null), 4000);
          handleConnect(activeRoomIdRef.current || targetRoomId.trim());
        }
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
          roomId: activeRoomIdRef.current || targetRoomId.trim(),
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
        });
      }
    };

    // Monitor connection state
    pc.onconnectionstatechange = () => {
      console.log('WebRTC State:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setStatus('connected');
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn('WebRTC state disconnected or failed. Keeping session active on hybrid frame fallback...');
        setIsWebRtcActive(false);
        if (pc.restartIce) {
          pc.restartIce();
        }
      }
    };

    // Monitor ICE state
    pc.oniceconnectionstatechange = () => {
      console.log('ICE State Change:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setIsWebRtcActive(true);
      } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.warn('WebRTC ICE failed. Seamless fallback to hybrid frame stream active.');
        setIsWebRtcActive(false);
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
      }

      if (videoRef.current) {
        if (videoRef.current.srcObject !== stream) {
          videoRef.current.srcObject = stream;
        }
        videoRef.current.play().catch(e => console.warn('Video play warning:', e));
      }
      setStatus('connected');
    };

    // Listen for WebRTC DataChannel established by Host (Offerer)
    pc.ondatachannel = (event) => {
      const dataChannel = event.channel;
      dataChannelRef.current = dataChannel;
      console.log('[Controller]: Direct P2P WebRTC DataChannel established from host!');

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
          } else if (data.type === 'file-transfer-ack' && data.success) {
            setFileTransfer(prev => prev && prev.transferId === data.transferId ? {
              ...prev,
              isUploading: false,
              isComplete: true,
              progress: 100,
              savedFileName: data.fileName,
              savedPath: data.filePath
            } : prev);
            setClipboardToast({
              text: `📁 File "${data.fileName}" saved to remote Downloads folder!`,
              isSelf: true
            });
          } else if (data.type === 'file-explorer-list-res') {
            handleReceiveFileList(data);
          } else if (data.type === 'file-download-chunk') {
            handleReceiveDownloadChunk(data);
          } else if (data.type === 'screens-list' && Array.isArray(data.screens)) {
            console.log('[Controller]: Received available monitors list:', data.screens);
            setAvailableScreens(data.screens);
            if (data.currentScreenId) setCurrentScreenId(data.currentScreenId);
          } else if (data.type === 'screen-switched') {
            console.log('[Controller]: Remote screen switched to:', data);
            setCurrentScreenId(data.screenId);
            setClipboardToast({
              text: `🖥️ Active display: ${data.label || 'Monitor'}`,
              isSelf: true
            });
            setTimeout(() => setClipboardToast(null), 3000);
          } else if (data.type === 'terminal-result') {
            handleProcessTerminalOutput(data);
          }
        } catch (err) {}
      };
      dataChannel.onclose = () => {
        console.log('[Controller]: WebRTC DataChannel closed.');
      };
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
      roomId: activeRoomIdRef.current || targetRoomId.trim(),
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

  // P2P File Transfer Chunking Engine (Streams 60KB chunks safely over DataChannel / Socket)
  const sendTransferPayload = (payload) => {
    const fullPayload = { roomId, ...payload };
    let sent = false;
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      try {
        dataChannelRef.current.send(JSON.stringify(fullPayload));
        sent = true;
      } catch (err) {
        console.warn('[Controller]: DataChannel send chunk error:', err);
      }
    }
    if (!sent && socketRef.current) {
      socketRef.current.emit('file-transfer-chunk', fullPayload);
      sent = true;
    }
    return sent;
  };

  const sendFile = (file, customTargetDir = null) => {
    if (!file) return;
    const transferId = 'transfer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const CHUNK_SIZE = 60 * 1024; // 60 KB chunks
    const fileSizeMb = (file.size / (1024 * 1024)).toFixed(2);
    const fileSizeFormatted = file.size > 1024 * 1024 ? `${fileSizeMb} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;

    setFileTransfer({
      transferId,
      fileName: file.name,
      fileSizeFormatted,
      totalBytes: file.size,
      bytesSent: 0,
      progress: 0,
      speed: '0 KB/s',
      isUploading: true,
      isComplete: false,
      statusText: customTargetDir ? `Uploading to ${customTargetDir.split(/[\/\\]/).pop() || 'Folder'}...` : 'Transferring...',
      error: null
    });

    const startTime = Date.now();
    let offset = 0;
    let chunkIndex = 0;

    const readNextChunk = () => {
      if (offset >= file.size) return;

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();

      reader.onload = (e) => {
        const arrayBuffer = e.target.result;
        let binary = '';
        const bytes = new Uint8Array(arrayBuffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Chunk = btoa(binary);

        const isFirstChunk = chunkIndex === 0;
        const isLastChunk = offset + slice.size >= file.size;

        const payload = {
          type: 'file-transfer-chunk',
          transferId,
          fileName: file.name,
          fileSize: file.size,
          base64Chunk,
          chunkIndex,
          isFirstChunk,
          isLastChunk,
          targetDirectory: customTargetDir || undefined
        };

        sendTransferPayload(payload);

        offset += slice.size;
        chunkIndex++;

        const elapsedSec = (Date.now() - startTime) / 1000 || 0.1;
        const currentSpeedBytes = offset / elapsedSec;
        const speedStr = currentSpeedBytes > 1024 * 1024 
          ? `${(currentSpeedBytes / (1024 * 1024)).toFixed(1)} MB/s` 
          : `${Math.round(currentSpeedBytes / 1024)} KB/s`;

        const progress = Math.min(100, Math.round((offset / file.size) * 100));

        setFileTransfer(prev => prev && prev.transferId === transferId ? {
          ...prev,
          bytesSent: offset,
          progress,
          speed: speedStr,
          isUploading: !isLastChunk,
          statusText: isLastChunk ? 'Saving on target PC...' : 'Transferring...'
        } : prev);

        if (!isLastChunk) {
          if (dataChannelRef.current && dataChannelRef.current.bufferedAmount > 256 * 1024) {
            setTimeout(readNextChunk, 20);
          } else {
            setTimeout(readNextChunk, 4);
          }
        }
      };

      reader.readAsArrayBuffer(slice);
    };

    readNextChunk();
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOver) setIsDraggingOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDraggingOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      console.log('[Controller]: Drag & Drop File detected:', file.name, file.size);
      sendFile(file);
    }
  };

  // Mouse event helper - maps browser coordinates to host screen coordinates with exact 1-to-1 full-screen alignment
  const sendMouseEvent = (type, e) => {
    const targetEl = e.currentTarget || videoRef.current;
    if (!targetEl || (status !== 'connected' && status !== 'ready')) return;

    const rect = targetEl.getBoundingClientRect();
    const width = targetEl.videoWidth || targetEl.naturalWidth || 1920;
    const height = targetEl.videoHeight || targetEl.naturalHeight || 1080;

    if (!rect.width || !rect.height) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const normX = Math.max(0, Math.min(1, mouseX / rect.width));
    const normY = Math.max(0, Math.min(1, mouseY / rect.height));

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

  // High-performance hardware-accelerated local virtual cursor
  const updateLocalCursor = (e, visible = true, isClick = false) => {
    if (!localCursorRef.current) return;
    if (!visible) {
      localCursorRef.current.style.opacity = '0';
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    localCursorRef.current.style.opacity = '1';
    localCursorRef.current.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;
    if (isClick) {
      localCursorRef.current.classList.add('cursor-active');
    } else {
      localCursorRef.current.classList.remove('cursor-active');
    }
  };

  const lastMoveTimeRef = useRef(0);
  const handleMouseMove = (e) => {
    updateLocalCursor(e, true, false);
    const now = performance.now();
    if (now - lastMoveTimeRef.current >= 12) {
      lastMoveTimeRef.current = now;
      sendMouseEvent('mousemove', e);
    }
  };
  const handleMouseDown = (e) => {
    updateLocalCursor(e, true, true);
    sendMouseEvent('mousedown', e);
  };
  const handleMouseUp = (e) => {
    updateLocalCursor(e, true, false);
    sendMouseEvent('mouseup', e);
  };
  const handleMouseLeave = () => {
    if (localCursorRef.current) {
      localCursorRef.current.style.opacity = '0';
    }
  };
  const handleDoubleClick = (e) => sendMouseEvent('doubleclick', e);
  
  const handleContextMenu = (e) => {
    e.preventDefault(); // Prevent browser right-click context menu (mousedown/mouseup handles native right click)
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

  // Auto-derive all detected unique workspaces (From live hosts, saved configs, and active nodes)
  const allDetectedWorkspaces = Array.from(new Set([
    'ALL',
    'USPL',
    ...customWorkspaces,
    ...Object.values(savedDeviceGroups),
    ...activeHosts.map(h => (h.companyGroup || h.systemInfo?.companyGroup || '').toUpperCase()).filter(Boolean)
  ]));

  const handleSelectWorkspace = (ws) => {
    setSelectedWorkspace(ws);
    try {
      localStorage.setItem('unio_selected_workspace', ws);
    } catch(e) {}
  };

  const handleAddWorkspace = () => {
    const input = prompt('Enter Company / Group Workspace Code (e.g. USPL, G-TECH, TECHCORP):');
    if (input && input.trim()) {
      const clean = input.trim().toUpperCase();
      if (!customWorkspaces.includes(clean)) {
        const updated = [...customWorkspaces, clean];
        setCustomWorkspaces(updated);
        try { localStorage.setItem('unio_custom_workspaces', JSON.stringify(updated)); } catch(e) {}
      }
      handleSelectWorkspace(clean);
    }
  };

  const handleReassignGroup = async (e, roomId, currentGroup) => {
    e.stopPropagation();
    const newGroup = prompt(`Assign Company / Group Code for PC (ID: ${roomId}):`, currentGroup || 'USPL');
    if (newGroup && newGroup.trim()) {
      const clean = newGroup.trim().toUpperCase();
      // Update local storage and state immediately for instant responsive UI
      setSavedDeviceGroups(prev => {
        const updated = { ...prev, [roomId]: clean };
        try { localStorage.setItem('unio_saved_device_groups', JSON.stringify(updated)); } catch(e) {}
        return updated;
      });
      if (!customWorkspaces.includes(clean)) {
        const updated = [...customWorkspaces, clean];
        setCustomWorkspaces(updated);
        try { localStorage.setItem('unio_custom_workspaces', JSON.stringify(updated)); } catch(e) {}
      }
      try {
        await fetch(`${SIGNALING_SERVER}/api/set-company-group`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, companyGroup: clean })
        });
      } catch (err) {
        console.error('Failed to update group on server:', err);
      }
    }
  };

  // Combine live active hosts from signaling server with saved recent devices
  const allTrackedDevices = Array.from(new Set([
    ...activeHosts.map(h => String(h.roomId || '').trim()).filter(Boolean),
    ...recentDevices.map(d => String(d || '').trim()).filter(Boolean)
  ])).map(id => {
    const liveHost = activeHosts.find(h => String(h.roomId || '').trim() === id);
    const isSelf = Boolean(myLocalHostCode && id === String(myLocalHostCode).trim());
    const companyGroup = (savedDeviceGroups[id] || liveHost?.companyGroup || liveHost?.systemInfo?.companyGroup || 'USPL').toUpperCase();
    if (liveHost) {
      return {
        roomId: id,
        hostname: liveHost.systemInfo?.hostname || liveHost.liveMetrics?.hostname || `Device-${id}`,
        companyGroup,
        isOnline: true,
        isSelf,
        systemInfo: liveHost.systemInfo || null,
        liveMetrics: liveHost.liveMetrics || null,
        lastSeen: 'Just Now'
      };
    }
    return {
      roomId: id,
      hostname: `Device-${id}`,
      companyGroup,
      isOnline: false,
      isSelf,
      systemInfo: null,
      liveMetrics: null,
      lastSeen: 'Offline'
    };
  });

  // Filter first by selected company workspace for multi-tenant isolation
  const workspaceDevices = allTrackedDevices.filter(device => {
    if (selectedWorkspace === 'ALL') return true;
    return (device.companyGroup || 'USPL').toUpperCase() === selectedWorkspace.toUpperCase();
  });

  const filteredDevices = workspaceDevices.filter(device => {
    if (hideSelfDevice && device.isSelf) return false;
    const hostname = String(device.hostname || '').toLowerCase();
    const q = String(searchQuery || '').toLowerCase().trim();
    const roomId = String(device.roomId || '');
    const group = String(device.companyGroup || '').toLowerCase();
    const matchesSearch = !q || hostname.includes(q) || roomId.includes(q) || group.includes(q);
    if (statusFilter === 'online') return matchesSearch && device.isOnline;
    if (statusFilter === 'offline') return matchesSearch && !device.isOnline;
    return matchesSearch;
  });

  const totalCount = workspaceDevices.length;
  const onlineCount = workspaceDevices.filter(d => d.isOnline).length;
  const onlineWithMetrics = workspaceDevices.filter(d => d.isOnline && d.liveMetrics);
  const avgCpu = onlineWithMetrics.length > 0 
    ? Math.round(onlineWithMetrics.reduce((acc, curr) => acc + (curr.liveMetrics.cpuPercent || 0), 0) / onlineWithMetrics.length) 
    : 0;
  const avgRam = onlineWithMetrics.length > 0 
    ? Math.round(onlineWithMetrics.reduce((acc, curr) => acc + (curr.liveMetrics.ramPercent || 0), 0) / onlineWithMetrics.length) 
    : 0;

  if ((!isAuthenticated || showLandingView) && status !== 'connected') {
    return (
      <div className="landing-page-root">
        {/* Ambient Glows */}
        <div className="landing-ambient-glow glow-1"></div>
        <div className="landing-ambient-glow glow-2"></div>
        <div className="landing-ambient-glow glow-3"></div>

        {/* Landing Top Navbar */}
        <header className="landing-navbar">
          <div className="landing-nav-container">
            <div className="landing-brand">
              <img src="/logo.png" alt="UnioTechIT" className="landing-brand-logo" />
              <div className="landing-brand-badge">Remote 2.0</div>
            </div>

            <nav className="landing-nav-links">
              <a href="#features" className="landing-nav-link">Features</a>
              <a href="#architecture" className="landing-nav-link">Security</a>
              <a href="#how-it-works" className="landing-nav-link">How It Works</a>
              <a href="#download" className="landing-nav-link">Download</a>
            </nav>

            <div className="landing-nav-actions">
              <div className="landing-status-pill">
                <span className={`status-dot ${isServerConnected ? 'ready' : ''}`}></span>
                <span>{isServerConnected ? 'Cloud Online' : 'Connecting...'}</span>
              </div>

              {isAuthenticated ? (
                <button 
                  className="landing-login-btn glowing-btn"
                  onClick={() => setShowLandingView(false)}
                >
                  🖥️ Open Dashboard
                </button>
              ) : (
                <button 
                  className="landing-login-btn glowing-btn"
                  onClick={() => { setLoginError(''); setShowAuthModal(true); }}
                >
                  🔐 Login / Get Started
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <section className="landing-hero-section">
          <div className="landing-hero-container">
            <div className="landing-hero-badge">
              <span className="badge-pulse-dot"></span>
              <span>⚡ Next-Generation Web-Based RMM & Remote Desktop</span>
            </div>

            <h1 className="landing-hero-title">
              Enterprise Remote Desktop & Fleet Control,{' '}
              <span className="hero-gradient-text">Zero Installation for Admins.</span>
            </h1>

            <p className="landing-hero-subtitle">
              Control, diagnose, and maintain Windows endpoints in real-time. Native 60 FPS WebRTC streaming, silent remote PowerShell terminal, 64KB chunked file transfers, and isolated multi-tenant company workspaces.
            </p>

            <div className="landing-hero-cta-group">
              {isAuthenticated ? (
                <button 
                  className="hero-primary-btn"
                  onClick={() => setShowLandingView(false)}
                >
                  <span>🖥️ Launch Central Console</span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                  </svg>
                </button>
              ) : (
                <button 
                  className="hero-primary-btn"
                  onClick={() => { setLoginError(''); setShowAuthModal(true); }}
                >
                  <span>🔐 Get Started / Admin Login</span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                  </svg>
                </button>
              )}

              <a href="/UnioTechIT-Setup.exe" className="hero-secondary-btn" download="UnioTechIT-Setup.exe">
                <span>📥 Download Host Agent (.exe)</span>
                <span className="btn-sub-tag">v1.0.0</span>
              </a>
            </div>

            {/* Hero Visual Preview with Floating Badges */}
            <div className="landing-hero-preview-wrapper">
              <div className="hero-preview-glass-frame">
                <img 
                  src="/hero_banner.jpg" 
                  alt="UnioTechIT Remote Desktop Hologram Dashboard" 
                  className="hero-preview-img"
                />
                <div className="hero-preview-overlay-gradient"></div>

                {/* Floating Live Tech Badges */}
                <div className="hero-floating-badge badge-top-left">
                  <span className="badge-icon">⚡</span>
                  <div>
                    <strong>&lt; 15ms Latency</strong>
                    <small>Direct WebRTC DataChannel</small>
                  </div>
                </div>

                <div className="hero-floating-badge badge-top-right">
                  <span className="badge-icon">🛡️</span>
                  <div>
                    <strong>256-Bit E2EE</strong>
                    <small>Cryptographic Signed Tokens</small>
                  </div>
                </div>

                <div className="hero-floating-badge badge-bottom-left">
                  <span className="badge-icon">📊</span>
                  <div>
                    <strong>Live Fleet Telemetry</strong>
                    <small>CPU, RAM & Network Graphs</small>
                  </div>
                </div>

                <div className="hero-floating-badge badge-bottom-right">
                  <span className="badge-icon">🏢</span>
                  <div>
                    <strong>Multi-Tenant Isolation</strong>
                    <small>Company Workspaces</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Platform Specs Ribbon */}
        <section className="landing-stats-ribbon">
          <div className="stats-container">
            <div className="stat-card">
              <div className="stat-value">60 FPS</div>
              <div className="stat-label">Native Screen Refresh</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">&lt; 15ms</div>
              <div className="stat-label">Ultra-Low Glass Latency</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">64 KB</div>
              <div className="stat-label">Chunked P2P File Stream</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">100%</div>
              <div className="stat-label">Web-Based Controller</div>
            </div>
          </div>
        </section>

        {/* Features Grid Section */}
        <section id="features" className="landing-features-section">
          <div className="section-header">
            <span className="section-kicker">Core Capabilities</span>
            <h2 className="section-title">Built for Modern IT Admins & Support Teams</h2>
            <p className="section-subtitle">Everything you need to troubleshoot, control, and maintain remote Windows PCs from a single browser tab.</p>
          </div>

          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>🖥️</div>
              <h3 className="feature-title">Ultra-Low Latency Canvas</h3>
              <p className="feature-desc">Edge-to-edge desktop streaming with native C# hardware mouse & keyboard simulation, multi-monitor switching, and game-window support.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(129, 140, 248, 0.15)', color: '#818cf8' }}>💻</div>
              <h3 className="feature-title">Silent Remote Terminal</h3>
              <p className="feature-desc">Run PowerShell and CMD commands silently in the background with diagnostic presets (ipconfig, ping, flushdns, tasklist).</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(52, 211, 153, 0.15)', color: '#34d399' }}>📁</div>
              <h3 className="feature-title">Dual-Mode File Explorer</h3>
              <p className="feature-desc">Explore remote drive letters, breadcrumb navigation, search filters, 1-click chunked download to Admin PC, and folder upload.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(251, 146, 60, 0.15)', color: '#fb923c' }}>📊</div>
              <h3 className="feature-title">Live Health & Telemetry</h3>
              <p className="feature-desc">Real-time charts for CPU%, RAM%, disk space, upload/download network speed, and battery monitoring with zero overhead.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#a855f7' }}>🏢</div>
              <h3 className="feature-title">Multi-Tenant Workspaces</h3>
              <p className="feature-desc">Isolate fleet devices into company workspaces (USPL, Branch-1, Client-A) with real-time online counters and 1-click filtering.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(244, 63, 94, 0.15)', color: '#f43f5e' }}>✏️</div>
              <h3 className="feature-title">Annotations & Remote Reboot</h3>
              <p className="feature-desc">Draw on the live screen with laser pointers, arrows, and shapes, plus trigger remote reboot with zero-click auto-reconnect.</p>
            </div>
          </div>
        </section>

        {/* Architecture & Security Section */}
        <section id="architecture" className="landing-arch-section">
          <div className="arch-card-glass">
            <div className="arch-text-content">
              <span className="section-kicker">Security Architecture</span>
              <h2 className="section-title" style={{ textAlign: 'left', margin: '10px 0' }}>Enterprise Security & Cryptographic Access</h2>
              <p className="section-subtitle" style={{ textAlign: 'left', margin: '0 0 20px 0' }}>
                Built on WebRTC native peer-to-peer data channels with TLS encryption and stateless HMAC-SHA256 authenticated session tokens.
              </p>
              <ul className="arch-checklist">
                <li>🛡️ <strong>HMAC-SHA256 Token Signing:</strong> Secure admin gateway authentication with tamper protection.</li>
                <li>🔒 <strong>Direct WebRTC DataChannels:</strong> Peer-to-peer data transport bypassing intermediate third-party relays.</li>
                <li>⚡ <strong>Auto-Elevated Background Agent:</strong> Windows Task Scheduler auto-start for permanent 24/7 access.</li>
              </ul>
            </div>
            <div className="arch-stats-box">
              <div className="arch-stat-pill">
                <span className="pill-dot"></span>
                <span>24/7 Cloud Signaling Active</span>
              </div>
              <div className="arch-node-counter">
                <strong>{activeHosts.length}</strong>
                <span>Active Machines Online Now</span>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="landing-how-section">
          <div className="section-header">
            <span className="section-kicker">Quick Setup</span>
            <h2 className="section-title">Get Started in 3 Simple Steps</h2>
          </div>

          <div className="steps-container">
            <div className="step-card">
              <div className="step-num">01</div>
              <h3 className="step-title">Install Agent on Host PC</h3>
              <p className="step-desc">Download and run <code>UnioTechIT Setup.exe</code> on the remote Windows computer. It assigns an instant 6-digit node code.</p>
            </div>

            <div className="step-card">
              <div className="step-num">02</div>
              <h3 className="step-title">Assign Company Group</h3>
              <p className="step-desc">Optionally set a company workspace code (e.g. <code>USPL</code>, <code>BRANCH-1</code>) to organize your fleet.</p>
            </div>

            <div className="step-card">
              <div className="step-num">03</div>
              <h3 className="step-title">1-Click Control from Web</h3>
              <p className="step-desc">Log into the Web Console from any browser to view live telemetry, access file manager, or start 60 FPS remote control.</p>
            </div>
          </div>
        </section>

        {/* Direct Download Section */}
        <section id="download" className="landing-download-section">
          <div className="download-box-glass">
            <h2 className="download-title">Download UnioTechIT Windows Agent</h2>
            <p className="download-desc">Supported on Windows 10, Windows 11, and Windows Server (64-bit). No license keys required.</p>
            
            <div className="download-buttons-group">
              <a href="/UnioTechIT-Setup.exe" className="download-action-card" download="UnioTechIT-Setup.exe">
                <div className="dl-icon">⚡</div>
                <div className="dl-info">
                  <strong>Standalone Windows Setup (.exe)</strong>
                  <small>Recommended • 1-Click Installer (Auto Desktop Shortcut)</small>
                </div>
                <span className="dl-arrow">⬇️</span>
              </a>

              <a href="/download" className="download-action-card" download="UnioTechIT-Setup.zip">
                <div className="dl-icon">📦</div>
                <div className="dl-info">
                  <strong>Portable ZIP Package (.zip)</strong>
                  <small>Portable executable package for USB / network deployment</small>
                </div>
                <span className="dl-arrow">⬇️</span>
              </a>
            </div>
          </div>
        </section>

        {/* Landing Footer */}
        <footer className="landing-footer">
          <div className="footer-content">
            <div className="footer-brand">
              <img src="/logo.png" alt="UnioTechIT" style={{ height: '32px' }} />
              <p>UnioTechIT Remote Desktop — Enterprise Remote Support & RMM Platform.</p>
            </div>
            <div className="footer-links">
              <a href="https://github.com/aurav2001/Remote-Project" target="_blank" rel="noreferrer">GitHub Repository</a>
              <a href="https://remoteg-all-in-one-production-6122.up.railway.app/download">Download Host Agent</a>
              <button 
                className="footer-login-link"
                onClick={() => { setLoginError(''); setShowAuthModal(true); }}
              >
                Admin Console Login
              </button>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 UnioTechIT Systems. All Rights Reserved.</span>
          </div>
        </footer>

        {/* Glassmorphism Login Modal */}
        {showAuthModal && (
          <div className="auth-modal-overlay" onClick={() => setShowAuthModal(false)}>
            <div className={`auth-card-glass ${loginShake ? 'shake-anim' : ''}`} onClick={e => e.stopPropagation()}>
              <button className="auth-modal-close-btn" onClick={() => setShowAuthModal(false)} title="Close">✕</button>
              
              {/* Brand & Security Header */}
              <div className="auth-header">
                <div className="auth-logo-badge">
                  <img src="/logo.png" alt="UnioTechIT Logo" className="auth-logo-img" />
                  <div className="auth-security-icon-glow">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                      <path d="M9 12l2 2 4-4"/>
                    </svg>
                  </div>
                </div>
                <h1 className="auth-title">Admin Console Login</h1>
                <p className="auth-subtitle">Sign in to manage active remote devices & sessions</p>
              </div>

              {/* Error Notification */}
              {loginError && (
                <div className="auth-error-banner">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span>{loginError}</span>
                </div>
              )}

              {/* Login Form */}
              <form onSubmit={handleLogin} className="auth-form">
                <div className="auth-field-group">
                  <label className="auth-label">Administrator ID / Username</label>
                  <div className="auth-input-wrapper">
                    <svg className="auth-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    <input
                      type="text"
                      className="auth-input"
                      placeholder="Enter admin username"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>
                </div>

                <div className="auth-field-group">
                  <div className="auth-label-row">
                    <label className="auth-label">Security Master Password</label>
                  </div>
                  <div className="auth-input-wrapper">
                    <svg className="auth-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    <input
                      type={showPassword ? "text" : "password"}
                      className="auth-input"
                      placeholder="Enter master password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="auth-eye-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? "👁️" : "🔒"}
                    </button>
                  </div>
                </div>

                <div className="auth-options-row">
                  <label className="auth-checkbox-label">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="auth-checkbox"
                    />
                    <span>Remember Session (7 Days)</span>
                  </label>
                </div>

                <button
                  type="submit"
                  className="auth-submit-btn"
                  disabled={isLoggingIn}
                >
                  {isLoggingIn ? (
                    <span className="auth-loading-state">
                      <span className="auth-spinner"></span>
                      <span>Authenticating Gateway...</span>
                    </span>
                  ) : (
                    <span className="auth-btn-content">
                      <span>🔐 Authenticate & Enter Console</span>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                      </svg>
                    </span>
                  )}
                </button>
              </form>

              {/* Quick Credentials Preset Helper */}
              <div className="auth-quick-hint">
                <div className="auth-hint-header">
                  <span>⚡ Default Master Credentials:</span>
                  <button
                    type="button"
                    className="auth-autofill-btn"
                    onClick={() => {
                      setLoginUsername('admin');
                      setLoginPassword('admin123');
                      setLoginError('');
                    }}
                  >
                    1-Click Auto Fill
                  </button>
                </div>
                <div className="auth-creds-preview">
                  <code>User: <strong>admin</strong></code>
                  <code>Pass: <strong>admin123</strong></code>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="dashboard-root" style={{ display: status === 'connected' ? 'none' : 'block' }}>
          {/* Top Navbar Header */}
          <div className="dashboard-nav">
            <div className="dashboard-brand" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img src="/logo.png" alt="UnioTechIT Logo" style={{ height: '38px', maxWidth: '160px', objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(56, 189, 248, 0.4))' }} />
              <div>
                <h2 style={{ margin: 0, fontSize: '1.2rem', background: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>UnioTechIT Central Portal</h2>
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

            <div className="dashboard-nav-right" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: isServerConnected ? '#34d399' : '#f87171' }}>
                <span className={`status-dot ${isServerConnected ? 'ready' : ''}`} style={{ width: '8px', height: '8px' }}></span>
                <span>{isServerConnected ? 'Cloud Online' : 'Connecting...'}</span>
              </div>

              {/* Logged-in Admin Badge & User Actions */}
              <div className="admin-nav-profile-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  className="tab-btn"
                  style={{ padding: '5px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '5px' }}
                  onClick={() => setShowLandingView(true)}
                  title="View Public Landing Website"
                >
                  <span>🌐</span>
                  <span>Landing Page</span>
                </button>

                <button
                  className="admin-badge-pill-btn"
                  onClick={() => {
                    setChangePassError('');
                    setChangePassSuccess('');
                    setCurrentPassInput('');
                    setNewPassInput('');
                    setConfirmPassInput('');
                    setShowChangePassModal(true);
                  }}
                  title="Click to Change Admin Password"
                >
                  <span className="admin-avatar-icon">🛡️</span>
                  <span className="admin-username-label">{currentUser?.username || 'admin'}</span>
                  <span className="admin-tag-badge">Admin</span>
                </button>

                <button
                  className="admin-logout-nav-btn"
                  onClick={() => handleLogout(true)}
                  title="Sign Out of Admin Console"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                  </svg>
                  <span>Logout</span>
                </button>
              </div>
            </div>
          </div>

          {/* Main View Area */}
          {activeTab === 'dashboard' ? (
            <div className="dashboard-content">

              {/* Company / Organization Workspace Ribbon */}
              <div className="workspace-selector-ribbon">
                <div className="workspace-ribbon-header">
                  <span className="workspace-ribbon-title">🏢 Company Workspace Filter:</span>
                  <span className="workspace-ribbon-subtitle">
                    {selectedWorkspace === 'ALL'
                      ? 'Viewing all connected companies (Admin Mode)'
                      : `Active Isolated Workspace: ${selectedWorkspace}`}
                  </span>
                </div>

                <div className="workspace-pills-list">
                  {allDetectedWorkspaces.map(ws => {
                    const isSelected = selectedWorkspace === ws;
                    const count = ws === 'ALL' 
                      ? allTrackedDevices.length 
                      : allTrackedDevices.filter(d => (d.companyGroup || 'USPL').toUpperCase() === ws).length;
                    const onlineWs = ws === 'ALL'
                      ? allTrackedDevices.filter(d => d.isOnline).length
                      : allTrackedDevices.filter(d => (d.companyGroup || 'USPL').toUpperCase() === ws && d.isOnline).length;
                    
                    return (
                      <button
                        key={ws}
                        className={`workspace-pill-btn ${isSelected ? 'active' : ''}`}
                        onClick={() => handleSelectWorkspace(ws)}
                      >
                        <span className="ws-pill-name">{ws === 'ALL' ? '🌐 All Companies' : `🏢 ${ws}`}</span>
                        <span className="ws-counter-badge" style={{
                          background: onlineWs > 0 ? 'rgba(52, 211, 153, 0.25)' : 'rgba(255, 255, 255, 0.12)',
                          color: onlineWs > 0 ? '#34d399' : '#94a3b8'
                        }}>
                          {onlineWs > 0 ? `${onlineWs} Live` : `${count}`}
                        </span>
                      </button>
                    );
                  })}

                  <button
                    className="workspace-add-btn"
                    onClick={handleAddWorkspace}
                    title="Filter or register another Company Workspace Code"
                  >
                    ➕ Add / Switch Group
                  </button>
                </div>
              </div>

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
                    placeholder="Search machines by Hostname, ID, Company, or OS..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Workspace Dropdown for compact filtering */}
                  <select
                    value={selectedWorkspace}
                    onChange={(e) => handleSelectWorkspace(e.target.value)}
                    className="filter-select workspace-select"
                  >
                    {allDetectedWorkspaces.map(ws => (
                      <option key={ws} value={ws}>
                        {ws === 'ALL' ? '🌐 All Companies' : `🏢 Company: ${ws}`}
                      </option>
                    ))}
                  </select>

                  {myLocalHostCode ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#94a3b8', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <input 
                        type="checkbox" 
                        checked={hideSelfDevice} 
                        onChange={(e) => setHideSelfDevice(e.target.checked)} 
                        style={{ cursor: 'pointer' }}
                      />
                      <span>Hide My PC ({myLocalHostCode})</span>
                    </label>
                  ) : (
                    <button
                      onClick={() => {
                        const code = prompt('Enter your 6-digit Host PC Access Code to exclude this machine from remote control list:');
                        if (code && code.trim().length === 6) {
                          const cleanCode = code.trim();
                          setMyLocalHostCode(cleanCode);
                          try { localStorage.setItem('unio_my_host_code', cleanCode); } catch(e) {}
                        }
                      }}
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8', padding: '6px 12px', borderRadius: '8px', fontSize: '0.8rem', cursor: 'pointer' }}
                      title="Set your local Host Code so you don't connect to your own machine"
                    >
                      🛡️ Set My PC ID
                    </button>
                  )}

                  <select 
                    value={statusFilter} 
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="filter-select"
                  >
                    <option value="all">All Status ({totalCount})</option>
                    <option value="online">Online Only ({onlineCount})</option>
                    <option value="offline">Offline Only ({totalCount - onlineCount})</option>
                  </select>
                </div>
              </div>

              {/* Devices Card Grid */}
              <div className="devices-card-grid">
                {filteredDevices.length === 0 ? (
                  <div style={{ gridColumn: '1 / -1', padding: '40px 20px', textAlign: 'center', background: 'rgba(0,0,0,0.2)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '16px', color: '#94a3b8' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🏢</div>
                    <h3 style={{ margin: '0 0 6px 0', color: '#f8fafc' }}>No PC nodes found in "{selectedWorkspace}" workspace</h3>
                    <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem' }}>Switch workspace above or set your Host Agent to group code "{selectedWorkspace}"</p>
                    <button
                      onClick={() => handleSelectWorkspace('ALL')}
                      style={{ background: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '100px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      🌐 Show All Workspaces
                    </button>
                  </div>
                ) : filteredDevices.map(device => (
                  <div key={device.roomId} className="device-node-card">
                    <div>
                      {/* Company Workspace Tag & Self indicator Bar */}
                      <div className="node-company-row">
                        <div
                          onClick={(e) => handleReassignGroup(e, device.roomId, device.companyGroup)}
                          className="node-company-tag"
                          title="Click to edit or reassign company group"
                        >
                          <span className="company-tag-icon">🏢</span>
                          <span className="company-tag-label">{device.companyGroup || 'USPL'}</span>
                          <span className="company-tag-edit">✏️ Edit</span>
                        </div>

                        {device.isSelf && (
                          <span className="node-self-badge">
                            🛡️ This Machine
                          </span>
                        )}
                      </div>

                      <div className="node-card-header">
                        <div className="node-title-group" style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
                          <span className="node-icon">💻</span>
                          <div style={{ minWidth: 0, overflow: 'hidden' }}>
                            <h3 className="node-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.hostname}</h3>
                            <span className="node-code">ID: {device.roomId}</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
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
                        {(() => {
                          const wanIp = cachedDeviceWanIps[device.roomId] 
                            || (device.systemInfo?.publicIp && device.systemInfo.publicIp !== 'N/A' && !device.systemInfo.publicIp.includes('127.0.0.1') ? device.systemInfo.publicIp : null)
                            || (device.liveMetrics?.publicIp && device.liveMetrics.publicIp !== 'N/A' && !device.liveMetrics.publicIp.includes('127.0.0.1') ? device.liveMetrics.publicIp : null);
                          const lanIp = (device.systemInfo?.ip && device.systemInfo.ip !== '127.0.0.1')
                            ? device.systemInfo.ip
                            : (device.liveMetrics?.ip && device.liveMetrics.ip !== '127.0.0.1' ? device.liveMetrics.ip : '10.5.49.56');
                          return (
                            <div style={{ color: '#a5b4fc', fontSize: '0.74rem' }}>
                              {wanIp ? <>🌐 WAN: <span style={{ color: '#34d399' }}>{wanIp}</span> • </> : null}
                              <span>LAN: {lanIp}</span>
                            </div>
                          );
                        })()}
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
                        {device.isSelf
                          ? '⚡ Connect (This PC)'
                          : '⚡ 1-Click Connect'}
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
                <div className="card-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  <img src="/logo.png" alt="UnioTechIT Logo" style={{ height: '65px', maxWidth: '240px', objectFit: 'contain', filter: 'drop-shadow(0 4px 16px rgba(56, 189, 248, 0.4))', marginBottom: '4px' }} />
                  <h1 style={{ margin: 0, background: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>UnioTechIT Control</h1>
                  <p style={{ margin: 0 }}>Connect to a Remote System Node</p>
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
                    <button
                      onClick={handleDownloadSetup}
                      disabled={isDownloading}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: isDownloading
                          ? 'rgba(16, 185, 129, 0.4)'
                          : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        color: '#fff',
                        padding: '8px 16px',
                        borderRadius: '100px',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        border: 'none',
                        cursor: isDownloading ? 'not-allowed' : 'pointer',
                        boxShadow: isDownloading ? 'none' : '0 4px 12px rgba(16, 185, 129, 0.3)',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      {isDownloading ? '⏳ Starting Download...' : '📥 Download Setup (72 MB .zip)'}
                    </button>

                    <button
                      onClick={() => {
                        const downloadUrl = GITHUB_DOWNLOAD_URL;
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

      <div className="viewer-layout" style={{ display: (status === 'connected' || status === 'ready') ? 'flex' : 'none' }}>
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

                <button
                  onClick={() => {
                    setShowFileExplorerDrawer(prev => {
                      const next = !prev;
                      if (next && (!remoteFiles || remoteFiles.length === 0)) {
                        requestRemoteDirectory('', true);
                      }
                      return next;
                    });
                  }}
                  className={`control-btn btn-files ${showFileExplorerDrawer ? 'active' : ''}`}
                  title="Browse & Download Files from Target PC (Remote File Explorer)"
                >
                  📁 Files {activeDownloadTransfer ? '⬇️' : ''}
                </button>

                <button
                  onClick={() => setIsAnnotating(prev => !prev)}
                  className={`control-btn btn-annotate ${isAnnotating ? 'active' : ''}`}
                  title="Toggle Screen Annotation & Laser Pointer Tool"
                >
                  ✏️ Annotate
                </button>

                {/* Multi-Monitor Dual/Triple Display Switcher */}
                <div className="screens-dropdown-wrapper">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowScreenDropdown(prev => !prev);
                    }}
                    className={`control-btn btn-screen-switch ${showScreenDropdown ? 'active' : ''}`}
                    title="View and Switch Connected Displays (Multi-Monitor)"
                  >
                    🖥️ {availableScreens.length > 1 ? `Displays (${availableScreens.length})` : 'Display (1)'}
                    <span style={{ fontSize: '0.65rem', opacity: 0.85, marginLeft: 4 }}>▼</span>
                  </button>

                  {showScreenDropdown && (
                    <div className="screens-dropdown-menu">
                      <div className="screens-dropdown-header">
                        <span>CONNECTED MONITORS ({availableScreens.length || 1})</span>
                      </div>
                      {(availableScreens.length > 0 ? availableScreens : [{ id: 'screen:0:0', label: 'Monitor 1 (Primary)', name: 'Main Display', isPrimary: true, bounds: { width: 1920, height: 1080 } }]).map(scr => {
                        const isSelected = scr.id === currentScreenId || availableScreens.length <= 1;
                        return (
                          <button
                            key={scr.id}
                            onClick={() => handleSwitchScreen(scr.id)}
                            className={`screen-dropdown-item ${isSelected ? 'active' : ''}`}
                          >
                            <div className="screen-item-icon">
                              🖥️
                            </div>
                            <div className="screen-item-info">
                              <span className="screen-item-title">
                                {scr.label || scr.name}
                              </span>
                              <span className="screen-item-res">
                                {scr.bounds ? `${scr.bounds.width}×${scr.bounds.height}` : '1920×1080'}
                                {scr.isPrimary ? ' • Main Display' : ''}
                              </span>
                            </div>
                            {isSelected && <span className="screen-selected-badge">✓ Active</span>}
                          </button>
                        );
                      })}

                      {availableScreens.length <= 1 && (
                        <div style={{
                          padding: '8px 10px',
                          fontSize: '0.72rem',
                          color: '#94a3b8',
                          background: 'rgba(255, 255, 255, 0.03)',
                          borderRadius: '8px',
                          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                          lineHeight: 1.4
                        }}>
                          💡 <strong style={{ color: '#38bdf8' }}>Dual Screen Ready:</strong> When target PC connects a 2nd monitor or HDMI, it will appear here for instant 1-click switching.
                        </div>
                      )}
                    </div>
                  )}
                </div>

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
                        onClick={() => {
                          sendControlData({ type: 'minimize-host' });
                          setShowToolsDropdown(false);
                        }} 
                        className="dropdown-item"
                        title="Force-minimize the Host Agent window on the remote machine"
                      >
                        <span className="dropdown-icon">🗕</span>
                        <div>
                          <strong>Minimize Host Window</strong>
                          <small>Hide Agent to Taskbar</small>
                        </div>
                      </button>

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
                          if (fileInputRef.current) fileInputRef.current.click();
                          setShowToolsDropdown(false); 
                        }} 
                        className="dropdown-item"
                      >
                        <span className="dropdown-icon">📁</span>
                        <div>
                          <strong>Transfer File</strong>
                          <small>Upload file to remote Downloads</small>
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

                      <div className="dropdown-divider" style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }}></div>

                      <button 
                        onClick={() => {
                          setShowToolsDropdown(false);
                          setShowRebootModal(true);
                        }} 
                        className="dropdown-item reboot-action-item"
                        style={{ color: '#f87171' }}
                        title="Safely restart the remote machine and auto-reconnect on boot"
                      >
                        <span className="dropdown-icon">🔄</span>
                        <div>
                          <strong style={{ color: '#fca5a5' }}>Remote Reboot PC</strong>
                          <small style={{ color: '#f87171' }}>Restart & Auto-Reconnect</small>
                        </div>
                      </button>
                    </div>
                  )}
                </div>

                <button className="btn-disconnect" onClick={cleanup}>
                  Terminate Session
                </button>
              </div>
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
                  UnioTechIT Silent Background Shell [{shellType.toUpperCase()}] connected.<br />
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

          {/* Remote File Explorer & 1-Click Downloader Drawer */}
          {showFileExplorerDrawer && (
            <div className="file-explorer-drawer">
              {/* Drawer Header */}
              <div className="drawer-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.25rem' }}>📁</span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      Remote File Explorer
                    </h3>
                    <span style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                      Target: <strong style={{ color: '#f8fafc' }}>{hostSystemInfo?.hostname || 'Host PC'}</strong> • Browse files & 1-Click Download to your PC
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button 
                    onClick={() => requestRemoteDirectory(remoteCurrentPath, true)} 
                    className="btn-clear-logs" 
                    title="Refresh Current Folder"
                    disabled={isLoadingRemoteFiles}
                  >
                    🔄 Refresh
                  </button>
                  <button 
                    onClick={() => explorerFileInputRef.current?.click()} 
                    className="btn-upload-folder" 
                    title="Upload File into Current Folder"
                  >
                    ⬆️ Upload Here
                  </button>
                  <input
                    type="file"
                    ref={explorerFileInputRef}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        sendFile(e.target.files[0], remoteCurrentPath);
                        e.target.value = '';
                      }
                    }}
                  />
                  <button onClick={() => setShowFileExplorerDrawer(false)} className="drawer-close-btn">✕</button>
                </div>
              </div>

              {/* Quick Access Drives & Common Folders */}
              <div className="explorer-quick-bar">
                <span className="explorer-quick-label">💽 Drives:</span>
                <div className="explorer-drives-list">
                  {remoteDrives.map(d => (
                    <button
                      key={d}
                      onClick={() => requestRemoteDirectory(d)}
                      className={`drive-chip-btn ${remoteCurrentPath.startsWith(d) ? 'active' : ''}`}
                      title={`Open Drive ${d}`}
                    >
                      💽 {d}
                    </button>
                  ))}
                </div>

                <div className="explorer-quick-divider" />

                <span className="explorer-quick-label">⚡ Shortcuts:</span>
                <div className="explorer-shortcuts-list">
                  {remoteQuickPaths.map(q => (
                    <button
                      key={q.label}
                      onClick={() => requestRemoteDirectory(q.path)}
                      className={`shortcut-chip-btn ${remoteCurrentPath === q.path ? 'active' : ''}`}
                      title={`Go to ${q.label}`}
                    >
                      {q.icon} {q.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Path & Search Navigation Bar */}
              <div className="explorer-nav-bar">
                <button
                  onClick={() => remoteParentPath && requestRemoteDirectory(remoteParentPath)}
                  disabled={!remoteParentPath || isLoadingRemoteFiles}
                  className="btn-nav-up"
                  title="Go to Parent Directory (Up 1 Level)"
                >
                  ⬆️ Up
                </button>

                <div className="explorer-path-input-group">
                  <span className="path-icon">📂</span>
                  <input
                    type="text"
                    value={pathInputValue}
                    onChange={(e) => setPathInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && pathInputValue.trim()) {
                        requestRemoteDirectory(pathInputValue.trim());
                      }
                    }}
                    placeholder="Enter absolute directory path (e.g. C:\Users\Admin\Desktop)..."
                    className="explorer-path-input"
                  />
                  <button
                    onClick={() => pathInputValue.trim() && requestRemoteDirectory(pathInputValue.trim())}
                    className="btn-path-go"
                    title="Navigate to Path"
                  >
                    Go ➔
                  </button>
                </div>

                <div className="explorer-search-group">
                  <span className="search-icon">🔍</span>
                  <input
                    type="text"
                    value={fileSearchQuery}
                    onChange={(e) => setFileSearchQuery(e.target.value)}
                    placeholder="Search in this folder..."
                    className="explorer-search-input"
                  />
                  {fileSearchQuery && (
                    <button onClick={() => setFileSearchQuery('')} className="btn-search-clear">✕</button>
                  )}
                </div>
              </div>

              {/* Active Download Progress Banner */}
              {activeDownloadTransfer && (
                <div className="explorer-download-banner">
                  <div className="download-banner-info">
                    <span className="download-banner-title">
                      ⬇️ Downloading: <strong>{activeDownloadTransfer.fileName}</strong>
                    </span>
                    <span className="download-banner-stats">
                      {activeDownloadTransfer.receivedFormatted} / {activeDownloadTransfer.totalFormatted} ({activeDownloadTransfer.speed}) • {activeDownloadTransfer.progress}%
                    </span>
                  </div>
                  <div className="download-banner-progress-track">
                    <div
                      className="download-banner-progress-fill"
                      style={{ width: `${activeDownloadTransfer.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* File List Content Table */}
              <div 
                className="explorer-files-container"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    sendFile(e.dataTransfer.files[0], remoteCurrentPath);
                  }
                }}
              >
                {isLoadingRemoteFiles ? (
                  <div className="explorer-loading-state">
                    <div className="spinner"></div>
                    <p>Fetching remote directory contents...</p>
                  </div>
                ) : (
                  <table className="explorer-table">
                    <thead>
                      <tr>
                        <th style={{ width: '45%' }}>Name</th>
                        <th style={{ width: '15%' }}>Size</th>
                        <th style={{ width: '25%' }}>Modified Date</th>
                        <th style={{ width: '15%', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {remoteFiles
                        .filter(f => !fileSearchQuery || f.name.toLowerCase().includes(fileSearchQuery.toLowerCase()))
                        .map(item => {
                          const ext = (item.ext || '').toLowerCase();
                          let icon = '📄';
                          if (item.isDirectory) icon = '📁';
                          else if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)) icon = '🖼️';
                          else if (['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv'].includes(ext)) icon = '🎬';
                          else if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'].includes(ext)) icon = '🎵';
                          else if (['.pdf'].includes(ext)) icon = '📕';
                          else if (['.zip', '.rar', '.7z', '.tar', '.gz', '.iso'].includes(ext)) icon = '📦';
                          else if (['.exe', '.msi', '.bat', '.cmd', '.ps1'].includes(ext)) icon = '⚙️';
                          else if (['.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.json', '.py', '.c', '.cpp', '.cs', '.java', '.php'].includes(ext)) icon = '💻';
                          else if (['.doc', '.docx'].includes(ext)) icon = '📘';
                          else if (['.xls', '.xlsx', '.csv'].includes(ext)) icon = '📊';
                          else if (['.ppt', '.pptx'].includes(ext)) icon = '📙';
                          else if (['.txt', '.log', '.md', '.ini', '.cfg'].includes(ext)) icon = '📄';

                          const isDownloadingThis = activeDownloadTransfer && activeDownloadTransfer.fileName === item.name && !activeDownloadTransfer.isComplete;

                          return (
                            <tr 
                              key={item.path} 
                              className={`explorer-row ${item.isDirectory ? 'is-dir' : 'is-file'}`}
                              onDoubleClick={() => {
                                if (item.isDirectory) requestRemoteDirectory(item.path);
                                else requestDownloadRemoteFile(item.path, item.name);
                              }}
                            >
                              <td className="explorer-cell-name">
                                <span className="item-icon">{icon}</span>
                                <span 
                                  className="item-label" 
                                  onClick={() => item.isDirectory && requestRemoteDirectory(item.path)}
                                  title={item.name}
                                >
                                  {item.name}
                                </span>
                              </td>
                              <td className="explorer-cell-size">{item.sizeFormatted}</td>
                              <td className="explorer-cell-date">
                                {item.mtime ? new Date(item.mtime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '--'}
                              </td>
                              <td className="explorer-cell-actions">
                                {item.isDirectory ? (
                                  <button
                                    onClick={() => requestRemoteDirectory(item.path)}
                                    className="btn-item-open"
                                    title="Open Folder"
                                  >
                                    Open ➔
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => requestDownloadRemoteFile(item.path, item.name)}
                                    disabled={Boolean(isDownloadingThis)}
                                    className="btn-item-download"
                                    title="Download this file to your Admin PC"
                                  >
                                    {isDownloadingThis ? (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                        <span className="spinner-sm"></span> {activeDownloadTransfer.progress}%
                                      </span>
                                    ) : (
                                      '⬇️ Download'
                                    )}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}

                      {remoteFiles.length === 0 && !isLoadingRemoteFiles && (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
                            <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>📂</div>
                            <p style={{ margin: 0, fontSize: '0.9rem' }}>This directory is empty or inaccessible.</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
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

          {/* Hidden File Input for Actions Menu Upload */}
          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                sendFile(e.target.files[0]);
                e.target.value = '';
              }
            }} 
          />

          {/* Floating Glassmorphic Annotation Toolbar */}
          {isAnnotating && (
            <div className="annotation-toolbar">
              <div className="annotation-toolbar-group">
                <button
                  onClick={() => setAnnotationTool('laser')}
                  className={`annotate-tool-btn ${annotationTool === 'laser' ? 'active' : ''}`}
                  title="Laser Pointer (Smooth glowing pointer with no permanent mark)"
                >
                  🔴 Laser
                </button>
                <button
                  onClick={() => setAnnotationTool('pen')}
                  className={`annotate-tool-btn ${annotationTool === 'pen' ? 'active' : ''}`}
                  title="Pen (Freehand Drawing)"
                >
                  ✏️ Pen
                </button>
                <button
                  onClick={() => setAnnotationTool('arrow')}
                  className={`annotate-tool-btn ${annotationTool === 'arrow' ? 'active' : ''}`}
                  title="Arrow Pointer (Point to specific buttons or areas)"
                >
                  ↗️ Arrow
                </button>
                <button
                  onClick={() => setAnnotationTool('rect')}
                  className={`annotate-tool-btn ${annotationTool === 'rect' ? 'active' : ''}`}
                  title="Rectangle Box (Highlight sections)"
                >
                  🔲 Box
                </button>
                <button
                  onClick={() => setAnnotationTool('highlighter')}
                  className={`annotate-tool-btn ${annotationTool === 'highlighter' ? 'active' : ''}`}
                  title="Translucent Highlighter"
                >
                  🖍️ Highlight
                </button>
              </div>

              <div className="annotation-divider" />

              {/* Color Palette */}
              <div className="annotation-toolbar-group color-swatch-list">
                {['#ef4444', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#ffffff'].map(c => (
                  <button
                    key={c}
                    className={`color-swatch ${annotationColor === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setAnnotationColor(c)}
                    title={`Color: ${c}`}
                  />
                ))}
              </div>

              <div className="annotation-divider" />

              {/* Stroke Sizes */}
              <div className="annotation-toolbar-group">
                {[2, 4, 8].map(s => (
                  <button
                    key={s}
                    className={`size-select-btn ${annotationSize === s ? 'active' : ''}`}
                    onClick={() => setAnnotationSize(s)}
                    title={`Stroke: ${s}px`}
                  >
                    {s === 2 ? 'Thin' : s === 4 ? 'Med' : 'Thick'}
                  </button>
                ))}
              </div>

              <div className="annotation-divider" />

              {/* Actions: Undo, Clear, Screenshot, Close */}
              <div className="annotation-toolbar-group">
                <button
                  onClick={() => setAnnotations(prev => prev.slice(0, -1))}
                  className="btn-annotate-action"
                  disabled={annotations.length === 0}
                  title="Undo last drawing"
                >
                  ↩️ Undo
                </button>
                <button
                  onClick={() => {
                    setAnnotations([]);
                    sendControlData({
                      type: 'annotation-event',
                      payload: { type: 'clear' }
                    });
                  }}
                  className="btn-annotate-action danger"
                  disabled={annotations.length === 0}
                  title="Clear all drawings"
                >
                  🧹 Clear
                </button>
                <button
                  onClick={handleCaptureScreenshot}
                  className="btn-annotate-action"
                  title="Download Screenshot with Drawings"
                >
                  📸 Save
                </button>
                <button
                  onClick={() => setIsAnnotating(false)}
                  className="btn-annotate-close"
                  title="Exit Annotation Mode"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          <div 
            ref={containerRef}
            className="video-container"
            tabIndex={0} // Makes container focusable to receive keyboard events
            onClick={focusControl}
            onWheel={handleWheel}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onMouseLeave={handleMouseLeave}
          >
            {/* Interactive Transparent Annotation & Laser Pointer Canvas */}
            <canvas
              ref={annotationCanvasRef}
              className={`annotation-canvas ${annotationTool === 'laser' && isAnnotating ? 'laser-mode' : ''}`}
              style={{
                display: (isAnnotating || annotations.length > 0) ? 'block' : 'none',
                pointerEvents: isAnnotating ? 'auto' : 'none'
              }}
              onMouseDown={handleAnnotationMouseDown}
              onMouseMove={handleAnnotationMouseMove}
              onMouseUp={handleAnnotationMouseUp}
              onMouseLeave={handleAnnotationMouseLeave}
            />

            {/* Drag & Drop Visual Glow Overlay */}
            {isDraggingOver && (
              <div className="file-drop-overlay">
                <div className="file-drop-card">
                  <div className="file-drop-icon">📥</div>
                  <h3>Drop File to Upload</h3>
                  <p>Streaming directly to remote PC's <strong>Downloads</strong> folder</p>
                </div>
              </div>
            )}

            {/* Zero-Latency Local Virtual Cursor Dot & Pointer */}
            <div
              ref={localCursorRef}
              className="remote-virtual-cursor"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
                opacity: 0,
                zIndex: 20,
                willChange: 'transform'
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.85))' }}>
                <path d="M4 3L11.5 21L14.5 13.5L22 10.5L4 3Z" fill="#3b82f6" stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              <div className="cursor-pulse-ring" />
            </div>

            {/* Connecting Stream Loading Overlay */}
            {(!isWebRtcActive && !socketFrame) && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'radial-gradient(ellipse at center, #111827 0%, #030712 100%)',
                zIndex: 5
              }}>
                <div style={{
                  width: '56px',
                  height: '56px',
                  border: '4px solid rgba(129, 140, 248, 0.2)',
                  borderTopColor: '#818cf8',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  marginBottom: '20px'
                }}></div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#f8fafc', marginBottom: '8px' }}>
                  Receiving Live Remote Desktop...
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.85rem', maxWidth: '380px', textAlign: 'center' }}>
                  Establishing 60 FPS ultra-low latency WebRTC P2P Video Stream with Host ({roomId})
                </p>
              </div>
            )}
            <video
              ref={(el) => {
                videoRef.current = el;
                if (el && remoteStreamRef.current && el.srcObject !== remoteStreamRef.current) {
                  el.srcObject = remoteStreamRef.current;
                  el.play().catch(e => {});
                }
              }}
              autoPlay
              playsInline
              muted
              onPlaying={() => setIsWebRtcActive(true)}
              onPause={() => setIsWebRtcActive(false)}
              onError={() => setIsWebRtcActive(false)}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              onWheel={handleWheel}
              style={{
                objectFit: 'fill',
                width: '100%',
                height: '100%',
                display: isWebRtcActive ? 'block' : 'none',
                background: '#000'
              }}
            />

            {(!isWebRtcActive || !remoteStreamRef.current) && socketFrame && (
              <img
                src={socketFrame}
                alt="Remote Screen Stream"
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
                style={{
                  objectFit: 'fill',
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

      {/* P2P Live File Transfer Progress Modal / Banner */}
      {fileTransfer && (
        <div className="file-transfer-toast">
          <div className="file-toast-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="file-toast-icon">{fileTransfer.isComplete ? '✅' : '📤'}</span>
              <div>
                <strong style={{ fontSize: '0.9rem', color: '#f8fafc', display: 'block' }}>{fileTransfer.fileName}</strong>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                  {fileTransfer.fileSizeFormatted} {fileTransfer.speed && !fileTransfer.isComplete ? `• ${fileTransfer.speed}` : ''}
                </div>
              </div>
            </div>
            <button 
              onClick={() => setFileTransfer(null)} 
              className="btn-file-toast-close"
              title="Dismiss banner"
            >
              ✕
            </button>
          </div>

          <div className="file-progress-track">
            <div 
              className="file-progress-fill" 
              style={{ 
                width: `${fileTransfer.progress}%`,
                background: fileTransfer.isComplete 
                  ? 'linear-gradient(90deg, #10b981 0%, #34d399 100%)' 
                  : 'linear-gradient(90deg, #38bdf8 0%, #818cf8 100%)'
              }}
            />
          </div>

          <div className="file-toast-footer">
            <span style={{ wordBreak: 'break-all', maxWidth: '80%' }}>
              {fileTransfer.isComplete 
                ? `✅ Saved: ${fileTransfer.savedPath || 'Downloads'}` 
                : `Transferring ${fileTransfer.progress}%...`}
            </span>
            <strong>{fileTransfer.progress}%</strong>
          </div>
        </div>
      )}

      {/* Remote Reboot & Auto-Reconnect Modal & Overlay */}
      {showRebootModal && (
        <div className="reboot-modal-overlay">
          <div className="reboot-modal-card">
            {!isRebooting ? (
              <>
                <div className="reboot-modal-icon">🔄</div>
                <h3 className="reboot-modal-title">Remote System Reboot</h3>
                <p className="reboot-modal-desc">
                  Are you sure you want to reboot the remote machine (<strong>Node #{roomId}</strong>)?
                </p>
                <div className="reboot-modal-info-box">
                  <div>⚡ <strong>Windows will restart immediately</strong></div>
                  <div>🔄 <strong>UnioTech Host Agent will auto-launch</strong> on startup</div>
                  <div>🔗 <strong>Controller will auto-reconnect</strong> with zero extra clicks</div>
                </div>
                <div className="reboot-modal-actions">
                  <button 
                    onClick={() => setShowRebootModal(false)} 
                    className="reboot-btn-cancel"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleInitiateReboot} 
                    className="reboot-btn-confirm"
                  >
                    🔄 Restart & Auto-Reconnect
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="reboot-spinner-wrapper">
                  <div className="reboot-pulse-ring"></div>
                  <div className="reboot-spinner-icon">🔄</div>
                </div>
                <h3 className="reboot-modal-title" style={{ color: '#38bdf8' }}>Target PC is Rebooting...</h3>
                <p className="reboot-modal-desc">
                  Waiting for Windows to restart and UnioTech Host Agent to come back online.
                </p>
                <div className="reboot-status-pill">
                  <span className="reboot-dot-pulse"></span>
                  <span>Polling Room #{roomId} • Attempt #{rebootAttemptCount}</span>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 12 }}>
                  Your session will automatically resume the instant the machine boots.
                </p>
                <button 
                  onClick={handleCancelRebootWaiting} 
                  className="reboot-btn-cancel"
                  style={{ marginTop: 16, width: '100%' }}
                >
                  Stop Waiting (Exit)
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showChangePassModal && (
        <div className="specs-modal-overlay" onClick={() => setShowChangePassModal(false)}>
          <div className="specs-modal-container" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
            <div className="specs-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>🔑</span>
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f8fafc' }}>Change Admin Master Password</h3>
              </div>
              <button className="specs-modal-close-btn" onClick={() => setShowChangePassModal(false)}>✕</button>
            </div>

            <form onSubmit={handleChangePassword} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {changePassError && (
                <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#fca5a5', padding: '10px 14px', borderRadius: '8px', fontSize: '0.85rem' }}>
                  ⚠️ {changePassError}
                </div>
              )}
              {changePassSuccess && (
                <div style={{ background: 'rgba(52, 211, 153, 0.15)', border: '1px solid rgba(52, 211, 153, 0.4)', color: '#6ee7b7', padding: '10px 14px', borderRadius: '8px', fontSize: '0.85rem' }}>
                  ✅ {changePassSuccess}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>Current Password</label>
                <input
                  type="password"
                  className="room-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  placeholder="Enter current password"
                  value={currentPassInput}
                  onChange={e => setCurrentPassInput(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>New Password</label>
                <input
                  type="password"
                  className="room-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  placeholder="Enter new password (min 4 chars)"
                  value={newPassInput}
                  onChange={e => setNewPassInput(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>Confirm New Password</label>
                <input
                  type="password"
                  className="room-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  placeholder="Re-type new password"
                  value={confirmPassInput}
                  onChange={e => setConfirmPassInput(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="tab-btn"
                  style={{ padding: '8px 16px' }}
                  onClick={() => setShowChangePassModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-btn"
                  style={{ padding: '8px 20px', background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
                  disabled={isChangingPass}
                >
                  {isChangingPass ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
