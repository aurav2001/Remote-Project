const { app, BrowserWindow, ipcMain, screen, desktopCapturer, clipboard, shell, Tray, Menu, powerSaveBlocker, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Critical flags to prevent Chromium from throttling screen capture & timers in background
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('high-dpi-support', '1');

try {
  powerSaveBlocker.start('prevent-app-suspension');
} catch(e) {}

let tray = null;

function createTray() {
  if (tray) return;
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show UnioTechIT Host',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: 'Hide to System Tray',
        click: () => {
          if (mainWindow) {
            mainWindow.hide();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => {
          app.quit();
        }
      }
    ]);
    tray.setToolTip('UnioTechIT Host Agent (Active)');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (e) {
    console.warn('Tray creation warning:', e);
  }
}

// Set a clean userData path in the user's local Temp directory to bypass permission/cache errors
try {
  // Expose real local IPv4 addresses (192.168.x.x) instead of anonymized .local mDNS hostnames for direct P2P connection on same Wi-Fi
  app.commandLine.appendSwitch('enable-webrtc-hide-local-ips-with-mdns', 'false');
  app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
  // Disable background throttling & occlusion to prevent screen stream freezing when host window is minimized
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch('enable-zero-copy');

  const localUserData = path.join(app.getPath('temp'), 'remoteg-remote-desktop-data');
  if (!fs.existsSync(localUserData)) {
    fs.mkdirSync(localUserData, { recursive: true });
  }
  app.setPath('userData', localUserData);
} catch (err) {
  console.error('Failed to set local userData path:', err);
}

let inputHelperProcess = null;
let mainWindow = null;

