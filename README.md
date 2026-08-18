# DeepSeek Harness (DSH) 原生桌面客户端

专为 **DeepSeek Harness (DSH)** 打造的 Windows 原生桌面应用，彻底解决 Web 浏览器模式下的跨域、防嵌入、Cookie 隔离等痛点。

---

## 🌟 核心特性与解决的痛点

1. **🛡️ 彻底解除 X-Frame-Options / CSP 防嵌入限制**：
   - 底层网络拦截，自动剥离目标网站（如 GitHub、各大文档站、内部系统）的 `X-Frame-Options` 与 `Content-Security-Policy: frame-ancestors`。
   - 社区插件的侧边栏与嵌入式网页预览 100% 畅通无阻。

2. **🍪 解决 SameSite 跨站 Cookie 隔离（GitHub 登录态完美支持）**：
   - 自动改写 `Set-Cookie` 为 `SameSite=None; Secure; Partitioned`，解决跨站 iframe 拒绝 Cookie 的问题，支持在客户端内直接登录 GitHub 并保持会话。

3. **🔌 100% 兼容 DSH 社区插件生态**：
   - 基于微内核动态模块架构，无需重新编译客户端，所有已安装的 DSH 插件（如 `dsh-ssh`、`dsh-task-board` 等）即装即用。

4. **🖥️ 桌面原生集成体验**：
   - **系统托盘**：最小化到托盘常驻，右键菜单快速控制、刷新、重新连接。
   - **全局快捷键**：按下 `Ctrl + Shift + D` 随时在屏幕前显示 / 隐藏 DSH 窗口。
   - **窗口记忆**：自动记忆上次窗口大小、位置与最大化状态。
   - **自动重连与健康探测**：当 DSH 后端正在启动或重启时，自动显示连接缓冲状态并在就绪后平滑进入。
   - **单实例保护**：防止重复多开应用，二次启动自动唤醒当前窗口。

---

## 🚀 启动与使用方式

### 方式一：直接运行便携版 EXE（免安装）
双击打开目录下的便携版可执行文件：
* `dist/DeepSeek Harness-Portable-1.0.0.exe`
或者运行已解压的免安装目录：
* `dist/win-unpacked/DeepSeek Harness.exe`

### 方式二：开发者调试运行
在当前目录下执行：
```bash
pnpm start
# 或
npm start
```

---

## 📦 重新打包命令

若对主进程配置或界面进行了调整，可执行以下命令重新打包：

```bash
# 生成便携版单文件 EXE (推荐)
pnpm run dist:exe

# 生成解压版绿色文件夹 (开发调试快)
pnpm run dist

# 生成 Windows NSIS 安装向导安装包
pnpm run dist:installer
```

---

## ⚙️ 环境变量配置

* `DSH_WEB_URL`：自定义 DSH 服务地址（默认为 `http://127.0.0.1:3080`）。
  ```bash
  # 例如连接远程或特定端口的 DSH：
  $env:DSH_WEB_URL="http://127.0.0.1:3080"; pnpm start
  ```
