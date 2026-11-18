# DEV-008 测试结果

隔离的 Windows 原生 Tauri 调试版位于 `poc-001b/src-tauri/target/debug/shandong-poc-001b.exe`。运行环境为 Windows 11 25H2 x64（26200.9974）、Intel Core i7-14650HX、16 GB RAM、WebView2 157.0.4341.60。测试通过 WebView2 的鼠标及键盘输入驱动界面，PDF 导入使用 Win32 文件选择器。原生启动校验 Win32 窗口句柄、独立进程和应用返回的 Schema 7。 [Windows 构建](poc-001b/output/dev008/logs/windows-build.log) · [环境与 EXE 哈希](poc-001b/output/dev008/logs/windows-environment.log)

| 编号 | 结果 | 核对内容 |
| --- | --- | --- |
| DEV008-T01 | PASS | 实际 Schema 6 库用 SQLite Backup 复制，两次原生启动到 Schema 7。核对 21 张历史表、6 条迁移记录、8 个资源文件哈希、外键和完整性。 |
| DEV008-T02 | PASS | 新库与迁移库只有一个 `default`。两次启动后身份不变，删除受阻。 |
| DEV008-T03 | PASS | 原生创建两夹、重命名、上移，和 SQLite 排序结果一致。 |
| DEV008-T04 | PASS | 原生重复名称提示和输入焦点。Rust 核验空白、控制字符、过长名称、非法类型、未知收藏夹及未知资源。 |
| DEV008-T05 | PASS | 从检索结果收藏，确认只移除指定收藏夹的关系。重复取消保持幂等。 |
| DEV008-T06 | PASS | 实际导入数学卷并收藏，与标准知识点经原生详情收藏。Rust 补充用户知识点、更名、别名、停用、第二原卷版本及答案 PDF。 |
| DEV008-T07 | PASS | 原生同一题入三夹，复制保留来源，移动移除来源，取消只影响确认的夹。 |
| DEV008-T08 | PASS | 两连接并发重复收藏，删除收藏夹与入夹竞争。去重、外键和无残留关系均有断言。 |
| DEV008-T09 | PASS | 知识详情和收藏页切换重点。Rust 与原生验证跨夹一致性和重启持久化。 |
| DEV008-T10 | PASS | 原生切换三类资源、按措辞搜索及仅重点。Rust 和性能套件分别覆盖稳定名称排序、过滤翻页和下一页。 |
| DEV008-T11 | PASS | 原生结果行、侧栏和多选批量收藏，核对目标夹包含两道指定题。 |
| DEV008-T12 | PASS | 原生打开 SQLite 当前题、定位标准知识点，并在实际 WebView2 渲染所选原卷版本。返回保留类型筛选。 |
| DEV008-T13 | PASS | 原生加入篮并保存组卷，读回明确的固定修订。Rust 验证现有重复题检查和后续修订保护。 |
| DEV008-T14 | PASS | 既有人工流程确认 A/B 为同题，去重数为 1，原始成员保留。确认信息过期时移除回滚。 |
| DEV008-T15 | PASS | 收藏绑定逻辑题，最新个人修订可读，旧审核留在旧修订，公共原版及已保存组卷固定修订可读。 |
| DEV008-T16 | PASS | 原生删除收藏夹后试题、知识点和省卷登记仍可读。Rust 验证修订、审核、组卷、来源、PDF/图片字节与外键。 |
| DEV008-T17 | PASS | 批内非法 ID、关系插入故障、删除约束故障回滚。显示缺 PDF 或可读修订的收藏。原生倒序提交旧 IPC 响应和写入锁期间关闭窗口均有断言。 |
| DEV008-T18 | PASS | 实际关闭原生进程，直接核对 SQLite 中移动、顺序及重点状态。新 PID 在 WebView2 模拟断网且关闭 HTTP 缓存下回读。 |
| DEV008-T19 | PASS | 1,000 和 5,000 条三类混合关系含人工同题。原生记录首屏、打开文件夹、筛选、翻页、批量和重点操作，并记录 IPC 和内存。 |
| DEV008-T20 | PASS | POC-001 静态样本、原生旧 JSON、SQLite 修订、知识库、高级检索、附件、组卷、原卷阅读和双向定位通过综合回归。单独的系统打印输出复测见下文。 |

主要证据为[Schema 6 → 7](poc-001b/output/dev008/logs/windows-schema7-upgrade.log)、[Rust 50 项](poc-001b/output/dev008/logs/rust-tests.log)、[TypeScript 34 项](poc-001b/output/dev008/logs/typescript-tests.log)和[原生操作](poc-001b/output/dev008/logs/windows-favorites.log)。[12 张原生截图](poc-001b/output/dev008/desktop/) · [原始日志](poc-001b/output/dev008/logs/) · [SHA-256](poc-001b/output/dev008/SHA256SUMS)

历史回归包括实际生成的 JSON 演示、SQLite 题卷、外部附件、固定组卷以及原卷截图的双 PDF。文本、版式、附件像素和题答分离均通过核验。原卷系统打印单项已打开真实 Windows 对话框并看到 Microsoft Print to PDF，首次等待输出超时，重试时用户停止桌面控制，未验证写出的 PDF。 [历史回归日志](poc-001b/output/dev008/logs/) · [系统打印首次尝试](poc-001b/output/dev008/logs/regression-system-print.log)

## 性能

| 收藏关系 | 首屏 ms | 收藏夹打开 ms | 筛选 ms | 下一页 ms | 批量总计 ms | 单次列表 IPC ms | 标记 ms | APP / WebView2 工作集 MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 174.58 | 169.25 | 172.96 | 168.63 | 95.84 | 15.09 | 170.30 | 40.2 / 399.4 |
| 5,000 | 185.84 | 169.19 | 167.20 | 167.94 | 496.46 | 38.41 | 171.58 | 42.5 / 445.0 |

样本分别占用两个收藏夹，包含三种资源及一对人工同题。批量总计按每次 250 项调用 IPC。每组从新原生进程开始，UI 时间包含约 150 ms 一轮的验证轮询，IPC 耗时包含进程间往返和 SQLite 查询。Rust 日志另列服务调用耗时。WebView2 是六个后代进程的工作集之和，共享页可重复计入。性能卷是合成元数据，实际原卷的渲染另在 Windows 流程验证。 [原始计时和内存字节数](poc-001b/output/dev008/performance.json)

## 复现

在 `poc-001b` 执行 `npm run typecheck`、`npm test`、`cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`。用 Windows MSVC 和 SDK 执行 `npm run tauri -- build --debug --no-bundle --config <隔离配置>`。配置与 `POC001B_TEST_APP_IDENTIFIER` 使用同一 `org.shandong-study.dev008-<十六进制标识>`。运行 `node tests/windows-webview.mjs <exe> --favorites` 与 `--favorites-performance`，分别从空隔离配置启动。Python 需要 psutil 用于进程工作集采样。

升级采用 `favorites-probe.py backup`、原生 `--schema-seven` 和 `favorites-probe.py verify-upgrade`，源库必须为可只读访问的 DEV-007 Schema 6 测试配置。历史纸卷夹具由 `tests/paper-reader-fixtures.py` 生成。历史高级检索使用 SQLite 题库套件产生的数据库，附件回归继续使用高级检索种好的分页题。不同测试配置可以通过复制关闭状态的试验数据库来保留输入快照。
