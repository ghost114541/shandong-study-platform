# DEV-010 验收矩阵

Windows 11 x64（26200）、WebView2 和 15.64 GiB 物理内存。在隔离配置和使用原创/合成数据的测试中运行。截图来自实际 Tauri 窗口。原生脚本强制终止正式程序进程，Rust 子进程试验另列。运行命令与证据见文末。

| 编号 | 状态 | 断言与证据 |
| --- | --- | --- |
| DEV010-T01 | PASS | Tauri 从 Schema 8 升级，旧迁移历史、旧业务表指纹和 129 个文件完全一致。Rust 独立迁移测试另核对历史。 |
| DEV010-T02 | PASS | Windows Rust 实测 SQLite WAL 中已提交和未提交事务。快照只含已提交内容，能够独立打开。 |
| DEV010-T03 | PASS | 含 SQLite、已登记图片/PDF、包历史、授权/归属信息及旧版 `questions.json` 的原生备份。 |
| DEV010-T04 | PASS | 归档 Manifest、快照 SHA-256、逐文件 SHA-256、已验证历史记录。正常取消未留下完整文件。 |
| DEV010-T05 | PASS | 原生界面拒绝未知格式和 Schema、坏清单、越界路径、缺图、坏 PDF 和坏数据库。 |
| DEV010-T06 | PASS | 原生预览、替换确认、源库保留。Rust 实测 Schema 8 隔离迁移，源库仍是 Schema 8。 |
| DEV010-T07 | PASS | Windows 空白配置恢复 2,507 个稳定试题记录。人工同题关系保留，折算为 2,506 道逻辑题。业务表逐表指纹匹配，实际检索入口打开。 |
| DEV010-T08 | PASS | 收藏、重点、固定组卷、合成审核和已确认同题关系恢复。固定组卷继续引用修订 1。 |
| DEV010-T09 | PASS | 文件指纹一致。Windows 原卷阅读器实际打开恢复后的原卷并截图，附件读回成功。新截图题保存后分别按试题 ID 和原卷 ID 查到同一区域。 |
| DEV010-T10 | PASS | 安装操作、版本、成员文件、公共所有权及个人覆盖的表指纹完全相同。 |
| DEV010-T11 | PASS | 启动时验证候选，原库仍可打开。缺失候选的 Rust 试验继续打开原库。 |
| DEV010-T12 | CONDITIONAL PASS | 真实 Tauri 在写归档中途终止，未发布完整文件。Rust 验证取消、缺图及容量预检。真实卷耗尽未测。 |
| DEV010-T13 | PASS | Tauri 进程在解包中、解包后、校验后、首次打开前、打开后、原子切换前和切换后被强制终止。重启检查原库或完整新库。 |
| DEV010-T14 | PASS | 原生文件夹对话框选择 D:，从 C: 迁移后重启，新旧库逐表指纹及 130 个文件逐项哈希一致。再次迁移在复制阶段强制终止，原库指纹一致。实机切回上一个库并反向回退。 |
| DEV010-T15 | PASS | 原生试题进入回收站，Rust 独立复核常规列表和检索隐藏。 |
| DEV010-T16 | PASS | Rust 验证知识点、父子依赖及个人试卷隐藏与恢复。 |
| DEV010-T17 | PASS | Windows 恢复个人试题后指纹一致，Rust 核对修订 ID 和原资源 ID。 |
| DEV010-T18 | PASS | Windows 恢复后比较收藏、固定组卷、原修订、审核与同题关系。 |
| DEV010-T19 | PASS | 清空确认后安全阻断。Rust 拒绝公共试题进入回收站。 |
| DEV010-T20 | PASS | 新题和已存在个人题的编辑均已在 Windows 实测持久化。保留草稿离开等待 SQLite 保存后继续。 |
| DEV010-T21 | PASS | 强制终止前写入行内公式、原创图片和小问。重开恢复编辑区、图片解码和小问控件，正式保存后活动草稿清除。 |
| DEV010-T22 | PASS | 实际框选原卷、截图进入新试题草稿，进程被终止前无正式修订。重启恢复稳定 UUID、截图与来源，保存后两向位置记录匹配。 |
| DEV010-T23 | PASS | 实际组卷选题、标题修改、自动保存和强制终止。重启按固定修订恢复组卷草稿，标题保持，未产生正式组卷。 |
| DEV010-T24 | PASS | Rust 测试旧序号拒绝、修订冲突和正式保存后迟到写不能复活草稿。 |
| DEV010-T25 | PASS | 独立 SQLite 进程持有写锁，Windows 界面显示草稿保存失败。释放锁后保留草稿并离开成功。Rust 覆盖附件外键失败和丢失文件。 |
| DEV010-T26 | CONDITIONAL PASS | Windows 实测 Ctrl+Z、Ctrl+Y 行内公式与保留草稿离开。小问切换和恢复字段通过，图片与纯文本的撤销/重做组合未全量执行。 |
| DEV010-T27 | PASS | 原生界面运行 SQLite、外键、图片和 PDF 检查。Rust 缺图诊断和资源包历史检查。 |
| DEV010-T28 | PASS | 拒绝损坏 SQLite、文件哈希不一致和缺图。NTFS 拒绝写入隔离目录时没有发布归档。 |
| DEV010-T29 | PASS | 原创 35/500/2,000 顶层题、5/26/46 公式图片和 1/3/6 份 22 页扫描卷。见原始性能记录。 |
| DEV010-T30 | CONDITIONAL PASS | Rust 与 TypeScript 历史回归和 Windows 数据保护主链。既有 Windows 端到端脚本未全部独立重跑。 |

