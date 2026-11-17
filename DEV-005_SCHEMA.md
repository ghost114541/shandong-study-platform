# DEV-005 Schema 4

[0004_attachments.sql](poc-001b/src-tauri/migrations/0004_attachments.sql) 通过已有迁移器在一个 SQLite 事务中应用。迁移 1–3 的 SQL 和历史校验值保留。富文本继续使用内容 Schema 1。

| 表或索引 | 数据与约束 |
|---|---|
| `attachment` | 主键 `attachment_id`，唯一 `sha256` 与 `storage_key`，登记时间 `registered_at`，白名单 `media_type`，`byte_size` 限制为 1 至 5,242,880。ID 与逻辑键均由 SHA-256 推导并受 SQLite 约束。 |
| `revision_attachment` | 联合主键 `(revision_id, attachment_id)`。指向不可变修订和附件登记的外键拒绝删除仍有引用的记录。一个修订多次使用同一附件只登记一条关系。 |
| `attachment_revisions` | 用附件 ID 反查已保存的修订。 |

原有 Schema 1 题目 JSON 附件声明包含 `id`、`media_type`、`byte_size` 和 `sha256`。新修订验证声明和登记一致，文件实际存在、哈希一致且能解码，随后同步写入引用表。旧修订字节保留，内嵌 Base64 继续显示。旧版未绑定文件的声明保留在历史 JSON 中，读取时显示未登记。迁移仅新增正式附件表和关系表。

`import_attachment` 接收原始图片字节。`read_attachment` 根据 ID 验证并返回展示数据，调用方可传入当前修订的声明供对照。`check_attachment` 返回登记、关联修订数和可空文件校验错误。非法或未登记 ID 通过 IPC 返回对应的结构化错误。