// Initialize the C# native input helper process
function startInputHelper() {
  let exePath = app.isPackaged 
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'input-helper.exe')
    : path.join(__dirname, 'input-helper.exe');
  
  if (!fs.existsSync(exePath)) {
    const altPath = path.join(__dirname, 'input-helper.exe');
    if (fs.existsSync(altPath)) {
      exePath = altPath;
    }
  }

  if (!fs.existsSync(exePath)) {
    console.error('[InputHelper]: input-helper.exe missing at path:', exePath);
    return;
  }

  console.log('Spawning input helper from:', exePath);
  
  inputHelperProcess = spawn(exePath, [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  inputHelperProcess.on('error', (err) => {
    console.error('Failed to start input helper process:', err);
  });

  inputHelperProcess.stdout.on('data', (data) => {
    console.log(`[InputHelper Stdout]: ${data.toString().trim()}`);
  });

  inputHelperProcess.stderr.on('data', (data) => {
    console.error(`[InputHelper Stderr]: ${data.toString().trim()}`);
  });

  inputHelperProcess.on('close', (code) => {
    console.log(`Input helper exited with code ${code}. Restarting...`);
    inputHelperProcess = null;
    setTimeout(startInputHelper, 1000);
  });
}

function sendInputHelperCommand(cmd) {
  if (inputHelperProcess && inputHelperProcess.stdin.writable) {
    inputHelperProcess.stdin.write(cmd + '\n');
  } else {
    console.warn('Input helper process not running. Re-initializing...');
  }
}

let isQuitting = false;

app.on('before-quit', () => {
  isQuitting = true;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: false,
    minimizable: true,
    maximizable: false,
    autoHideMenuBar: true,
    title: 'UnioTechIT System Host Agent',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      backgroundThrottling: false, // Ensures screen video capture never freezes when window is minimized or covered!
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();

  // Intercept window close (X button) to hide into System Tray instead of terminating WebRTC session
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      console.log('[Main Process]: Window close intercepted — hiding to System Tray to keep remote session active.');
      mainWindow.hide();
    }
  });
  
  // Relay renderer console.log to main process terminal
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console]: ${message}`);
  });
}

// IPC Handler to minimize host window on remote connection
ipcMain.handle('minimize-host-window', () => {
  console.log('[Main Process]: Minimizing host window (keeps background video capture 100% active)...');
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  } catch (e) {}
});

// --- Transparent Screen Annotation & Laser Pointer Overlay Window ---
let overlayWindow = null;

function getOrCreateOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const bounds = primaryDisplay.bounds;

    overlayWindow = new BrowserWindow({
      x: bounds.x || 0,
      y: bounds.y || 0,
      width: bounds.width,
      height: bounds.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      resizable: false,
      movable: false,
      show: true,
      enableLargerThanScreen: true,
      webPreferences: {
        backgroundThrottling: false,
        preload: path.join(__dirname, 'preload-overlay.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    overlayWindow.setBounds(bounds);
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    if (typeof overlayWindow.setVisibleOnAllWorkspaces === 'function') {
      overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));

    overlayWindow.on('closed', () => {
      overlayWindow = null;
    });

    return overlayWindow;
  } catch (err) {
    console.warn('[Main Process]: Could not create annotation overlay window:', err);
    return null;
  }
}

ipcMain.on('show-annotation', (event, data) => {
  try {
    const win = getOrCreateOverlayWindow();
    if (win && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('render-annotation', data);
    }
  } catch (e) {
    console.warn('[Main Process]: Annotation overlay IPC relay warning:', e);
  }
});

// Active File Transfer WriteStreams Map
const activeFileTransfers = new Map();

ipcMain.handle('save-file-chunk', async (event, { transferId, fileName, base64Chunk, isFirstChunk, isLastChunk, fileSize, targetDirectory }) => {
  try {
    const os = require('os');
    const safeFileName = path.basename(fileName || 'received_file');
    let downloadsDir = '';
    if (targetDirectory && fs.existsSync(targetDirectory)) {
      downloadsDir = targetDirectory;
    } else {
      try {
        downloadsDir = app.getPath('downloads');
      } catch (e) {
        downloadsDir = path.join(os.homedir(), 'Downloads');
      }
    }

    if (!downloadsDir || !fs.existsSync(downloadsDir)) {
      downloadsDir = path.join(os.homedir(), 'Downloads');
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
      }
    }

    let transfer = activeFileTransfers.get(transferId);

    if (isFirstChunk || !transfer) {
      let finalFilePath = path.join(downloadsDir, safeFileName);
      // Auto-increment filename if duplicate exists
      if (fs.existsSync(finalFilePath)) {
        const ext = path.extname(safeFileName);
        const nameWithoutExt = path.basename(safeFileName, ext);
        let counter = 1;
        while (fs.existsSync(path.join(downloadsDir, `${nameWithoutExt} (${counter})${ext}`))) {
          counter++;
        }
        finalFilePath = path.join(downloadsDir, `${nameWithoutExt} (${counter})${ext}`);
      }

      const writeStream = fs.createWriteStream(finalFilePath, { flags: 'w' });
      transfer = {
        filePath: finalFilePath,
        fileName: path.basename(finalFilePath),
        stream: writeStream,
        bytesWritten: 0
      };
      activeFileTransfers.set(transferId, transfer);
      console.log(`[Main Process]: Starting file transfer: ${transfer.fileName} -> ${finalFilePath}`);
    }

    if (base64Chunk && transfer && transfer.stream) {
      const buffer = Buffer.from(base64Chunk, 'base64');
      transfer.stream.write(buffer);
      transfer.bytesWritten += buffer.length;
    }

    if (isLastChunk && transfer && transfer.stream) {
      transfer.stream.end();
      activeFileTransfers.delete(transferId);
      console.log(`[Main Process]: File transfer complete: ${transfer.fileName} (${transfer.bytesWritten} bytes saved to ${transfer.filePath})`);
      
      // Automatically open Windows File Explorer and highlight the received file on target PC
      try {
        shell.showItemInFolder(transfer.filePath);
      } catch (e) {
        console.warn('Could not highlight file in folder:', e);
      }

      return {
        success: true,
        fileName: transfer.fileName,
        filePath: transfer.filePath,
        bytesWritten: transfer.bytesWritten
      };
    }

    return { success: true, pending: true };
  } catch (err) {
    console.error('[Main Process]: Error saving file chunk:', err);
    if (activeFileTransfers.has(transferId)) {
      try {
        activeFileTransfers.get(transferId).stream.end();
      } catch (e) {}
      activeFileTransfers.delete(transferId);
    }
    return { success: false, error: err.message };
  }
});

// Format byte sizes into readable string
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)) + ' ' + sizes[i];
}

// Get Windows drives & common user folders
ipcMain.handle('get-drives-and-quick-paths', async () => {
  try {
    const drives = [];
    if (process.platform === 'win32') {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      for (const l of letters) {
        const root = `${l}:\\`;
        try {
          if (fs.existsSync(root)) {
            drives.push(root);
          }
        } catch(e) {}
      }
    } else {
      drives.push('/');
    }

    const home = app.getPath('home');
    const desktop = app.getPath('desktop');
    const documents = app.getPath('documents');
    const downloads = app.getPath('downloads');
    const pictures = app.getPath('pictures');

    return {
      success: true,
      drives,
      quickPaths: [
        { label: 'Desktop', path: desktop, icon: '🖥️' },
        { label: 'Downloads', path: downloads, icon: '📥' },
        { label: 'Documents', path: documents, icon: '📄' },
        { label: 'Pictures', path: pictures, icon: '🖼️' },
        { label: 'Home', path: home, icon: '🏠' }
      ]
    };
  } catch (err) {
    return { success: false, error: err.message, drives: ['C:\\'], quickPaths: [] };
  }
});

// Read target directory items
ipcMain.handle('read-directory', async (event, targetPath) => {
  try {
    let resolvedPath = targetPath ? path.resolve(targetPath) : app.getPath('desktop');
    if (!fs.existsSync(resolvedPath)) {
      resolvedPath = app.getPath('desktop');
    }

    const dirEntries = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
    const items = [];

    for (const entry of dirEntries) {
      // Skip system/hidden files like $RECYCLE.BIN, System Volume Information, desktop.ini
      if (entry.name.startsWith('$') || entry.name.toLowerCase() === 'system volume information' || entry.name.toLowerCase() === 'pagefile.sys') {
        continue;
      }
      const fullItemPath = path.join(resolvedPath, entry.name);
      let isDirectory = false;
      let sizeBytes = 0;
      let mtime = null;

      try {
        isDirectory = entry.isDirectory();
        const stat = await fs.promises.stat(fullItemPath);
        sizeBytes = stat.size || 0;
        mtime = stat.mtime ? stat.mtime.toISOString() : null;
      } catch (statErr) {
        // Permission denied on specific system files
        isDirectory = entry.isDirectory();
      }

      const ext = isDirectory ? '' : path.extname(entry.name).toLowerCase();

      items.push({
        name: entry.name,
        path: fullItemPath,
        isDirectory,
        sizeBytes,
        sizeFormatted: isDirectory ? '--' : formatBytes(sizeBytes),
        mtime,
        ext
      });
    }

    // Sort: directories first (alphabetical), then files (alphabetical)
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    const parsed = path.parse(resolvedPath);
    const parentPath = resolvedPath === parsed.root ? null : path.dirname(resolvedPath);

    return {
      success: true,
      currentPath: resolvedPath,
      parentPath,
      items,
      totalItems: items.length
    };
  } catch (err) {
    console.error('[Main Process]: Error reading directory:', err);
    return {
      success: false,
      error: err.message,
      currentPath: targetPath,
      parentPath: null,
      items: []
    };
  }
});

// Read a chunk of a target file for downloading to remote Admin Controller
ipcMain.handle('read-file-chunk', async (event, { filePath, offset, chunkSize = 64 * 1024 }) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'File does not exist on target PC.' };
    }
    const stat = await fs.promises.stat(filePath);
    const totalSize = stat.size;
    const currentOffset = offset || 0;
    const bytesToRead = Math.min(chunkSize, totalSize - currentOffset);

    if (bytesToRead <= 0) {
      return {
        success: true,
        base64Chunk: '',
        bytesRead: 0,
        totalSize,
        isLastChunk: true
      };
    }

    const fileHandle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, currentOffset);
    await fileHandle.close();

    const isLastChunk = (currentOffset + bytesRead) >= totalSize;

    return {
      success: true,
      base64Chunk: buffer.toString('base64'),
      bytesRead,
      totalSize,
      isLastChunk
    };
  } catch (err) {
    console.error('[Main Process]: Error reading file chunk:', err);
    return { success: false, error: err.message };
  }
});

// Single Instance Lock: Prevents duplicate host instances from running concurrently
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main Process]: Another instance of RemoteG is already running. Quitting duplicate instance...');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    try {
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
          callback({ video: sources[0] });
        }).catch(() => {
          callback({});
        });
      });
    } catch (e) {}

    startInputHelper();
    createWindow();
    createTray();

    // Configure Windows Auto-Start on System Boot for seamless auto-reconnect after restart
    try {
      if (app.isPackaged) {
        app.setLoginItemSettings({
          openAtLogin: true,
          openAsHidden: true,
          path: process.execPath,
          args: ['--hidden', '--auto-start']
        });
        console.log('[Main Process]: Registered openAtLogin Windows Startup entry.');
      }
    } catch (e) {
      console.warn('[Main Process]: Error setting openAtLogin:', e);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (inputHelperProcess) {
    inputHelperProcess.kill();
  }
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handler to get screen sources with exact monitor resolutions and display bounds
ipcMain.handle('get-screen-sources', async () => {
  try {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'],
      thumbnailSize: { width: 150, height: 150 }
    });
    if (!sources || sources.length === 0) {
      return [{ 
        id: 'screen:0:0', 
        name: 'Primary Display', 
        label: 'Monitor 1 (Primary)', 
        isPrimary: true, 
        bounds: primaryDisplay ? primaryDisplay.bounds : { x: 0, y: 0, width: 1920, height: 1080 } 
      }];
    }
    const mapped = sources.map((source, index) => {
      const matchedDisplay = displays[index] || (index === 0 ? primaryDisplay : displays[0]);
      const isPrimary = matchedDisplay && primaryDisplay ? matchedDisplay.id === primaryDisplay.id : index === 0;
      const bounds = matchedDisplay ? matchedDisplay.bounds : { x: 0, y: 0, width: 1920, height: 1080 };
      const res = `${bounds.width}x${bounds.height}`;
      const label = `Monitor ${index + 1} (${res}${isPrimary ? ' - Main' : ''})`;
      return {
        id: source.id,
        name: source.name || label,
        label,
        index: index + 1,
        isPrimary,
        bounds
      };
    });
    return mapped;
  } catch (error) {
    console.error('[Main Process]: Error fetching screen sources:', error);
    return [{ id: 'screen:0:0', name: 'Primary Display', label: 'Monitor 1 (Primary)', isPrimary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
  }
});

// IPC Handler to update active monitor display bounds in C# input helper
ipcMain.on('set-active-display', (event, bounds) => {
  try {
    if (bounds && typeof bounds.x === 'number' && typeof bounds.y === 'number' && typeof bounds.width === 'number' && typeof bounds.height === 'number') {
      sendInputHelperCommand(`setdisplaybounds ${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
    }
  } catch (err) {
    console.warn('[Main Process]: Error setting active display bounds:', err);
  }
});

