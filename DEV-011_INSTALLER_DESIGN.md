# DEV-011 Windows 安装器设计

知卷 KnowPaper（测试版）使用 Windows x64 NSIS 当前用户安装。向导跟随 Windows 语言选择简体中文或英语，把 EXE 和卸载器写入 `%LOCALAPPDATA%\KnowPaper Preview`，用 HKCU 登记卸载项并创建开始菜单快捷方式。交互完成页可选桌面快捷方式和启动应用。固定目录使不同版本命中同一程序位置，并隔离用户选择的资源库。安装目录本身为重解析点、普通文件或无法检查时，安装停止。

Tauri 2.12.5 的默认模板会在安装或卸载时处理运行中的进程，并提供删除应用数据的选项。两类动作须在初始化与卸载确认页就受控，而默认 hooks 在这些步骤之后才执行。因此沿用并定向修改上游模板，保留 MUI、离线 WebView2 和签名集成。共享的 NSIS 宏承载互斥、目录检查和本地化错误。上游 MIT 许可随模板保存。

安装器先完成 WebView2 检查，再提取临时 EXE 和卸载器，检查开始菜单快捷方式，然后通过同目录替换发布程序。主要路径失败以非零退出。安装文件和 Windows 注册表写入分属不同操作，进程异常终止时可能残留待重试的程序文件。应用数据受目录和操作范围隔离。

[NSIS 模板](poc-001b/src-tauri/windows/preview-installer.nsi) · [保护宏](poc-001b/src-tauri/windows/preview-guards.nsh) · [上游 2.12.5 模板](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.5/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi) · [上游 MIT 许可](poc-001b/src-tauri/windows/TAURI-LICENSE-MIT.txt)
