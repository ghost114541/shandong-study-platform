# DEV-002 统一数据契约与 SQLite 试题编辑

开发分支为 `dev/dev-002-editor-sqlite`，基准为 `81001f81cf492417c53b6ff65ce969fdcf1593bd`。使用 Windows 原生 Tauri 2、React、TypeScript、Rust 和 SQLite。

## 实现

- Rust 和 TypeScript 用同一批样本校验富文本。责任边界、旧文件转换、图像尺寸和附件状态见 [数据契约](DEV-002_CONTRACT.md)。
- 默认进入 SQLite 题库。首次保存同一事务写入逻辑题、小问身份与初始用户修订。再次保存比较当前修订 ID，并在同一 `BEGIN IMMEDIATE` 事务新增有基线的用户修订。过期请求返回 `conflict`，SQLite 写锁超时返回 `busy`。
- 历史与公共原版可查看。用户版优先由已有 SQLite 视图决定。审核记录按修订 ID 读取。保存错误保留草稿，关闭或切换未保存的编辑时可选择继续编辑。
- 题卷和答案卷先按固定 ID 从 SQLite 回读，经共享预览组件渲染，再由现有 WebView2 `PrintToPdf` 导出。按修订 ID 与卷类命名，示例 PDF 使用原文件名。
- 应用数据目录继续使用 `study.sqlite3` 和 `questions.json`。旧编辑器入口为“POC-001B JSON 演示”。原迁移 `0001_core.sql` 及 DEC-039、DEC-040、DEC-041 保持原有语义。

## Rust IPC

| 命令 | 行为 |
|---|---|
| `database_status` | 返回数据库 Schema 或初始化错误。 |
| `list_subjects`、`list_questions` | 读取学科与逻辑题列表。 |
| `create_question` | 同一事务创建逻辑题并写入第一条用户修订。 |
| `current_revision`、`public_original` | 读取当前修订或最早公共修订及其审核记录。 |
| `read_revision`、`list_revisions` | 按 ID 回读不可变修订，或列出指定题目的修订历史。 |
| `save_user_revision` | 校验内容并按预期当前修订新增用户版本。 |
| `export_pdf` | 把当前 WebView2 预览输出为 A4 PDF。数据库入口附带并检查修订 ID。 |

实测、复跑命令和交付证据见 [测试结果](DEV-002_TEST_RESULTS.md)。范围和后续事项见 [遗留事项](DEV-002_KNOWN_ISSUES.md)。