// IPC Handler for Remote System Reboot
ipcMain.handle('execute-system-reboot', async (event, { force, delaySec }) => {
  try {
    const delay = Number(delaySec) || 3;
    const { exec } = require('child_process');
    console.log(`[Main Process]: Initiating Windows Reboot in ${delay} seconds...`);
    exec(`shutdown /r /t ${delay} /f /c "Remote Maintenance Reboot Initiated by Controller"`, (err, stdout, stderr) => {
      if (err) {
        console.error('[Main Process]: Error executing shutdown command:', err);
      }
    });
    return { success: true, delaySec: delay };
  } catch (err) {
    console.error('[Main Process]: Reboot initiation failed:', err);
    return { success: false, error: err.message };
  }
});

// Helper function to fetch WAN Public IP asynchronously with timeout
function getPublicIp() {
  return new Promise((resolve) => {
    const https = require('https');
    const req = https.get('https://api.ipify.org?format=json', { timeout: 2500 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.ip || 'N/A');
        } catch (e) {
          resolve('N/A');
        }
      });
    });
    req.on('error', () => resolve('N/A'));
    req.on('timeout', () => {
      req.destroy();
      resolve('N/A');
    });
  });
}

// IPC Handler to get system information (Host Device Specs)
ipcMain.handle('get-system-info', async () => {
  const os = require('os');
  let ipAddress = '127.0.0.1';
  try {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
      const iface = interfaces[devName];
      for (let i = 0; i < iface.length; i++) {
        const alias = iface[i];
        if (alias.family === 'IPv4' && !alias.internal) {
          ipAddress = alias.address;
          break;
        }
      }
    }
  } catch (err) {
    console.warn('Error reading network interfaces:', err);
  }

  const cpus = os.cpus();
  const cpuModel = cpus && cpus.length > 0 ? cpus[0].model.trim() : 'Standard CPU';
  const totalRamGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));

  const username = (os.userInfo ? os.userInfo().username : null) || process.env.USERNAME || 'Admin';
  const userDomain = process.env.USERDOMAIN || process.env.COMPUTERNAME || 'WORKGROUP';
  const domainUser = `${userDomain}\\${username}`;

  const uptimeSec = os.uptime();
  const rebootTime = new Date(Date.now() - (uptimeSec * 1000));
  const lastReboot = rebootTime.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  const publicIp = await getPublicIp();

  let agentVersion = '1.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    agentVersion = pkg.version || '1.0.0';
  } catch (e) {}

  const info = {
    hostname: os.hostname(),
    companyGroup: typeof hostCompanyGroup !== 'undefined' ? hostCompanyGroup : 'USPL',
    cpu: cpuModel,
    ram: `${totalRamGb} GB`,
    ip: ipAddress,
    publicIp: publicIp,
    loggedUser: domainUser,
    domain: userDomain,
    lastReboot: lastReboot,
    agentVersion: agentVersion,
    platform: `${os.type()} ${os.arch()}`
  };
  console.log('[Main Process]: Returning Host System Info:', info);
  return info;
});

