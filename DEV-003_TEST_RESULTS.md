# DEV-003 Windows 验收

日期 2026-11-17。桌面回归使用 `org.shandong-study.dev003-05396590f9`，既有测试库的升级使用 `org.shandong-study.dev003-29406d2211`。两者都属于独立 Tauri 测试配置。Rust 使用临时文件，合成检索样本没有引入正式学习资源。

## 12 项实测结果

| 编号 | 结果 | 实际验证 |
|---|---|---|
| DEV003-T01 审核有效期 | PASS | Rust 以固定日历日期测试未审核、未来、到期日、次日、争议、不通过和重新通过，并逐项对照有效通过数。Windows 实测未审核、过期与未来通过记录不提前生效。 |
| DEV003-T02 九学科 | PASS | SQLite 空库启动及两次原生启动均返回九学科，数学仍是 `math`。迁移与重启后数学题引用保持。 |
| DEV003-T03 知识树 | PASS | Rust 验证父子项与兄弟排序。Windows 实际创建三级树并展开、收起。 |
| DEV003-T04 错误层级 | PASS | 外键拒绝不存在及跨学科父节点。直接自引用、两行同时插入的循环及重新挂上后代都被拒绝。 |
| DEV003-T05 用户知识点 | PASS | Rust 和窗口实测创建、改名与别名。公共演示节点原始字段禁止更新、删除、替换，可另加别名或下级。 |
| DEV003-T06 试题关联 | PASS | Rust 验证一题多点和一点多题、跨学科拒绝、解除关联、改名稳定 ID 与修订后关联持久。Windows 关联两点并解除一个，修订原始 JSON 不变。 |
| DEV003-T07 层级检索 | PASS | Rust 和 Windows 均验证父点含后代与仅直属两种查法。 |
| DEV003-T08 组合检索 | PASS | 学科、节点、中文关键词组合可命中。验证跨富文本标记、字面特殊符号、超长输入、当前可见修订、同题多出处／多关联去重。 |
| DEV003-T09 分页与性能 | PASS | 分别生成 10,000 和 50,000 道合成逻辑题。逐页取完全部结果，核对顺序、总数、末页和无重复。实际延迟、大小及查询计划见下表与日志。 |
| DEV003-T10 升级 | PASS | Rust 以真实 Schema 1 文件验证旧知识点、审核、公共／用户修订和固定组卷引用，且注入迁移冲突验证回滚。以 SQLite 备份复制 DEV-002 桌面实测库后，Windows 两次实际启动，迁移历史仅增加版本 2，原始题目、小问、审核及修订 JSON 完全一致。用原修订 ID 重新导出的题卷及答案卷与 DEV-002 逐页像素相同。 |
| DEV003-T11 Windows 闭环 | PASS | 原生窗口进程 PID 24636 创建用户知识点并关联试题。关闭重启到 PID 26528，通过组合过滤仅命中一道题，点开原题能看到保留的关联。 |
| DEV003-T12 旧功能 | PASS | TypeScript 32 项，Rust 22 项数据库测试及 2 项旧 JSON，POC-001 12 项。隔离原生窗口复跑首次 SQLite 保存、重启、公式、图片、小问、修订、审核隔离、忙锁与 WebView2 PDF；旧 JSON 异常处理及模拟离线重新加载通过。三份旧 PDF 与基准逐页像素一致。 |

正式题库的冷缓存端到端延迟、macOS、物理断网、实体打印、打包安装／卸载为 **NOT TESTED**。

## DEV003-T09 实际基准

Windows 11 x64，Intel Core i7-14650HX，16 核／24 线程，约 15.64 GiB RAM，NVMe SSD；Rust 测试构建，应用绑定 SQLite 3.54.1。每次为独立临时库，含一道修订每题，使用 `ANALYZE` 和 WAL checkpoint。计时为已打开连接上的 SQL 查询和 Rust 结果转换，每项 30 次。结果不含 IPC、界面渲染或首次冷读。

