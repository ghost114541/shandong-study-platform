# DATA — 概念数据模型与数据契约（草案）

> **不是最终 SQLite DDL**。2026-11-10 已批准计数、核对证据和版本展示/固定引用三项**数据语义**（DEC-039…041）。具体字段名、约束、索引与 migrations 在 PoC 及技术审查后冻结。

## 1. 核心实体

| 实体 | 关键字段（概念） | 关系及说明 |
|---|---|---|
| `subject` | id, name | 九学科，预留扩展 |
| `knowledge_point` | id, subject_id, parent_id, label, scope, active | 可变深度树；`scope=standard/user` |
| `knowledge_alias` | point_id, alias, source | 别名用于搜索，但不会更改标准 ID |
| `knowledge_relation` | from_id, to_id, type | 前置、相关、进阶等跨树联系 |
| `explanation_revision` | id, point_id, content_json, status, source | 知识讲解与分类节点分离，审查状态单独记录 |
| `question` | id, subject_id, type, difficulty, canonical_id, owner_scope, state | 唯一顶层逻辑题是正式数量统计单位；小问不叠加计数（DEC-039） |
| `question_part` | id, question_id, parent_part_id, order, score, content_json, answer_json, explanation_json | 一题多个小问，层级受限由技术设计定 |
| `shared_material` | id, content_json, file_refs | 阅读文章、图表等，可关联多个小问/题 |
| `part_dependency` | part_id, depends_on_id, dependency_type | 防止脱离前置问孤立组卷 |
| `question_knowledge` | question_id/part_id, point_id, relation_type | 一道题多个考点，子问可以不同考点 |
| `paper` | id, title, subject_id, year, exam_date, region, exam_type, source_type | 逻辑完整试卷，不与 PDF 文件一一绑定 |
| `paper_file` | id, paper_id, file_id, file_role, version | 原卷/答案/解析/重排版本 |
| `question_occurrence` | id, question_id, paper_id, raw_number, page_index, rect_norm, status | 原题页码/区域与题库双向定位 |
| `attachment` | id, sha256, media_type, relative_key, size, source | 外部 PDF、图片与其他文件的完整性索引 |
| `resource_provenance` | item_id, original_url_or_reference, license_evidence, acquired_at | 资源来源、再分发权利依据与审核范围 |
| `verification_record` | item_id, item_type, aspect, reviewer, checked_at, evidence, verdict, review_of | 正式答案核对必须能追溯审核身份/日期/依据/结论；争议复核独立留痕（DEC-040） |
| `question_revision` | id, question_id, base_revision_id, scope, content_snapshot, created_at, immutable | 用户版本优先展示、原版可选；公共修订和用户修订均保留可引用版本（DEC-041） |
| `resource_pack` | id, version, schema_version, installed_at, manifest_hash, state | 包注册与安装日志 |
| `pack_membership` | pack_id, entity_type, entity_id, revision_id | 记录包对实体的提供关系 |
| `favorite_collection` | id, name | 基础收藏文件夹 |
| `favorite_item` | collection_id, target_id, target_type, mark | 收藏与重点标记 |
| `composition` | id, title, template, settings_json | 自定义组卷的配置 |
| `composition_item` | composition_id, question_id, revision_ref, content_snapshot_ref, part_selection, sort_order, score_override | 持久化时固定不可变修订或快照；不能无提示漂移到新版本（DEC-041） |
| `edit_draft` | target_id, editor_state_json, updated_at | 自动保存草稿，不混同正式修订 |
| `trash_item` | target_type, target_id, deleted_at, previous_context | 逻辑删除与恢复 |
| `backup_record` | id, backup_version, created_at, validation_status | 备份目录清单及恢复记录 |

### 标准 ID 原则