// --- LIVE SYSTEM HEALTH & METRICS ENGINE ---
const os = require('os');
const { exec } = require('child_process');

let prevCpuTimes = null;
function getCpuTimes() {
  const cpus = os.cpus();
  let user = 0, sys = 0, idle = 0;
  for (const cpu of cpus) {
    user += cpu.times.user;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
  }
  const total = user + sys + idle;
  return { idle, total };
}
prevCpuTimes = getCpuTimes();

let lastNetBytes = null;
let lastNetTime = Date.now();
let lastNetSpeed = { download: '0 KB/s', upload: '0 KB/s' };
let lastSystemStats = {
  ramTotalGb: null,
  ramUsedGb: null,
  ramPercent: null,
  diskFreeGb: 'N/A',
  diskTotalGb: 'N/A',
  diskPercent: 0,
  batteryPercent: null,
  isCharging: false
};

// Zero-overhead pure native Node.js system telemetry (0% CPU, 0 spawned processes)
function updateSystemStatsNative() {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    lastSystemStats.ramTotalGb = (totalMem / (1024 * 1024 * 1024)).toFixed(1);
    lastSystemStats.ramUsedGb = (usedMem / (1024 * 1024 * 1024)).toFixed(1);
    lastSystemStats.ramPercent = Math.round((usedMem / totalMem) * 100);
  } catch (e) {}
}

