# DEV-006 验收结果

测试使用原生 Windows 11（10.0.26200）、MSVC x64、Windows SDK 10.0.26100、Edge WebView2 157 系列和 Tauri 调试构建。测试机为 Intel Core i7-14650HX，安装内存约 16 GB。Node.js 24.13.0 和 Python 3.12 驱动测试。桌面测试通过本机 WebView2 DevTools 操作真实 Win32 窗口，与实际 SQLite、附件目录和 `PrintToPdf` 交互。数据库和应用标识均与正式工作区隔离。

`PASS` 表示实测达到本项要求，`FAIL` 表示实际执行但未达到要求，`NOT TESTED` 表示本轮未执行，`BLOCKED` 表示外部条件阻止执行。下表为最终记录。

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| DEV006-T01 组卷篮 | PASS | 搜索行与侧栏加题，同组上下移动、组间排序、移除及题量和总分，切换工作区保留草稿。 |
| DEV006-T02 重复逻辑题 | PASS | 先加入 B，再写入人工确认 B 属于 A，实际组卷篮拒绝加入 A。Rust 事务验证也拒绝重复。 |
| DEV006-T03 修订固定 | PASS | 加入 A 后保存题目 B，草稿保留 A。保存并重启后继续读取 A，再更新原题并复导。新版本在明确刷新后采用最新修订。 |
| DEV006-T04 组卷分值 | PASS | 两小问由 4、6 改为 7、6，组卷整题合计 13，原修订保持 10。另调整无小问题的整题分值。Rust 拒绝失配。 |
| DEV006-T05 Schema 5 升级 | PASS | 实际 DEV-005 隔离 Schema 4 数据库经 SQLite Backup，复制对应附件后原生升级。两次启动的 Schema 5 历史一致，旧投影逐行相等。 |
| DEV006-T06 保存和重启 | PASS | 实际保存、结束原 Win32 进程并启动新 PID。从列表打开核对标题、题序、修订、范围、分值与分组，再导出。 |
| DEV006-T07 新版本保护 | PASS | 新版本指向父 ID，副本有独立 ID。读回原卷一致。测试注入重复、坏分值、缺失修订后确认写入回滚。 |
| DEV006-T08 多题 PDF | PASS | 物理、数学、化学三道原创题。A4、中文、KaTeX 公式、同图两处、题型、题号、两小问和总分 24 实测。 |
| DEV006-T09 独立答案解析 PDF | PASS | 两卷题号和分值逐项对齐。长解析跟随对应小问答案，化学题显示「暂无答案」及已有解析，文本断言确认题卷无答案。 |
| DEV006-T10 分页 | PASS | 两卷各两页，物理长题与长解析分别跨页。逐页渲染核对公式、图像、短题、编号和作答空白。 |
| DEV006-T11 真实附件 | PASS | 两道题共享一个内容寻址文件，两处 PDF 图片逐像素匹配原始 170 × 100 PNG。低分辨率需确认，缺失及 SHA-256 损坏均拒绝。Rust 额外验证答案解析中的图片。 |
| DEV006-T12 快照一致性 | PASS | 拒绝另一组卷的延迟异步预览及旧摘要、主窗口伪造就绪、固定修订缺失、第二个打印视图挂起及输出路径写入失败。无半套发布，已有批次保留。 |
| DEV006-T13 历史组卷 | PASS | 在 Schema 4 备份中以 DEV-001 格式保存固定条目，升级后从原生列表回读旧修订与原分值。Rust 另覆盖 Schema 1、2 的旧组卷升级。 |
| DEV006-T14 性能及内存 | PASS | 10、30、50 道顶层题全部完成打开、预览和双 PDF 导出。计时与工作集原始数据见下。 |
| DEV006-T15 综合回归 | PASS | POC-001、POC-001B 和 DEV-001 至 DEV-005 的 Rust、TypeScript、SQLite、原生 Windows 与 PDF 相关回归通过。 |

macOS 实机、安装卸载、实体打印和正式大规模题库性能为 `NOT TESTED`，不属于上述 15 项 Windows 验收。当前无 `BLOCKED` 用例。初期运行修复了测试脚本等待初始页面、保留回归夹具和转发 IPC 原始错误的处理，最终执行记录见下。

## 性能测量

