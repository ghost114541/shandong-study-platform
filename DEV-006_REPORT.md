# DEV-006 多题组卷、固定修订与双 PDF 导出

开发分支 `dev/dev-006-paper-composition` 从 DEV-005 的 `66ebd5779a9e0ee14ee998f0e148b4f35678957a` 建立。交付采用 Windows 原生 Tauri 2、React、TypeScript、Rust、SQLite 和 WebView2。

- 试题检索结果及侧栏可直接加入固定修订。组卷篮支持移除、组内题序、分组调整、总分与未保存保护。
- Schema 5 将标题、范围、时长、分组、题序、版式与分值持久化。已保存组卷可打开、复制或以独立 ID 保存新版本。后续原题修订继续走原题的现有版本与审核流程。
- 双份输出使用同一保存快照生成连续题号和小问分值。Windows 原生测试实际完全退出、重启、重开、导出和原题更新后再导出。
- 交付样本为物理、数学、化学各一道原创顶层题，包含两小问，调整后的分值为 13、5、6 分。题卷和答案解析卷各两页 A4。题卷用到同一附件两次，文件服务只保存一份原始附件。
- SQLite 库与 Win32 测试配置均隔离。原生测试证据、逐页文本及图片像素校验、性能记录见验收报告。

实现提交为 `3549833`（Schema 5、固定数据与快照）、`e42fd73`（组卷工作区、IPC、受控 WebView2 导出与测试工具）和 `0398b5d`（按需加载题目预览与失败回归）。分支上的交付提交收录验收证据和交接文档。

[Schema 5](DEV-006_SCHEMA.md) · [组卷设计](DEV-006_COMPOSITION_DESIGN.md) · [PDF 设计](DEV-006_PDF_DESIGN.md) · [验收结果](DEV-006_TEST_RESULTS.md) · [后续事项](DEV-006_KNOWN_ISSUES.md)

[题卷 PDF](poc-001b/output/dev006/composition-paper.pdf) · [答案解析 PDF](poc-001b/output/dev006/composition-answers.pdf) · [Windows 重启回读截图](poc-001b/output/dev006/desktop-reopened-composition.png) · [Windows 双 PDF 导出截图](poc-001b/output/dev006/desktop-dual-export.png)