updateSystemStatsNative();
setInterval(updateSystemStatsNative, 3000);

function formatUptime(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

let cachedPublicIp = 'N/A';
let lastPublicIpFetch = 0;

function collectLiveMetrics() {
  // 1. CPU
  const currCpu = getCpuTimes();
  const idleDiff = currCpu.idle - prevCpuTimes.idle;
  const totalDiff = currCpu.total - prevCpuTimes.total;
  prevCpuTimes = currCpu;
  let cpuPercent = 0;
  if (totalDiff > 0) {
    cpuPercent = Math.round((1 - (idleDiff / totalDiff)) * 100);
    cpuPercent = Math.min(100, Math.max(0, cpuPercent));
  }

  // 2. RAM
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const ramPercent = Math.round((usedMem / totalMem) * 100);
  const ramUsedGb = (usedMem / (1024 * 1024 * 1024)).toFixed(1);
  const ramTotalGb = (totalMem / (1024 * 1024 * 1024)).toFixed(1);

  // 3. IP & CPU Model
  let ipAddress = '127.0.0.1';
  try {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
      const iface = interfaces[devName];
      for (let i = 0; i < iface.length; i++) {
        if (iface[i].family === 'IPv4' && !iface[i].internal) {
          ipAddress = iface[i].address;
          break;
        }
      }
    }
  } catch (e) {}

  const cpus = os.cpus();
  const cpuModel = cpus && cpus.length > 0 ? cpus[0].model.trim() : 'Standard CPU';

  const username = (os.userInfo ? os.userInfo().username : null) || process.env.USERNAME || 'Admin';
  const userDomain = process.env.USERDOMAIN || process.env.COMPUTERNAME || 'WORKGROUP';
  const domainUser = `${userDomain}\\${username}`;

  const uptimeSec = os.uptime();
  const rebootTime = new Date(Date.now() - (uptimeSec * 1000));
  const lastReboot = rebootTime.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  if (Date.now() - lastPublicIpFetch > 600000 || cachedPublicIp === 'N/A') {
    lastPublicIpFetch = Date.now();
    getPublicIp().then(ip => { cachedPublicIp = ip; }).catch(() => {});
  }

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    cpuModel,
    ip: ipAddress,
    publicIp: cachedPublicIp,
    loggedUser: domainUser,
    domain: userDomain,
    lastReboot,
    cpuPercent,
    ramUsedGb: lastSystemStats.ramUsedGb || ramUsedGb,
    ramTotalGb: lastSystemStats.ramTotalGb || ramTotalGb,
    ramPercent: lastSystemStats.ramPercent !== null ? lastSystemStats.ramPercent : ramPercent,
    diskFreeGb: lastSystemStats.diskFreeGb,
    diskTotalGb: lastSystemStats.diskTotalGb,
    diskPercent: lastSystemStats.diskPercent,
    downloadSpeed: lastNetSpeed.download,
    uploadSpeed: lastNetSpeed.upload,
    uptime: formatUptime(uptimeSec),
    batteryPercent: lastSystemStats.batteryPercent,
    isCharging: lastSystemStats.isCharging
  };
}

