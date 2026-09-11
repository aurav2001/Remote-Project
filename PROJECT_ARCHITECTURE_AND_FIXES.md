# UnioTechIT Remote Desktop - Project Architecture & Implementation Record

> **Document Purpose**: Permanent knowledge base and architectural reference for all system components, security bypasses, lock screen mechanics, input pipeline, and release workflows.

---

## 1. Core Architecture Overview

```
                     ┌──────────────────────────────┐
                     │   Signaling / HTTP Server    │
                     │    (Node.js + Socket.IO)     │
                     │  remote.uniotechit.com:443   │
                     └──────────────┬───────────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           ▼                                                 ▼
┌───────────────────────┐                         ┌───────────────────────┐
│  Host Agent (Electron)│◄═════ WebRTC Data ═════►│  Web Controller (Vite)│
│    UnioTechIT Host    │      & Media Stream     │     Admin Console     │
└──────────┬────────────┘                         └───────────────────────┘
           │ (Stdio IPC)
           ▼
┌───────────────────────┐
│ C# Native Input Helper│
│  (Win32 Desktop GDI,  │
│ Winlogon & ScanCodes) │
└───────────────────────┘
```

---

## 2. Key Modules & Implementation Details

### A. Windows Lock Screen (`Winlogon`) Streaming & PIN Unlock
- **Challenge**: When Windows locks (`Win+L`), Desktop Window Manager (DWM) DirectX screen capture freezes/suspends.
- **Solution**:
  1. `client-electron/input-helper.cs`:
     - Calls `OpenInputDesktop` and `SetThreadDesktop` to switch thread context dynamically between `Default` (user) and `Winlogon` (lock screen).
     - Captures lock screen frames at 5 FPS via GDI `BitBlt` with `CreateDC("DISPLAY")`.
     - Emits `FRAME_JPG <base64>` via stdout to Electron main process.
  2. `UnlockWithPin`:
     - Wakes lock curtain with `Space` + `Escape`.
     - Sets cursor to center-screen PIN box (`X = Width/2, Y = Height * 0.58`) and clicks to focus.
     - Clears previous input with `Ctrl+A` + `Backspace`.
     - Types digits using hardware scan codes (`MapVirtualKey`) and submits `VK_RETURN` (Enter).
     - Immediately captures response frames at +250ms and +500ms for instant visual feedback.

---

### B. Zero-Prompt & Silent Launch Configuration
- **Windows UAC**:
  - `client-electron/package.json`:
    - `requestedExecutionLevel: "asInvoker"`
    - `perMachine: false`
    - `oneClick: true`
  - Installs to `%LOCALAPPDATA%\Programs\UnioTechIT\` without Administrator / UAC elevation prompts.
- **Chromium Media & Permission Prompts**:
  - `client-electron/main.js`:
    - `app.commandLine.appendSwitch('use-fake-ui-for-media-stream')`
    - `app.commandLine.appendSwitch('enable-usermedia-screen-capturing')`
    - `app.commandLine.appendSwitch('auto-select-desktop-capture-source', 'Entire screen')`
    - `session.defaultSession.setPermissionRequestHandler((wc, p, cb) => cb(true))`
    - `session.defaultSession.setPermissionCheckHandler(() => true)`
    - `session.defaultSession.setDisplayMediaRequestHandler((req, cb) => cb({ video: sources[0] }))`

---

### C. Mouse & Double-Click Handling
- **Rule**: Physical mouse events (`mousedown` and `mouseup`) must be streamed directly.
- **Fix**: Removed synthetic `doubleclick` emission. When a technician double-clicks in the browser, the two natural `mousedown` + `mouseup` pairs are processed by Windows as a native double-click. This eliminates quadruple clicks and stops files from opening automatically inside clicked folders.

---

### D. Automated Multi-Package & Version Pipeline
- **Script**: `sync-files.js`
- **Behavior**:
  - Automatically bumps the patch version (`version.json`) on every run (e.g. `1.1.1` ➔ `1.1.2` ➔ `1.1.3`).
  - Synchronizes version across `package.json`, `client-electron/package.json`, and `controller-web/package.json`.
  - Re-compiles C# helper (`csc.exe`) into `input-helper.exe`.
  - Builds Electron NSIS installer (`UnioTechIT Setup <version>.exe`).
  - Builds Vite production web controller.
  - Bundles cPanel deployment zips:
    1. `cpanel-deploy-light-v<version>.zip` (Frontend + Server)
    2. `cpanel-full-bundle-v<version>.zip` (Complete bundle with installer)
    3. `SOURCE_BACKUP_v<version>_<date>.zip` (Source code backup)

---

## 3. Supported Features Checklist

| Feature | Protocol / Method | Status |
| :--- | :--- | :--- |
| **Low-Latency Screen Stream** | WebRTC VP8/H.264 60 FPS + Canvas Fallback | ✅ 100% Working |
| **Lock Screen Capture & Unlock** | C# Native Winlogon GDI + ScanCodes | ✅ 100% Working |
| **Silent 1-Click Launch** | `asInvoker` + Fake UI Flags | ✅ 100% Working |
| **Mouse / Keyboard Input** | Normalized Coordinates (`movenorm`) | ✅ 100% Working |
| **Multi-Monitor Display Switch** | `desktopCapturer` + Display Bounds Relay | ✅ 100% Working |
| **Bidirectional Clipboard** | Electron `clipboard` API + Socket/DataChannel | ✅ 100% Working |
| **Remote File Explorer** | Chunked Stream / PowerShell Terminal Fallback | ✅ 100% Working |
| **Remote Terminal** | PowerShell / CMD Execution Relay | ✅ 100% Working |
| **Annotations & Laser** | Multi-layer Glassmorphic Overlay Window | ✅ 100% Working |
| **2FA / MFA Security** | TOTP Google/Microsoft Authenticator | ✅ 100% Working |
| **Organization Groups** | Isolated Workspaces (`companyGroup`) | ✅ 100% Working |

---
