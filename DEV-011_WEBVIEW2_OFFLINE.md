# DEV-011 WebView2 离线部署

生产配置使用 `webviewInstallMode.type = "offlineInstaller"`。Tauri 构建阶段获取 Microsoft x64 Evergreen Standalone 安装器并封入 NSIS。用户安装阶段检测已登记的 Runtime。缺失时从包内提取并执行 Microsoft 安装器，执行错误或非零返回则停止知卷安装。

前端构建在本地打包 React、KaTeX 字体及 PDF.js worker。生产跨域限制仍由 CSP 执行。安装器嵌入 Runtime、已有 Runtime 时安装、缺少 Runtime 时断网部署，以及安装后断网使用是四项独立验证。Windows 机器的现有 WebView2 需要保留。无 Runtime 测试依赖隔离 Windows 快照。

[实际验证与限制](DEV-011_TEST_RESULTS.md) · [Tauri Windows 安装文档](https://v2.tauri.app/distribute/windows-installer/) · [Microsoft WebView2 分发文档](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)
