# DEV-008 统一收藏

开发基准为 GitHub 上 `dev/dev-007-paper-reader` 的 `6a1b7ebe16073915c3fb7dd8b32f5100708d0b13`。交付分支为 `dev/dev-008-favorites`。Windows 原生开发验收证据见测试报告，独立源码审查由网页端 ChatGPT 执行。

“我的收藏”可以保存独立试题、逻辑试卷和标准或用户知识点，支持收藏夹、跨夹复制和移动、重点、过滤、站内搜索、排序和分页。收藏持续写入本地 SQLite。打开收藏通过现有试题编辑器、试卷阅读器与知识库，收藏试题可用组卷篮锁定修订。已人工确认的重复题在列表折叠为一项，原始收藏关系和其他文件夹内容受保护。

| 源码 | 交付内容 |
| --- | --- |
| `migrations/0007_favorites.sql`、`db/migrations.rs`、`db/mod.rs` | 注册 Schema 7、默认收藏夹、强类型资源引用、索引与级联方向。 |
| `db/favorites.rs`、`db/paper_files.rs`、`favorites_ipc.rs`、`src-tauri/src/main.rs` | 事务写服务、批量、人工同题归并、分页统计、PDF 版本文件可访问性及桌面 IPC。 |
| `favorites-workspace.tsx`、`favorite-controls.tsx`、`favorites.css` | 收藏工作区、管理对话框、资源状态、筛选及加载反馈。 |
| `favorites-api.ts`、`use-favorites.ts`、`latest-read.ts` | Tauri 数据类型、写后刷新、并发响应保护和窗口关闭期间的写入保护。 |
| `main.tsx`、`search-workspace.tsx`、`search-preview.tsx`、`sqlite-workspace.tsx`、`knowledge-workspace.tsx`、`paper-library.tsx` | 检索多选、详情入口、知识树定位、试卷库与原卷入口及使用原组卷篮。 |
| `favorites_tests.rs`、`latest-read.test.ts`、`windows-favorites.mjs`、`favorites-probe.py`、`windows-webview.mjs`、`sqlite-probe.py` | 模型、事务、重启、原生输入、升级、故障注入、性能和回归。 |

[Schema 7](DEV-008_SCHEMA.md) · [收藏服务](DEV-008_FAVORITES_DESIGN.md) · [界面设计](DEV-008_UI_DESIGN.md) · [逐项验收](DEV-008_TEST_RESULTS.md) · [已知问题](DEV-008_KNOWN_ISSUES.md) · [项目交接](PROJECT_STATUS.md)
