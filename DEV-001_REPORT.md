# DEV-001 · SQLite 开发与 Windows 回归报告

日期 2026-11-16。开发基准为已审查的 `ccda8e1fba1120f78959f030fdad490fd31ffff3`。本地复用原仓库；开始时工作区干净，远程 `main` 同基准。开发分支为 `dev/dev-001-sqlite`。SRS DRAFT-0.2 仍待全文签核。

## 实现与验收范围

在既有 Tauri Rust 项目增加 SQLite 初始化、版本化迁移、11 张业务表、迁移历史表和当前修订视图。Rust API 支持逻辑题及小问身份、试卷出处、人工同题确认、不可变修订、逐修订审核，以及按固定修订保存和读取组卷。结构、字段、约束、索引和 POC-001B JSON 导入映射见 [DEV-001_SCHEMA.md](DEV-001_SCHEMA.md)。

Windows 原生工具链为 Rust/Cargo 1.100.0、MSVC 14.51、Windows SDK 10.0.26100。依赖锁定为 rusqlite 0.42.0、libsqlite3-sys 0.40.0（内含 SQLite 3.54.1）、sha2 0.11.1、Tauri 2.12.6。桌面回归使用现有 WebView2。React 编辑器、KaTeX、JSON 存储及 WebView2 PDF 引擎沿用基准代码。

## 数据库自动化验收

所有 Rust 测试使用临时目录中的真实 SQLite 文件。命令在 `poc-001b/` 下运行。

```powershell
cargo check --offline --locked --manifest-path src-tauri/Cargo.toml
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml
```

| 编号 | 实测 | 判定 |
|---|---|---|
| TEST-001 | 新文件自动创建。核查 12 张表、外键开启、WAL、5 秒 busy timeout、版本及迁移摘要。完整性检查通过。 | PASS |
| TEST-002 | 保存修订后重开。原迁移时间、记录数量与修订 ID 未变化。 | PASS |
| TEST-003 | 注入含建表、插入和非法 SQL 的第二版迁移。重开验证已提交的第一版数据保留，临时 DDL、写入、迁移记录和版本更新均未残留。 | PASS |
| TEST-004 | 两道逻辑题、三小问、两个原卷出处。统计返回 2／3／2，同一试卷题位不可重复。额外测试确认相同文本默认仍为两题，人工归并后仍能追踪原出处和既有组卷版本。 | PASS |
| TEST-005 | A 通过后新增 B，当前已核对数归零。验证同修订的复核链、过期、争议、失败、后续通过及无答案不能通过。 | PASS |
| TEST-006 | 用户修订优先，最初公共版本可读且内容一致。 | PASS |
| TEST-007 | 公共更新后重开数据库，个人修订继续优先，公共原版和新公共版本可分别读取。 | PASS |
| TEST-008 | 保存引用 A 的组卷，创建 B 后重开，旧卷继续绑定 A。引用缺失的组卷写入整笔回滚。 | PASS |
| TEST-009 | 删除、改写和替换修订统统失败，跨题 revision FK 及跨题组卷引用被拒绝，固定题位的替换与直接删除也被拒绝。 | PASS |
| 额外验证 | 原始 LaTeX（含空格）、结构、图与附件元数据回读；拒绝未知内容版本、无效附件、跨学科父节点；区分忙、文件访问、损坏、陌生数据库、新版本及外键损坏。 | PASS |

首次编译测试退出 101（FAIL），SQLite 的整数统计改用 `i64`，SHA-256 摘要改为显式十六进制编码。修正后上述两条命令均退出 0。Rust 输出为数据层 `12 passed; 0 failed`、既有 JSON 存储 `2 passed; 0 failed`。

## TEST-010 · POC-001B 回归

GUI 与 PDF 测试使用单独的 Tauri 应用标识。回归时检查每次窗口启动的 `database_status == 1` 和隔离 SQLite 文件存在。原应用数据目录未用于测试。

| 实际命令 | 退出状态与证据 | 判定 |
|---|---|---|
| `npm run typecheck` | 0，TypeScript 无诊断。 | PASS |
| `npm test` | 0，原有 4 项前端测试全部通过。 | PASS |
| `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml` | 0，原有 2 项 JSON 存储测试通过。 | PASS |
| `npm run tauri dev -- --no-watch --config $config` | CLI 退出 0。首轮 Win32 窗口和 SQLite 文件已出现，编辑器探针 30 秒超时（探针退出 1）。同代码重跑后 WebView2 编辑器就绪，`database_status == 1`、数据库文件和 HWND 均通过检查，窗口正常关闭（探针退出 0）。首轮超时原因未单独确认。 | PASS（重跑） |
| `npm run tauri build -- --debug --no-bundle --config $config` | 0，Vite 前端构建与 Windows 嵌入资源的 Tauri 调试可执行文件成功。 | PASS |
| `node tests/windows-webview.mjs $exe` | 0，五次真实 Win32 窗口启动；整题和小问、LaTeX、格式、图片、保存重启、WebView2 模拟离线和三类错误 JSON 回归通过。 | PASS |
| `python tests/check_pdf.py $output --render $renderDirectory` | 0，WebView2 实际生成题卷、答案卷、长题卷，页数 1／1／5，每页 594.96 × 841.92 pt。编号、分离、跨页和 36 段文本检查通过。7 张渲染图的文件 SHA-256 与基准已审查图逐页一致。 | PASS |

运行时使用仓库原验证的 Windows SDK 环境。复跑隔离构建与回归时，可在 Windows x64 原生开发终端执行以下命令。使用不同于常规的应用标识，调试测试产物也保留在独立 Cargo 目标目录。

```powershell
cd poc-001b
New-Item -ItemType Directory -Force .test-output | Out-Null
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) 'src-tauri\target\dev001-regression'
$env:POC001B_TEST_APP_IDENTIFIER = 'org.shandong-study.dev001-' + [guid]::NewGuid().ToString('N').Substring(0,10)
$config = Join-Path (Get-Location) '.test-output\dev001-isolated-config.json'
@{ identifier = $env:POC001B_TEST_APP_IDENTIFIER } | ConvertTo-Json -Compress | Set-Content -LiteralPath $config -Encoding utf8
npm run tauri build -- --debug --no-bundle --config $config
$exe = Join-Path $env:CARGO_TARGET_DIR 'debug\shandong-poc-001b.exe'
node tests/windows-webview.mjs $exe
$output = Join-Path '.test-output' $env:POC001B_TEST_APP_IDENTIFIER
$renderDirectory = Join-Path $output 'pdf-pages'
python tests/check_pdf.py $output --render $renderDirectory
```

PDF 检查使用 PyMuPDF 1.26.7。原始日志在 `poc-001b/.test-output/`，以 `dev001-` 开头，包括 `dev001-rust-test.log`、`dev001-rust-test-retry.log`、`dev001-cargo-check.log`、`dev001-typecheck.log`、`dev001-npm-test.log`、`dev001-tauri-build.log`、`dev001-webview.log` 、`dev001-pdf.log`、`dev001-dev.log` 与 `dev001-dev-window.log`。首次开发窗口探针保留在 `dev001-dev-window-first.log`。仓库保留本报告中的证据与复跑命令。

## 未执行事项

macOS 实机、发布安装包、安装／卸载、实体打印及整机断网均为 **NOT TESTED**。本任务要求的数据层可用性和已列出的 Windows 回归均有实测；正式题库与审核 UI、附件服务及故障修复 UX 见 [DEV-001_KNOWN_ISSUES.md](DEV-001_KNOWN_ISSUES.md)。
