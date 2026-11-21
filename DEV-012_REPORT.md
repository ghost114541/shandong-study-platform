# DEV-012 macOS 跨平台开发交接

开发从远程 `dev/dev-011-windows-installer` 的 `9446c0c764412566f2467effaacc37c00e7d321f` 开始。获取远端引用后本地与远端一致，起始工作区干净，历史 Windows 测试资料保留。开发分支为 `dev/dev-012-macos`，提交与证据可在分支查看。 [分支和提交](https://github.com/ghost114541/shandong-study-platform/commits/dev/dev-012-macos)

| 主要提交 | 内容 |
| --- | --- |
| `ed95cc7` | arm64 CI、Tauri 平台配置与包检查 |
| `137d696`、`8bffb0f`、`4b2a997` | PDF PoC、平台打印后端、AppKit 异步分页及安全路径 |
| `b190984`、`842790d`、`cda1a1e` | Windows 备份、Mac 安全切换和共享应用夹具 |
| `3e96550`、`2332553`、`05a6df5` | Windows 历史回归、反向迁移、应用级自动化和打印通知修复 |
| `c6ed30a` | Mac 原卷阅读器换用同版本 PDF.js 兼容发行文件 |

新增 Mac arm64 Preview 打包、原生 PDF 后端、PDFKit 原卷系统打印及系统路径别名支持。SQLite Schema 9、备份 v1、资源包协议、DEC-039～041 沿用。Windows Win32、WebView2 和 NSIS 保留。实现与推送、可用环境验收、实机验收和独立审查分别记录。

## macOS CI 与 PDF

官方 `macos-15` Apple Silicon VM 完成 arm64 构建、测试及 `.app`／`.dmg` 验证。AppKit 异步打印 PoC 两次输出 10 页 A4，核对中文、公式、图片、表格和分页。首次同步试验的空白页失控已修复。 [CI 设计](DEV-012_CI_DESIGN.md) · [PDF PoC](DEV-012_PDF_POC.md)

运行环境为 macOS 15.8.2（24H232）、Xcode 16.4、Rust 1.100.0、Node 24.13.0、Tauri CLI 2.12.5。Mac 原生 Rust 75 项和前端 34 项通过。Preview 包实测为 arm64，DMG 完整性、应用内容、签名及挂载结构均通过检查。Gatekeeper 对 ad-hoc 包的分发评估为 rejected。

构建提交为 `c6ed30ae2b2859f9bd9332fb8529acd63a64f311`。DMG 共 9,459,855 字节，下载后独立重算 SHA-256 为 `18c501a49987c0fd3958767af5e82bf3c41a12d244d6c643a594cce5718cb816`。Artifact ZIP 与内部 `.app.zip` 的哈希均另行核对。该运行的三个 Job 全部成功。 [Actions 运行](https://github.com/ghost114541/shandong-study-platform/actions/runs/44905827205) · [DMG、App 和应用证据 Artifact](https://github.com/ghost114541/shandong-study-platform/actions/runs/44905827205/artifacts/14707503549) · [构建 Manifest](poc-001b/output/dev012/macos-manifest.json) · [包 SHA-256](poc-001b/output/dev012/macos-SHA256SUMS)

原生隔离应用用正式入口导出一份示例 PDF 和 20／30／50 题双卷，拒绝错配的组卷快照。输出经 PDF 解析、各页 MediaBox、题号、长材料、图片、公式字体、答案分隔、边界和空白页检查。Mac 应用也渲染了 100 页扫描 PDF 并跳至第二页。该 VM 单次 20／30／50 题双卷耗时分别为 730／838／1050 ms，扫描卷首屏为 286 ms。抽查发现一处小问分值标题与正文分列相邻两页，文字完整。 [审批范围与视觉结果](DEV-012_PDF_VALIDATION.md) · [Mac 应用验证数据](poc-001b/output/dev012/macos-shared-fixture/pdf-summary.json) · [实际页面抽样](poc-001b/output/dev012/macos-app-pdf-pages.png)

## 跨平台数据

新增 Windows 原生合成归档生成、Mac 原生候选库切换、Mac 再备份和业务表与内容哈希对照程序。Windows 合成资料从既有 DEV-010 夹具生成，包含新增的原创组卷和 100 页扫描样本。 [迁移设计与复现](DEV-012_BACKUP_MIGRATION.md)

Windows → Mac CI → 独立 Windows 库的原生数据层往返通过。回读和三份归档核对了 43 张业务表、102 条组卷固定修订引用及 131 项外部或兼容文件。Mac VM 数据层恢复与再次备份的单次样本耗时分别约 0.68 秒和 0.60 秒。 [往返证据](poc-001b/output/dev012/roundtrip-fingerprints.json) · [SHA-256 与原始耗时](poc-001b/output/dev012/migration-and-performance.json)

E2E-007 尚未使用 Mac 实机 GUI 完成。Apple Silicon 安装、重装、系统打印和交互数据验收仍待进行。 [实机复现](DEV-012_MACOS_INSTALL_DESIGN.md)

## Windows 回归

Windows 11 x64 本机经 MSVC 重建 NSIS。Rust 69 项库测试与 9 项应用测试通过，TypeScript 34 项通过。Windows 原生隔离工作区通过单题、双 PDF、图片及附件失败防护、检索和收藏、原卷三角色、批量扫描、跨页截图、双向定位和重开。组卷测试还复跑了快照错配与双卷部分失败保护。Windows 原生打印面板通过 Microsoft Print to PDF 保存了所选原卷第 1 页，并核对了实际渲染。最终构建提交的 Windows CI 亦成功。 [Windows 构建产物](https://github.com/ghost114541/shandong-study-platform/actions/runs/44905827232/artifacts/14707533723) · [系统打印输出](poc-001b/output/dev012/windows-system-printed-original.pdf) · [验收矩阵](DEV-012_TEST_RESULTS.md)

## 交付边界

Mac 目标为 arm64，Preview 0.2.1，macOS 13.0 为临时最低打包版本。内部包使用 ad-hoc 签名。缺少 Apple Silicon 实机，因此未宣称正式跨平台兼容通过。待网页端 ChatGPT 独立源码审查。 [安装设计](DEV-012_MACOS_INSTALL_DESIGN.md) · [平台兼容](DEV-012_PLATFORM_COMPATIBILITY.md) · [已知问题](DEV-012_KNOWN_ISSUES.md)
