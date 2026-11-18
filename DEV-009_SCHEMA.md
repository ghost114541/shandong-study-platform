
# Schema 8 资源包记录

迁移 [0008_resource_packs.sql](poc-001b/src-tauri/migrations/0008_resource_packs.sql) 由现有 SQLite 迁移器注册。Schema 1–7 的历史 SQL 和校验和继续沿用。对 DEV-008 隔离实测库执行 SQLite 备份后启动 Tauri，所有采集的原有表指纹、外部资源文件哈希和已应用迁移校验和一致。证据见 [原生数据库状态](poc-001b/output/dev009/windows-state-snapshots.json)。

| 表 | 用途 |
| --- | --- |
| `pack_identity`、`pack_version` | 包唯一 ID、版本、安装时间、兼容信息、Manifest 与归档 SHA-256、来源和权利、解压统计、安装后的文件异常 |
| `pack_operation`、`pack_operation_blob` | 一次确认的操作 ID、耐久阶段、结果、清理状态和该操作的文件意图 |
| `pack_file` | 每个版本的成员路径、角色、哈希和字节数 |
| `pack_knowledge_owner`、`pack_question_owner`、`pack_paper_owner` | 资源逻辑 ID 的所属包，外键指向既有资源实体 |
| `pack_knowledge_version` | 公共标题、排序、别名和权利的历史快照 |
| `pack_question_version`、`pack_question_knowledge` | 公共不可变修订、包内修订键、来源版本、知识点和权利 |
| `pack_knowledge_hidden` | 用户取消公共题知识点关联后持久保存的本地覆盖 |
| `pack_paper_version`、`pack_paper_file`、`pack_paper_occurrence` | 公共原卷元数据、PDF 版本来源和题目出处来源 |

`effective_knowledge_point`、`effective_knowledge_alias`、`effective_question_knowledge` 与 `effective_paper` 接入现有知识、检索、原卷和收藏入口。标准知识点保护触发器仍作用于基础记录。个人试卷元数据由存在的本地覆盖行决定，允许用户有意清空某个字段。安装成功事务包含包版本和成功状态；清理完成另有持久标记。