- 标准知识点/公共资源使用稳定 ID，不以名称/年份当唯一键。
- 同一道题在多个试卷中出现：`question` 仅一项，`question_occurrence` 多项；是否为同题不能仅凭 OCR 相似、文件哈希推断。
- 对完全相同文件，`attachment.sha256` 可去重；不同版式文件仍可关联到同一逻辑 `paper`。
- 用户编辑公共资源，创建 `question_revision` 或 fork，不直接改写公共包记录；若存在用户版本，默认展示用户版本；提供明确的公共原版查看入口（DEC-041）。

## 2. 内容文档结构（示例，非最终 Schema）

统一采用 `schema_version` 和节点序列：

```json
{
  "schema_version": 1,
  "type": "doc",
  "content": [
    {"type":"paragraph", "children":[{"type":"text", "text":"已知函数 "}, {"type":"math_inline", "latex":"f(x)=x^2-2x+1"}]},
    {"type":"image", "attachment_id":"asset_example_01", "alt":"题目配图"}
  ]
}
```

- 文档节点使用可控类型；避免将不可控 HTML 字符串直接渲染到富文本应用。
- 题干、答案、解析、小问可以独立文档，保留元数据和原始 PDF/图片引用。
- 建立去格式化检索文本及正规化公式索引；截图题未转录文本时只能依靠显式元数据检索。
- 对多问共享材料，引用 `shared_material` ID；导出时确保材料只出现必要次数。

## 3. 页码与区域

建议页码内部统一 0 起索引，对用户显示 1 起页码。矩形区域使用 `[x0,y0,x1,y1]`（0—1 的相对坐标），标记文档版本和页面尺寸来源；PDF 变化后原区域应核查。DOCX 不能可靠使用固定页码。

## 4. 已批准的计数、审核、版本规则（DEC-039…041）

### 4.1 正式题量与去重

- **题量 = 满足正式发布资格的唯一顶层逻辑题数量**。顶层题所含小问数单独统计，不叠加到 2,000 道指标。
- 同一道逻辑题出现在多个试卷或重印版本中，建立多个 `question_occurrence`，**只计一次**。共享阅读材料下的多个真正独立逻辑题，分别保有其顶层 ID。
- 纯截图题并非天然排除；须有可辨识题目、必要元数据、正确答案及审核证据，才能计入正式发布数量。仅上传了一幅图片或一份试卷的行为不自动增加正式独立题数。
- 去重判断需要可追溯的人工确认/显式映射；不能仅凭文件哈希或文本相似度自动将两题合并。

### 4.2 答案核对记录

- “答案已核对”必须有与**被审核题目版本**关联的审核人/身份标识、核对日期、来源/依据、结论。审核结论至少能区分通过、争议和不通过。
- 被标记为争议、失败或过期/不对应当前答案版本的记录，不得计入正式通过数量。
- 发生纠错后保留原审核记录并新建修订与复核记录；**不强制所有题目经两名人员独立审核**。
- 具体枚举和核对工作流在技术设计中落地，但最低证据字段不可删去。

### 4.3 用户覆盖及组卷引用

- 公共包版本为不可变参考，用户修改生成独立的私有修订；有私有覆盖时通常视图**默认显示用户版本**，可主动切换到公共原版。
- 更新公共资源包时不得覆盖用户版本，也不能静默改变已保存组卷。
- 组卷条目固定指向**不可变修订 ID 或内容快照**；再次打开或重新导出使用相同题目内容。固定引用丢失时显示错误与修复入口，不得暗中换成新版本。
- 这些是**已批准数据语义**；版本存储的具体数据表和引用实现仍待 PoC 确认。

## 5. 迁移与一致性

- 使用明确的 schema migrations，不在启动时直接依赖 `CREATE TABLE IF NOT EXISTS` 替代正式升级。
- 所有外键需检查；公共包导入与用户私有对象删除使用独立写操作，避免连带删除被收藏对象。
- 用户数据跨平台备份采用与系统无关的相对资源引用；恢复时核查所有附件哈希、表关系及数据库版本。
- 原始包、草稿、归档、公用版本及回收站的保留策略仍须通过 `OID-008` 等决定。
