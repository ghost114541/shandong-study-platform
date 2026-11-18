
# DEV-007 原卷阅读与双向定位

开发基准为 `fc9c98e416565de83bb9111b60142f3733f3b670`，开发分支为 `dev/dev-007-paper-reader`。

试卷库可导入本地原卷、答案和解析，按学科、年份与地区筛选，并打开具体文件版本。内置 PDF 阅读器支持单页翻阅、页码跳转、缩放、旋转、缩略图、文本搜索与高亮。原始 PDF 可按原字节另存。Windows 打印通过系统界面选择打印机。

在原卷上可跨页取区并关联已有试题，也可把 PNG 截图带入原有富文本编辑器。新试题与初始用户修订、原卷出现关系及全部区域一起保存。试题详情列出逻辑题的原始来源，可跳到正确的文件版本并突出对应区域。点击标记从 SQLite 打开实际原始题的试题详情。

| 源码 | 变更 |
| --- | --- |
| `0006_paper_files.sql`、`db/paper_files.rs` | 复用原有试卷与出现记录，新增 PDF 版本、文件内容校验、区域和完整性约束。 |
| `paper_reader_ipc.rs`、`main.rs`、`editor_ipc.rs` | Rust 端文件选择、二进制区间读取、另存、Windows 打印及截题保存。 |
| `paper-library.tsx`、`paper-reader.tsx`、`pdf-page.tsx`、`pdf-document.ts` | 试卷库、离线 PDF.js、单页读卷、截题、搜索和区域导航。 |
| `sqlite-workspace.tsx`、`paper-locations.tsx` | 截图草稿、整题解析编辑、原卷来源入口和返回定位。 |
| `tests/windows-paper-reader.mjs`、`paper_reader_tests.rs` | Windows 原生和 Rust 验收，包含存储故障、跨页、文件版本及逻辑题约束。 |

[Schema 6](DEV-007_SCHEMA.md) · [导入设计](DEV-007_PDF_IMPORT_DESIGN.md) · [阅读器设计](DEV-007_READER_DESIGN.md) · [双向定位](DEV-007_BIDIRECTIONAL_LINK_DESIGN.md) · [验收证据](DEV-007_TEST_RESULTS.md) · [剩余事项](DEV-007_KNOWN_ISSUES.md)