// Push live metrics to renderer every 4 seconds (ultra-low bandwidth)
setInterval(() => {
  const metrics = collectLiveMetrics();
  const allWindows = BrowserWindow.getAllWindows();
  for (const win of allWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send('system-metrics-update', metrics);
    }
  }
}, 4000);

// IPC Listener to execute control events using native input-helper
ipcMain.on('control-event', (event, data) => {
  try {
    // Multi-layer guarantee: hide host window to tray on first remote event so it never blocks remote clicks or DWM screen capture
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    }
    const { type, x, y, nx, ny, button, keyCode } = data;

    if (type === 'mousemove') {
      if (nx !== undefined && ny !== undefined) {
        sendInputHelperCommand(`movenorm ${nx} ${ny}`);
      } else {
        sendInputHelperCommand(`move ${Math.round(x)} ${Math.round(y)}`);
      }
    } else if (type === 'mousedown') {
      if (nx !== undefined && ny !== undefined) {
        sendInputHelperCommand(`movenorm ${nx} ${ny}`);
      } else if (x !== undefined && y !== undefined) {
        sendInputHelperCommand(`move ${Math.round(x)} ${Math.round(y)}`);
      }
      sendInputHelperCommand(`mousedown ${button || 'left'}`);
    } else if (type === 'mouseup') {
      if (nx !== undefined && ny !== undefined) {
        sendInputHelperCommand(`movenorm ${nx} ${ny}`);
      } else if (x !== undefined && y !== undefined) {
        sendInputHelperCommand(`move ${Math.round(x)} ${Math.round(y)}`);
      }
      sendInputHelperCommand(`mouseup ${button || 'left'}`);
    } else if (type === 'click' || type === 'doubleclick') {
      if (nx !== undefined && ny !== undefined) {
        sendInputHelperCommand(`movenorm ${nx} ${ny}`);
      } else if (x !== undefined && y !== undefined) {
        sendInputHelperCommand(`move ${Math.round(x)} ${Math.round(y)}`);
      }
      sendInputHelperCommand(`click ${button || 'left'}`);
      if (type === 'doubleclick') {
        sendInputHelperCommand(`click ${button || 'left'}`);
      }
    } else if (type === 'wheel') {
      const { deltaY } = data;
      if (deltaY) {
        sendInputHelperCommand(`scroll ${Math.round(deltaY)}`);
      }
    } else if (type === 'keydown') {
      if (keyCode) {
        sendInputHelperCommand(`keydown ${keyCode}`);
      }
    } else if (type === 'keyup') {
      if (keyCode) {
        sendInputHelperCommand(`keyup ${keyCode}`);
      }
    }
  } catch (err) {
    console.error('Error handling control event:', err);
  }
});

// IPC Handler for Silent Remote Shell Execution (PowerShell & CMD)
ipcMain.handle('execute-remote-command', async (event, { command, shellType = 'powershell' }) => {
  return new Promise((resolve) => {
    if (!command || !command.trim()) {
      return resolve({ output: 'Error: Empty command provided.', isError: true });
    }

    let execCmd = '';
    if (shellType === 'cmd') {
      execCmd = `cmd.exe /c "${command.replace(/"/g, '""')}"`;
    } else {
      // PowerShell EncodedCommand for reliable handling of special chars and multi-line scripts
      const encoded = Buffer.from(command, 'utf16le').toString('base64');
      execCmd = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
    }

    exec(execCmd, { windowsHide: true, maxBuffer: 1024 * 1024 * 5, timeout: 30000 }, (error, stdout, stderr) => {
      let output = (stdout || '') + (stderr ? `\n[STDERR]:\n${stderr}` : '');
      if (!output.trim()) {
        output = error ? `Error: ${error.message}` : 'Command executed successfully (no output).';
      }
      resolve({
        output: output.trim(),
        isError: !!error
      });
    });
  });
});

