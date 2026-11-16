# POC-001B · Windows 原生 Tauri 技术验证报告

验证日期 2026-11-16。需求依据为待整体签核的 SRS DRAFT-0.2。DEC-039、DEC-040、DEC-041 继续适用。试题内容为工程样本，其答案未进入正式核对统计。

## 原始基线

已读取 README、项目状态、SRS、架构、数据模型、QA 矩阵、决策记录和 POC-001 报告、样本。解压后以原始 `MANIFEST.sha256` 核对 35 个成员，全部一致。原始基线已独立提交，ZIP 保留在工作区。原始清单对应 ZIP 基线，当前项目的状态页包含后续附录。

POC-001 已运行 JSON 结构/计数及 Node 语法检查，并通过 MathJax SVG + WeasyPrint 生成并检查两份单页 A4 PDF。其浏览器交互、保存回读、桌面窗口、Tiptap/KaTeX、跨页和原生 WebView2 打印留待 POC-001B。POC-001B 复用三道题、六个小问、40 分、10 条 LaTeX 和函数示意图。额外预览样本在数学题干增加 36 个编号段落。

## Windows 环境与依赖

| 项目 | 实际结果 |
|---|---|
| Windows | Windows 11 家庭中文版 25H2，x64，build 26200.9974。注册表遗留项 ProductName 返回 Windows 10 Home China；版本与构建号来自注册表，架构来自 RuntimeInformation。CIM 查询被限制。 |
| 写权限 | `C:\download\KnowPaper\shandong_study_platform_v1` 可解压、写文件、构建。Git 元数据写入和工具下载使用本任务授权的执行环境。 |
| Node / npm / Git | 24.13.0 / 11.6.2 / 2.53.0.windows.1。 |
| Rust | rustup 默认 `stable-x86_64-pc-windows-msvc`，rustc 1.100.0，Cargo 1.100.0。用 Rust 官方引导程序安装。 |
| C++ 构建工具 | Visual Studio Community 18.11.12324.101 已带 MSVC 14.51.36231，实测找到 x64 cl.exe 与 link.exe。SDK 初始缺失。VS Installer 静默修改返回 5007。 |
| Windows SDK | 从 NuGet 获取 Microsoft.Windows.SDK.CPP、CPP.x64、BuildTools 10.0.26100.9457，使用工作区内 SDK 10.0.26100.0 的头文件、库及 rc.exe，和已安装 MSVC 配合编译。目录位于 `poc-001b/.test-output/sdk`。 |
| WebView2 | 注册表 Evergreen Runtime 157.0.4341.46。 |
| 网络 | 默认沙盒中 npm、Rust 站点和 GitHub 探测 DNS 失败；任务授权环境下 npm ping、依赖下载、私有仓库创建与推送成功。 |
| Python PDF 检查 | Python 3.12.0，PyMuPDF 1.26.7，安装到本次测试目录。 |

版本由 `poc-001b/package-lock.json` 和 `poc-001b/src-tauri/Cargo.lock` 锁定。实际版本为 Tauri Rust 2.12.6、Tauri CLI / JS API 2.12.5、Tauri Build 2.7.5、WebView2 COM 0.39.1、React 19.3.1、TypeScript 5.9.3、Vite 7.3.8、Tiptap 3.34.0、KaTeX 0.16.47、Zod 4.6.7、tempfile 3.27.0、serde_json 1.0.154、Tokio 1.54.1。

