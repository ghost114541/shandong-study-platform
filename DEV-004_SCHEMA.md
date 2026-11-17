# DEV-004 数据库 Schema 3

`0003_search_metadata.sql` 沿用既有迁移器和单事务升级。此前的 `0001_core.sql`、`0002_knowledge.sql` 及其历史校验保持原样。富文本仍是内容 Schema 1。

| 对象 | 所属层级与职责 |
|---|---|
| `question_identity`、`logical_question`、`question_members` | 原题与主逻辑题的对应关系。仅以有证据的人工确认 `question_duplicate` 归并。 |
| `logical_question_knowledge` | 每条关联同时保留原题 ID、主逻辑题 ID 和知识点 ID。原 `question_knowledge` 关系行保持各自归属。 |
| `question_annotation` | 本地难度标注，1 至 5 为有序等级，空值为未标注。查看与写入以主逻辑题为准，重复题原有标注不会被归并覆盖。 |
| `question_tag` | 各原题的本地标签，编辑主逻辑题仅更新主记录的标签，搜索覆盖归并成员标签。 |
| `paper`、`question_occurrence` | 原卷身份及题位。一道题在多个原卷或题位出现时存多条记录。 |
| `paper_user_metadata` | 按原卷 ID 保存可空年份、地区、来源，仅为本地标注，同卷关联题共用。原卷标题和题位保持原样。 |
| `revision_search_text.question_type` | 与现有题干投影同属不可变修订。迁移回填，新增修订触发器同事务写入。 |

编辑器以事务保存难度和标签，创建新原卷与题位在同一事务。已有原卷通过原卷 ID 添加新的题位。更新原卷本地标注只改覆盖表，来源和再分发许可分别处理。未录入元数据的旧记录仍可浏览、检索和输出 PDF。题干、答案、审核记录和组卷固定修订不随元数据编辑改变。
