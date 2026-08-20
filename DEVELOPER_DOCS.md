# 📘 RemoteG - Developer & Architecture Guide

Welcome to the **RemoteG** developer documentation. This guide details the architecture, component pipelines, network protocols, code structure, and step-by-step instructions for adding new features to the platform in the future.

---

## 📐 1. System Architecture Overview

RemoteG is built on a high-performance **hybrid P2P (Peer-to-Peer) architecture**:
1. **Signaling Phase (Socket.IO)**: Used exclusively for device discovery, 6-digit access code handshakes, WebRTC SDP negotiation, and ICE candidate exchange.
2. **Streaming & Control Phase (WebRTC)**: Once connected, high-definition screen video and ultra-low-latency mouse/keyboard/terminal/telemetry packets run directly Peer-to-Peer (P2P).

```
   ┌────────────────────────┐                   ┌────────────────────────┐
   │                        │ ── (Signaling) ──>│  Node.js Signaling     │
   │   Electron Host App    │                   │  Server (Render)       │
   │  (Windows PC Target)   │ <─ (Signaling) ── │ (Socket.io Signaling)  │
   └───────────┬────────────┘                   └───────────▲────────────┘
               │                                            │
               │         ┌───────────────────────┐          │
               └────────>│ WebRTC Video & P2P    │──────────┘
                         │ DataChannel Pipeline  │
                         └───────────────────────┘
                                     ▲
                                     │
                        ┌────────────┴───────────┐
                        │   React Controller     │
                        │   Web App (Browser)    │
                        └────────────────────────┘
```

---

## 📁 2. Repository & File Structure Map

```
Remote/
├── server/                             # Node.js + Socket.IO Signaling Server
│   ├── index.js                        # Signaling server logic & active room host registry
│   └── package.json                    # Server dependencies
│
├── client-electron/                    # Windows Desktop Host Application
│   ├── main.js                         # Electron main process (Window lifecycle, C# process spawn, WMI telemetry, IPC)
│   ├── preload.js                      # ContextBridge security bridge (exposes electronAPI to renderer)
│   ├── renderer.js                     # Renderer process (Screen capture, WebRTC PeerConnection, DataChannel listener)
│   ├── index.html                      # Unattended host status UI & Permanent Access Code display
│   ├── input-helper.cs                 # Native C# Win32 User32.dll Low-Level Hardware Event Processor
│   ├── input-helper.exe                # Compiled C# standalone binary for hardware mouse/keyboard injection
│   ├── icon.png                        # App branding icon
│   ├── RemoteG-Setup.zip               # Production NSIS installer zip package
│   └── package.json                    # Electron dependencies & electron-builder packaging config
│
├── controller-web/                     # Web-based Remote Control Dashboard (Frontend)
│   ├── src/
│   │   ├── App.jsx                     # Central RMM Dashboard, Canvas Scaling, WebRTC Video Viewer, Control Handlers
│   │   ├── index.css                   # Glassmorphic Dark UI & Telemetry styling
│   │   └── main.jsx                    # React root entrypoint
│   ├── index.html                      # HTML entrypoint
│   ├── vite.config.js                  # Vite bundler configuration
│   └── package.json                    # React dependencies
│
├── render.yaml                         # Render Cloud Deployment specification
├── PROJECT_SUMMARY.md                  # Quick feature & status summary
└── DEVELOPER_DOCS.md                   # Full Developer Architecture & Extension Guide (This Document)
```

---

## ⚙️ 3. Core Subsystems Deep-Dive

### A. Native C# Hardware Input Engine (`input-helper.cs`)
- **Location**: `client-electron/input-helper.cs` -> `client-electron/input-helper.exe`
- **Mechanism**: Windows OS blocks synthetic browser events from interacting with elevated UAC windows or native OS dialogs. RemoteG solves this by spawning a background native C# helper process (`input-helper.exe`) that listens to STDIN commands and executes raw Win32 `User32.dll` APIs:
  - `SetCursorPos(x, y)`: Absolute mouse movement.
  - `mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP)`: Hardware left click.
  - `mouse_event(MOUSEEVENTF_RIGHTDOWN | MOUSEEVENTF_RIGHTUP)`: Hardware right click.
  - `mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0)`: Mouse wheel scroll.
  - `keybd_event(vkCode, 0, flags, 0)`: Native keyboard virtual keydown / keyup.

