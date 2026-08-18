// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::WebviewBuilder,
    LogicalPosition, LogicalSize, Manager, WebviewUrl,
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

    // 设置运行工作目录为用户的当前工作区
    if let Ok(cwd) = std::env::current_dir() {
        cmd.current_dir(cwd);
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

/// 预加载初始化脚本
const DSH_PRELOAD_INIT_SCRIPT: &str = r#"
(function() {
  console.log('[DSH Native Client] Active on:', window.location.href);
})();
"#;

#[tauri::command]
fn open_browser_window(app_handle: tauri::AppHandle, url: String, title: Option<String>) -> Result<(), String> {
    let window_title = title.unwrap_or_else(|| "DSH Browser Preview".to_string());
    let target_url = url.trim().to_string();

    if let Some(existing_window) = app_handle.get_webview_window("browser-preview") {
        let _ = existing_window.show();
        let _ = existing_window.set_focus();
        let eval_code = format!("window.location.href = '{}';", target_url.replace('\', "\\").replace('\'', "\\'"));
        let _ = existing_window.eval(&eval_code);
        let _ = existing_window.set_title(&window_title);
    } else {
        let parsed_url = url::Url::parse(&target_url)
            .unwrap_or_else(|_| url::Url::parse("https://github.com").unwrap());

        let _ = tauri::WebviewWindowBuilder::new(
            &app_handle,
            "browser-preview",
            tauri::WebviewUrl::External(parsed_url),
        )
        .title(&window_title)
        .inner_size(1100.0, 800.0)
        .min_inner_size(400.0, 300.0)
        .resizable(true)
        .decorations(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 方案 C：在主窗口内部挂载/停靠原生浏览器视口 (Native Docked Viewport)
#[tauri::command]
async fn dock_browser_attach(
    app_handle: tauri::AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let target_url = if url.trim().is_empty() {
        "about:blank".to_string()
    } else {
        url.trim().to_string()
    };
    let parsed_url = url::Url::parse(&target_url)
        .unwrap_or_else(|_| url::Url::parse("https://github.com").unwrap());

    if let Some(webview) = app_handle.get_webview("sidebar-browser") {
        let _ = webview.set_position(LogicalPosition::new(x, y));
        let _ = webview.set_size(LogicalSize::new(width, height));
        let _ = webview.show();
        let _ = webview.navigate(parsed_url);
    } else {
        let window = app_handle
            .get_window("main")
            .ok_or_else(|| "Main window 'main' not found".to_string())?;

        let builder = WebviewBuilder::new("sidebar-browser", WebviewUrl::External(parsed_url))
            .enable_clipboard_access()
            .accept_first_mouse(true);

        let _ = window
            .add_child(
                builder,
                LogicalPosition::new(x, y),
                LogicalSize::new(width, height),
            )
            .map_err(|e| format!("Failed to dock native webview: {}", e))?;
    }
    Ok(())
}

/// 方案 C：更新原生侧边栏视口尺寸与位置
#[tauri::command]
async fn dock_browser_update_bounds(
    app_handle: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(webview) = app_handle.get_webview("sidebar-browser") {
        let _ = webview.set_position(LogicalPosition::new(x, y));
        let _ = webview.set_size(LogicalSize::new(width, height));
    }
    Ok(())
}

/// 方案 C：隐藏原生侧边栏视口（切换 Tab 时）
#[tauri::command]
async fn dock_browser_hide(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(webview) = app_handle.get_webview("sidebar-browser") {
        let _ = webview.hide();
    }
    Ok(())
}

/// 方案 C：重新显示原生侧边栏视口
#[tauri::command]
async fn dock_browser_show(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(webview) = app_handle.get_webview("sidebar-browser") {
        let _ = webview.show();
    }
    Ok(())
}

/// 方案 C：原生视口导航
#[tauri::command]
async fn dock_browser_navigate(app_handle: tauri::AppHandle, url: String) -> Result<(), String> {
    let target_url = if url.trim().is_empty() {
        "about:blank".to_string()
    } else {
        url.trim().to_string()
    };
    if let Some(webview) = app_handle.get_webview("sidebar-browser") {
        if let Ok(parsed_url) = url::Url::parse(&target_url) {
            let _ = webview.navigate(parsed_url);
        }
    }
    Ok(())
}

/// 方案 C：销毁原生视口
#[tauri::command]
async fn dock_browser_close(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(webview) = app_handle.get_webview("sidebar-browser") {
        let _ = webview.close();
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_browser_window,
            dock_browser_attach,
            dock_browser_update_bounds,
            dock_browser_hide,
            dock_browser_show,
            dock_browser_navigate,
            dock_browser_close,
        ])
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