公式使用 Tiptap 3 的 `InlineMath` / `BlockMath` 节点和带 `pos` 的更新命令。PDF 使用 WebView2 的异步 `ICoreWebView2_7::PrintToPdf`，等待 KaTeX 字体和图片加载后打印当前预览。 [Tauri 前置要求](https://v2.tauri.app/start/prerequisites/) · [Tiptap Mathematics](https://tiptap.dev/docs/editor/extensions/nodes/mathematics) · [WebView2 打印 API](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/print) · [VS Installer 退出码](https://learn.microsoft.com/en-us/visualstudio/install/create-a-network-installation-of-visual-studio)

## 实测命令与结果

以下命令在 `poc-001b/` 中执行。原始构建日志、窗口证据、自动化输出及渲染图在该目录的 `.test-output/`。工作区 SDK 的环境加载脚本为 `.test-output/native-env.ps1`。常规安装 SDK 的电脑可直接使用 x64 开发者终端运行命令。

| 测试 | 实际命令 | 退出状态及输出 | 判定 |
|---|---|---|---|
| npm 依赖与锁文件 | `npm install --no-audit --no-fund --fetch-retries=1` | 0，安装 83 个包；`npm ls --depth=0` 枚举实际版本 | PASS |
| TypeScript 类型检查 | `npm run typecheck` | 0，`tsc --noEmit` 无诊断 | PASS |
| React/Vite 前端构建 | `npm run build` | 0，194 个模块；产出 JS、CSS 和本地 KaTeX 字体。Rollup 提示上游注释与包体大小 | PASS |
| 首次 Rust 编译检查 | `cargo check --offline --manifest-path src-tauri/Cargo.toml` | 101，`link.exe` 未在执行环境被发现。显式配置 MSVC 与本地 SDK 后重试 | FAIL，后续恢复 |
| Windows 原生 Rust 编译检查 | `cargo check --offline --locked --manifest-path src-tauri/Cargo.toml` | 0，`Finished dev profile` | PASS |
| 样本、KaTeX、数据结构回读与编号 | `npm test` | 0，4 项通过。检查 10 条原始公式及 mhchem、JSON 往返、格式标记、图片引用、非法结构、版本及独立题卷投影 | PASS |
| Rust 文件保存和读回 | `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml` | 0，2 项通过。真实临时目录中验证原子替换，两次保存回读相等，错误输入保留原文件 | PASS |
| 开发模式和真实窗口 | `npm run tauri dev` | 0，编译并运行 `target/debug/shandong-poc-001b.exe`。Win32 HWND 461404、会话 6，WebView2 页面 `http://127.0.0.1:1420/`。通过原生关闭函数退出 | PASS |
| 正式 Windows 构建 | `npm run tauri build` | 0，原生 release EXE 及 1 个 x64 NSIS 安装包。首轮下载并校验 NSIS 3.13 和插件；修正公式排版后重建仍为 0 | PASS |
| 生产窗口、富文本、公式、图片、JSON 及异常 | `node tests/windows-webview.mjs .\src-tauri\target\packaging\release\shandong-poc-001b.exe` | 0，五次 Win32 窗口启动，页面为 `http://tauri.localhost/`。编辑整题及小问、加粗和斜体、更新行内及独立公式、上传图片、保存关闭重启再保存，验证稳定 ID、结构与附件。三种无效 JSON 分别弹出页面错误信息，保存被禁用 | PASS |
| 断网资源 | 上述 WebView2 自动化的第二次运行 | 0，关闭后重启，用开发者协议禁用该 WebView2 的网络和缓存并重载。断言 `navigator.onLine === false`，KaTeX woff、公式、两张图片加载成功，再次保存成功 | PASS（模拟断网） |
| PDF 分离导出 | 上述 WebView2 自动化的第一次运行 | 0，分别打开两份预览，调用 Windows WebView2 `PrintToPdf` 生成 3 个有效 PDF | PASS |
| PDF 尺寸、页数、分离和分页 | `python tests/check_pdf.py .test-output --render .test-output/pdf-pages` | 0，每页 594.96 × 841.92 pt（A4）。题卷 1 页、答案卷 1 页、长题 5 页。六个小问编号一致，答案标志仅出现在答案卷。长题 01–36 标志各出现一次，无空白页或越页文本框 | PASS |
| PDF 逐页视觉检查 | 打开 PyMuPDF 渲染出的 7 张 PNG | 见题卷函数图、积分、分式、物理单位、化学反应箭头和上下标。长题续页与末尾小问可读。首轮发现句号单独成行，调整后重新导出，复验通过 | PASS |
| 物理断网、安装器安装/卸载、实体打印机、macOS | 未执行 | 断网自动化限 WebView2，安装包本次只完成构建。另见手动复验和遗留问题 | NOT TESTED |

最终三份 PDF 位于 [题卷](poc-001b/output/pdf/paper.pdf)、[答案卷](poc-001b/output/pdf/answers.pdf)、[长题卷](poc-001b/output/pdf/paper-long.pdf)。它们均由最终 Windows 构建直接导出，使用的是原始示例数据。WebView2 生成的 PDF 页面宽度存在 0.32 pt 的取整差，处于 A4 检查容差内。

本机 Windows 产物（相对于 `poc-001b/`）

- `src-tauri/target/packaging/release/shandong-poc-001b.exe`，SHA-256 `3DF257331AE4CA09C06A96F2A1B72A18727BBCC8D434D0919F36BEE5005A9E66`。
- `src-tauri/target/packaging/release/bundle/nsis/山东高中学习资源平台 POC-001B_0.1.0_x64-setup.exe`，SHA-256 `EB9EAAF89B507AB619341FCA493B4C16FF27FF7EA61B4BEA95435BD907B82B29`。

## 结论与交接

POC-001B 的 Windows 原生开发、生产构建、编辑回读和 WebView2 双 PDF 导出通过本次样本验证。正式版仍须补齐完整数据模型、正式资源、复杂编辑和分页场景、安装回归与 macOS 实机验证。下一步可把本原型的结构化编辑文档和 PDF 渲染作为 DEV-001 的候选实现，以 SQLite 迁移及 DEC-039…041 的数据约束和回归用例作为交接重点。手动复验和风险见 [手动测试](POC-001B_MANUAL_TEST.md) 与 [遗留问题](POC-001B_KNOWN_ISSUES.md)。

项目源码、原始文档、POC-001 和新 PDF 通过 Git 推送至私有仓库 `main`。Windows 构建产物与测试缓存保存在本机。 [私有 GitHub 仓库](https://github.com/ghost114541/shandong-study-platform)
