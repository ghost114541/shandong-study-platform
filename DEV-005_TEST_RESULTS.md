# DEV-005 Windows 验收

2026-11-17，Windows 11 x64（Build 26200）、WebView2 157.0.4341.46、Rust 1.100.0 MSVC、Node 24.13.0、Python 3.12。常规原生验收使用 `org.shandong-study.dev005-b5381f2e01`，升级使用 `org.shandong-study.dev005-d13c19479e`。使用合成试题、原创教学示意图与上一轮隔离测试库备份。

| 用例 | 结果 | 实际验证 |
|---|---|---|
| T01 同卷唯一表单 | PASS | 两个 SQLite 连接验证并发冲突和公共原卷、修订内容。Windows React 验证一个表单列出两个题位，冲突保留草稿，重读后保存成功并同步两题位。 |
| T02 固定预览修订 | PASS | 检索取得 A 后写入 B。侧栏仍加载 A，完整试题打开 A 为只读，明确读取 B 后可编辑。晚到回包被丢弃，返回保留筛选及第 2 页。 |
| T03 实际图片导入 | PASS | Rust 在真实目录保存并重读 PNG、JPEG、WebP、GIF。另解码两帧 GIF 并拒绝截断的后续帧。Windows 文件选择器载入 PNG。 |
| T04 哈希与去重 | PASS | 四种格式各导入两次，重复导入复用 ID 和文件。测试核对磁盘字节、SQLite 行、独立计算的 SHA-256 及文件数。 |
| T05 异常与目录限制 | PASS | 拒绝非图片、已识别但无法解码的图片、错误 MIME、超 5 MiB 输入、非法 ID、绝对路径和穿越。Windows 真实文件独占及目录联接拒绝访问，库外目标未改动。 |
| T06 导入故障恢复 | PASS | 暂存路径被目录阻塞时无正式文件，React 草稿和两条公式保留。模拟进程留下部分暂存及 SQLite 触发器拒绝登记，验证无可读取的半成品登记，同字节重试恢复。 |
| T07 SQLite 重启回读 | PASS | 在 Windows 用真实 PNG 编辑并保存题干和答案，核对 JSON 只含稳定引用及声明。正常关闭进程后重新启动，打开同一题并解码图片。 |
| T08 历史修订与组卷 | PASS | 两道题共用文件。后续修订删除图片并追加公共修订后，历史修订、组卷固定引用和附件引用数仍正确。 |
| T09 原生侧边预览 | PASS | 显示外部 PNG、数学和化学公式、两个小问。展开答案后才读答案图片。延迟实际图片 IPC 回包并切题，另一题保持正确。 |
| T10 缺失和损坏 | PASS | 隔离环境实际删除、篡改文件，检测缺失和 SHA-256 错误。诊断 API 在缺失时仍可读引用数。重新导入同字节恢复原 ID。 |
| T11 外部附件 PDF | PASS | WebView2 输出独立题卷及答案卷，两份各 1 页，A4 尺寸 594.96 × 841.92 pt。每份内嵌 170 × 100 PNG 的全部 17,000 像素与原图一致。核对中文、KaTeX、化学式、分值、小问和答案分离，并查看渲染页面。 |
| T12 不完整 PDF 拦截 | PASS | 暂留真实图片 IPC 时拦截。图片已经显示后篡改磁盘文件，Rust 再校验并拦截。预览加载到缺失或损坏状态时也拦截，确认目标路径无 PDF。 |
| T13 旧格式兼容 | PASS | 原 POC-001B JSON 模拟离线回读、编辑、非法文件提示和 PDF 通过。真实 DEV-004 库中的旧 SQLite Base64 图片经升级后在侧栏、编辑器和 PDF 中可用。 |
| T14 综合回归 | PASS | Rust 34 项数据层测试、2 项旧 JSON 存储测试，前端 32 项，POC-001 12 项。原生 SQLite 编辑、知识库、高级检索、旧 JSON 和 Schema 4 升级通过。六份旧基准 PDF 逐页渲染像素一致。 |

## 命令与日志

以下命令从 `poc-001b/` 运行。隔离配置仅覆盖 Tauri identifier。原生文件选择和窗口操作通过已有 CDP 验收脚本驱动。PDF 检查需 Python 可导入 PyMuPDF。

