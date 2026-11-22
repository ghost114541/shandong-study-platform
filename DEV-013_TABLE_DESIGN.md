# DEV-013 结构化表格设计

开发基线为 `fe05f71d7cca831be3fffa2eacfb851386b7476c`。适用范围为 SQLite 试题的题干、答案、解析及小问。

## 内容契约

```json
{"type":"table","content":[
  {"type":"tableRow","content":[
    {"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"项目","marks":[{"type":"bold"}]}]}]},
    {"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"结果"}]}]}
  ]},
  {"type":"tableRow","content":[
    {"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"样本 A"},{"type":"hardBreak"},{"type":"text","text":"第 2 次"}]}]},
    {"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"inlineMath","attrs":{"latex":"x^2"}}]}]}
  ]}
]}
```

- 表格只出现在 doc 的块列表，行必须等宽。表头以首行的 `tableHeader` 表示，普通单元格用 `tableCell`。每格保存各自的类型，首行全部为表头时输出语义化表头组。
- 单元格采用段落结构，沿用粗体、斜体、换行、纯文本和行内 LaTeX 规则。表格、行、单元格无持久化 attrs。编辑器通过 Tiptap 3.34.0 扩展提供命令、Tab 和撤销。图片和独立公式应放在表格外。编辑器只提供矩形行列操作，外部表格需在应用中新建后填写各格。
- 每份富文本文档最多 16 个表格，每表 1–120 行、1–8 列、最多 480 个单元格。单元格最多 16 段，每段最多 256 个行内节点。全部表格的 JSON 合计最多 512 KiB（UTF-8）。节点树固定到段落与行内内容。沿用修订 32 MiB 后端总上限。Zod 与 Rust 都采用严格字段白名单，并共享测试样本。KaTeX 仍关闭 trust。

## 版本与兼容

- 本地含表格修订使用 `schema_version: 2`，兼容读取现有完整 v1。编辑器根据全部文档是否含表格确定新保存的版本。去掉最后一张表可生成新的 v1 修订，现有历史修订继续保留。
- SQLite Schema 9 的版本列和 JSON 校验已允许版本 2，继续使用现有插入事务、用户优先视图、逐修订审核、固定组卷和附件链接。写入新修订时将题干和小问提示的表格文字加入现有搜索投影。旧修订及其搜索记录保持原样。
- 草稿继续使用原 payload 容器和附件登记，恢复时验证全部内容。草稿可以包含未填完的试题元数据。
- 备份 v1 是 Schema 9 快照，现有格式完整保存两种修订、草稿和固定引用。DEV-013 读取旧备份和含表格备份。旧程序可能接收档案容器，其修订读取会拒绝 v2，旧程序中的表格草稿恢复不受支持。含表格的库及备份须使用支持 v2 的版本，保留升级前备份用于回退。
- `.studyzip` 继续接受现有协议 1、清单 `db_schema: 8` 和内容 v1。包内 v2 试题明确拒绝，包括在 v1 清单下伪报的内容。本轮交付本地表格功能。公开分发含表格的包需另提协议变更。
- 旧版示例试题集 JSON 继续沿用 v1 原契约。SQLite 迁移、备份容器、资源包公开协议及 DEC-039–041 无需修改。

## PDF

原有单题与组卷快照共用富文本渲染。使用固定列宽的语义化 HTML 表格和行级分页样式，让打印引擎处理分页。复用小问布局、已验证图片、禁用信任的 KaTeX、题卷答案隔离及双卷原子发布路径。Windows WebView2 和 macOS WebKit 都用合成素材实际验证分页、长中文、公式、图片、行标记与答案隔离。延续 DEV-012 的 Mac 文本检索已知差异及 Apple Silicon 实机 BLOCKED。
