// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

const DSH_AUTO_BYPASS_INIT_SCRIPT: &str = r#"
(function() {
  console.log('[Tauri DSH Unblocker] Native injected script active');

  function scanAndBypass() {
    // 1. Auto-click '仍然加载' / 'Load anyway'
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim();
      if (text === '仍然加载' || text === 'Load anyway' || text === '继续加载') {
        btn.click();
      }
    }

    // 2. Enhance iframe sandbox
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      if (!iframe.getAttribute('data-tauri-unblocked')) {
        iframe.setAttribute('data-tauri-unblocked', 'true');
        if (iframe.hasAttribute('sandbox')) {
          iframe.setAttribute(
            'sandbox',
            'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads'
          );
        }
      }
    }
  }

  const observer = new MutationObserver(scanAndBypass);
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }
})();
"#;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Setup Window with Native Init Script
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(DSH_AUTO_BYPASS_INIT_SCRIPT);
            }

            // Setup System Tray Icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("DeepSeek Harness (Tauri v2)")
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
