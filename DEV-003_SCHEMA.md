# DEV-003 数据库 Schema 2

迁移 `0002_knowledge.sql` 在现有迁移事务中执行。Schema 1 的迁移文件及其校验值沿用原样，富文本内容仍为 Schema 1。应用数据目录、旧 JSON 和 WebView2 的 PDF 命名规则沿用 DEV-002。

| 对象 | 语义 |
|---|---|
| `subject` | 语文 `chinese`、数学 `math`、英语 `english`、物理 `physics`、化学 `chemistry`、生物 `biology`、思想政治 `politics`、历史 `history`、地理 `geography`。原有 `math` 行及试题引用保留。 |
| `knowledge_point` | 原稳定 ID、学科、名称、父节点。新增 `origin`、`sort_order`、`enabled`。无来源标记的旧记录迁移为用户知识点，排序为 0，默认启用。 |
| `knowledge_alias` | 每个知识点可拥有多个本地别名，同一知识点和别名的组合唯一。别名可添加到公共知识点，独立保存。 |
| `question_knowledge` | 主键为 `(question_id, knowledge_id)`。两个组合外键通过共同 `subject_id` 确保同学科。反向索引为 `(knowledge_id, question_id)`。 |
| `revision_search_text` | 每个不可变修订 ID 的题干文字投影。迁移回填已有修订，新增修订的 SQLite 触发器同步写入。 |

原有组合外键拒绝不存在或跨学科的父节点。插入与修改父节点触发器递归检查祖先，拒绝直接及间接循环。迁移先校验旧节点均能从本学科的根节点到达，异常会回滚。知识点的 ID、来源及学科不可直接改写，标准节点禁止更新、删除和替换。

标准演示节点只有数学中的“演示 · 函数”和“演示 · 二次函数”。用户扩展标准节点时可添加本地别名或自己的子节点。用户名称修改保留 ID 及全部关联。

关联属于**顶层逻辑题**。知识点增删关联写入独立关系表，完全保留修订正文和对应审核。查看历史时显示逻辑题当前关联。已保存组卷仍按原 `composition_item.revision_id` 打开。同题多知识点及多出处仍只计一个顶层题，保留 DEC-039、DEC-040、DEC-041。
