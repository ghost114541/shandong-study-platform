# DEV-002 Windows 验收结果

日期 2026-11-17。在 Windows 原生 MSVC、Windows SDK 10.0.26100、Node 24、Rust 和 WebView2 上执行。SQLite 闭环使用独立 Tauri 标识 `org.shandong-study.dev002-225974f8d8`，旧功能桌面回归使用 `org.shandong-study.dev002-6fb7ae3f87`。数据库单元测试使用独立临时文件。

## 验收表

| 用例 | 结果 | 实测证据 |
|---|---|---|
| DEV002-T01 跨语言契约 | PASS | Rust 和 TypeScript 对同一份 27 个正反样本逐条判定。另核对 POC 样本的公式、图引用和小问 ID。 |
| DEV002-T02 首次创建 | PASS | Windows UI 新建数学题并保存，独立 SQLite 查询读到题目 `1536721e-bbeb-4202-9abc-9910e94a4b3b`、用户修订 #1 及两个小问 ID。Rust 还验证创建失败时整笔回滚。 |
| DEV002-T03 真正关闭重启 | PASS | 原生窗口正常退出，应用 PID 36724、28152、25528 三次启动。先回读 #1，再回读默认的 #2。 |
| DEV002-T04 公式和图片 | PASS | 重启动后核对两条精确 LaTeX（含原始空格）、同一内嵌 PNG、小问 ID 和分值。窗口成功渲染公式并解码图片。 |
| DEV002-T05 修订不可变 | PASS | 保存生成以 #1 为基线的 #2。对比 #1 完整 SQLite JSON 原串不变；历史可读。旧基线 IPC 请求返回 `conflict`。Rust 用两条独立连接复测。 |
| DEV002-T06 公共资源保护 | PASS | Rust 临时 SQLite 测试在公共版上创建用户修订，回读公共原版内容一致，当前指向用户修订。 |
| DEV002-T07 审核隔离 | PASS | #1 登记审核通过后，桌面回读审核通过。#2 无审核记录，历史 #1 仍显示通过。 |
| DEV002-T08 SQLite PDF | PASS | WebView2 实际输出三份 A4 PDF，各一页。修订 #2 题卷含中文、两条公式、真实图像、题号和两小问 4／6 分；答案卷仅呈现答案。比较 #1 与 #2 答案文本确认修改生效。自动校验后渲染并查看三页。 |
| DEV002-T09 保存失败 | PASS | 桌面先模拟空题型，再由独立 SQLite 连接持有写锁。两次失败后数据库仍只有 #1，草稿留在编辑器。原生关闭提示可取消，解锁后正常保存。 |
| DEV002-T10 旧功能 | PASS | TypeScript 32 项；Rust 15 项数据库与 2 项 JSON；POC-001 12 项。Windows 旧 JSON 回读、模拟离线、异常 JSON 均通过。原三份 PDF 分别 1／1／5 页，逐页渲染像素与基准一致。 |

额外范围为 **NOT TESTED** 的项目包括 macOS 实机、安装卸载、物理断网、实体打印及同一时间运行两个桌面窗口。并发保护已在两条实际数据库连接和桌面 IPC 的过期基线测试中验证。

## 命令、退出状态与日志

命令从 `poc-001b/` 执行。Rust 命令使用已有 MSVC、SDK 环境初始化脚本；PDF 检查使用环境中已安装的 PyMuPDF。

