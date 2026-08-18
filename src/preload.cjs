const { contextBridge, ipcRenderer } = require('electron');

// Expose Desktop API
contextBridge.exposeInMainWorld('dshDesktop', {
  version: '1.0.0',
  platform: process.platform,
  isDesktop: true,
  minimize: () => ipcRenderer.send('dsh:window-minimize'),
  maximize: () => ipcRenderer.send('dsh:window-maximize'),
  close: () => ipcRenderer.send('dsh:window-close'),
  togglePin: () => ipcRenderer.send('dsh:window-toggle-pin'),
  reload: () => ipcRenderer.send('dsh:window-reload'),
  openDevTools: () => ipcRenderer.send('dsh:open-devtools'),
  retryConnection: () => ipcRenderer.send('dsh:retry-connect'),
  getWindowState: () => ipcRenderer.invoke('dsh:get-window-state'),
  onWindowStateChanged: (callback) => {
    ipcRenderer.on('dsh:window-state-changed', (_event, state) => callback(state));
  },
  onStatusChange: (callback) => {
    ipcRenderer.on('dsh:status-update', (_event, status) => callback(status));
  }
});

/**
 * Inject Native DeepSeek-Styled Custom Frameless Titlebar
 */
function injectCustomTitleBar() {
  if (document.getElementById('dsh-custom-titlebar')) return;

  // Insert CSS
  const style = document.createElement('style');
  style.id = 'dsh-custom-titlebar-styles';
  style.textContent = `
    :root {
      --dsh-titlebar-height: 36px;
    }
    body {
      padding-top: var(--dsh-titlebar-height) !important;
      box-sizing: border-box !important;
    }
    #dsh-custom-titlebar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: var(--dsh-titlebar-height);
      background: #0b0f19;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 4px 0 12px;
      z-index: 2147483647;
      user-select: none;
      -webkit-app-region: drag;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .dsh-titlebar-left {
      display: flex;
      align-items: center;
      gap: 8px;
      -webkit-app-region: drag;
    }
    .dsh-titlebar-logo {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .dsh-titlebar-logo svg {
      width: 100%;
      height: 100%;
      fill: #3b82f6;
    }
    .dsh-titlebar-title {
      font-size: 12px;
      font-weight: 500;
      color: #94a3b8;
      letter-spacing: 0.2px;
    }
    .dsh-titlebar-tag {
      font-size: 10px;
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      padding: 1px 6px;
      border-radius: 4px;
      font-weight: 500;
    }
    .dsh-titlebar-right {
      display: flex;
      align-items: center;
      height: 100%;
      -webkit-app-region: no-drag;
    }
    .dsh-titlebar-btn {
      width: 38px;
      height: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      outline: none;
      transition: background 0.15s, color 0.15s;
    }
    .dsh-titlebar-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #f1f5f9;
    }
    .dsh-titlebar-btn.active {
      color: #60a5fa;
      background: rgba(59, 130, 246, 0.12);
    }
    .dsh-titlebar-btn-close:hover {
      background: #ef4444 !important;
      color: #ffffff !important;
    }
    .dsh-titlebar-btn svg {
      width: 14px;
      height: 14px;
      fill: currentColor;
    }
    .dsh-titlebar-divider {
      width: 1px;
      height: 14px;
      background: rgba(255, 255, 255, 0.1);
      margin: 0 4px;
    }
  `;
  document.head.appendChild(style);

  // Create Titlebar Element
  const bar = document.createElement('div');
  bar.id = 'dsh-custom-titlebar';
  bar.innerHTML = `
    <div class="dsh-titlebar-left">
      <div class="dsh-titlebar-logo">
        <svg viewBox="0 0 50 50">
          <path d="M48.8 10C48.3 9.8 48.1 10.3 47.8 10.5C47.7 10.6 47.6 10.7 47.5 10.8C46.8 11.6 45.9 12.2 44.8 12.1C43.1 12 41.7 12.5 40.4 13.8C40.1 12.2 39.2 11.3 37.9 10.7C37.2 10.3 36.5 10 36 9.3C35.6 8.8 35.5 8.3 35.4 7.7C35.2 7.4 35.1 7.1 34.8 7C34.4 6.9 34.2 7.3 34 7.6C33.4 8.8 33.2 10 33.2 11.4C33.3 14.3 34.5 16.7 36.9 18.3C37.2 18.5 37.2 18.7 37.2 19C37 19.6 36.8 20.1 36.6 20.7C36.5 21.1 36.3 21.2 36 21C34.6 20.4 33.5 19.6 32.5 18.6C30.7 16.9 29.2 15 27.2 13.5C26.8 13.2 26.3 12.9 25.8 12.6C23.9 10.6 26.1 9 26.6 8.8C27.2 8.6 26.8 7.9 25.1 7.9C23.3 7.9 21.7 8.5 19.6 9.3C19.3 9.4 19 9.5 18.7 9.6C16.9 9.2 14.9 9.1 12.9 9.4C9.1 9.8 6.1 11.6 3.8 14.8C1.2 18.5 0.5 22.8 1.3 27.3C2.1 32 4.5 35.8 8.1 38.9C11.8 42 16.1 43.6 21 43.3C24 43.1 27.4 42.7 31.1 39.5C32 40 33 40.1 34.7 40.3C36 40.4 37.2 40.2 38.1 40C39.6 39.7 39.5 38.3 39 38C34.6 36 35.6 36.8 34.7 36.1C36.9 33.5 40.2 30.7 41.5 21.7C41.6 21 41.6 20.6 41.5 20C41.5 19.6 41.6 19.5 42 19.5C43.1 19.3 44.1 19 45.1 18.5C47.9 16.9 49.1 14.3 49.3 11.3C49.4 10.8 49.3 10.3 48.8 10Z"/>
        </svg>
      </div>
      <span class="dsh-titlebar-title">DeepSeek Harness</span>
      <span class="dsh-titlebar-tag">Desktop</span>
    </div>

    <div class="dsh-titlebar-right">
      <button class="dsh-titlebar-btn" id="dsh-btn-pin" title="置顶窗口">
        <svg viewBox="0 0 16 16">
          <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.219.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146z"/>
        </svg>
      </button>

      <button class="dsh-titlebar-btn" id="dsh-btn-reload" title="刷新页面 (Ctrl+R)">
        <svg viewBox="0 0 16 16">
          <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
          <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
        </svg>
      </button>

      <div class="dsh-titlebar-divider"></div>

      <button class="dsh-titlebar-btn" id="dsh-btn-min" title="最小化">
        <svg viewBox="0 0 16 16">
          <path d="M3 8a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9A.5.5 0 0 1 3 8z"/>
        </svg>
      </button>

      <button class="dsh-titlebar-btn" id="dsh-btn-max" title="最大化/还原">
        <svg id="dsh-icon-max" viewBox="0 0 16 16">
          <rect width="10" height="10" x="3" y="3" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      </button>

      <button class="dsh-titlebar-btn dsh-titlebar-btn-close" id="dsh-btn-close" title="关闭 (隐藏到托盘)">
        <svg viewBox="0 0 16 16">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/>
        </svg>
      </button>
    </div>
  `;

  document.body.prepend(bar);

  // Wire Button Events
  const btnPin = document.getElementById('dsh-btn-pin');
  const btnReload = document.getElementById('dsh-btn-reload');
  const btnMin = document.getElementById('dsh-btn-min');
  const btnMax = document.getElementById('dsh-btn-max');
  const btnClose = document.getElementById('dsh-btn-close');
  const iconMax = document.getElementById('dsh-icon-max');

  let isPinned = false;

  btnPin?.addEventListener('click', () => {
    ipcRenderer.send('dsh:window-toggle-pin');
  });

  ipcRenderer.on('dsh:window-pinned', (_event, pinned) => {
    isPinned = pinned;
    if (btnPin) {
      btnPin.classList.toggle('active', isPinned);
      btnPin.title = isPinned ? '取消置顶' : '置顶窗口';
    }
  });

  btnReload?.addEventListener('click', () => {
    ipcRenderer.send('dsh:window-reload');
  });

  btnMin?.addEventListener('click', () => {
    ipcRenderer.send('dsh:window-minimize');
  });

  btnMax?.addEventListener('click', () => {
    ipcRenderer.send('dsh:window-maximize');
  });

  btnClose?.addEventListener('click', () => {
    ipcRenderer.send('dsh:window-close');
  });

  // Handle Maximize state change
  ipcRenderer.on('dsh:window-state-changed', (_event, { isMaximized }) => {
    if (iconMax) {
      if (isMaximized) {
        iconMax.innerHTML = `
          <path fill="none" stroke="currentColor" stroke-width="1.1" d="M5.5 3.5h7v7h-7z"/>
          <path fill="none" stroke="currentColor" stroke-width="1.1" d="M3.5 5.5v7h7"/>
        `;
      } else {
        iconMax.innerHTML = `
          <rect width="10" height="10" x="3" y="3" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/>
        `;
      }
    }
  });

  // Query Initial State
  ipcRenderer.invoke('dsh:get-window-state').then((state) => {
    if (state) {
      isPinned = state.isPinned;
      if (btnPin) btnPin.classList.toggle('active', isPinned);
    }
  });
}

/**
 * Handle DOM Readiness for both Titlebar and Auto-bypass
 */
window.addEventListener('DOMContentLoaded', () => {
  // 1. Inject Custom Titlebar
  injectCustomTitleBar();

  // 2. Auto-bypass embed refusal panels in sidebar plugins (since Electron natively allows embedding)
  const observer = new MutationObserver(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent ? btn.textContent.trim() : '';
      if (text === '仍然加载' || text === 'Load anyway') {
        btn.click();
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
});
