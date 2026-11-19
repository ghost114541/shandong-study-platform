# Schema 9 数据保护

迁移 [0009_data_protection.sql](poc-001b/src-tauri/migrations/0009_data_protection.sql) 追加到现有迁移器。应用标识沿用 `0x53484431`。Schema 1–8 的历史 SQL 和校验值继续沿用。

| 表或视图 | 用途 |
| --- | --- |
| `backup_record` | 备份 ID、版本和类型、快照 Schema、时间、文件名、文件数、归档 SHA-256、已验证标志和失败原因。位置只保存文件名。 |
| `trash_item` | 一次删除的 ID、操作 ID、资源类型、原 ID、发生时间、学科、父资源与引用概要。恢复另有时间戳。部分唯一索引阻止同一资源重复进入回收站。 |
| `visible_question`、`visible_knowledge`、`visible_paper` | 常规列表和检索使用的视图。试题按已确认的主 ID 过滤。稳定 ID、来源、收藏与历史引用继续保存在业务表。 |
| `edit_draft`、`draft_attachment` | 草稿 ID、对象 ID、基准修订、格式、内容、写入序号、编辑和保存时间、状态与附件外键。序号和关闭状态阻止晚到写入。 |

恢复操作与数据根的指针存放在应用默认目录下 `data-protection/root.json`。启动前可读取该日志，当前数据库无法打开时也可查询根路径并准备恢复。文件状态和表结构的验证见 [恢复设计](DEV-010_RESTORE_DESIGN.md)。

[迁移与业务表指纹](poc-001b/output/dev010/windows-state-snapshots.json) · [Rust 测试](poc-001b/output/dev010/rust-dev010.log)
