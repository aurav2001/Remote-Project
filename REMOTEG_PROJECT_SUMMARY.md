# 🚀 RemoteG Project — Complete Documentation & Reference Guide

## 📌 Project Overview
**RemoteG** is a ultra-fast, unattended remote desktop control suite consisting of a Windows Electron Host Agent, a WebRTC Signaling Server, and a React Web Controller Portal.

- **GitHub Repository**: [https://github.com/aurav2001/Remote-Project](https://github.com/aurav2001/Remote-Project)
- **Live Render Web Portal**: [https://remoteg-portal.onrender.com](https://remoteg-portal.onrender.com)
- **Live Signaling Server**: [https://remote-desktop-signaling-syj4.onrender.com](https://remote-desktop-signaling-syj4.onrender.com)

---

## 🏗️ Architecture & Component Layout

### 1. `client-electron` (Host Agent Application)
- **Tech Stack**: Electron, Node.js, Win32 API C# Binary (`input-helper.cs` -> `input-helper.exe`).
- **Function**: Captures desktop screen video stream via `navigator.mediaDevices.getUserMedia` and sends WebRTC video tracks + hybrid Socket.io JPEG fallback frames.
- **Hardware Input Execution**: Executes remote mouse clicks, double clicks, right clicks, scroll wheel, and keyboard virtual key codes using `input-helper.exe`.
- **C# Mouse Timing**: Configured with a `15ms` hardware press duration delay (`MOUSEEVENTF_LEFTDOWN` -> `15ms sleep` -> `MOUSEEVENTF_LEFTUP`) to guarantee physical click execution across all Windows apps, Start Menu, and context menus.

### 2. `controller-web` (Web Controller Portal)
- **Tech Stack**: React, Vite, WebRTC DataChannel, Socket.io-client.
- **Function**: Provides full remote desktop interactive viewer with real-time mouse/keyboard control, live health metrics (CPU, RAM, Disk, Network), silent PowerShell/CMD terminal drawer, hardware specs, and bidirectional clipboard sync.
- **Layout Architecture**:
  - **Viewer Canvas**: `100vw` x `100vh` edge-to-edge video fill (`object-fit: fill`) with 0px absolute left positioning to eliminate all black sidebars and pillarboxing gaps.
  - **Left Floating Panel Dock**: Dark glassmorphism vertical panel (`width: 190px`) featuring `🟢 Node ID`, `📊 Health`, `💻 Terminal`, `⚡ Actions Menu`, and `Terminate Session`.
  - **1-Click Collapse Toggle**: `◀` / `▶` toggle button that collapses the left panel into a tiny `36px` icon on the far left edge for 100% unblocked edge-to-edge desktop viewing.

### 3. `server-signaling` (Signaling & Socket Relay Server)
- **Tech Stack**: Node.js, Express, Socket.io.
- **Function**: Coordinates WebRTC SDP Offer/Answer exchange, ICE candidates, room authorization, and hybrid socket frame relay.

---

## 🛠️ Key Solved Issues & Implementations

1. **Hardware Click Reliability**: Added 15ms delay in `input-helper.cs` between down and up mouse events.
2. **Duplicate Click Elimination**: Deduplicated `onMouseDown` + `onMouseUp` vs `onClick` in `App.jsx` so menus and windows remain open cleanly without getting immediately dismissed.
3. **Black Screen WebRTC Deadlock Fix**: Kept `<video>` element rendered in DOM (`display: block`) to avoid Chrome media engine decoding suspension.
4. **Zero-Gap Layout**: Applied `object-fit: fill` and absolute 0px left positioning in `index.css` to prevent video pillarboxing and desktop shifting.
5. **Horizontal Button Spilling Fix**: Enforced `flex-direction: column !important` on `.control-bar-left` to keep all action buttons neatly stacked in the left dock panel.

---
*Documented on August 22, 2026 for RemoteG Project reference.*