#### Recompiling `input-helper.exe`:
If you modify `input-helper.cs`, recompile it using Windows built-in C# compiler (`csc.exe`):
```powershell
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /out:client-electron\input-helper.exe client-electron\input-helper.cs
```

---

### B. Precision Mouse Coordinate & Aspect Ratio Engine (`App.jsx`)
- **Location**: `controller-web/src/App.jsx` (`sendMouseEvent`)
- **Problem Solved**: Browser container dimensions rarely match host display resolutions (e.g. 1920x1080 host displayed inside a 1366x768 browser window with letterbox/pillarbox black bars).
- **Formula Implemented**:
  1. Calculates exact rendered video frame dimensions inside the `<video>` element:
     ```js
     const containerAspect = rect.width / rect.height;
     const videoAspect = videoWidth / videoHeight;
     if (containerAspect > videoAspect) {
       // Pillarboxed (black bars left/right)
       renderHeight = rect.height;
       renderWidth = rect.height * videoAspect;
       offsetX = (rect.width - renderWidth) / 2;
       offsetY = 0;
     } else {
       // Letterboxed (black bars top/bottom)
       renderWidth = rect.width;
       renderHeight = rect.width / videoAspect;
       offsetX = 0;
       offsetY = (rect.width / videoAspect) / 2;
     }
     ```
  2. Clamps click bounds and maps relative coordinates to host video dimensions:
     ```js
     const targetX = (clampedX / renderWidth) * videoWidth;
     const targetY = (clampedY / renderHeight) * videoHeight;
     ```

---

### C. Signaling & P2P Protocol Event Reference

All socket signaling events passed between Host, Controller, and Signaling Server:

| Event Name | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `join-room` | Peer -> Server | `{ roomId, role, systemInfo }` | Register socket in 6-digit access room. |
| `active-hosts-list` | Server -> Controller | `[{ roomId, systemInfo, liveMetrics, isOnline }]` | Broadcast list of live active managed nodes. |
| `ready` | Server -> Peers | `{ host, controller, systemInfo }` | Emitted when both Host & Controller join the same room. |
| `webrtc-offer` | Host -> Controller | `{ roomId, offer }` | Relays WebRTC SDP Offer. |
| `webrtc-answer` | Controller -> Host | `{ roomId, answer }` | Relays WebRTC SDP Answer. |
| `ice-candidate` | Peer -> Peer | `{ roomId, candidate }` | Relays WebRTC ICE candidates. |
| `control-event` | Controller -> Host | `{ type, x, y, button, keyCode, deltaY }` | Hardware control packet (sent via DataChannel or Socket fallback). |
| `system-metrics` | Host -> Controller | `{ roomId, metrics }` | CPU, RAM, Disk, Netstat & Battery telemetry updates. |
| `terminal-command` | Controller -> Host | `{ id, command, shellType }` | Remote command execution request. |
| `terminal-result` | Host -> Controller | `{ id, output, isError, timestamp }` | Command execution stdout/stderr response. |

---

### D. RMM Telemetry Engine (`main.js` & `renderer.js`)
- **Location**: `client-electron/main.js` (`collectLiveMetrics`)
- **Metrics Collected**:
  - **CPU Utilization**: Sampled via `os.cpus()` idle/total time deltas.
  - **Memory (RAM)**: Sampled via `os.totalmem()` and `os.freemem()`.
  - **Disk Space (C:)**: Fetched asynchronously via PowerShell WMI (`Win32_LogicalDisk`).
  - **Battery Health**: Fetched asynchronously via PowerShell WMI (`Win32_Battery`).
  - **Network Speed**: Sampled via `netstat -e` rx/tx bytes per second delta.
- Streamed to Controller every 2 seconds over WebRTC `RTCDataChannel` (falling back to Socket.IO).

---

## 🛠️ 4. Developer Guides: How to Add Features in the Future

### Guide 1: How to Add Bidirectional Clipboard Synchronization
1. **Host (`renderer.js`)**:
   Listen on `activeDataChannel` for clipboard events:
   ```javascript
   if (data.type === 'clipboard-set') {
     navigator.clipboard.writeText(data.text);
   }
   ```
