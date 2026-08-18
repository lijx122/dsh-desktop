// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// 强力预加载初始化脚本（在任何页面 DOM 解析之前执行）：
/// 1. 彻底解决侧边栏拦截：直接在 fetch 层劫持 /sidebar/api/browser.probe，返回可嵌入
/// 2. 彻底解决拖拽上传：修复 Windows WebView2 下的 HTML5 拖拽事件
const DSH_PRELOAD_INIT_SCRIPT: &str = r#"
(function() {
  console.log('[DSH Native Unblocker & DragDrop Fix] Active on:', window.location.href);

  // 1. 彻底解决侧边栏探测防御：劫持 /sidebar/api/browser.probe
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = args[0] ? args[0].toString() : '';
    if (typeof url === 'string' && url.includes('/sidebar/api/browser.probe')) {
      return new Response(JSON.stringify({
        ok: true,
        value: {
          reachable: true,
          xFrameOptions: null,
          frameAncestors: ["*"],
          contentType: "text/html"
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return originalFetch.apply(this, args);
  };

  // 2. 自动穿透侧边栏拦截提示（双重保险）
  function handleDOMBypass() {
    const buttons = document.querySelectorAll('button');
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      const text = (btn.textContent || '').trim();
      if (text === '仍然加载' || text === 'Load anyway' || text === '继续加载') {
        btn.click();
      }
    }

    const iframes = document.querySelectorAll('iframe');
    for (let i = 0; i < iframes.length; i++) {
      const iframe = iframes[i];
      if (!iframe.getAttribute('data-unblocked')) {
        iframe.setAttribute('data-unblocked', 'true');
        iframe.removeAttribute('sandbox');
        iframe.setAttribute('referrerpolicy', 'no-referrer');
      }
    }
  }

  // 3. 修复 Windows WebView2 下的拖拽图片/文件到输入框
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, true);

  window.addEventListener('drop', (e) => {
    // 确保拖拽事件能够顺利冒泡到 React/Vue 的 drop target 区域
  }, true);

  // 4. 持续监听 DOM
  const observer = new MutationObserver(handleDOMBypass);
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  setInterval(handleDOMBypass, 200);
})();
"#;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Setup System Tray Icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("DeepSeek Harness")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(true);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(DSH_PRELOAD_INIT_SCRIPT);
            }

            Ok(())
        })
        .on_page_load(|window, _payload| {
            let _ = window.eval(DSH_PRELOAD_INIT_SCRIPT);
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
