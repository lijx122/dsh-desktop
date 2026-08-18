const { app, BrowserWindow, session, shell, Tray, Menu, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Disable standard application menu globally
Menu.setApplicationMenu(null);

const DSH_DEFAULT_URL = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080';
let mainWindow = null;
let tray = null;
let isQuitting = false;
let checkInterval = null;

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
        lower === 'x-webkit-csp'
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
    minWidth: 960,
    minHeight: 620,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    title: 'DeepSeek Harness',
    backgroundColor: '#0b0f19',
    frame: false, // Frameless window for custom modern DSH titlebar
    autoHideMenuBar: true,
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

  mainWindow.setMenuBarVisibility(false);

  if (state.isMaximized) {
    mainWindow.maximize();
  }

  // Synchronize maximize state to renderer
  mainWindow.on('maximize', () => {
    saveWindowState();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dsh:window-state-changed', { isMaximized: true });
    }
  });

  mainWindow.on('unmaximize', () => {
    saveWindowState();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dsh:window-state-changed', { isMaximized: false });
    }
  });

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

  // Start connection attempt
  attemptConnect();
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
    // Load splash screen
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
              message: `探测中 (${new Date().toLocaleTimeString()})...`,
              connected: false
            });
          }
        }
      }, 1500);
    }
  }
}

/** Setup System Tray */
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
      label: '重新连接服务',
      click: () => attemptConnect()
    },
    {
      label: '刷新页面 (Ctrl+R)',
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
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('DeepSeek Harness (DSH)');
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

// Window Control IPC Handlers
ipcMain.on('dsh:window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('dsh:window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('dsh:window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('dsh:window-toggle-pin', (event) => {
  if (mainWindow) {
    const nextPin = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(nextPin);
    event.reply('dsh:window-pinned', nextPin);
  }
});

ipcMain.on('dsh:window-reload', () => {
  if (mainWindow) mainWindow.reload();
});

ipcMain.handle('dsh:get-window-state', () => {
  return {
    isMaximized: mainWindow ? mainWindow.isMaximized() : false,
    isPinned: mainWindow ? mainWindow.isAlwaysOnTop() : false
  };
});

ipcMain.on('dsh:retry-connect', () => attemptConnect());
ipcMain.on('dsh:open-devtools', () => {
  if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' });
});

// App Lifecycle
app.whenReady().then(() => {
  setupNetworkSecurityHooks();
  createMainWindow();
  setupTray();

  // Register Global Hotkey (Ctrl+Shift+D) to toggle DSH
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
