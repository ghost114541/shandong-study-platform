# DEV-012 收尾证据

本目录提交合成测试产生的 PDF、自动化日志、抽样页面、应用计时、归档指纹和失败记录。Windows 日志中的本机账户名已替换。完整 Windows 测试输出保存在本机 `poc-001b/.test-output/dev012-closeout-raw/`，输入、返程归档和产物 SHA-256 可按清单独立核验。

- `windows-pdf/` 保存实际 WebView2 的单份和 20／30／50 题双卷，`windows-sqlite-single.pdf` 来自正式 SQLite 单题。两个平台抽样页面来自实际 PDF 栅格化。
- `roundtrip-fingerprints.json` 比较 Windows CI → Mac CI → 本机 Windows 的 43 张表、102 条固定组卷记录及 131 个文件哈希。
- `failed-attempts/` 保存初次编译、测试工具、夹具和 Mac 内容检查的失败记录。生命周期注入是否真正触发，由应用报告及本轮 CI 日志确定。
- macOS 与 Windows 线上产物下载入口及实际测试 SHA 见项目测试矩阵。Actions 原始 Artifact 受 14 天保留期约束，本地样例和指纹永久放入分支。 [收尾测试矩阵](../../../DEV-012_CLOSEOUT_TEST_RESULTS.md)

复现 Windows 真实输出检查可运行 `python tests/macos-app-check.py --inspect <app-smoke.json> <evidence-dir>`。原生应用通过 `node tests/windows-webview.mjs <isolated-exe> --dev012-fixture` 启动，隔离用户资料先用已核验的 `windows.knowbackup` 中的 SQLite 数据和登记资源初始化。备份中用于旧版兼容的 questions.json 单独留在归档，此应用夹具使用内置演示。现有 SQLite 原生单题验证使用 `tests/check-sqlite-pdf.py`。Mac PDFKit 检索使用 `swift tests/macos-pdf-search.swift <paper-20.pdf> <paper-30.pdf> <paper-50.pdf>`。 [迁移复现](../../../DEV-012_BACKUP_MIGRATION.md)

Windows 历史专项在 .test-output/dev012-closeout-native/ 中运行。试验副本将旧 DEV-012 测试标识的允许项替换为本轮新建的合成标识，断言保持原样。普通 PDF 夹具从已有合成文件复制，故障恢复用 --debug --features dev010-test-hooks 构建，专项输出写入隔离目录。线上产物按记录的 SHA 下载，Windows 本地生成的 PDF 由复测程序重新读取实际文件。

`evidence.sha256` 按提交到 Git 的实际字节生成。启用 CRLF 转换的 Windows 工作区可用 `git show HEAD:<仓库相对路径>` 读取原始字节核对文本文件。包及备份文件的 SHA-256 来自原始二进制。
