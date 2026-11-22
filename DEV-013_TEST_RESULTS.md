# DEV-013 测试矩阵

执行提交 `b9b7d6cbd8244cef721f8dd17d689736a955f4ca`。Windows 本机为独立的 `org.shandong-study.dev013-4d013a` 测试配置，CDP 向真实 Win32 WebView2 应用发送输入。测试资料为原创合成样本。

| 编号 | 结果 | 执行记录 |
| --- | --- | --- |
| TAB-01 | PASS | 本机插入 2×2，再通过工具栏扩为 3×4，核对各行列数。 |
| TAB-02 | PASS | 增删行列及删除整表后撤销，保留原目标文字。 |
| TAB-03 | PASS | 中文、英文、数字、粗斜体、段落换行及 KaTeX 行内公式。实际 Tab 进入下一格。 |
| TAB-04 | PASS | 撤销和重做增删行列，核对中间及最终尺寸。 |
| TAB-05 | PASS | 原生关闭、重新打开，3×4 结构与 IPC 回读 JSON 一致。 |
| TAB-06 | PASS | 保存新修订、基线指向旧修订，旧 JSON 可读且相等。Rust 验证审核与原修订绑定。 |
| TAB-07 | PASS | Rust 正式持久化及打印快照读取原固定修订，含表格的新个人修订通过 v1 公共包升级回归。 |
| TAB-08 | PASS | 原生关闭后恢复自动草稿，保存后回读。Rust 实际创建并恢复含表格的备份，核对修订、草稿与固定组卷。 |
| TAB-09 | PASS | 两端拒绝不规则、超大、嵌套或版本不符的表格及危险属性。原生编辑器拦截含远程图片和事件属性的外部表格 HTML。 |
| TAB-10 | PASS | Windows WebView2 实际导出单题题卷和答案解析卷，分别 10 页、2 页。 |
| TAB-11 | PASS | Windows WebView2 实际导出 20 题 PDF 对，题卷 19 页及答案解析 8 页。核对列宽、题号、答案隔离及完整双卷发布。 |
| TAB-12 | PASS | macOS 15.8.2 arm64 官方 CI 使用真实 WKWebView/AppKit 导出单题题卷与答案解析（9/2 页）及 20 题双卷（19/8 页）。通过 A4、行内容、图像、KaTeX 和答案隔离检查。 |
| TAB-13 | CONDITIONAL PASS | 两端逐行核对 `TABROW-001` 至 `TABROW-060`，列内容完整且无空白页或越界字词。Windows 重复表头，WebKit 在部分页间拆分同一行且续页未重绘表头。 |
| TAB-14 | PASS | Windows 旧版 JSON 演示实际打开、编辑、原生关闭后离线回读并导出。用原生 GUI 打开旧 SQLite v1 修订 #2560，解码附件和公式，编辑保存为 v1 修订 #2567，核对旧修订完整并导出 PDF。 |
| TAB-15 | PASS | v1 `.studyzip` 通过实际 ZIP 导入和升级测试，v2 伪报清单明确拒绝。v1 旧备份和含表格的新备份均实际恢复。 |
| TAB-16 | PASS | 原生打开 100 页合成原卷并翻页，PDF 保留已验证附件。实际通过桌面检索单元格文本、预览并收藏 v2 试题。 |
| Apple Silicon 实机 | BLOCKED | 缺授权的 Apple Silicon 物理设备，DEV-012 延续此状态。 |
| 表格极限版面 | NOT TESTED | 8 列、最大字节数以及单格超页三者叠加的实体排版。 |

## Windows 执行证据

- 本机运行 Windows 11 x64（26200）和 WebView2 157.0.4341.60。TypeScript 类型检查与 37 项测试通过，Rust 71 项库测试和 9 项应用测试通过。保留版本、可执行文件哈希和日志。[测试证据目录](poc-001b/output/dev013/)
- 单题和混合题卷使用 60 行原创正文，含长中文、每行公式、试题图片和小问。Poppler 检查 A4 MediaBox、非空页、字词边界、KaTeX 字体、图像对象、行标记与答案内容。渲染全部页面，并目视核对代表性首页、续页、末页及答案页。[实际 PDF 与页面证据](poc-001b/output/dev013/windows-pdf/)
- 首次原生单题导出脚本在附件未就绪时被拒绝。等待图片后完成导出。首次页面检查发现 KaTeX 公式组被拆行，修复后重新构建、导出及渲染。表格混合卷的旧答案标记在测试匹配中曾与小问标记重叠，已收窄匹配并重跑。

## 官方 CI

- Windows x64 CI 构建 PASS，Rust 与 TypeScript 测试通过，构建未签名 NSIS。[Windows CI](https://github.com/ghost114541/shandong-study-platform/actions/runs/45035739161) · [Windows artifact](https://github.com/ghost114541/shandong-study-platform/actions/runs/45035739161/artifacts/14760291010)
- macOS arm64 构建和真实 WebKit PDF 均 PASS。Windows→Mac→Windows 数据往返 PASS，43 张业务表、122 条固定引用、131 个外部或兼容文件指纹一致。[macOS CI](https://github.com/ghost114541/shandong-study-platform/actions/runs/45035739154) · [macOS artifact](https://github.com/ghost114541/shandong-study-platform/actions/runs/45035739154/artifacts/14759923839) · [Windows 返程 artifact](https://github.com/ghost114541/shandong-study-platform/actions/runs/45035739154/artifacts/14760037514) · [日志和 PDF 副本](poc-001b/output/dev013/macos-ci/)

在两端的单题及 20 题题卷中均找到 248 处完整单元格中文短句及 62 个 `x^2+12` 公式文本序列。两类答案卷各保留 32 处短句及 8 个公式序列。比对时忽略空白并使用 NFKC，字面检索延续 DEV-012 的独立记录。

早期 CI 的测试编译和备份路径断言为 FAIL，已分别改用组卷头 ID、选择库外备份目录并重跑。旧答案标记与表格小问标记的检查冲突已收窄匹配，并通过最终 CI。
