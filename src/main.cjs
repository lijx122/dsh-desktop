const { app, BrowserWindow, session, shell, Tray, Menu, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

// Disable standard application menu globally
Menu.setApplicationMenu(null);

const DSH_PORT = 3080;
const DSH_DEFAULT_URL = `http://127.0.0.1:${DSH_PORT}`;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let checkInterval = null;
let dshChildProcess = null;

/**
 * Locate embedded or local runtime binaries
 */
function getRuntimePaths() {
  const isPackaged = app.isPackaged;
  const baseDir = isPackaged
    ? path.join(process.resourcesPath, 'runtime')
    : path.join(__dirname, '../runtime');

  const nodeExe = path.join(baseDir, 'bin/node.exe');
  const dshBin = path.join(baseDir, 'dsh/lib/bin.js');

  return {
    nodeExe: fs.existsSync(nodeExe) ? nodeExe : 'node',
    dshBin: fs.existsSync(dshBin) ? dshBin : null,
    isEmbedded: fs.existsSync(nodeExe) && fs.existsSync(dshBin)
  };
}

/**
 * Start or Restart DSH Backend Daemon
 */
function startDshBackend(onReady) {
  const { nodeExe, dshBin, isEmbedded } = getRuntimePaths();
  console.log('[DSH Backend Manager] Starting with:', { nodeExe, dshBin, isEmbedded });

  if (dshChildProcess) {
    try {
      dshChildProcess.kill('SIGTERM');
      dshChildProcess = null;
    } catch {}
  }

  const args = dshBin ? [dshBin, 'web', '--port', String(DSH_PORT)] : ['web', '--port', String(DSH_PORT)];
  const cmd = dshBin ? nodeExe : 'dsh';

  try {
    dshChildProcess = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(DSH_PORT),
        NODE_ENV: 'production'
      }
    });

    dshChildProcess.stdout.on('data', (data) => {
      console.log(`[DSH Daemon stdout]: ${data}`);
    });

    dshChildProcess.stderr.on('data', (data) => {
      console.error(`[DSH Daemon stderr]: ${data}`);
    });

    dshChildProcess.on('exit', (code, signal) => {
      console.log(`[DSH Daemon] Exited with code ${code}, signal ${signal}`);
      dshChildProcess = null;
    });
  } catch (err) {
    console.error('[DSH Daemon] Failed to spawn backend process:', err);
  }

  if (onReady) onReady();
}

function stopDshBackend() {
  if (dshChildProcess) {
    try {
      console.log('[DSH Backend Manager] Killing backend process...');
      dshChildProcess.kill('SIGTERM');
      dshChildProcess = null;
    } catch {}
  }
}

// Persistent Window State
const configPath = path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch {}
  return { width: 1440, height: 920 };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getBounds();
    const isMaximized = mainWindow.isMaximized();
    fs.writeFileSync(configPath, JSON.stringify({ ...bounds, isMaximized }));
  } catch {}
}

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * Configure network security hooks to completely eliminate:
 * 1. X-Frame-Options / CSP frame-ancestors blockages (GitHub, doc sites, etc.)
 * 2. Cross-Site SameSite=Lax/Strict Cookie rejections inside embedded contexts
 */
function applySecurityHooksToSession(ses) {
  if (!ses || ses._hasDshSecurityHooks) return;
  ses._hasDshSecurityHooks = true;

  ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
    const responseHeaders = { ...details.responseHeaders };

    for (const key of Object.keys(responseHeaders)) {
      const lower = key.toLowerCase();

      // 1. Strip all frame blocking headers
      if (
        lower === 'x-frame-options' ||
        lower === 'frame-options' ||
        lower === 'content-security-policy' ||
        lower === 'content-security-policy-report-only' ||
        lower === 'x-content-security-policy' ||
        lower === 'x-webkit-csp' ||
        lower === 'cross-origin-opener-policy' ||
        lower === 'cross-origin-embedder-policy' ||
        lower === 'cross-origin-resource-policy'
      ) {
        delete responseHeaders[key];
      }

      // 2. Fix SameSite cookies for cross-site embedded contexts (GitHub / OAuth / etc.)
      if (lower === 'set-cookie') {
        responseHeaders[key] = responseHeaders[key].map((rawCookie) => {
          let cookie = rawCookie;
          if (/SameSite=(Lax|Strict)/i.test(cookie)) {
            cookie = cookie.replace(/SameSite=(Lax|Strict)/gi, 'SameSite=None');
          }
          if (!/SameSite=/i.test(cookie)) {
            cookie += '; SameSite=None';
          }
          if (!/Secure/i.test(cookie)) {
            cookie += '; Secure';
          }
          if (!/Partitioned/i.test(cookie)) {
            cookie += '; Partitioned';
          }
          return cookie;
        });
      }
    }

    callback({ cancel: false, responseHeaders });
  });

  ses.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    callback({ cancel: false, requestHeaders });
  });
}

