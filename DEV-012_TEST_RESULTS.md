# DEV-012 验收矩阵

| 编号 | 状态 | 证据范围 |
| --- | --- | --- |
| DEV012-T01 | PASS | 官方 GitHub arm64 VM 原生 Rust 测试与 Release 构建。 |
| DEV012-T02 | PASS | Mac CI npm ci、TypeScript 类型检查、34 项前端测试及 Vite 构建。 |
| DEV012-T03 | PASS | arm64 Mach-O、可执行文件及 AppKit、WebKit、PDFKit 链接检查。 |
| DEV012-T04 | PASS | DMG 完整性、只读挂载、包比对与 Applications 链接。 |
| DEV012-T05 | PASS | Preview Bundle ID、显示名、0.2.1、临时最低版本及系统图标。 |
| DEV012-T06 | PASS | 官方 arm64 运行器全部 Job 通过。下载后核对 Artifact ZIP 及内部 DMG 的 SHA-256。 |
| DEV012-T07 | BLOCKED | 缺少 Apple Silicon 实机及独立账户。 |
| DEV012-T08 | CONDITIONAL PASS | Mac 数据层在隔离空库初始化 Schema 9，实机安装后的首次初始化待测。 |
| DEV012-T09 | CONDITIONAL PASS | Mac 自动化覆盖九学科与知识点测试，实机知识树交互待测。 |
| DEV012-T10 | NOT TESTED | 中文输入法、粘贴、Cmd、撤销重做等实机流程待测。表格见已知问题。 |
| DEV012-T11 | CONDITIONAL PASS | Mac Rust 附件导入、保存、去重与哈希检查，Mac 文件选择器待测。 |
| DEV012-T12 | CONDITIONAL PASS | Mac CI 隔离应用显示 100 页扫描原卷并跳页。实机搜索、缩略图、旋转、切换原卷角色待测。 |
| DEV012-T13 | NOT TESTED | Mac 实机截图、跨页区域和保存附件待测。 |
| DEV012-T14 | NOT TESTED | Mac 实机双向跳转待测。 |
| DEV012-T15 | CONDITIONAL PASS | Mac CI 隔离应用通过正式入口导出示例 PDF。安装包实机及 SQLite 单道题交互待测。 |
| DEV012-T16 | CONDITIONAL PASS | Mac CI 隔离应用完成 20、30、50 题题卷导出，错误快照身份被拒绝。实机待测。 |
| DEV012-T17 | CONDITIONAL PASS | 同三组在 Mac CI 应用生成独立答案卷，核对题号与题卷隔离。实机待测。 |
| DEV012-T18 | CONDITIONAL PASS | PoC 两次 10 页 A4，实际应用双卷通过 A4、中文、公式、图文、题号及分页检查。代表性复杂表格、地图和实机视觉待测。 |
| DEV012-T19 | BLOCKED | 需要 Mac 实机打开 PDFKit 系统打印面板并存储 PDF。 |
| DEV012-T20 | CONDITIONAL PASS | Mac 自动化覆盖收藏及固定修订，实机交互待测。 |
| DEV012-T21 | CONDITIONAL PASS | Mac Rust 测试覆盖安装、重复、升级、损坏及个人版保护。原生对话框待测。 |
| DEV012-T22 | BLOCKED | 完整 E2E-007 需要在 Apple Silicon 实机经 GUI 选择、恢复、退出并重启。 |
| DEV012-T23 | CONDITIONAL PASS | Windows → Mac CI → Windows 对照 43 张业务表和 102 条固定组卷引用一致。实机 GUI 核对待测。 |
| DEV012-T24 | CONDITIONAL PASS | Windows → Mac CI → Windows 对照 65 项图片和 65 项 PDF 内容哈希一致。Mac 实机原卷定位和附件重定位待测。 |
| DEV012-T25 | CONDITIONAL PASS | 自动化覆盖草稿持久化及恢复，Mac 异常退出交互待测。 |
| DEV012-T26 | CONDITIONAL PASS | Mac 数据层覆盖回收站与诊断，实机界面待测。 |
| DEV012-T27 | BLOCKED | 外置 `/Volumes`、大小写敏感 APFS 和文件选择器迁移需要实机。 |
| DEV012-T28 | CONDITIONAL PASS | Mac 自动化覆盖损坏文件、候选验证及回退。实机断电和用户交互待测。 |
| DEV012-T29 | BLOCKED | 需要实机执行卸载重装及回读。 |
| DEV012-T30 | BLOCKED | 实机冷／热启动、进程内存和外置盘吞吐待测。CI 样本时序另存。 |
| DEV012-T31 | CONDITIONAL PASS | x64 NSIS 重建、原生 WebView2 单题与双卷、数据库、附件、原卷、检索、收藏、备份往返通过。Windows 系统打印保存和核对了 1 页真实 PDF。Windows 安装升级与卸载的全部历史故障专项未逐项重跑。 |
| DEV012-T32 | CONDITIONAL PASS | 双平台自动化及 Windows 专项原生样本已执行。完整实机综合矩阵待测。 |

Mac 证据仅来自 GitHub Actions VM。Windows 本机使用 Windows 11 x64、独立试验标识与合成资料。既有安装版本及用户资料保持原状。 [开发报告](DEV-012_REPORT.md) · [PDF 验证](DEV-012_PDF_VALIDATION.md) · [输出目录](poc-001b/output/dev012/)
