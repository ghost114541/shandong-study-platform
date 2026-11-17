# DEV-002 富文本数据契约

| 版本或载体 | 判定位置 | 用途 |
|---|---|---|
| SQLite Schema 1 | SQLite `user_version` 与迁移历史 | 数据库结构。继续使用原 `0001_core.sql`。 |
| 修订内容 Schema 1 | `question_revision.content_version` 与 `RevisionContent.schema_version` | 每条不可变修订的题型、分值、富文本和小问。 |
| POC-001B 文件 v1 | `document_type=poc001b_question_set` 与文件的 `schema_version` | 保留原本地 JSON 入口及单独存储。 |

`parseQuestionSet` 负责旧文件，`questionToRevision` 显式转换单道旧题，保留原始 LaTeX、图引用和小问 ID。题目 ID 和学科属于数据库逻辑题记录。转换入口没有批量写库副作用。

`parseRevisionContent` 与 Rust `RevisionContent::from_json` 校验修订。Rust 写入前再次校验并限制序列化 JSON 为 32 MiB，读库时也核对版本列。可选答案、解析用缺省或 `null` 表示，附件登记表可缺省。整题与小问分值为 u32，有小问时各分值合计须等于整题分值。小问 ID 在该题内唯一。

富文本根节点为非空 `doc`。块节点为段落、独立公式和图片，段落容纳文本、行内公式和换行。文本可带粗体与斜体标记。各层拒绝未知属性。LaTeX 保留原串，限 1–4000 个 UTF-16 代码单元且不能全为空白。化学方程式使用同一 LaTeX 节点，由 KaTeX mhchem 显示。

图片宽高可省略、为 `null` 或有限正数，单位为 CSS 像素。允许内置配图、合规长度的 PNG/JPEG/WebP/GIF 内嵌 Base64 和 `attachment:<id>`。本地图片通过选择文件并内嵌保存。数据格式通过只验证编码形状，选图时额外解码。外部附件必须有同一修订内对应的 ID、媒介类型、正安全整数大小与 SHA-256 元数据。已登记仅表示元数据存在，文件存在、哈希匹配和渲染均需实际文件服务。当前编辑器与预览显示占位提示，导出遇到可见的未解析附件或解码失败图片时会报错。

组卷预览使用独立的 `PaperData`。旧文件可直接投影为题卷和答案卷。SQLite 工作区通过 IPC 重新读取固定修订，调用 `revisionToPaper` 后共用同一渲染组件。修订含整题答案时，答案卷显示整题答案及各小问答案。

跨语言测试共用 `poc-001b/tests/revision-contract.json`，每份样本具有预期判定。既有数据库原样保留。若早期 DEV-001 调用方曾写入超出此契约的节点属性，读库会报告内容错误并保留该修订的原始数据。
