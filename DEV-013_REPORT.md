# DEV-013 结构化表格开发报告

DEV-013 从 DEV-012 的 `fe05f71d7cca831be3fffa2eacfb851386b7476c` 创建独立分支 `dev/dev-013-rich-tables`。设计先于源码提交，设计提交为 `2e512f7`。本阶段交付本地 SQLite 试题的结构化表格，供独立源码审查。

## 功能与兼容

- 题干、答案、解析和小问可插入表格，支持增删行列、Tab、换行、粗斜体、行内 LaTeX、撤销及重做。Tiptap 表格扩展锁定为 `3.34.0`。前端与 Rust 校验矩形结构、白名单和尺寸，并在事务应用前拒绝超限编辑。
- 含表格的本地修订采用内容 v2。v1 内容按原契约读取，SQLite 保持 Schema 9。保存产生新修订，新修订需要独立审核，公共包升级保留个人修订，已存组卷读取原固定修订。题干和小问提示的单元格文字进入既有搜索索引。
- 备份 v1 快照保留表格、草稿和固定版本。用实际 DEV-010 合成旧备份恢复并核对了 2,512 条原版修订 JSON、2,512 条搜索记录、1 条审核和 2 条固定组卷记录。安装包与备份的回退限制见问题清单。
- `.studyzip` 保持协议 1 和内容 v1。现有 v1 包经过导入、升级回归，v2 内容或伪报清单明确拒绝。DEC-039、DEC-040、DEC-041 延用。
- 单题题卷、单题答案解析和固定组卷双 PDF 共用表格渲染。继续使用既有 WebView2、WebKit、双 PDF 完整性校验和原子发布。

## 可复核证据

- Windows x64 本机使用隔离的真实 Tauri/WebView2 窗口执行编辑、重新启动、草稿恢复、PDF、检索、收藏和原卷测试。留存四份表格 PDF、页面渲染、字体与图片检查、SQLite 回读样本及执行日志。[Windows 证据](poc-001b/output/dev013/)
- macOS arm64 的单题、20 题双卷及答案解析实际生成。WebKit 在部分页间拆分同一行，续页未重复表头。逐行、完整中文短句及公式计数通过。[macOS PDF 和日志](poc-001b/output/dev013/macos-ci/)
- 两端官方 CI 均 PASS，执行提交为 `b9b7d6cbd8244cef721f8dd17d689736a955f4ca`。工作流的 checkout 固定使用对应的 `github.sha`。Windows→Mac→Windows 数据往返指纹一致。各作业和页面检查见测试矩阵。[Windows 构建](https://github.com/ghost114541/shandong-study-platform/actions/runs/45035739161) · [macOS arm64 构建与 PDF](https://github.com/ghost114541/shandong-study-platform/actions/runs/45035739154)
- DEV-012 独立审查状态继续为 **CONDITIONAL PASS**。Apple Silicon 实机保持 **BLOCKED**。

[设计](DEV-013_TABLE_DESIGN.md) · [测试矩阵](DEV-013_TEST_RESULTS.md) · [已知问题](DEV-013_KNOWN_ISSUES.md)

DEV-013 已推送，待网页端 ChatGPT 独立源码审查。
