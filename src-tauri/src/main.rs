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

    // 1. 尝试从 EXE 所在同级目录解析 resources/runtime
    let exe_dir = std::env::current_exe()
        .map(|p| p.parent().unwrap_or(std::path::Path::new(".")).to_path_buf())
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    let resource_dir = app_handle
        .path()
        .resource_dir()
        .unwrap_or_else(|_| exe_dir.clone());

    // 查找内置 node.exe
    let mut node_exe = exe_dir.join("resources/runtime/bin/node.exe");
    if !node_exe.exists() {
        node_exe = resource_dir.join("resources/runtime/bin/node.exe");
    }

    // 支持两种目录结构 (node_modules/@deepseek-ai/dsh 或 dsh)
    let candidates = [
        exe_dir.join("resources/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js"),
        exe_dir.join("resources/runtime/dsh/lib/bin.js"),
        resource_dir.join("resources/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js"),
        resource_dir.join("resources/runtime/dsh/lib/bin.js"),
    ];

    let dsh_bin = candidates.into_iter().find(|p| p.exists());

    let cmd_str = if node_exe.exists() {
        node_exe.to_string_lossy().to_string()
    } else {
        "node".to_string()
    };

    println!("[Tauri DSH Daemon] Resolved paths: node={:?}, dsh={:?}", cmd_str, dsh_bin);

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = Command::new(cmd_str);
    if let Some(bin) = &dsh_bin {
        cmd.arg(bin);
    }
    cmd.arg("web");
    cmd.arg("--port");
    cmd.arg("3080");

    // 设置运行工作目录
    if let Some(bin) = &dsh_bin {
        if let Some(parent) = bin.parent().and_then(|p| p.parent()) {
            cmd.current_dir(parent);
        }
    }

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
  console.log('[DSH Native Client] Active on:', window.location.href);

  // 劫持 /sidebar/api/browser.probe，保证侧边栏检测永远畅通
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
                .tooltip("DeepSeek Harness (Tauri v2 Truly All-in-One)")
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