2. **Controller (`App.jsx`)**:
   Add a "Paste Clipboard to Remote" button or handle `paste` keyboard event:
   ```javascript
   const handlePasteToRemote = async () => {
     const text = await navigator.clipboard.readText();
     sendControlData({ type: 'clipboard-set', text });
   };
   ```

---

### Guide 2: How to Add File Transfer (Drag & Drop File Upload to Host)
1. **Controller (`App.jsx`)**:
   Read uploaded file using `FileReader` as `ArrayBuffer` or `Base64` chunks and send over DataChannel:
   ```javascript
   const sendFileChunk = (file) => {
     const reader = new FileReader();
     reader.onload = (e) => {
       sendControlData({
         type: 'file-transfer-chunk',
         fileName: file.name,
         data: e.target.result
       });
     };
     reader.readAsDataURL(file);
   };
   ```
2. **Host (`main.js` & `preload.js`)**:
   Add IPC listener to write received chunks into `C:\Users\Public\Downloads\`:
   ```javascript
   ipcMain.handle('save-received-file', (event, { fileName, base64Data }) => {
     const filePath = path.join(os.homedir(), 'Downloads', fileName);
     fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
     return filePath;
   });
   ```

---

### Guide 3: How to Add Multi-Monitor Switching
1. **Host (`renderer.js`)**:
   The existing `loadSources()` helper fetches all display monitors using `desktopCapturer.getSources({ types: ['screen'] })`.
2. To switch monitors dynamically when controller clicks "Screen 2":
   - Controller sends `{ type: 'switch-screen', sourceId: 'screen:1:0' }`.
   - Host calls `startSharing(data.sourceId)` and replaces the video track on `peerConnection`:
     ```javascript
     const newTrack = localStream.getVideoTracks()[0];
     const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
     sender.replaceTrack(newTrack);
     ```

---

### Guide 4: How to Add User Authentication / Permanent Security PIN
1. **Host (`renderer.js`)**:
   Save permanent security PIN in `localStorage` or `main.js` configuration.
2. **Signaling Server (`server/index.js`)**:
   Validate security PIN during `join-room` handshake:
   ```javascript
   socket.on('join-room', ({ roomId, role, pin }) => {
     if (role === 'controller' && room.hostPin !== pin) {
       return socket.emit('auth-failed', 'Incorrect Security PIN');
     }
   });
   ```

---

## 🚀 5. Development, Build & Deployment Commands

### Local Development Startup
```powershell
# 1. Run Signaling Server
cd server
npm start

# 2. Run Host Electron App
cd client-electron
npm start

# 3. Run Web Controller Frontend
cd controller-web
npm run dev
```

### Packaging & Build Commands
```powershell
# Rebuild Controller Production Assets
cd controller-web
npm run build

# Package Standalone Windows Host Installer (.exe)
cd client-electron
npm run package

# Compress Executable for Web Download Distribution
powershell -Command "Compress-Archive -Path 'client-electron\dist-build\RemoteG Setup 1.0.0.exe' -DestinationPath 'client-electron\RemoteG-Setup.zip' -Force"
```

---

## ❓ 6. Common Troubleshooting & FAQs

- **Q: Why does the connection drop when testing on the same Wi-Fi network?**
  - **A**: Chromium hides local IPs behind `.local` mDNS hostnames by default. Make sure `app.commandLine.appendSwitch('enable-webrtc-hide-local-ips-with-mdns', 'false')` is enabled in `client-electron/main.js` so host exposes real `192.168.x.x` IPv4 candidates.

- **Q: Mouse clicks work on normal windows but fail on Task Manager or Admin Installers?**
  - **A**: Windows UAC blocks standard user input emulation. Run `client-electron` or `RemoteG Setup` as Administrator so `input-helper.exe` inherits administrative privileges.

- **Q: WebRTC connection status shows "connecting" forever?**
  - **A**: Ensure STUN/TURN servers are accessible over port 80/443 and both devices have internet/LAN connectivity.

---

*Documentation maintained by RemoteG Core Engineering.*
