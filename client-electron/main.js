const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Set a clean userData path in the user's local Temp directory to bypass permission/cache errors
try {
  const localUserData = path.join(app.getPath('temp'), 'antigravity-remote-desktop-data');
  if (!fs.existsSync(localUserData)) {
    fs.mkdirSync(localUserData, { recursive: true });
  }
  app.setPath('userData', localUserData);
} catch (err) {
  console.error('Failed to set local userData path:', err);
}

let inputHelperProcess = null;

// Initialize the C# native input helper process
function startInputHelper() {
  const exePath = app.isPackaged 
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'input-helper.exe')
    : path.join(__dirname, 'input-helper.exe');
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

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools(); // Uncomment for development debugging
}

app.whenReady().then(() => {
  startInputHelper();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (inputHelperProcess) {
    inputHelperProcess.kill();
  }
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handler to get screen sources
ipcMain.handle('get-screen-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({ 
      types: ['window', 'screen'],
      thumbnailSize: { width: 0, height: 0 }
    });
    return sources.map(source => ({
      id: source.id,
      name: source.name
    }));
  } catch (error) {
    console.error('Error fetching screen sources:', error);
    return [];
  }
});

// IPC Listener to execute control events using native input-helper
ipcMain.on('control-event', (event, data) => {
  try {
    const { type, x, y, button, keyCode } = data;

    if (type === 'mousemove') {
      sendInputHelperCommand(`move ${Math.round(x)} ${Math.round(y)}`);
    } else if (type === 'mousedown') {
      sendInputHelperCommand(`mousedown ${button || 'left'}`);
    } else if (type === 'mouseup') {
      sendInputHelperCommand(`mouseup ${button || 'left'}`);
    } else if (type === 'click') {
      sendInputHelperCommand(`click ${button || 'left'}`);
    } else if (type === 'doubleclick') {
      sendInputHelperCommand(`click ${button || 'left'}`);
      sendInputHelperCommand(`click ${button || 'left'}`);
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
