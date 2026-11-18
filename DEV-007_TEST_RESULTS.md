
# DEV-007 Windows 实测结果

环境为 Windows 11 x64（10.0.26200），Intel Core i7-14650HX、16 GB RAM、WebView2 157.0.4341.60、Node.js 24.13.0。采用隔离 Tauri 配置的原生 Windows 调试构建，使用真实 Win32 文件对话框、WebView2 CDP、SQLite 与本地文件。PDF 样本由验收脚本生成，包含文本、数学表达式与函数图、旋转页面、纯图像扫描、答案／解析、损坏／伪装／加密／超限文件及性能卷。

| 编号 | 结果 | 实际证据 |
| --- | --- | --- |
| DEV007-T01 | PASS | 6 页原创文本 PDF 实际选择导入，结束进程后另一 PID 离线打开原卷。 |
| DEV007-T02 | PASS | 6 页图像扫描 PDF 实际渲染，搜索显示无可提取文本，没有命中高亮。 |
| DEV007-T03 | PASS | 同字节跨逻辑试卷一个物理哈希文件，独立 ID。Rust 验证同卷同角色重复导入重用版本，以及同名不同内容生成新版本。 |
| DEV007-T04 | PASS | 原生导入拒绝损坏、伪装、加密、大于 64 MiB、超过 500 页。未登记 ID、相对磁盘路径拒绝读取。 |
| DEV007-T05 | PASS | 真实 DEV-006 Schema 5 先用 SQLite Backup 复制，再通过原生程序两次启动。19 张历史表投影、迁移 1 至 5、完整性及外键比对通过。 |
| DEV007-T06 | PASS | 原生翻页、缩略图、输入页码、整页和宽度缩放。 |
| DEV007-T07 | PASS | 原卷关键字命中第 1、2 页并实际高亮，扫描版无文字提示。 |
| DEV007-T08 | PASS | 同卷原卷、答案、解析三个登记版本切换并渲染。 |
| DEV007-T09 | PASS | CDP 鼠标拖选、切换缩放、四次旋转，区域复位吻合；在旋转源页追加跨页区域。TypeScript 覆盖四向变换。 |
| DEV007-T10 | PASS | 两个真实 PNG 写入现有附件服务并重新在题目编辑器解码，实测 644 × 607 和 910 × 548，文件哈希与登记一致。 |
| DEV007-T11 | PASS | 截图草稿编辑题干、答案、分值并保存。读取两页出现区域及新用户修订，当前审核状态为未审核。 |
| DEV007-T12 | PASS | 在第二份原卷中手工检索并选择已有题，确认关联，新增来源出现在同一个题的查询中。 |
| DEV007-T13 | PASS | 试题详情到精确版本及区域，再由标记到真实题目并返回原卷。 |
| DEV007-T14 | PASS | Windows 验证多来源和跨页。Rust 验证人工确认重复题仍返回原始出现记录，以及更正、越界坐标、越界页和错误版本。 |
| DEV007-T15 | PASS | 实际退出，离线重启后读取 PDF、原题 ID、三个跨版本来源区域与标记。 |
| DEV007-T16 | PASS | Rust 注入半程写失败、残留临时文件、登记失败、资源目录阻塞、文件缺失、哈希损坏、错误版本、无效区域和坏 PNG；原生注入迟到 IPC 响应、未登记读取并验证 PDF 外链无交互入口。 |
| DEV007-T17 | PASS | 1、20、100 页样本原生打开，20／50／100 页跳转，搜索、缩略图、截题及工作集均留原始数据。 |
| DEV007-T18 | PASS | Rust 42 项、TypeScript 33 项、POC-001 12 项及 Windows 旧题库、知识库、检索、附件、组卷和 PDF 内容回归。 |

- [原生 DEV-007 与 E2E 日志](poc-001b/output/dev007/logs/windows-reader.log) · [真实升级日志](poc-001b/output/dev007/logs/windows-schema6-upgrade.log) · [Windows 构建](poc-001b/output/dev007/logs/windows-final-build.log)
- [Rust 含故障注入](poc-001b/output/dev007/logs/rust-tests.log) · [TypeScript](poc-001b/output/dev007/logs/typescript-tests.log) · [原生回归日志](poc-001b/output/dev007/logs/)
- [E2E-001 PDF 内容与附件像素核验](poc-001b/output/dev007/logs/capture-and-export-verification.log)。从导入开始实际截题、编辑、保存、检索、固定组卷和导出。题卷两页，包含两张逐像素比对的截图；答案卷一页，含预期答案。
- **E2E-003 PASS**。用试题详情、选区标记及返回入口完成真实数据库双向定位。
- **Windows 原始文件另存与系统虚拟打印 PASS**。另存文件与输入 SHA-256 相同。Windows 系统对话框实际选择 Microsoft Print to PDF，保存并渲染核对一页，确认原卷的题干和函数图可见。实体纸张输出为 `NOT TESTED`。[打印日志](poc-001b/output/dev007/logs/windows-system-print.log) · [虚拟打印 PDF](poc-001b/output/dev007/artifacts/system-printed-original.pdf) · [渲染页](poc-001b/output/dev007/artifacts/system-print-page.png)

## 性能样本

20 页文本样本 20,427 字节。100 页文本样本 97,668 字节。首次导入到渲染含系统对话框的自动选择，分别为 810.0 和 835.6 ms。其后从库中首次打开分别为 141.4 和 145.3 ms，再次打开分别为 127.3 和 145.2 ms。100 页样本中第 50 和 100 页跳转耗时为 19.8 和 15.8 ms。截图两张、写入附件及编辑器加载合计 328.3 ms。

性能阶段主进程工作集约 92–93 MiB，进程生命周期峰值约 218 MiB。该进程的六个 WebView2 后代总工作集采样约 834–877 MiB。样本耗时包含自动化轮询开销，WebView2 数值为采样工作集总和，包含可能重复计入的共享驻留页。数据适用于这台设备及这些样本。[原始性能数据](poc-001b/output/dev007/performance.json)

## 证据与复现

[十张原生 UI 截图](poc-001b/output/dev007/desktop/) · [原创测试样本](poc-001b/output/dev007/fixtures/) · [导出及附件](poc-001b/output/dev007/artifacts/) · [SHA-256](poc-001b/output/dev007/SHA256SUMS)

从 `poc-001b` 运行 `npm test`、`cargo test --manifest-path src-tauri/Cargo.toml`。Windows 使用有 MSVC、SDK 和 WebView2 的开发环境，执行 `npm run tauri build -- --debug --no-bundle --config <隔离配置>`。设置 `POC001B_TEST_APP_IDENTIFIER` 为构建使用的 `org.shandong-study.dev007-<hex>`。使用带 PyMuPDF、psutil 的 Python 环境运行 `python tests/paper-reader-fixtures.py fixtures .test-output/dev007-fixtures`。在无旧试卷数据的隔离配置执行 `node tests/windows-webview.mjs <exe> --paper-reader`。有样本后运行 `--paper-print`，在系统对话框选择 Microsoft Print to PDF，保存到测试脚本输出的路径。升级使用脚本的 `backup`、`compare` 与原生套件的 `--schema-six`。历史回归分别运行 `--sqlite`、`--advanced`、`--attachments`、`--knowledge`、`--composition` 及无参数 JSON 演示。
