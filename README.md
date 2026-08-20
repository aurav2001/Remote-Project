# ⚡ RemoteG - Full-Stack Remote Desktop & RMM Platform

RemoteG is a full-featured, low-latency Remote Desktop & RMM (Remote Monitoring & Management) platform allowing users to view, control, monitor, and execute commands on Windows PCs from any web browser.

---

## ✨ Features
- **6-Digit Access Code & Unattended Remote Control**
- **Direct P2P Low-Latency Control Pipeline** (WebRTC DataChannel)
- **Native Hardware Mouse & Keyboard Input Engine** (`User32.dll` interop)
- **Precise Aspect-Ratio Coordinate & Letterbox Mapping**
- **Real-Time Telemetry Dashboard** (CPU %, RAM GB & %, Disk space, Network speed, Uptime)
- **Silent Background Remote Terminal** (PowerShell & CMD Execution)
- **Cross-Network & Same-Wi-Fi Support** (IPv4 candidate resolution & TURN/STUN relay)

---

## 📖 Quick Links & Documentation
- 📘 **[Developer & Extension Documentation (DEVELOPER_DOCS.md)](DEVELOPER_DOCS.md)** - Deep-dive architecture, code map, protocol specs & step-by-step guides for adding future features.
- 📋 **[Project Summary (PROJECT_SUMMARY.md)](PROJECT_SUMMARY.md)** - Feature checklist, components overview & operational reference.

---

## 🚀 Getting Started

### 1. Run Signaling Server
```bash
cd server
npm install
npm start
```

### 2. Run Desktop Host App (Electron)
```bash
cd client-electron
npm install
npm start
```

### 3. Run Web Controller (React + Vite)
```bash
cd controller-web
npm install
npm run dev
```

---

## 📦 Building Installer
```bash
cd client-electron
npm run package
```
Generates production installer: `dist-build/RemoteG Setup 1.0.0.exe` and updates `RemoteG-Setup.zip`.
