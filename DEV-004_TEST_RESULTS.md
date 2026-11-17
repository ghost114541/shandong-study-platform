# DEV-004 Windows 验收

日期 2026-11-17。常规桌面套件标识为 `org.shandong-study.dev004-c2169e15bb`，Schema 2 备份升级与侧栏补充复验使用 `org.shandong-study.dev004-29b33d1a77`。两者均为独立测试配置，实际用户库未用于测试。

| 用例 | 结果 | 已执行验证 |
|---|---|---|
| DEV004-T01 重复题知识点 | PASS | Rust 覆盖 A 单独关联、B 单独关联、两者同时关联和分别关联。归并前后保留 B 原始关系；同一知识点搜索与唯一题数一致。解除 A 的关系保留 B。两原卷、B 审核、B 原修订与固定组卷引用均保留。 |
| DEV004-T02 Schema 3 | PASS | 备份上一轮实际桌面 Schema 2 数据库。Windows 两次启动，原迁移历史不变并仅新增版本 3。题目、修订、审核、知识点与旧投影逐字段一致。Rust 额外用 Schema 2 固定组卷引用 B，升级重开两次保持同一内容。 |
| DEV004-T03 元数据 | PASS | 原生 UI 保存有序难度、本地标签、两条原卷与各自年份地区来源。重启后经 IPC 比对。Rust 验证创建出处失败时新原卷也回滚。 |
| DEV004-T04 多来源条件 | PASS | 任一合法出处可命中同一主逻辑题一次。年份、地区、来源拆散到两出处时不命中。包含归并成员的出处。 |
| DEV004-T05 组合筛选 | PASS | Rust 和桌面覆盖学科、知识点、题干、难度、题型、年份、地区、来源和标签的组合。验证清空、未标注与新修订题型。 |
| DEV004-T06 审核状态 | PASS | Rust 实测无记录、有效通过、到期当天、过期、未来、争议及不通过。旧修订通过而新修订未审核时，新修订只命中无审核记录。桌面复跑 DEV-003 日期行为。 |
| DEV004-T07 排序分页 | PASS | Rust 验证年份与难度升降序、等值 ID 顺序、未标注后置和末页。桌面实测 25＋5 条分页。 |
| DEV004-T08 侧边预览 | PASS | Windows 原生窗口选择 SQLite 题，预览两条公式、解码 PNG、两个小问、知识点和审核状态。未解析的外部图片只显示附件提示。 |
| DEV004-T09 答案折叠 | PASS | 默认 DOM 无答案正文；手动展开显示当前修订答案；切题后再次折叠。 |
| DEV004-T10 状态恢复 | PASS | 打开详情并返回仍在第 2 页，关键词保留。延迟真实 Tauri IPC 回包验证晚到响应不会覆盖当前选题；模拟缺失修订时保留原结果和已应用条件。 |
| DEV004-T11 检索负载 | PASS | 10,000 与 50,000 合成题均加入多来源、标签、知识点及五级难度。完整翻页并对照预期 ID 集合。分别记录 SQLite 延迟和小样本桌面 IPC/预览。 |
| DEV004-T12 历史回归 | PASS | Rust 28 项数据库与 2 项旧 JSON；TypeScript 32 项；POC-001 12 项。原生窗口复跑 SQLite 编辑与 PDF、知识点与审查有效期、旧 JSON 演示、模拟离线及非法 JSON。六份重新导出的 PDF 与对应基准逐页渲染像素一致。 |

未验收范围 **NOT TESTED** 包括正式学习资源冷启动及跨设备性能、macOS、安装卸载和实体打印。

## DEV004-T11 实测性能

Windows 11 x64，Intel Core i7-14650HX（16 核、24 线程），约 15.64 GiB RAM，NVMe SSD，Rust 测试构建，应用 SQLite 3.54.1。使用临时 SQLite 文件，生成两条出处每题，部分题有第二标签及知识点，难度按五档分布。执行 `ANALYZE` 与 checkpoint 后逐页核对。下列 SQL＋Rust 转换计时每项 30 次，使用已打开连接。

| 合成题 | SQLite 主文件 | 出处／标签／知识点关系 | 组合结果 | 首页 P50 / P95 | 第 6 页 P50 / P95 |
|---:|---:|---:|---|---:|---:|
| 10,000 | 13,291,520 B | 20,000／13,333／15,000 | 333 道，14 页，末页 8 道 | 91.821 / 98.644 ms | 90.479 / 92.402 ms |
| 50,000 | 66,109,440 B | 100,000／66,666／75,000 | 1,667 道，67 页，末页 17 道 | 500.533 / 513.313 ms | 495.750 / 567.192 ms |

组合包含学科、知识点后代、关键词、2024 年起、地区、来源、难度、题型、标签和年份排序。计划中使用知识点与修订选择索引、标签反查索引、原卷题位索引及按逻辑题聚合结果的自动索引，也使用临时 B-tree 排序。保留完整 `EXPLAIN QUERY PLAN`。

原生小样本中，WebView2 发起检索 IPC 到回包，30 次 P50 1.70 ms、P95 2.50 ms；从点击第一份富文本预览到 DOM 更新并完成内嵌图片解码为 7.80 ms。另一隔离库复跑分别为 2.00 ms、2.50 ms 与 36.10 ms。此 IPC 与预览计时来自小样本，不能代替 10,000／50,000 道题的端到端数据。

## 实际命令与日志

从 `poc-001b/` 执行，Rust 使用 MSVC x64 编译环境。每份日志末尾记录退出状态。

