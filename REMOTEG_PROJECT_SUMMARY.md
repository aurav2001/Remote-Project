# 🚀 UnioTechIT (RemoteG) — Complete Project Documentation & Master Reference

> **Last Updated:** August 31, 2026  
> **Repository:** [https://github.com/aurav2001/Remote-Project](https://github.com/aurav2001/Remote-Project)  
> **Live Production URL:** [https://remoteg-all-in-one-production-6122.up.railway.app](https://remoteg-all-in-one-production-6122.up.railway.app)

---

## 📌 1. Production Deployment & Cloud Architecture

- **Primary Cloud Platform:** **Railway** (Automated Nixpacks Deployment on `git push origin main`)
- **Node.js Version:** `Node.js 22.x` (enforced via `.nvmrc` and `nixpacks.toml`)
- **Root Setup:**
  - `package.json` in root directory: builds `controller-web` (`npm run build`) and starts `server/index.js`.
  - `railway.json`: configured with `nixpacks` builder.
  - `nixpacks.toml`: specifies `nodejs_22` provider.
- **Previous Render Status:** Render free quota exhausted (503 Service Unavailable). Railway is now the **primary, permanent 24/7 server**.

---

## 🏗️ 2. Core Components & Tech Stack

### A. Web Controller (`controller-web/`)
- **Framework:** React 19 + Vite 8 + Socket.IO-Client + WebRTC Native API.
- **Design:** Modern Glassmorphism, tailored dark theme, dynamic SVG micro-animations, responsive layout.
- **Key Features:**
  1. **Single-Page Landing Website & Popup Admin Gateway:**
     - **High-Impact Cyber Landing Page:** Interactive 3D holographic hero banner with floating live tech badges (`< 15ms Latency`, `256-Bit E2EE`, `Fleet Telemetry`, `Multi-Tenant Isolation`).
     - **Top Navigation Bar:** Live cloud presence indicator (`🟢 Cloud Online`), feature jump links, and glowing `🔐 Login / Get Started` button.
     - **Core Showcase Sections:** Platform specs ribbon (60 FPS, < 15ms), 6 feature cards, 3-step setup guide, direct `.exe`/`.zip` download cards, and footer.
     - **Glassmorphism Login Modal:** Pops up on click with 1-click credential auto-fill (`admin` / `admin123`), show/hide password, and HMAC-SHA256 session management.
     - **Navbar Admin Profile:** `🛡️ admin [Admin]` badge, Change Password modal, `🌐 Landing Page` view switcher, and instant Logout.
     - **Device Management:** Grid/Card view of all registered online devices with live CPU/RAM/Battery metrics, public/private IPs, OS version, and 1-Click Connect.
  2. **Ultra-Low Latency Video Canvas:** Edge-to-edge full desktop streaming (`object-fit: fill`), mouse click/scroll/drag/drop, and keyboard event dispatch.
  3. **Left Floating Dock:** Collapsible toolbar with `📊 Health`, `💻 Terminal`, `📁 Files`, `✏️ Annotate`, `🖥️ Displays`, `⚡ Actions`, and `Terminate Session`.
  4. **Dual-Mode Remote File Explorer:**
     - Quick drive letters (`C:\`, `D:\`) & shortcuts (`Desktop`, `Downloads`, `Documents`, `Pictures`, `Home`).
     - Real-time directory navigation, path bar, breadcrumbs, search filter.
     - **1-Click Download (Target ➔ Admin PC):** Streams files in 64KB chunks and saves directly to the Admin browser's Downloads folder.
     - **Folder Upload:** Drag-and-drop or `⬆️ Upload Here` button to upload files into the active remote directory.
     - **Dual-Mode Engine:** Uses native Electron IPC if available, and automatically falls back to silent PowerShell execution within 1.2s on older host versions.
  5. **Silent Remote Terminal:** PowerShell & CMD execution with instant diagnostic presets (`ipconfig`, `tasklist`, `systeminfo`, `ping`, `flushdns`).
  6. **Live Telemetry & Health Drawer:** Real-time graphs for CPU%, RAM%, Disk Space, Network Upload/Download speeds, Battery status.
  7. **Multi-Monitor Display Switcher:** 1-Click switching across dual/triple monitors with monitor resolution badges.
  8. **Screen Annotation Suite:** Laser pointer, freehand pen, arrows, rectangle boxes, and highlighter in customizable colors.
  9. **Remote Reboot & Auto-Reconnect:** Sends reboot trigger to target PC, polls signaling room, and automatically re-establishes live connection on boot.
  10. **Bidirectional Clipboard Sync:** Real-time automatic and manual clipboard sharing.

### B. Windows Host Desktop Agent (`client-electron/`)
- **Tech Stack:** Electron 28, Node.js, C# Native Input Helper (`input-helper.cs` ➔ `input-helper.exe`).
- **Functionality:**
  - Captures Windows desktop stream via `desktopCapturer` and feeds WebRTC video tracks + hybrid JPEG canvas frames.
  - Native hardware click simulation with 15ms debounce in `input-helper.exe` for start menu, taskbar, and game window support.
  - Windows Auto-Start configured via `app.setLoginItemSettings` and elevated Windows Task Scheduler (`schtasks /sc ONLOGON /rl HIGHEST`).
  - Native IPC handlers: `get-drives-and-quick-paths`, `read-directory`, `read-file-chunk`, `save-file-chunk`, `execute-remote-command`, `get-system-info`.
  - Silent PowerShell/CMD runner using child process spawn.

### C. Signaling & Relay Server (`server/`)
- **Tech Stack:** Node.js, Express, Socket.IO.
- **Role:** WebRTC signaling (SDP Offer/Answer, ICE candidates), room presence management, heartbeat keeping, fallback relay for terminal, clipboard, file chunks, and telemetry.
- **Static Assets:** Serves compiled `controller-web/dist` directly and provides download routes for `UnioTechIT-Setup.exe` and `UnioTechIT-Setup.zip`.

---

## 📦 3. Installer & Distribution Files

| File | Purpose | Location |
| :--- | :--- | :--- |
| **`UnioTechIT Setup 1.0.0.exe`** | Standalone NSIS Windows Installer | `client-electron/dist-build/` & `server/public/` |
| **`UnioTechIT-Setup.zip`** | Portable zipped host package | `client-electron/` & `server/public/` |
| **Web Download Route (EXE)** | Direct 1-click download link | `/UnioTechIT-Setup.exe` |
| **Web Download Route (ZIP)** | Direct zip download route | `/download` |

---

## 🛠️ 4. Useful Maintenance & Build Commands

### Rebuild Web Controller:
```powershell
cd "c:\Users\Gulshan Pandey\Desktop\Remote\controller-web"
npm run build
Copy-Item -Path "dist\*" -Destination "..\server\public\" -Recurse -Force
```

### Rebuild Windows Host Setup Installer:
```powershell
cd "c:\Users\Gulshan Pandey\Desktop\Remote\client-electron"
npm run package
Compress-Archive -Path "dist-build\UnioTechIT Setup 1.0.0.exe" -DestinationPath "UnioTechIT-Setup.zip" -Force
Copy-Item "dist-build\UnioTechIT Setup 1.0.0.exe" "..\server\public\UnioTechIT-Setup.exe" -Force
Copy-Item "UnioTechIT-Setup.zip" "..\server\public\UnioTechIT-Setup.zip" -Force
```

### Deploy to Railway (Auto-Deploy via Git):
```powershell
cd "c:\Users\Gulshan Pandey\Desktop\Remote"
git add -A
git commit -m "Your update message"
git push origin main
```

---

## 🌐 5. Quick Links Summary

- **Live Web Dashboard:** [https://remoteg-all-in-one-production-6122.up.railway.app](https://remoteg-all-in-one-production-6122.up.railway.app)
- **Direct Installer Download (Target PC):** [https://remoteg-all-in-one-production-6122.up.railway.app/UnioTechIT-Setup.exe](https://remoteg-all-in-one-production-6122.up.railway.app/UnioTechIT-Setup.exe)
- **GitHub Master Repo:** [https://github.com/aurav2001/Remote-Project](https://github.com/aurav2001/Remote-Project)

