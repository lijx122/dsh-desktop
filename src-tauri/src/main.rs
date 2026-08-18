// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// 强力预加载初始化脚本（在任何页面 DOM 解析之前执行）：
/// 1. 自动穿透侧边栏拦截提示
/// 2. 原生支持拖拽文件/图片到聊天输入框
const DSH_PRELOAD_INIT_SCRIPT: &str = r#"
(function() {
  console.log('[DSH Native Unblocker & DragDrop Fix] Active on:', window.location.href);

  // 1. 自动穿透侧边栏拦截提示
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
        if (iframe.hasAttribute('sandbox')) {
          iframe.setAttribute(
            'sandbox',
            'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads'
          );
        }
      }
    }
  }

  // 2. 修复 Windows WebView2 下的 HTML5 拖拽事件冒泡
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  }, false);

  window.addEventListener('drop', (e) => {
    // 允许网页本身的 drop handler 处理
  }, false);

  // 3. 持续高频监听 DOM
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
            // 每次页面加载（包括跳到 127.0.0.1:3080 时）强制运行初始化脚本
            let _ = window.eval(DSH_PRELOAD_INIT_SCRIPT);
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