| 合成逻辑题 | 数据库主文件 | 组合分页 | 组合第 1 页 P50 / P95 | 组合第 31 页 P50 / P95 | 无学科和知识点的关键词第 61 页 P50 / P95 |
|---:|---:|---|---:|---:|---:|
| 10,000 | 8,237,056 B | 858 道，35 页，末页 8 道 | 3.306 / 3.488 ms | 15.845 / 16.613 ms | 19.033 / 21.346 ms |
| 50,000 | 40,570,880 B | 4,286 道，172 页，末页 11 道 | 45.624 / 50.609 ms | 128.687 / 135.867 ms | 87.640 / 95.185 ms |

每页 25 道。两档 WAL 文件 checkpoint 后均为 0 B。查询计划使用 `question_subject_identity`、知识点主键、重复题主键、`question_revision_selection`、修订组合索引及投影主键。样本的直接链接集中在一个节点，优化器对层级子节点与链接选择扫描；完整计划见日志。

## 实际命令及日志

命令从 `poc-001b/` 执行，使用原生 MSVC x64 环境。各日志末尾记录退出状态。

| 命令 | 结果 | 日志 |
|---|---|---|
| 阶段 A `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml` | 0 | [Rust](poc-001b/output/dev003/logs/dev003-a-rust.log) |
| 阶段 A `npm.cmd run typecheck` 与 `npm.cmd test` | 均为 0 | [类型检查](poc-001b/output/dev003/logs/dev003-a-ts.log) · [单测](poc-001b/output/dev003/logs/dev003-a-js.log) |
| 阶段 B `npm.cmd run typecheck` 与 `npm.cmd test` | 均为 0，最终构建也执行类型检查 | [类型检查](poc-001b/output/dev003/logs/dev003-ts.log) · [单测](poc-001b/output/dev003/logs/dev003-npm.log) |
| `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml -- --nocapture` | 0，含默认 10,000 题实测 | [Rust 与查询计划](poc-001b/output/dev003/logs/dev003-final-rust.log) |
| 设 `DEV003_SYNTHETIC_COUNT=50000`，运行 `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml dev003_t09 -- --nocapture` | 0 | [50,000 题](poc-001b/output/dev003/logs/dev003-perf-50000.log) · [硬件](poc-001b/output/dev003/logs/dev003-hardware.log) |
| `npm.cmd run tauri build -- --debug --no-bundle --config .test-output/dev003-final-isolated-config.json` | 0 | [Tauri 构建](poc-001b/output/dev003/logs/dev003-final-build.log) |
| `node tests/windows-webview.mjs src-tauri/target/debug/shandong-poc-001b.exe --sqlite` | 0 | [SQLite、修订、WebView2 复跑](poc-001b/output/dev003/logs/dev003-final-desktop-sqlite.log) |
| 同一命令改为 `--knowledge` | 0 | [审核、知识点、检索](poc-001b/output/dev003/logs/dev003-final-desktop-knowledge.log) |
| 同一命令省略模式 | 0 | [旧 JSON 窗口](poc-001b/output/dev003/logs/dev003-final-desktop-legacy.log) |
| `python tests/check-sqlite-pdf.py .test-output/org.shandong-study.dev003-05396590f9/sqlite --render .test-output/org.shandong-study.dev003-05396590f9/sqlite/pages` | 0 | [真实 SQLite PDF](poc-001b/output/dev003/logs/dev003-pdf-sqlite.log) |
| `python tests/check_pdf.py .test-output/org.shandong-study.dev003-05396590f9/legacy --render .test-output/org.shandong-study.dev003-05396590f9/legacy/pages` | 0 | [旧 PDF](poc-001b/output/dev003/logs/dev003-pdf-legacy.log) · [逐页像素](poc-001b/output/dev003/logs/dev003-legacy-pixels.log) |
| `python tests/sqlite-probe.py copy-schema-one $source $destination`；Tauri 构建改用 `.test-output/dev003-upgrade-config.json`；桌面测试改为 `--upgrade` | 均为 0 | [只读原库备份](poc-001b/output/dev003/logs/dev003-backup.log) · [迁移构建](poc-001b/output/dev003/logs/dev003-upgrade-build.log) · [两次启动](poc-001b/output/dev003/logs/dev003-desktop-upgrade.log) · [旧版 PDF 像素比较](poc-001b/output/dev003/logs/dev003-upgrade-pixels.log) |
| `python ../poc-001/tests/test_poc.py` | 0 | [POC-001](poc-001b/output/dev003/logs/dev003-poc001.log) |