## E2E-007 与 E2E-008

- E2E-007 Windows 隔离配置为 **PASS**，跨平台为 **PARTIAL**。Windows 已从 Schema 8 演进后的合成用户配置备份，并恢复到空白隔离配置。原生运行检索、收藏、原卷、附件和固定组卷读取。macOS 实机 **NOT TESTED**。
- E2E-008 Windows **PASS**。恢复个人题后保留原收藏、固定组卷、同题和审核引用。继续编辑同一道题的公式及图片，强制终止后恢复，并形成未审核的新修订。删除收藏夹后原试题仍在。组卷草稿和 PDF 截图草稿分别完成真实进程终止和重启。

## 真实 Windows 进程终止

| 注入点 | 重新打开结果 |
| --- | --- |
| `archive-mid` | 没有同名完整归档。源库业务表指纹一致。 |
| `unpack-mid`、`unpacked`、`validated` | 未确认替换。启动后空白库仍为空白，预检中断记录可见。 |
| `before-open`、`first-open`、`before-pointer` | 日志仍引用旧库和待切换目标。再次启动验证候选。 |
| `after-pointer` | 重新启动直接打开完整的新库。原先空白库仍可读取。Windows WebView2 断网模式下可读本地资源。 |

## 性能

同一 Windows 开发机、Debug Rust，单次试验，源数据库、暂存与归档均在本机。每个扫描文件约 9.3 MB，22 页原创栅格内容。阶段起点是从操作开始的偏移值。体积为实际字节。

| 题目 | 图片 | 扫描 PDF | 归档字节 | 备份总耗时 | 恢复预检 | 完整性检查 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 35 | 5 | 1 | 9,911,408 | 819 ms | 272 ms | 172 ms |
| 500 | 26 | 3 | 29,276,486 | 1,819 ms | 484 ms | 361 ms |
| 2,000 | 46 | 6 | 59,337,068 | 4,932 ms | 1,455 ms | 1,068 ms |

原始日志同时列出快照、资源复制及哈希阶段起点、解包、重新打开数据库和持久化空间增量。Windows Tauri 独立日志包括启动、端到端预检、草稿计时和工作集采样。一次备份完成时采样 Tauri 工作集 99,876,864 字节、WebView2 子进程合计 439,664,640 字节。当前结果未测 4 GB 机器和峰值内存。

## 复现

- 在 `poc-001b` 运行 `npm run build`、`npm test`。在 Windows MSVC x64 与 SDK 环境运行 `cargo test --locked -- --nocapture`。
- 使用独立标识符 `org.shandong-study.dev010-<8 位十六进制>` 写入 `TAURI_CONFIG`，从 `src-tauri` 运行 `cargo build --locked --features tauri/custom-protocol,dev010-test-hooks`。测试功能仅为 Debug 且匹配隔离标识符的应用启用。
- 从 `poc-001b` 设置同值 `POC001B_TEST_APP_IDENTIFIER`，执行 `node tests/windows-data-protection.mjs <构建的 EXE>`。脚本检查隔离配置不存在，再从历史 DEV-009 合成 Schema 8 库建立测试副本。设置 `KNOWPAPER_DEV010_STORAGE_TEST_PARENT` 可选择另一卷上的全新验收目录。成功后用同一参数和配置追加 `--extended`，验证真实 SQLite 锁、保留草稿离开、个人题与截图草稿。追加 `--migration-crash` 独立运行跨卷迁移中断和两次回退。
- 运行 `python tests/dev010-fixtures.py perf-assets .test-output/dev010-performance-assets`，从 `src-tauri` 运行 `cargo run --locked --example dev010_perf -- ../.test-output/dev010-performance-assets`。

[Windows 测试](poc-001b/output/dev010/windows-ui.log) · [草稿与截图扩展原生日志](poc-001b/output/dev010/windows-extended.log) · [迁移故障与双向回退](poc-001b/output/dev010/windows-migration-fault.log) · [业务数据与附件指纹](poc-001b/output/dev010/windows-state-snapshots.json) · [Rust 全量回归](poc-001b/output/dev010/rust-tests.log) · [Rust DEV-010](poc-001b/output/dev010/rust-dev010.log) · [TypeScript](poc-001b/output/dev010/typescript-tests.log) · [构建](poc-001b/output/dev010/windows-build.log) · [截图](poc-001b/output/dev010/screenshots) · [Windows 计时](poc-001b/output/dev010/windows-timings.json) · [性能原始数据](poc-001b/output/dev010/performance.log)