function setupNetworkSecurityHooks() {
  applySecurityHooksToSession(session.defaultSession);
  app.on('session-created', (ses) => {
    applySecurityHooksToSession(ses);
  });
}

/** Check if DSH backend is running at target URL */
function checkDshHealth(url = DSH_DEFAULT_URL) {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, { timeout: 1500 }, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Create Main App Window */
function createMainWindow() {
  const state = loadWindowState();
  const iconPath = path.join(__dirname, '../assets/icon.png');

  mainWindow = new BrowserWindow({
    width: state.width || 1440,
    height: state.height || 920,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    title: 'DeepSeek Harness',
    backgroundColor: '#0b0f19',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      webSecurity: false,
      allowRunningInsecureContent: true
    }
  });

  if (state.isMaximized) {
    mainWindow.maximize();
  }

  // Handle Close to Tray
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    } else {
      saveWindowState();
    }
  });

  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  // Handle Popups / OAuth Windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('oauth') || url.includes('login') || url.includes('authorize') || url.includes('auth')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 800,
          height: 700,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false
          }
        }
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Start backend daemon & connection attempt
  startDshBackend(() => {
    attemptConnect();
  });

  mainWindow.show();
}

/** Attempt connection to DSH backend with polling */
async function attemptConnect() {
  const isHealthy = await checkDshHealth(DSH_DEFAULT_URL);

  if (isHealthy) {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    mainWindow.loadURL(DSH_DEFAULT_URL);
  } else {
    const splashPath = path.join(__dirname, 'splash.html');
    mainWindow.loadFile(splashPath);

    if (!checkInterval) {
      checkInterval = setInterval(async () => {
        const alive = await checkDshHealth(DSH_DEFAULT_URL);
        if (alive) {
          clearInterval(checkInterval);
          checkInterval = null;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('dsh:status-update', { message: '服务已就绪，正在进入...', connected: true });
            setTimeout(() => mainWindow.loadURL(DSH_DEFAULT_URL), 500);
          }
        } else {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('dsh:status-update', {
              message: `正在拉起 DSH 后台服务 (${new Date().toLocaleTimeString()})...`,
              connected: false
            });
          }
        }
      }, 1200);
    }
  }
}

/** Restart backend and reload frontend */
function restartDshEntirely() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(__dirname, 'splash.html'));
    mainWindow.webContents.send('dsh:status-update', { message: '正在重启 DSH 后台服务...', connected: false });
  }

  startDshBackend(() => {
    setTimeout(() => {
      attemptConnect();
    }, 1000);
  });
}

/** Setup System Tray with Restart Action */
function setupTray() {
  const iconPath = path.join(__dirname, '../assets/icon.png');
  if (!fs.existsSync(iconPath)) return;

  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示 DeepSeek Harness',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: '🔄 重启 DSH 后台服务',
      click: () => restartDshEntirely()
    },
    {
      label: '刷新界面 (Ctrl+R)',
      click: () => mainWindow.reload()
    },
    { type: 'separator' },
    {
      label: '置顶窗口',
      type: 'checkbox',
      checked: false,
      click: (item) => mainWindow.setAlwaysOnTop(item.checked)
    },
    {
      label: '开发者工具',
      click: () => mainWindow.webContents.openDevTools({ mode: 'detach' })
    },
    { type: 'separator' },
    {
      label: '退出应用并关闭后台',
      click: () => {
        isQuitting = true;
        stopDshBackend();
        app.quit();
      }
    }
  ]);

  tray.setToolTip('DeepSeek Harness (All-in-One)');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// IPC Handlers
ipcMain.on('dsh:retry-connect', () => restartDshEntirely());
ipcMain.on('dsh:open-devtools', () => {
  if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' });
});

// App Lifecycle
app.whenReady().then(() => {
  setupNetworkSecurityHooks();
  createMainWindow();
  setupTray();

  try {
    globalShortcut.register('CommandOrControl+Shift+D', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (e) {
    console.warn('Could not register shortcut:', e);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (checkInterval) clearInterval(checkInterval);
  globalShortcut.unregisterAll();
  stopDshBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopDshBackend();
    app.quit();
  }
});