| 命令 | 退出状态 | 日志 |
|---|---|---|
| 阶段 A `npm.cmd run typecheck` | 0 | [类型检查](poc-001b/output/dev002/logs/dev002-a-typecheck.log) |
| 阶段 A `npm.cmd test` | 首次 1，补回原图片错误标签后 0 | [首次](poc-001b/output/dev002/logs/dev002-a-npm-test.log) · [重试](poc-001b/output/dev002/logs/dev002-a-npm-test-retry.log) |
| 阶段 A `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml` | 0 | [Rust 测试](poc-001b/output/dev002/logs/dev002-a-rust.log) |
| 阶段 B `cargo check --offline --locked --manifest-path src-tauri/Cargo.toml` | 0 | [Cargo 检查](poc-001b/output/dev002/logs/dev002-cargo-check.log) |
| 最终 `npm.cmd run typecheck`、`npm.cmd test`、`cargo test --offline --locked --manifest-path src-tauri/Cargo.toml` | 均为 0 | [类型检查](poc-001b/output/dev002/logs/dev002-final-typecheck.log) · [前端](poc-001b/output/dev002/logs/dev002-final-npm-test.log) · [Rust](poc-001b/output/dev002/logs/dev002-final-rust-test.log) |
| `npm.cmd run tauri build -- --debug --no-bundle --config .test-output/dev002-final-isolated-config.json` | 0 | [Windows 构建](poc-001b/output/dev002/logs/dev002-final-tauri-build.log) |
| `node tests/windows-webview.mjs src-tauri/target/debug/shandong-poc-001b.exe --sqlite` | 首次及诊断 1。修正图片插入及探针后为 0；全新隔离复验 0 | [首次](poc-001b/output/dev002/logs/dev002-desktop-sqlite.log) · [诊断](poc-001b/output/dev002/logs/dev002-desktop-sqlite-diagnostic.log) · [重试](poc-001b/output/dev002/logs/dev002-desktop-sqlite-retry.log) · [最终](poc-001b/output/dev002/logs/dev002-final-desktop-sqlite.log) |
| `python tests/check-sqlite-pdf.py .test-output/org.shandong-study.dev002-225974f8d8/sqlite --render .test-output/org.shandong-study.dev002-225974f8d8/sqlite/pages` | 0 | [SQLite PDF 校验](poc-001b/output/dev002/logs/dev002-final-pdf-sqlite.log) |
| `node tests/windows-webview.mjs src-tauri/target/debug/shandong-poc-001b.exe` | 0 | [旧桌面回归](poc-001b/output/dev002/logs/dev002-desktop-legacy.log) |
| `python tests/check_pdf.py .test-output/org.shandong-study.dev002-6fb7ae3f87/legacy --render .test-output/org.shandong-study.dev002-6fb7ae3f87/legacy/pages` | 0 | [旧 PDF 检查](poc-001b/output/dev002/logs/dev002-pdf-legacy.log) · [逐页像素比较](poc-001b/output/dev002/logs/dev002-legacy-pixels.log) |
| `python ../poc-001/tests/test_poc.py` | 0 | [POC-001 回归](poc-001b/output/dev002/logs/dev002-poc001-regression.log) |

准备时直接调用 Cargo 获取退出 1，终端提示找不到 `cl.exe`。加载 DEV-001 同一套原生编译环境后通过。第一次桌面试跑同时暴露了探针误选 ProseMirror 占位图、图片插入可替换选中的公式节点。重跑增加条件，逐一核对真图片和两条公式。

## Windows 桌面复跑

在 MSVC x64 开发终端中运行。每次生成独立应用标识。传入的标识需与测试构建一致。

```powershell
cd poc-001b
New-Item -ItemType Directory -Force .test-output | Out-Null
$env:POC001B_TEST_APP_IDENTIFIER = 'org.shandong-study.dev002-' + [guid]::NewGuid().ToString('N').Substring(0,10)
$config = '.test-output/dev002-isolated-config.json'
@{ identifier = $env:POC001B_TEST_APP_IDENTIFIER } | ConvertTo-Json -Compress | Set-Content -LiteralPath $config -Encoding ascii
npm.cmd run tauri build -- --debug --no-bundle --config $config
$exe = 'src-tauri/target/debug/shandong-poc-001b.exe'
node tests/windows-webview.mjs $exe --sqlite
node tests/windows-webview.mjs $exe
$out = Join-Path .test-output $env:POC001B_TEST_APP_IDENTIFIER
python tests/check-sqlite-pdf.py "$out/sqlite" --render "$out/sqlite/pages"
python tests/check_pdf.py "$out/legacy" --render "$out/legacy/pages"
```

## 交付证据

- [修订 #2 题卷](poc-001b/output/dev002/revision-2-paper.pdf) · [修订 #2 答案卷](poc-001b/output/dev002/revision-2-answers.pdf) · [修订 #1 答案卷](poc-001b/output/dev002/revision-1-answers.pdf)
- [Windows 重启回读](poc-001b/output/dev002/desktop-reopened-sqlite.png) · [历史修订与审核](poc-001b/output/dev002/desktop-history-approved.png) · [题卷预览](poc-001b/output/dev002/paper-revision-2.png) · [答案卷预览](poc-001b/output/dev002/answers-revision-2.png)
- [SQLite 首次保存与二次修订记录](poc-001b/output/dev002/sqlite-evidence.json)
