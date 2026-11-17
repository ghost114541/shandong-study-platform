# DEV-003 九学科、知识点与基础检索

基准为已审查的 `fa218cb40f59a32b07d1c0a36f7cd7ab5b98c08a`。在 `dev/dev-003-knowledge-search` 分支上扩展已有 Tauri 应用。

## 阶段 A

Rust 使用 SQLite 的 `date('now')` 取得 UTC 公历日。审核记录里只有日期，系统本地时区和浏览器显示时区不参与日期资格判断。按 `checked_on DESC, id DESC` 选择日期不晚于当天的记录。审核到期日当天仍有效，次日对曾通过的记录显示“已过期”。只有未来记录时显示“审核尚未生效”，历史有效记录仍按当天判定。争议或不通过按当前适用记录显示。此选择顺序和有效通过条件与 `verified_current_count` 一致。窗口重新聚焦、跨 UTC 日期或手动读取修订时刷新状态。

## 阶段 B

- Schema 2 初始化九大学科。知识库显示树、父节点、别名和直属题数。新增和重命名用户知识点、扩展公共标准节点及知识点关联均经 Rust IPC 写入真实 SQLite。
- 试题详情可关联多个同学科知识点，也可单独解除关联。知识点工作区可跳转到直属关联试题列表。搜索支持学科、字面关键词、直属或含后代的知识点、组合条件与分页，并从结果进入原试题详情。
- 新增 IPC 为 `revision_review`、`list_knowledge`、`create_knowledge`、`rename_knowledge`、`add_knowledge_alias`、`question_knowledge`、`set_question_knowledge`、`search_questions`。原有应用目录和编辑、修订及 PDF 路径继续使用。

[迁移与表结构](DEV-003_SCHEMA.md) · [检索设计](DEV-003_SEARCH_DESIGN.md) · [测试结果](DEV-003_TEST_RESULTS.md) · [遗留事项](DEV-003_KNOWN_ISSUES.md)
