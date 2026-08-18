// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

static DSH_DAEMON: Mutex<Option<Child>> = Mutex::new(None);

/// 启动或重启内置的 DSH 后台服务
fn start_embedded_dsh_backend(app_handle: &tauri::AppHandle) {
    let mut lock = DSH_DAEMON.lock().unwrap();

    // 杀死旧进程
    if let Some(mut child) = lock.take() {
        let _ = child.kill();
    }

    // 解析内置 runtime 路径
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    let node_exe = resource_dir.join("resources/runtime/bin/node.exe");
    let dsh_bin = resource_dir.join("resources/runtime/dsh/lib/bin.js");

    let cmd_str = if node_exe.exists() {
        node_exe.to_string_lossy().to_string()
    } else {
        "node".to_string()
    };

    println!("[Tauri DSH Daemon] Launching {:?} with {:?}", cmd_str, dsh_bin);

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = Command::new(cmd_str);
    if dsh_bin.exists() {
        cmd.arg(dsh_bin);
    }
    cmd.arg("web");
    cmd.arg("--port");
    cmd.arg("3080");

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(child) = cmd.spawn() {
        println!("[Tauri DSH Daemon] Spawned successfully with PID: {}", child.id());
        *lock = Some(child);
    } else {
        eprintln!("[Tauri DSH Daemon] Failed to spawn child process");
    }
}

/// 强力预加载初始化脚本
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
            let handle = app.handle().clone();

            // 1. 自动在后台拉起内置的 DSH Daemon (无需用户安装 node/npm)
            start_embedded_dsh_backend(&handle);

            // 2. 构建系统托盘菜单（包含重启 DSH 后台服务、显示、退出）
            let show_item = MenuItemBuilder::with_id("show", "显示 DeepSeek Harness").build(app)?;
            let restart_item = MenuItemBuilder::with_id("restart", "🔄 重启 DSH 后台服务").build(app)?;
            let reload_item = MenuItemBuilder::with_id("reload", "刷新界面 (Ctrl+R)").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出应用并关闭后台").build(app)?;

            let menu = MenuBuilder::new(app)
                .items(&[&show_item, &restart_item, &reload_item, &quit_item])
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("DeepSeek Harness (Tauri v2 All-in-One)")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "restart" => {
                        println!("[Tauri Tray] Restarting DSH Backend...");
                        start_embedded_dsh_backend(app);
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.eval("window.location.replace('http://127.0.0.1:3080');");
                        }
                    }
                    "reload" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.eval("window.location.reload();");
                        }
                    }
                    "quit" => {
                        let mut lock = DSH_DAEMON.lock().unwrap();
                        if let Some(mut child) = lock.take() {
                            let _ = child.kill();
                        }
                        std::process::exit(0);
                    }
                    _ => {}
                })
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
