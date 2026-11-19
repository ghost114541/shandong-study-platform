# DEV-010.1 Windows 验收矩阵

Windows 11 x64，真实 Tauri EXE 和 WebView2。使用独立测试配置 `org.shandong-study.dev010-1d0f1b6b`、原生文件对话框、原创或合成数据库与外部资源。默认库升级 Schema 9 后包含 2,507 个稳定试题记录和 129 个外部或兼容文件，其中包括图片、PDF 及旧 JSON。表指纹涵盖审核、人工同题、资源包归属、收藏、组卷、活动草稿及登记关系。备份历史独立更新，所以通用表指纹跳过 `backup_record`。每个快照均运行 SQLite 完整性和外键检查。

| 编号 | 结论 | 断言 |
| --- | --- | --- |
| DEV0101-T01 | PASS | Windows 预检时以真实路径断言候选与旧库、控制树互不包含，候选是同级管理容器的直系子目录。 |
| DEV0101-T02 | PASS | 所有恢复、迁移、回退使用同一配置控制目录，默认配置树及包含它的目录无法通过清理检查。 |
| DEV0101-T03 | PASS | Windows 实际建立父级、子级、同名和独立目录。Rust 拒绝重叠、已有数据库与危险迁移目标。 |
| DEV0101-T04 | CONDITIONAL PASS | 大小写变体和真正 NTFS junction 均被拒绝。将已确认候选替换为 junction 后，启动继续使用旧库。独立目录符号链接因权限错误 1314 为 NOT TESTED。 |
| DEV0101-T05 | PASS | 版本 1 日志指向控制目录内的活动库。真实程序从原位启动并显示修复入口。旧版尚未提交的嵌套候选被启动检查拒绝。 |
| DEV0101-T06 | PASS | 安全布局修复后，独立库和原内层库的表指纹及 129 个文件完全一致。旧内层可回退并再切回独立库。故意移走登记图片的场景为 BLOCKED，原指针保持。 |
| DEV0101-T07 | PASS | Windows 从默认库创建本地备份经原生对话框恢复。新旧库互不包含，SQLite 和记名外部文件均通过验证。 |
| DEV0101-T08 | PASS | 真实两次重启分别回退到默认库并切回新库。旧内层布局修复后也进行双向回退。 |
| DEV0101-T09 | PASS | 拒绝清理活动库、父级、配置控制目录、有效回退库、待用候选、无归属目录和 junction。Windows UI 显示拒绝原因。 |
| DEV0101-T10 | PASS | Rust 在临时沙箱删除符合规则且已退役的受控测试库。活动库、回退库仍通过 SQLite 完整性检查，控制日志字节一致。 |
| DEV0101-T11 | PASS | Windows Tauri 在八个检查点真实强制终止。每次重启按已提交的指针打开原库或完整候选。 |
| DEV0101-T12 | PASS | 把已排队候选分别改为损坏数据库、缺失图片和哈希错误 PDF。Windows 启动拒绝三个候选，当前库及指纹保持一致。 |
| DEV0101-T13 | PASS | 原生试题检索、PDF 阅读和收藏可打开；固定组卷仍读取修订 1。审核、同题、组卷、收藏和外部文件指纹均保留。 |
| DEV0101-T14 | PASS | Windows 通过文件夹对话框从 C: 迁移到 D:，验证卷不同、表指纹和文件哈希一致，重启回退到 C:。 |
| DEV0101-T15 | PASS | Schema 8 → 9、在线备份及恢复回归通过。活动草稿从归档得到原内容与基准修订，Rust 校验迟到写入及正式保存竞争。 |
| DEV0101-T16 | CONDITIONAL PASS | 78 个 Rust 和 34 个 TypeScript 测试通过。真实 Windows 重跑了旧 JSON、公式、图片、三份 WebView2 导出及知识库/审核/检索链。全部历史独立 GUI 流程未逐个重跑。 |

## 故障注入

- `candidate-created`、`unpack-mid` 和 `candidate-verified` 时强制终止。下一次启动保持默认旧库并登记中断，表指纹一致。
- `before-open`、`first-open`、`startup-verified`、`before-pointer` 时强制终止。新指针发布前，日志的活动路径仍是旧库。
- `after-pointer` 时强制终止。下次启动读取完整新库及 129 项原有外部文件。旧默认库仍能读取。操作前后控制路径保持不变。
- Windows NTFS ACL 实际拒绝候选目录写入。单独用 Win32 文件共享限制阻止替换 `root.json`，实际打开原库并保留旧日志字节；释放限制后可重试。
- 声明超过目标卷容量的清单触发真实可用空间预检，创建前目录清单一致。真实设备在写入中耗尽空间为 NOT TESTED。

## 核对与复现

- 原生日志记录 PID、强制终止阶段、`active`、`previous`、`candidate` 及控制路径。JSON 证据同时记录规范化关系断言涉及的路径、SQLite 表指纹和各登记文件 SHA-256。
- 在 `poc-001b` 运行 `npm run build` 与 `npm test`。Windows MSVC/SDK 环境中运行 `cargo test --locked -- --nocapture`。
- 用形如 `org.shandong-study.dev010-<8 位十六进制>` 的新配置标识运行 `cargo build --locked --features tauri/custom-protocol,dev010-test-hooks`。设置相同的 `POC001B_TEST_APP_IDENTIFIER` 以及 D: 上尚不存在的 `KNOWPAPER_DEV0101_STORAGE_TEST_PARENT`。从 `poc-001b` 运行 `node tests/windows-data-protection.mjs <EXE> --root-safety`。测试从 DEV-009 的合成 Schema 8 配置读取并复制数据，可通过 `KNOWPAPER_DEV010_SCHEMA8_SOURCE` 指定来源。故障挂钩只在 Debug 的隔离标识符下启用。

[Windows 原生日志](poc-001b/output/dev0101/windows-ui.log) · [实际路径、表指纹与逐文件 SHA-256](poc-001b/output/dev0101/windows-state-snapshots.json) · [路径及清理测试](poc-001b/output/dev0101/path-safety.log) · [Rust 全量](poc-001b/output/dev0101/rust-tests.log) · [TypeScript](poc-001b/output/dev0101/typescript-tests.log) · [原生历史知识库回归](poc-001b/output/dev0101/windows-historical-knowledge.log) · [原生历史 JSON 回归](poc-001b/output/dev0101/windows-historical-legacy.log) · [实际截图](poc-001b/output/dev0101/screenshots)