| 命令或步骤 | 退出状态 | 证据 |
|---|---|---|
| 阶段 A `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml` 及 `npm.cmd run typecheck` | 0／0 | [Rust](poc-001b/output/dev004/logs/dev004-a-rust.log) · [类型检查](poc-001b/output/dev004/logs/dev004-a-ts.log) |
| 阶段 B 全部 Rust 测试 `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml -- --nocapture` | 0 | [最终 Rust](poc-001b/output/dev004/logs/dev004-rust.log) |
| `npm.cmd run typecheck`、`npm.cmd test` | 0／0，最终 Tauri 构建另含类型检查 | [类型检查](poc-001b/output/dev004/logs/dev004-ts.log) · [前端单测](poc-001b/output/dev004/logs/dev004-npm.log) |
| `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml dev004_t11 -- --nocapture`，分别设 `DEV004_SYNTHETIC_COUNT=10000` 和 `50000` | 0／0 | [10,000 道](poc-001b/output/dev004/logs/dev004-perf-10000.log) · [50,000 道](poc-001b/output/dev004/logs/dev004-perf-50000.log) · [硬件](poc-001b/output/dev004/logs/dev004-hardware.log) |
| `npm.cmd run tauri build -- --debug --no-bundle --config .test-output/dev004-config.json` | 0 | [正常库构建](poc-001b/output/dev004/logs/dev004-build.log) |
| `node tests/windows-webview.mjs src-tauri/target/debug/shandong-poc-001b.exe --sqlite` | 0 | [SQLite 编辑及 PDF](poc-001b/output/dev004/logs/dev004-desktop-sqlite.log) |
| 同一节点脚本改为 `--knowledge`、`--advanced` 及省略模式 | 0／0／0 | [知识库](poc-001b/output/dev004/logs/dev004-desktop-knowledge.log) · [高级界面](poc-001b/output/dev004/logs/dev004-desktop-advanced.log) · [旧 JSON](poc-001b/output/dev004/logs/dev004-desktop-legacy.log) |
| `python tests/sqlite-probe.py copy-schema-two $source $destination`；Tauri 构建用 `.test-output/dev004-upgrade-config.json`；原生脚本 `--upgrade`、`--advanced` | 均为 0 | [备份](poc-001b/output/dev004/logs/dev004-backup.log) · [构建](poc-001b/output/dev004/logs/dev004-upgrade-build.log) · [升级](poc-001b/output/dev004/logs/dev004-desktop-upgrade.log) · [侧栏复验](poc-001b/output/dev004/logs/dev004-desktop-advanced-recheck.log) |
| `python tests/check-sqlite-pdf.py .test-output/org.shandong-study.dev004-c2169e15bb/sqlite --render .test-output/org.shandong-study.dev004-c2169e15bb/sqlite/pages`；`python tests/check_pdf.py .test-output/org.shandong-study.dev004-c2169e15bb/legacy --render .test-output/org.shandong-study.dev004-c2169e15bb/legacy/pages`；对比两组及基准 PyMuPDF 像素摘要 | 均为 0 | [SQLite PDF](poc-001b/output/dev004/logs/dev004-pdf-sqlite.log) · [旧 PDF](poc-001b/output/dev004/logs/dev004-pdf-legacy.log) · [六份像素比对](poc-001b/output/dev004/logs/dev004-pdf-pixels.log) |
| `python ../poc-001/tests/test_poc.py` | 0 | [POC-001](poc-001b/output/dev004/logs/dev004-poc001.log) |

阶段 B 草稿首次 Rust 执行因 SQL 排序列名歧义退出 101。修正为唯一结果列别名后复跑通过。[草稿失败日志](poc-001b/output/dev004/logs/dev004-rust-draft.log)

## 复跑与证据

在 Windows 原生 MSVC x64 开发终端执行。创建新的隔离标识并用作 Tauri 配置，按下列顺序运行；PDF 检查使用 PyMuPDF。升级另用独立标识，将 DEV-003 桌面实测库通过 `copy-schema-two` 备份到其 `study.sqlite3` 后再启动升级。

```powershell
New-Item -ItemType Directory -Force .test-output | Out-Null
$env:POC001B_TEST_APP_IDENTIFIER = 'org.shandong-study.dev004-' + [guid]::NewGuid().ToString('N').Substring(0,10)
$config = '.test-output/dev004-config.json'
@{ identifier = $env:POC001B_TEST_APP_IDENTIFIER } | ConvertTo-Json -Compress | Set-Content -LiteralPath $config -Encoding ascii
npm.cmd run tauri build -- --debug --no-bundle --config $config
$exe = 'src-tauri/target/debug/shandong-poc-001b.exe'
node tests/windows-webview.mjs $exe --sqlite
node tests/windows-webview.mjs $exe --knowledge
node tests/windows-webview.mjs $exe --advanced
node tests/windows-webview.mjs $exe
```

- [元数据编辑](poc-001b/output/dev004/desktop-metadata.png) · [高级筛选与侧边预览](poc-001b/output/dev004/desktop-advanced-preview.png) · [展开修订答案](poc-001b/output/dev004/desktop-preview-answer.png)
- [Schema 2 升级记录](poc-001b/output/dev004/schema-two-upgrade.json) · [侧栏与元数据复跑记录](poc-001b/output/dev004/advanced-evidence.json)
- [WebView2 SQLite 题卷](poc-001b/output/dev004/revision-2-paper.pdf) · [修订 #2 答案卷](poc-001b/output/dev004/revision-2-answers.pdf)
