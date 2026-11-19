# DEV-011 Windows 功能测试版交接

**核心生命周期验收通过，整体 CONDITIONAL PASS。** 在 Windows 11 x64 原生环境，通过真实 NSIS 运行 0.2.0 干净 Preview 安装、0.2.1 原位升级、卸载保留资料与重装回读。等待网页端 ChatGPT 独立源码审查。交付为未签名内部功能测试版。

## 版本与实际安装包

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| A 本机实测 `KnowPaper-Preview-0.2.0-windows-x64-setup.exe` | 224,480,912 | `fb4d959944bb8f30ba233d7f1a706f4a0927a50ff8b53b50570835046afd6255` |
| B 本机实测 `KnowPaper-Preview-0.2.1-windows-x64-setup.exe` | 224,481,505 | `0fbd28ff66306c8888bf8fd4211da11dacff6bb3ac057a0c1f3d622d487b7187` |
| B GitHub Actions `KnowPaper-Preview-0.2.1-windows-x64-setup.exe` | 224,481,993 | `ba738a49eec3ada56251e200fb06d559cf69df3affc5ba155c1c4bfd89b8b5cf` |

本机两个 EXE 存在于 `poc-001b/output/dev011/binaries/0.2.0-verified/` 和 `0.2.1/`。同名早期候选保存在另一目录，哈希独立归档。CI B 的下载 ZIP 及内部 EXE 已独立重算 SHA-256，产物有效至 2026-12-03 17:38:26 UTC。CI 和本机安装器是不同构建，验收使用表内标有“本机实测”的两份。

[A Manifest](poc-001b/output/dev011/manifest-local-0.2.0.json) · [B Manifest](poc-001b/output/dev011/manifest-local-0.2.1.json) · [CI B 下载](https://github.com/ghost114541/shandong-study-platform/actions/runs/44577470728/artifacts/14558850936) · [CI 校验记录](poc-001b/output/dev011/github-actions-artifact.json)

## 数据与可恢复性

- 该安装的应用标识是 `org.shandong-study.knowpaper-preview`，程序在 `%LOCALAPPDATA%\KnowPaper Preview`。HKCU 展示名称、版本和快捷方式目标随安装、升级和卸载正确变化。
- 从空白 Preview 初始化 Schema 9，通过应用恢复合成历史数据，再迁移到 D: 的 Unicode 路径，随后添加原创题目、修订、图片、原卷、收藏、固定组卷和草稿。升级、卸载、重装前后，活动库 43 项 SQLite 表指纹、130 项外部及兼容文件、备份历史、回退库和控制日志一致。
- B 回读历次数据并输出双 PDF。验证阶段使用 WebView2 离线模拟与无有效应用代理，并在仅含 Windows 目录的 PATH 下渲染原卷、打开关联试题。Microsoft 独立 Runtime 已嵌入，缺 Runtime 的完全断网部署为 BLOCKED。
- 截断包、安装器并发、程序占用、版本过旧、提取中强制终止、不可写目录、快捷方式写入失败和测试配置权限拒绝均有真实退出和数据对比记录。

[24 项矩阵及故障明细](DEV-011_TEST_RESULTS.md) · [本机安装日志](poc-001b/output/dev011/native-resume.log) · [分阶段指纹](poc-001b/output/dev011/acceptance/data-fingerprints.json) · [PDF 输出与渲染](poc-001b/output/dev011/pdf-verification) · [已知问题](DEV-011_KNOWN_ISSUES.md)

## 性能样本

Windows 11 26200，Core i7-14650HX，约 16 GB RAM，Tauri CLI 2.12.5，Rust 1.100.0，Node 24.13.0。A 向导自动化 3.72 秒，A→B 向导自动化 12.96 秒，B 卸载向导 2.09 秒。含自动化等待和主机负载。A 首次从 .lnk 启动至数据库可用 1.20 秒，B 首次启动 1.18 秒，B 重装后离线启动 1.42 秒。活动库受控外部文件合计 51,889 字节，回退库 51,502 字节，升级前后一致。

Tauri 主进程抽样约 43–47 MiB，WebView2 子进程合计约 355–406 MiB 工作集。直接使用 Windows 注册卸载器复测时，SQLite 两库分别为 4,546,560 和 4,542,464 字节，连同 259 项资源及两个控制/备份文件在卸载及重装前后共 263 项哈希一致。C: 卸载后可用空间增加约 21.7 MB，D: 抽样可用空间相同。WebView2 离线封装在同配置尺寸比对中增加 215,044,284 字节。4 GB 和 8 GB 客户机未测。

[主机和 Runtime 签名](poc-001b/output/dev011/environment.json) · [过程时序和工作集](poc-001b/output/dev011/acceptance/timings.json) · [离线封装体积](poc-001b/output/dev011/size-comparison.json) · [注册卸载器与磁盘采样](poc-001b/output/dev011/registered-uninstall.json)

## Git 与复现

- 远程基准 `dev/dev-010-1-library-root-safety` 起点 `198f81c5c59281a5a32f28d1ea3bbeaa4dde2aad`。本地初始工作树干净。远程默认分支为 `main`，其 HEAD 已核对为 `ccda8e1fba1120f78959f030fdad490fd31ffff3`。
- DEV-011 分支为 `dev/dev-011-windows-installer`。验收 A 的应用源码 `6abd52ef2b4c272fb82a29ed58428dcd49d4bf9c`，用 `cb57d869b2d47c38f66a048b3949f351ad6304b0` 的 NSIS 配置和显式 0.2.0 覆盖重打包。B 的应用构建启于 `f83cc7a686a046fc2a9d615839c08ad91640f728`，使用 `28871529cb7f77402fb504f118011ea54fd60dda` 的修正保护宏完成打包。完整构建记录随证据提交。
- 从 `poc-001b` 执行 `node tests/windows-installer.mjs <A.exe> <B.exe> <新证据目录>`。两包旁都须有匹配的 Manifest。可将 `KNOWPAPER_DEV011_TEST_LIBRARY` 设为 D: 上不存在的专用目录以验证跨卷。独立故障检查用 `node tests/windows-installer-faults.mjs <B.exe> <已验收的合成证据目录>`。

[开发分支](https://github.com/ghost114541/shandong-study-platform/tree/dev/dev-011-windows-installer) · [交接状态](PROJECT_STATUS.md) · [构建流程](DEV-011_BUILD_RELEASE_PROCESS.md) · [安装设计](DEV-011_INSTALLER_DESIGN.md) · [身份](DEV-011_VERSION_IDENTITY.md) · [WebView2](DEV-011_WEBVIEW2_OFFLINE.md) · [升级](DEV-011_UPGRADE_DESIGN.md) · [卸载](DEV-011_UNINSTALL_SAFETY.md)
