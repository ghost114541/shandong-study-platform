# DEV-008 Schema 7

迁移 [0007_favorites.sql](poc-001b/src-tauri/migrations/0007_favorites.sql) 通过既有迁移器进入 Schema 7。迁移器在写事务内校验既有历史和 SQL 校验值，执行新增 DDL，并检查数据库和外键。默认收藏夹 ID 为 `default`，迁移仅登记一次。数据库触发器保护默认收藏夹免于删除、替换或改变身份。

| 对象 | 约束和用途 |
| --- | --- |
| `favorite_collection` | 稳定文本主键、唯一名称、系统标识、排序和 UTC 时间。名称唯一性采用 SQLite NOCASE。 |
| `favorite_target` | `question_id`、`paper_id`、`knowledge_id` 三列各有外键和唯一约束，CHECK 保证恰有一列非空。生成列给出资源类型和原始 ID，资源级重点保存在此表。 |
| `favorite_member` | `(collection_id, target_id)` 为复合主键，记录入夹 UTC 时间。删除收藏夹只向下级联至本表。 |
| `favorite_identity` | 试题通过原先的人工确认表解析 canonical ID。试卷与知识点沿用本身 ID。 |

成员反向索引支持按目标查全部收藏夹，收藏夹顺序索引支持稳定排序。点查先使用 `(kind, original_id)` 唯一索引，再使用既有人工同题 canonical 索引找原始成员。原卷 PDF 版本列表使用 `role = 'original'` 的试卷版本部分索引。

收藏写入只接触三张收藏表。资源外键采用 RESTRICT，未来实体暂时下架宜保留稳定资源行并在查询中标示可用性。删除收藏夹或取消收藏后，服务仅清理没有任何收藏关系的逻辑目标的私有收藏记录。

真实 Schema 6 备份、保存前哈希、升级两次启动与旧文件验证见[迁移证据](poc-001b/output/dev008/logs/windows-schema7-upgrade.log)。
