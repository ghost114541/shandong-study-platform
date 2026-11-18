
# .studyzip 协议 v1

知卷 0.1.0 的离线导入器接受本规范。应用版本、协议版本、SQLite Schema 与富文本内容版本各自独立。完整示例见 [Manifest](poc-001b/output/dev009/fixtures/manifest.example.json) 和 [合成首版包](poc-001b/output/dev009/fixtures/small.studyzip)。

## 容器与清单

单卷 ZIP32，末尾为无归档注释的 EOCD。成员采用 Stored 或 Deflate，文件名区分大小写，禁止加密和目录成员。所有路径均使用 ASCII 和正斜线。

根成员 `manifest.json` 包含以下字段。

| 字段 | 契约 |
| --- | --- |
| `format`、`protocol_version` | 固定为 `shandong-study-resource-pack`、`1` |
| `pack_id`、`pack_version` | 稳定小写 ID。版本是 SemVer 的正式三段版本，不接受预发行和构建后缀 |
| `display_name`、`source` | 名称和来源声明，分别最多 120、500 个字符 |
| `min_app_version`、`db_schema`、`content_version` | 最低应用 SemVer。v1 导入器要求 Schema 8 和 RevisionContent v1 |
| `counts` | `knowledge`、`questions`、`papers`、`images`、`pdfs`，均为实际非负数量。试题按归档内顶层记录计数 |
| `files` | 除 Manifest 本身外的全部成员，每项含 `path`、`sha256`、`bytes`、`role`。SHA-256 为 64 位小写十六进制 |
| `license_manifest` | 固定为 `LICENSES/rights-and-attribution.json` |

| 角色 | 路径 | 内容 |
| --- | --- | --- |
| `knowledge` | `data/knowledge.jsonl` | `id, subject_id, parent_id, title, sort_order, aliases, rights_id` |
| `questions` | `data/questions.jsonl` | `id, subject_id, revision, content, knowledge, rights_id` |
| `papers` | `data/papers.jsonl` | `id, subject_id, title, metadata, files, occurrences, rights_id` |
| `rights` | `LICENSES/rights-and-attribution.json` | 必填，`entries` 每项含 `id, source, author, license, statement, redistribution_claimed, scope, evidence`。证据可为字符串或 null |
| `image` | `attachments/<sha256>.<ext>` | PNG、JPEG（`.jpeg`）、GIF、WebP |
| `pdf` | `paper-pdfs/<sha256>.pdf` | 经结构校验的被动 PDF |

## 记录

严格 UTF-8 JSON。JSONL 每行一个对象，禁止空白记录、重复对象键、未知结构字段和同类重复资源 ID。稳定 ID 为 1–96 个 ASCII 字符，首字符为字母或数字，其余还允许点、短横线和下划线。归档至少包含一个知识点、顶层试题或逻辑试卷。v1 限制见 [安全设计](DEV-009_SECURITY_DESIGN.md)。

- **知识点**。`parent_id` 为空或是同学科可引用的公共节点。别名数组最多 40 项。已引入的学科和父节点固定，后续版本可以更新标题、排序、公共别名及声明。
- **试题**。`content` 使用现有 [RevisionContent v1](DEV-002_CONTRACT.md)。`knowledge` 是该版本的公共知识点 ID 数组。图片用 `attachment:sha256-<sha256>`，声明的类型、长度和哈希必须与包内文件一致。公式、答案、解析和小问沿用现有验证器。归档不提供审核结论导入字段。
- **试卷**。`metadata` 为 `year, region, source`，允许空值。`files` 每项为 `role, sha256, name, rights_id`，原卷 `original` 必填，可另有 `answer`、`analysis`。`occurrences` 每项为 `source_key, question_id, regions`。区域可为空，最多 64 个。`page_index` 从 0 起算，`rect` 为四个 0–1 之间的归一化坐标，边界须递增。出处须指向同学科的包内或已登记公共题。
- **权利**。知识点、试题、逻辑试卷与每个 PDF 版本引用权利条目的 ID。图片声明随使用它的试题修订追溯。应用逐条显示授权声明，OID-004 继续约束正式发行。
- **引用**。图片和 PDF 均须被当前包引用。归档可以共享同一个哈希对应的 PDF 或图片字节。逻辑资源仍各有自己的 ID 和版本历史。

## 版本行为

同一已安装最新版本只有整份 ZIP 字节相同才返回已安装。重新压缩、重排成员或修改 Manifest 会改变 ZIP SHA-256，并在同版本触发冲突。更高版本按记录执行新增和增量更新。遗漏资源继续保留；v1 低版本导入一律拒绝。不同包不能取得现有资源的 ID 所有权。