初轮 Rust 性能用例超过 60 秒，主动终止，日志退出 -1。查询视图连接补上等价键条件后通过。首轮 Windows SQLite 与知识点测试均因 Python 自带 SQLite 3.42.0 无法解析聚合函数内的排序语法而退出 1。投影视图改为有序子查询后，以新隔离配置复跑通过。[初轮 Rust](poc-001b/output/dev003/logs/dev003-rust-initial.log) · [初轮 SQLite 桌面](poc-001b/output/dev003/logs/dev003-desktop-sqlite-first.log) · [初轮知识点桌面](poc-001b/output/dev003/logs/dev003-desktop-knowledge-first.log)

## Windows 桌面复跑

从原生 MSVC x64 开发环境进入 `poc-001b/`。测试需要 Python 与用于 PDF 检查的 PyMuPDF。每轮生成隔离标识，禁止使用日常应用标识。

```powershell
New-Item -ItemType Directory -Force .test-output | Out-Null
$env:POC001B_TEST_APP_IDENTIFIER = 'org.shandong-study.dev003-' + [guid]::NewGuid().ToString('N').Substring(0,10)
$config = '.test-output/dev003-isolated-config.json'
@{ identifier = $env:POC001B_TEST_APP_IDENTIFIER } | ConvertTo-Json -Compress | Set-Content -LiteralPath $config -Encoding ascii
npm.cmd run tauri build -- --debug --no-bundle --config $config
$exe = 'src-tauri/target/debug/shandong-poc-001b.exe'
node tests/windows-webview.mjs $exe --sqlite
node tests/windows-webview.mjs $exe --knowledge
node tests/windows-webview.mjs $exe
$out = Join-Path .test-output $env:POC001B_TEST_APP_IDENTIFIER
python tests/check-sqlite-pdf.py "$out/sqlite" --render "$out/sqlite/pages"
python tests/check_pdf.py "$out/legacy" --render "$out/legacy/pages"
```

复跑升级时生成另一独立标识。使用 DEV-002 桌面测试留下的 `study.sqlite3` 为 `$source`，以新标识下的 `study.sqlite3` 为 `$destination`，执行 `copy-schema-one`，按新标识构建，再运行 `--upgrade`。测试对原始修订及审核逐字段比对。PDF 像素比较将两组 PDF 逐页交给同一个 PyMuPDF 渲染器，并比较像素摘要。

## 交付证据

- [知识点树](poc-001b/output/dev003/desktop-knowledge-tree.png) · [组合检索](poc-001b/output/dev003/desktop-knowledge-search.png) · [打开试题与关联](poc-001b/output/dev003/desktop-linked-question.png)
- [Windows 关联记录](poc-001b/output/dev003/knowledge-evidence.json) · [Schema 1 到 2 的真实库升级证据](poc-001b/output/dev003/migration-evidence.json) · [SQLite 修订保存证据](poc-001b/output/dev003/sqlite-evidence.json)
- [SQLite 题卷](poc-001b/output/dev003/revision-2-paper.pdf) · [新修订答案卷](poc-001b/output/dev003/revision-2-answers.pdf) · [上一修订答案卷](poc-001b/output/dev003/revision-1-answers.pdf)
