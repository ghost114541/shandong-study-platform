# DEV-001 · SQLite 数据模型与迁移

## 数据库文件与版本

Tauri 用 `app.path().app_data_dir()` 定位本地应用数据，首次启动建立 `study.sqlite3`。路径通过 Tauri 解析，可在 Windows 和 macOS 使用。库采用 `rusqlite` 的 bundled SQLite，避免依赖系统 SQLite 版本。启动失败保留错误类型和详情，Rust 输出诊断，`database_status` IPC 返回版本或结构化错误。编辑器的原有 JSON 与 PDF 路径可继续使用。

- **数据库 Schema 1** 由 [0001_core.sql](poc-001b/src-tauri/migrations/0001_core.sql) 定义。用 SQLite `application_id`（0x53484431）、`user_version` 和 `schema_migration` 的连续版本、名称、SHA-256 校验值及 UTC 执行时间校验身份和历史。校验前将 SQL 的 CRLF 统一为 LF。
- **富文本内容 Schema 1** 存在每条修订的 `content_version` 列和 `content_json.schema_version` 中。数据库迁移编号与内容格式独立演进。未知内容版本报 `unsupported_content`。
- 首次迁移和后续升级由一笔 `BEGIN IMMEDIATE` 执行待处理脚本、记录历史、更新版本及检查完整性。重开时校对既有历史。失败整批回滚，保留原数据库与已提交数据。带陌生表的未标记数据库、更新版本或校验不匹配会报错。已经执行的 SQL 文件应固定，后续变更使用新编号。
- 每条应用连接启用外键、递归触发器、5 秒 busy timeout，使用 WAL 和 `synchronous=FULL`。启动执行 `quick_check` 与 `foreign_key_check`，可调用 `integrity_check` 执行完整检查。忙、文件访问、损坏、版本、迁移和约束错误有单独分类。路径备份应通过 SQLite 一致性备份或在所有连接关闭后执行。

## 表关系与查询

```text
subject ─┬─ knowledge_point ── 同学科父节点
         └─ question ─┬─ question_part
                      ├─ question_occurrence ── paper
                      ├─ question_duplicate ── question（本题与归并主记录）
                      └─ question_revision ─┬─ 当前版本视图 current_question_revision
                                           ├─ verification_record ── 上一条审核
                                           └─ composition_item ── composition
```

| 表 | 关键字段、约束与索引 |
|---|---|
| `subject` | 稳定字符串 ID；学科名称唯一。 |
| `knowledge_point` | 稳定 ID、学科、标题、可空父节点。组合外键限定父节点在同一学科，禁止自己作为父节点；索引 `(subject_id, parent_id)` 用于按学科遍历。 |
| `question` | 稳定字符串 ID、学科 FK；学科索引用于按学科列出题目。分值、题型和正文存在修订内容中。 |
| `question_part` | 主键 `(question_id,id)`。注册逻辑小问身份，更换题目版本时保留旧 ID；各版本的顺序、分值和内容位于快照。 |
| `paper` | 原始逻辑试卷的稳定 ID 和标题。 |
| `question_occurrence` | 主键 `(paper_id,source_key)`，每张卷内的题位唯一。题位可用题号或已确认的局部位置标识。索引 `question_id` 查找一个逻辑题的全部试卷出处。 |
| `question_duplicate` | 记录人工认定的别名题 ID、主逻辑题 ID、确认人、日期和证据。一个别名只指向一个主记录；拒绝自引用、链、环和跨学科归并。主记录索引用于查全部别名出处。 |
| `question_revision` | 数据库分配递增修订 ID。题目 FK、可空基线修订、`public/user` 范围、内容版本、JSON 和创建时间。组合外键及插入检查要求基线是同题的既有修订，并避免公共版本引用个人版本为基线。`(question_id,scope,id)` 支持当前和公共原版查询，`(question_id,base_revision_id)` 支持追溯。更新、删除及主键替换由触发器拒绝。 |
| `verification_record` | 明确的修订 FK、审核人、审核日期、证据、`passed/disputed/failed`、可选有效截止日和同修订的 `review_of`。每次复核接续该修订的最后记录，记录只能追加。`(revision_id,checked_on DESC,id DESC)` 支持按日期查有效结论。 |
| `composition` | 组卷 ID、标题、创建时间。保存使用新 ID，标题和各题位在同一写事务中插入。 |
| `composition_item` | 主键 `(composition_id,position)` 固定顺序，复合 FK `(question_id,revision_id)` 固定实际修订，且目标受删除保护。反查索引按修订查组卷。拒绝单项改写、替换、单独删除；加载时缺少修订显式报错。 |
| `schema_migration` | 迁移版本主键，名称唯一，保存校验值和执行时间。 |

## 已批准的数据规则

- **DEC-039** 由 `counts()` 分别返回主逻辑题数、主记录当前修订中的小问数和真实出处数。相同文本默认仍是独立记录。人工调用 `confirm_duplicate(...)` 明确归并后，别名不再计入逻辑题和当前小问统计，过去的数据、出处、修订和原有组卷仍可追溯。技术计数用于数据层验证，正式发布统计还需合规、元数据及内容审核。
- **DEC-040** 由 `record_review()` 逐修订保存审核证据。`verified_current_count(as_of)` 只计算主记录的当前修订，以给定日期当时已记录的最后审核为准。通过记录到期后不计入，后续争议或不通过使同修订的旧通过结论失效。含小问的题需要每个小问具有实质答案才可记录通过。旧修订可查询其历史记录，后续修订须独立审核。
- **DEC-041** 默认读取最后追加的用户修订，其次是最后公共修订。`public_original()` 读取最早公共修订。公共更新和用户编辑都追加快照。已保存组卷按固定修订读取，用户和公共版本更新都不会替换固定引用。

## 富文本与未来导入

`RevisionContent` 保存 `question_type`、`score`、整题的 `stem/answer/analysis`、小问列表和附件元数据。小问用 `id/score/prompt/answer/analysis`。文档沿用 Tiptap `doc` JSON，保留文本、粗体斜体、换行、行内及块公式（`attrs.latex` 原样保存）、图片。支持 `poc001:parabola`、内嵌位图和带登记信息的 `attachment:<id>`。附件元数据包含 ID、MIME、大小和 SHA-256，实际外部文件写入与哈希验证留到附件服务。单修订限制 32 MiB。写入先验证内容和小问 ID，再在同一事务登记小问和追加修订。

未来导入先用 POC-001B 的 `parseQuestionSet` 检查文档类型和版本，再明确映射学科与来源，沿用整题 ID、小问 ID、分值及原 Tiptap 节点，把题型映射到 `question_type`、缺失解析保持为空。内嵌图可随快照保留，导入附件服务时根据原始字节建立元数据和逻辑引用。公共样本与个人文件要分别导入对应范围，导入前保留原文件和合法来源信息。

参考 [rusqlite 事务与连接接口](https://docs.rs/rusqlite/0.42.0/rusqlite/struct.Connection.html)。