每道题包含 1 个公式、8 段长正文、1 处图片、答案和 4 段解析。每批题使用同一张 170 × 100 图片，附加相同测试版式。加载从点击保存列表项计至题目列表就绪，预览从点击计至全部图像已解码，导出从 IPC 到两份 PDF 发布。前两列包含桌面自动化轮询耗时。内存在导出结束后取工作集，包括 Tauri 主进程及其 WebView2 子进程合计。数值为单次观测，工作集为采样而非峰值。

| 顶层题 | 加载 ms | 预览 ms | 双 PDF ms | 主进程 MiB | 进程组合计 MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10 | 318 | 156 | 896 | 40.7 | 530.8 |
| 30 | 322 | 159 | 913 | 42.6 | 549.6 |
| 50 | 323 | 158 | 951 | 43.9 | 571.5 |

[10/30/50 题性能记录](poc-001b/output/dev006/performance.json)

## 日志和产物

- Rust 基线 36 项通过，最终 39 项通过。TypeScript 32 项通过，Windows 构建包含类型检查，POC-001 Python 12 项检查通过。[基线 Rust](poc-001b/output/dev006/logs/baseline-rust.log) · [最终 Rust](poc-001b/output/dev006/logs/rust-test.log) · [TypeScript](poc-001b/output/dev006/logs/npm-test.log) · [POC-001](poc-001b/output/dev006/logs/poc001-python.log) · [Windows 构建](poc-001b/output/dev006/logs/windows-final-composition-build.log)
- Windows 原生重启、快照拒绝及导出性能。[原生测试](poc-001b/output/dev006/logs/windows-final-composition.log) · [SQLite 备份](poc-001b/output/dev006/logs/windows-upgrade-backup.log) · [原生升级](poc-001b/output/dev006/logs/windows-final-upgrade.log) · [迁移行数和校验记录](poc-001b/output/dev006/schema-four-upgrade.json)
- POC-001B 旧 JSON，DEV-001/002 SQLite 与修订，DEV-003 知识树与检索，DEV-004 高级搜索，以及 DEV-005 附件回归。[旧 JSON](poc-001b/output/dev006/logs/windows-final-legacy.log) · [SQLite](poc-001b/output/dev006/logs/windows-final-sqlite.log) · [知识树](poc-001b/output/dev006/logs/windows-final-knowledge.log) · [高级检索](poc-001b/output/dev006/logs/windows-final-advanced.log) · [附件](poc-001b/output/dev006/logs/windows-final-attachments.log)
- 正式组卷产物及回归 PDF 校验。[题卷](poc-001b/output/dev006/composition-paper.pdf) · [答案解析卷](poc-001b/output/dev006/composition-answers.pdf) · [组卷 PDF 验证](poc-001b/output/dev006/logs/composition-pdf.log) · [SQLite PDF](poc-001b/output/dev006/logs/sqlite-pdf.log) · [附件 PDF](poc-001b/output/dev006/logs/attachment-pdf.log) · [旧 JSON PDF](poc-001b/output/dev006/logs/legacy-pdf.log)
- Windows 截图。[检索加题](poc-001b/output/dev006/desktop-search-basket.png) · [组卷草稿](poc-001b/output/dev006/desktop-composition-draft.png) · [题目与分值控件](poc-001b/output/dev006/desktop-composition-items.png) · [重启回读](poc-001b/output/dev006/desktop-reopened-composition.png) · [题卷预览](poc-001b/output/dev006/desktop-paper-preview.png) · [答案解析预览](poc-001b/output/dev006/desktop-answers-preview.png) · [双 PDF 导出](poc-001b/output/dev006/desktop-dual-export.png) · [历史组卷](poc-001b/output/dev006/desktop-migrated-composition.png)

可复现入口位于 `poc-001b`。使用 MSVC 和 SDK 已配置的 Windows shell，以唯一测试标识执行 `npm run tauri build -- --debug --no-bundle --config <隔离配置>`。使 `POC001B_TEST_APP_IDENTIFIER` 与构建标识一致，然后运行 `node tests/windows-webview.mjs <exe> --composition`。升级使用 `tests/sqlite-probe.py copy-schema-four`、`seed-history-composition` 和 `--upgrade`。回归用例 `--sqlite`、`--advanced`、`--attachments` 在同一隔离库依次运行，知识库和 JSON 演示可使用另一空配置。PDF 检查脚本为 `tests/check-composition-pdf.py` 等。
