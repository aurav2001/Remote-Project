# UnioTechIT / RemoteG - Master Project Documentation & Knowledge Base

## 📌 Project Overview
**UnioTechIT Remote Desktop (RemoteG)** is an Enterprise-Grade, Ultra-Low Latency Web-Based Remote Desktop & RMM (Remote Monitoring and Management) Platform. It allows Administrators and Clients to monitor, manage, and remote-control Windows PCs from any modern web browser using a 6-digit access code without port forwarding.

---

## 🏗️ Architecture & Technology Stack

1. **Host Client (`client-electron`)**:
   - **Framework**: Electron (Node.js + Chromium)
   - **Screen Video Pipeline**: `desktopCapturer` & WebRTC MediaStream (60 FPS crisp hardware-accelerated video)
   - **Native Hardware Control**: C# Win32 Interop Helper (`input-helper.exe` compiled from `input-helper.cs`), communicating via stdin/stdout with `User32.dll` APIs for pixel-accurate mouse movement, left/right/middle clicks, double clicks, mouse wheel scroll, and full virtual keyboard events.
   - **Telemetry Sampler**: Continuous background collection of CPU load, RAM used/total, Disk C: free/total, Network speeds, LAN IP, WAN Public IP, Domain/User, Uptime, Last Reboot, and Battery.
   - **Silent Background Execution**: Encoded PowerShell & CMD silent execution engine.
   - **File Operations**: Chunks-based P2P file sender/receiver and remote File Explorer directory browser.
   - **Production Packaging**: `electron-builder` NSIS installer (`UnioTechIT Setup 1.0.0.exe`, 76.6 MB).

2. **Web Controller (`controller-web`)**:
   - **Framework**: React + Vite + Vanilla CSS design system
   - **Branding & UI**: Modern Dark Glassmorphic Theme with Outfit/Inter typography, animated stat badges, and reactive state cards.
   - **Live Video & Stream Fallback**: WebRTC P2P direct video stream with zero-flicker state machine (`isWebRtcActiveRef`) and JPEG canvas fallback.
   - **Features Suite**:
     - Remote Desktop control with 1:1 hardware-accelerated virtual cursor
     - Live System Health Drawer (CPU/RAM/Disk/Network gauges)
     - Interactive Remote PowerShell & CMD Terminal with history and Quick Script buttons
     - Multi-Monitor display switcher
     - Remote File Explorer & Target-to-Admin file downloader
     - Drag-and-drop file upload to remote Downloads folder
     - Transparent Screen Annotation & Laser Pointer overlay
     - Excel Diagnostics Exporter for system specs and registered clients
     - 2FA / TOTP Two-Factor Authentication with QR code & Authenticator apps
     - Multi-Tenant Company Group Isolation & PC limit management

3. **Signaling Server & Database Backend (`server`)**:
   - **Framework**: Node.js + Express + Socket.IO + MySQL2
   - **Database**: Supports dual-mode persistence (cPanel MySQL database with local JSON auto-failover and migration).
   - **Authentication**: JWT token-based auth, password hashing, TOTP 2FA secret management, and role-based access (SuperAdmin vs Client).
   - **Signaling Engine**: WebRTC SDP offer/answer relay, ICE candidate exchange, heartbeat management without duplicate renegotiation loops.
   - **Email Notifications**: Nodemailer-based registration alerts for admins and welcome confirmation for clients.

---

## ⚡ Complete Feature Matrix

| Feature | Description | Implementation Status |
| :--- | :--- | :--- |
| **WebRTC 60 FPS P2P Stream** | Direct peer-to-peer ultra-low latency desktop streaming with dynamic aspect ratio | ✅ 100% Complete & Stable |
| **Zero-Flicker Stream Engine** | Stale closure frame blocking + duplicate renegotiation loop protection | ✅ 100% Fixed & Verified |
| **Native Hardware Control** | C# Win32 driver for mouse move, click, double-click, wheel scroll, and keypresses | ✅ 100% Complete |
| **RMM Telemetry & Health** | Real-time CPU, RAM, Disk, Network speeds, LAN IP, and Uptime on cards & drawer | ✅ 100% Complete & Fixed |
| **Remote PowerShell / CMD** | Interactive terminal drawer with command history, quick presets, and live output | ✅ 100% Complete |
| **P2P File Transfer** | Drag-and-drop file uploads (60KB chunks) to remote Downloads folder with Explorer pop | ✅ 100% Complete |
| **Remote File Explorer** | Browse remote C: drive / folders and download files directly to admin browser | ✅ 100% Complete |
| **Screen Annotations & Laser** | Live drawing tools (laser, pen, arrow, rectangle, highlighter) on remote screen | ✅ 100% Complete |
| **2FA / TOTP Security** | Two-factor authentication with QR code scan for Google/Microsoft Authenticator | ✅ 100% Complete |
| **Multi-Tenant Workspaces** | Company group filtering (USPL, G-TECH, PRITS, etc.) and max PC limit enforcement | ✅ 100% Complete |
| **Excel Telemetry Export** | 1-Click export of full hardware specs, disk volumes, network IPs to .xlsx | ✅ 100% Complete |
| **Windows Lock Screen Access** | Dynamic `OpenInputDesktop` + `SetThreadDesktop` sync, SAS `SendSAS` Ctrl+Alt+Del trigger, and PIN/Password entry on lock screen | ✅ 100% Complete & Stable |
| **Permanent Source Backup** | Clean 4.25 MB pure source backup (`backup-pre-lockscreen-v1` tag & checkpoint) | ✅ Saved & Locked |

---

## 🛠️ Important Commands & Workflows

### 1. Running Locally (Development)
* **Web Controller**: `npm --prefix controller-web run dev`
* **Signaling Server**: `node server/index.js`
* **Electron Host**: `npm --prefix client-electron start`

### 2. Building & Packaging
* **Compile Web Frontend**: `npm --prefix controller-web run build`
* **Package Electron Installer (.exe)**: `npm --prefix client-electron run package`
* **Sync & Build cPanel Zips**: `node sync-files.js`

### 3. Deploying to cPanel
* Upload `cpanel-deploy-light.zip` to the cPanel application folder.
* Extract in place.
* In cPanel **Setup Node.js App**, click **Restart**.

---

## 🔒 Permanent Backup Reference
* **File**: `BACKUP_SOURCE_ONLY_NO_NODE_MODULES_2026-09-09.zip` (4.25 MB)
* **Location**: Root workspace directory. Contains 100% pure source code without node_modules or large build caches.
