
# DEV-009 知卷离线资源包

基准为 `dev/dev-008-favorites` 的 `9453ae8722f243208d048fa77a0a6f5c30208a36`。开发分支为 `dev/dev-009-resource-packs`。

知卷支持本地选择 `.studyzip` v1、完整性与兼容校验、预览新增和更新、确认、限额暂存、无覆盖发布、事务安装以及中断历史和恢复。知识库、题库、试卷库、收藏和组卷使用同一套已提交资源。Schema 8 建立资源包版本、文件清单、安装操作、归属与公共版本记录。既有个人修订、收藏重点、用户知识树、原卷和固定组卷继续使用原来登记的资源。

POC-003 验证了受限 ZIP 读取及真实子进程终止前后的提交顺序。正式 Windows 验收随后使用真实 Tauri EXE 在三处强制终止应用，重启检查已发布文件、SQLite、暂存清理与版本可见性。E2E-006 完成。Windows 调试测试程序 SHA-256 为 `ca3433322d3c2a9e02a2865d2e66e89b88ca8935736f41200b5d430cb8522550`。2,000 道合成题的大包在本机用约 1.78 秒安装，采样及适用边界见测试记录。

[POC-003](POC-003_REPORT.md) · [协议](DEV-009_PACK_FORMAT.md) · [Schema 8](DEV-009_SCHEMA.md) · [安全](DEV-009_SECURITY_DESIGN.md) · [安装恢复](DEV-009_INSTALL_RECOVERY_DESIGN.md) · [公共增量](DEV-009_PUBLIC_UPDATE_DESIGN.md) · [界面](DEV-009_UI_DESIGN.md) · [逐项验收与证据](DEV-009_TEST_RESULTS.md) · [已知问题](DEV-009_KNOWN_ISSUES.md) · [项目交接](PROJECT_STATUS.md)