| 命令 | 退出码 | 日志 |
|---|---|---|
| 阶段 A `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml` 与 `npm.cmd run typecheck` | 0 / 0 | [Rust](poc-001b/output/dev005/logs/stage-a-rust.log) · [TypeScript](poc-001b/output/dev005/logs/stage-a-ts.log) |
| 阶段 A Windows 隔离构建，原生脚本 `--sqlite --stage-a` 和 `--advanced --stage-a` | 0 / 0 / 0 | [构建](poc-001b/output/dev005/logs/stage-a-build.log) · [SQLite](poc-001b/output/dev005/logs/stage-a-sqlite.log) · [高级检索](poc-001b/output/dev005/logs/stage-a-advanced.log) |
| `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml -- --nocapture` | 0 | [Rust 测试](poc-001b/output/dev005/logs/rust-passed.log) |
| `npm.cmd test`、`python ../poc-001/tests/test_poc.py` | 0 / 0 | [前端](poc-001b/output/dev005/logs/npm-test.log) · [POC-001](poc-001b/output/dev005/logs/poc001-python.log) |
| `npm.cmd run tauri build -- --debug --no-bundle --config .test-output/dev005-verified-config.json`，含 TypeScript 类型检查 | 0 | [原生构建](poc-001b/output/dev005/logs/windows-build-passed.log) |
| `node tests/windows-webview.mjs .test-output/dev005-verified.exe`，依次加 `--sqlite`、`--knowledge`、`--advanced`、`--attachments` 和无参数旧 JSON 模式 | 均为 0 | [SQLite](poc-001b/output/dev005/logs/native-sqlite.log) · [知识库](poc-001b/output/dev005/logs/native-knowledge.log) · [检索](poc-001b/output/dev005/logs/native-advanced.log) · [附件](poc-001b/output/dev005/logs/native-attachments.log) · [JSON](poc-001b/output/dev005/logs/native-legacy.log) |
| `python tests/sqlite-probe.py copy-schema-three $source $destination`，用 `.test-output/dev005-upgrade-config.json` 构建，运行 `node tests/windows-webview.mjs src-tauri/target/debug/shandong-poc-001b.exe --upgrade` | 均为 0 | [SQLite Backup](poc-001b/output/dev005/logs/schema3-backup-final.log) · [构建](poc-001b/output/dev005/logs/upgrade-build.log) · [升级回读](poc-001b/output/dev005/logs/native-upgrade.log) |
| `python tests/check-attachment-pdf.py .test-output/<标识>/attachments --render .test-output/<标识>/attachments/pages` | 0 | [附件 PDF](poc-001b/output/dev005/logs/pdf-attachments-final.log) |
| 分别以 `sqlite` 和 `legacy` 输出目录运行 `python tests/check-sqlite-pdf.py`、`python tests/check_pdf.py`；用 PyMuPDF 比较 `get_pixmap().samples` 与六份已交付基准逐页相同 | 均为 0 | [旧 SQLite PDF](poc-001b/output/dev005/logs/pdf-sqlite-final.log) · [旧 JSON PDF](poc-001b/output/dev005/logs/pdf-legacy-final.log) · [像素比对](poc-001b/output/dev005/logs/pdf-regression-pixels.log) |

阶段 A 首次启动后发现测试探针未接受 DEV-005 隔离标识。高级检索和真实库迁移的早期脚本曾在搜索按钮仍禁用时点击结果，升级脚本还误读过 ProseMirror 的占位元素。修正探针和等待条件后重测。Rust 草稿增加功能时曾因 SQL 整数转换、历史测试版本号和解码 API 类型不匹配而失败，修正后全量重跑。[执行日志](poc-001b/output/dev005/logs/)

## 交付证据

- [题卷 PDF](poc-001b/output/dev005/attachment-paper.pdf) · [答案卷 PDF](poc-001b/output/dev005/attachment-answers.pdf) · [原始 PNG](poc-001b/output/dev005/curve-dev005.png)
- [题卷渲染](poc-001b/output/dev005/attachment-paper.png) · [答案渲染](poc-001b/output/dev005/attachment-answers.png)
- [同卷表单](poc-001b/output/dev005/desktop-metadata.png) · [重启回读](poc-001b/output/dev005/desktop-reopened-attachment.png) · [侧边预览](poc-001b/output/dev005/desktop-attachment-preview.png) · [文件缺失](poc-001b/output/dev005/desktop-missing-attachment.png)
- [附件登记及引用证据](poc-001b/output/dev005/attachment-evidence.json) · [迁移历史与行数](poc-001b/output/dev005/schema-three-upgrade.json) · [迁移后的旧图](poc-001b/output/dev005/desktop-migrated-base64.png)