// --- NATIVE BIDIRECTIONAL CLIPBOARD SYNCHRONIZATION ENGINE ---
let lastHostClipboardText = '';

ipcMain.handle('read-clipboard', () => {
  return clipboard.readText();
});

ipcMain.on('write-clipboard', (event, text) => {
  if (typeof text === 'string') {
    lastHostClipboardText = text; // Cache to prevent echo loop back
    clipboard.writeText(text);
    console.log('[Main Process]: Host OS Clipboard updated from Remote Controller:', text.substring(0, 30));
  }
});

// --- PERSISTENT ROOM ACCESS CODE, COMPANY WORKSPACE & HTTP HEARTBEAT REGISTRATION ---
function getOrInitHostRoomId() {
  try {
    const codeFile = path.join(app.getPath('userData'), 'permanent_access_code.txt');
    if (fs.existsSync(codeFile)) {
      const code = fs.readFileSync(codeFile, 'utf8').trim();
      if (code.length === 6) return code;
    }
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    fs.writeFileSync(codeFile, newCode, 'utf8');
    return newCode;
  } catch (e) {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

function getOrInitCompanyGroup() {
  try {
    const groupFile = path.join(app.getPath('userData'), 'company_group.txt');
    if (fs.existsSync(groupFile)) {
      const group = fs.readFileSync(groupFile, 'utf8').trim();
      if (group) return group.toUpperCase();
    }
    const defaultGroup = 'USPL';
    fs.writeFileSync(groupFile, defaultGroup, 'utf8');
    return defaultGroup;
  } catch (e) {
    return 'USPL';
  }
}

let hostRoomId = getOrInitHostRoomId();
let hostCompanyGroup = getOrInitCompanyGroup();

ipcMain.handle('get-permanent-code', () => {
  return hostRoomId;
});

ipcMain.handle('set-permanent-code', (event, newCode) => {
  if (newCode && newCode.trim().length === 6) {
    hostRoomId = newCode.trim();
    try {
      const codeFile = path.join(app.getPath('userData'), 'permanent_access_code.txt');
      fs.writeFileSync(codeFile, hostRoomId, 'utf8');
    } catch(e) {}
    sendHttpHeartbeat();
  }
  return hostRoomId;
});

ipcMain.handle('get-company-group', () => {
  return hostCompanyGroup;
});

ipcMain.handle('set-company-group', (event, newGroup) => {
  if (newGroup && newGroup.trim()) {
    hostCompanyGroup = newGroup.trim().toUpperCase();
    try {
      const groupFile = path.join(app.getPath('userData'), 'company_group.txt');
      fs.writeFileSync(groupFile, hostCompanyGroup, 'utf8');
    } catch(e) {}
    sendHttpHeartbeat();
  }
  return hostCompanyGroup;
});

// Helper to get real local LAN IPv4 address (e.g. 192.168.x.x)
function getLocalLanIp() {
  try {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
      const iface = interfaces[devName];
      for (let i = 0; i < iface.length; i++) {
        const alias = iface[i];
        if (alias.family === 'IPv4' && !alias.internal) {
          return alias.address;
        }
      }
    }
  } catch (e) {}
  return '127.0.0.1';
}

// Send direct HTTP POST Heartbeat to Signaling Server (Works on any PC, 0 dependencies)
function sendHttpHeartbeat() {
  if (!hostRoomId) return;
  const https = require('https');
  const lanIp = getLocalLanIp();
  const payload = JSON.stringify({
    roomId: hostRoomId,
    companyGroup: hostCompanyGroup,
    systemInfo: {
      hostname: os.hostname(),
      companyGroup: hostCompanyGroup,
      platform: `${os.type()} ${os.arch()}`,
      ip: lanIp
    }
  });

  const req = https.request({
    hostname: 'remoteg-all-in-one-production-6122.up.railway.app',
    port: 443,
    path: '/api/register-host',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 4000
  }, (res) => {
    // Heartbeat received
  });

  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.write(payload);
  req.end();
}

// Immediately register on startup and send periodic heartbeat every 5 seconds
app.whenReady().then(() => {
  sendHttpHeartbeat();
  setInterval(sendHttpHeartbeat, 5000);
});


