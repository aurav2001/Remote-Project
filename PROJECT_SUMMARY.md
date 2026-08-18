# RemoteG - Web-Based Remote Desktop Project Summary

## 📌 Project Overview
RemoteG is a full-featured, low-latency Remote Desktop application allowing users to share and control a Windows PC from any web browser using a 6-digit access code.

---

## 🏗️ Architecture & Stack
1. **Host Client (`client-electron`)**:
   - **Framework**: Electron (Node.js + Chromium)
   - **Screen Capture**: `desktopCapturer` & `getUserMedia` (WebRTC)
   - **Native Hardware Control**: C# Win32 Interop Helper (`input-helper.exe`) compiled from `input-helper.cs` (executes hardware mouse movement, mouse clicks, mouse wheel scroll, and virtual keypresses using `User32.dll` APIs).
   - **Icon**: `icon.png` (Embedded in `electron-builder` NSIS installer config).

2. **Web Controller (`controller-web`)**:
   - **Framework**: React + Vite
   - **Viewer**: Dynamic aspect ratio video scaling (`scaleX`, `scaleY` resolution mapping).
   - **Control Pipeline**: Emits `mousemove`, `mousedown`, `mouseup`, `doubleclick`, `right-click`, `onWheel` scroll, and `keydown`/`keyup` events.

3. **Signaling Server (`server`)**:
   - **Framework**: Node.js + Express + Socket.io (Hosted on Render: `https://remote-desktop-signaling-syj4.onrender.com`).
   - **Role**: Relays 6-digit room code handshakes, WebRTC SDP Offers/Answers, and ICE Candidates.

---

## ⚡ Last Completed Features & Achievements
1. **Mouse Scroll Wheel Support**:
   - Integrated `MOUSEEVENTF_WHEEL` (0x0800) in C# input engine.
   - Captured browser `wheel` / `deltaY` events in React controller and relayed to host.

2. **WebRTC DataChannel (Zero-Lag Direct P2P Control)**:
   - Configured direct P2P `RTCDataChannel('controlEvents')` between browser controller and host PC.
   - Bypassed server relay lag for mouse/keyboard inputs, achieving instantaneous TeamViewer/AnyDesk-style P2P responsiveness.

3. **Custom 3D Branding & Built Installer Zip**:
   - Generated sleek 3D cyan/indigo app icon (`icon.png`).
   - Configured `electron-builder` in `package.json`.
   - Built production installer (`dist-build/RemoteG Setup 1.0.0.exe`).
   - Compressed build output to `c:\Users\Gulshan Pandey\Desktop\Remote\client-electron\RemoteG-Setup.zip` (~76.3 MB).

4. **Live System Health & Metrics Dashboard (Atera-Style Telemetry)**:
   - Built host periodic telemetry sampler (CPU %, RAM GB & %, Disk space C:, Network Download/Upload speed, Battery %, Uptime).
   - Streamed metrics over WebRTC DataChannel & Socket.io relay every 2 seconds.
   - Built glassmorphic Live Health drawer in React Web Controller (`controller-web`).

---

## 🚀 How to Run / Deploy Next Time
* **Host App (Dev)**: `cd client-electron` -> `npm start`
* **Host App (Package Executable)**: `cd client-electron` -> `npm run package`
* **Controller Web (Dev)**: `cd controller-web` -> `npm run dev`
* **Controller Web (Build)**: `cd controller-web` -> `npm run build`
* **Signaling Server (Dev/Deploy)**: `cd server` -> `npm start`
