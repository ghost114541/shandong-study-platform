# CONTENT-004-B 九科资源建设检查点（2026-11-26）

Windows 私人活动库经实际恢复和重启，累计 420 道逻辑题和 33 套合格完整卷。B 批新增 105 道，距 450 道差 30 道。全库完整解析率 82.14%，B 新题实质解析核对 44/105。双 PDF 扩展路径误拒绝修复，A 三题 PDF 的内容缺失在留存产物中未获支持。OID-004、应用内英语听力和 macOS Apple Silicon 实机验收继续开放。

[检查点](CONTENT-004_B_CHECKPOINT.md) · [验收矩阵](CONTENT-004_TEST_RESULTS.md) · [PDF 专项](CONTENT-004_PDF_EXPORT_TEST_RESULTS.md)

# CONTENT-004-A 九科资源建设检查点（2026-11-26）

Windows 隔离库经实际恢复达到 315 道逻辑题、25 套应用内完整卷，九科均有新增。A 批达标，B 已收集候选。CONTENT-004 阶段仍差 435 道和 20 套，全库完整解析率 76.19%。已登记组卷导出缺失内容问题。OID-004 开放，应用内英语听力 BLOCKED。

[A 报告](https://github.com/ghost114541/shandong-study-platform/blob/83ad75133a258a79c361f3386b81827d3def81ec/CONTENT-004_REPORT.md) · [A 验收矩阵](https://github.com/ghost114541/shandong-study-platform/blob/83ad75133a258a79c361f3386b81827d3def81ec/CONTENT-004_TEST_RESULTS.md) · [A 批次进度](https://github.com/ghost114541/shandong-study-platform/blob/83ad75133a258a79c361f3386b81827d3def81ec/CONTENT-004_BATCH_SUMMARY.json)

# CONTENT-003.2 独立验收后最小补丁（2026-11-25）

修复 PDF 导入窗口标题编码，区分新重复题的原卷出现关系和逐修订内容来源。网页端独立源码审查原结论为 CONDITIONAL PASS，最小补丁待最终独立复验。真实库只读保全，现有正式审核统计、OID-004、应用内英语音频和 Apple Silicon 状态沿用。

[补丁报告](CONTENT-003.2_PATCH_REPORT.md) · [补丁验收矩阵](CONTENT-003.2_PATCH_TEST_RESULTS.md)

# CONTENT-003.2 批量导入与逐修订核对（2026-11-25）

开发端完成定向修复，待网页端独立源码审查。全库隔离副本 206 题、211 修订、22 卷、44 个 PDF 版本、15 个固定引用。实际应用恢复、九科查询和全库审计通过。当前答案核对 102，解析核对 25，正式人工审核通过 0。英语应用内音频和 Apple Silicon 实机保持 BLOCKED，OID-004 开放。

[报告](CONTENT-003.2_REPORT.md) · [验收矩阵](CONTENT-003.2_TEST_RESULTS.md) · [数量](CONTENT-003.2_COUNTS.json) · [全库摘要](CONTENT-003.2_FULL_AUDIT_SUMMARY.json)

# CONTENT-003.1 批量导入安全与数量复验（2026-11-24）

- 分支 `content/content-003-1-batch-hardening` 基于 `f4976ad6a641d71290ad69ff928fc8310cfb0b8f`。独立 Windows 配置下通过目标身份保护、混合来源全库计数、多个文件版本和批次重放的验证。
- 私人库从 102 道增至 206 道，9 科可检索，保留 105 条原修订和 15 条固定组卷引用。22 条卷记录中 21 套材料完整，其中英语听力可在应用外使用。正式人工审核通过 0。
- 最终备份已实际切换和重启。前后审计均为 0 个结构异常，43 张业务表与 330 个非数据库备份成员相符。待网页端 ChatGPT 独立安全收尾与数量目标复验。

[报告](CONTENT-003.1_REPORT.md) · [验收矩阵](CONTENT-003.1_TEST_RESULTS.md) · [数量](CONTENT-003.1_COUNTS.json) · [来源索引](CONTENT-003.1_SOURCE_INDEX.csv) · [已知问题](CONTENT-003.1_KNOWN_ISSUES.md)

# CONTENT-003 半自动批量导入与全库来源审计（2026-11-24）

- 正式分支从 CONTENT-002 的 9 道题、4 套完整卷继续建设。Windows 隔离个人库累计 102 道独立题、20 套完整卷及 1 套缺听力音频的英语卷，覆盖 9 科。
- 新增全库反查与逐修订来源登记、资源收集和批处理。最终应用备份实际恢复及重启，备份前、解包及恢复后结构错误均为 0。
- 102 道均有参考答案及解析字段，25 道核对完整解析，2 道有来源分歧，正式人工审核通过 0。200 道题及英语完整卷仍未达目标，待独立验收。

[报告](CONTENT-003_REPORT.md) · [批处理与来源结构](CONTENT-003_BATCH_DESIGN.md) · [测试](CONTENT-003_TEST_RESULTS.md) · [计数](CONTENT-003_COUNTS.json) · [已知问题](CONTENT-003_KNOWN_ISSUES.md)

# CONTENT-002 跨学科个人题库（2026-11-24）

- 独立分支 `content/content-002-cross-subject-pilot` 基于远端 CONTENT-001 `56e7955c66dc484dc65963ef92b0b723623401f4`。
- Windows 原生试点新增语文、物理、历史 3 套完整试卷、3 份答案解析版及 6 道顶层逻辑题。累计个人库 4 套卷、9 道题，正式审核通过 0。
- 重启后的双向定位、3 对导出、原生完整备份及旧组卷固定修订已验证。私人追溯清单与活动库及解包库一致。应用协议、DEV-012、DEV-013 与 OID-004 沿用既有状态。

[报告](CONTENT-002_REPORT.md) · [九科矩阵](CONTENT-002_SUBJECT_COVERAGE.csv) · [测试](CONTENT-002_TEST_RESULTS.md) · [追溯格式](CONTENT-002_TRACE_SCHEMA.md) · [已知事项](CONTENT-002_KNOWN_ISSUES.md)

# CONTENT-001 山东高中个人题库（2026-11-24）

- 修订任务授权建立个人离线库。独立分支 `content/content-001-provenance-audit` 基于 `82da6023bf91f5aa4712a6feae835d6c970390f7`。调查 13 个来源站点或机构，覆盖九科，登记 27 条资源链接及配套记录。
- Windows 隔离试点收录 3 道数学真题和 1 套完整试卷，保留来源、真实文件哈希、参考答案、解析、原卷定位和固定组卷。三题和一卷待正式内容复核，扩充目标尚未达到。
- OID-004 保持开放，仅阻断第三方资源随软件正式公开发行。DEV-012、DEV-013 保持 **CONDITIONAL PASS**，Apple Silicon 实机 **BLOCKED**。

[审计](CONTENT-001_AUDIT_REPORT.md) · [来源](CONTENT-001_SOURCE_REGISTER.csv) · [导入](CONTENT-001_IMPORT_PLAN.md) · [测试](CONTENT-001_TEST_RESULTS.md) · [问题](CONTENT-001_KNOWN_ISSUES.md)

# DEV-013 结构化表格（2026-11-22）

- 独立分支 `dev/dev-013-rich-tables`，起点 `fe05f71d7cca831be3fffa2eacfb851386b7476c`。本地表格修订使用内容 v2，继续读取 v1，SQLite Schema 9、备份 v1、`.studyzip` 和 DEC-039～041 延用。
- Windows 原生编辑、草稿、固定修订、单题和 20 题双 PDF 已取得实测证据。Windows/macOS 官方 CI 均 PASS，执行提交为 `b9b7d6cbd8244cef721f8dd17d689736a955f4ca`。Mac WebKit 续页表头与拆行边界见测试矩阵。DEV-012 保持 **CONDITIONAL PASS**，Apple Silicon 实机保持 **BLOCKED**。
- DEV-013 已推送，待网页端 ChatGPT 独立源码审查。

[设计](DEV-013_TABLE_DESIGN.md) · [报告](DEV-013_REPORT.md) · [测试](DEV-013_TEST_RESULTS.md) · [已知问题](DEV-013_KNOWN_ISSUES.md)

# DEV-012 独立审查后收尾（2026-11-22）

- 开发分支为 `dev/dev-012-macos`，首次收尾基线为 `094b6acfd119901a2acdf7943a905b90d1ce886d`。历史 DEV-011 基线为 `9446c0c764412566f2467effaacc37c00e7d321f`。Preview 0.2.1、SQLite Schema 9、备份协议 v1、`.studyzip` 及 DEC-039～041 延用。
- 收尾实现覆盖 macOS PDF 超时、关窗、迟到完成、并发拒绝及安全恢复提示。增加跨平台 PDF 实际输出和中文检索、公式、分页验证，以及同提交的 Windows→Mac→Windows 数据探针。实际测试 SHA、测试环境和逐项状态见收尾矩阵。
- 两套官方 CI 均通过，实际测试提交为 `b229d6d6b2a833e40c2ca88b5de5f49b2cb94cc0`。Mac VM 故障注入和两端 PDF 样本已核对。全 CI 与本机返程的 43 张表、102 条固定修订及 131 项外部或兼容文件指纹一致。 [macOS CI](https://github.com/ghost114541/shandong-study-platform/actions/runs/44952652985) · [Windows CI](https://github.com/ghost114541/shandong-study-platform/actions/runs/44952653055)
- Windows x64 原生工具链、WebView2 文字与版面回归、PDF.js 原卷导入与截图、固定修订安全、收藏、审核、资源库故障恢复和 NSIS 已重跑。
- 独立审查基线仍为 **CONDITIONAL PASS**。Apple Silicon 实机、完整 Mac GUI E2E-007、原生 PDFKit 打印面板、外置卷、安装重装、正式签名公证及 OID-005 仍开放。下一步由网页端 ChatGPT 独立源码复审，再使用授权实机按步骤补证。

[收尾报告](DEV-012_CLOSEOUT_REPORT.md) · [收尾测试矩阵](DEV-012_CLOSEOUT_TEST_RESULTS.md) · [生命周期设计](DEV-012_PRINT_LIFECYCLE.md) · [已知问题](DEV-012_KNOWN_ISSUES.md) · [实机步骤](DEV-012_MACOS_INSTALL_DESIGN.md) · [历史 32 项验收](DEV-012_TEST_RESULTS.md)

# DEV-011 Windows 安装与数据安全交接（2026-11-19）

**DEV-011 Windows 安装、升级与卸载核心开发验收完成，待网页端 ChatGPT 独立源码审查。整体结论 CONDITIONAL PASS。**

- 分支为 `dev/dev-011-windows-installer`，基准为 `198f81c5c59281a5a32f28d1ea3bbeaa4dde2aad`。真实未签名 Windows x64 NSIS 支持当前用户安装。0.2.0 → 0.2.1 原位升级、卸载、重装和旧资料回读已实测。
- 活动库在 D: 的 Unicode 目录，回退库在 C:。SQLite 表、外部图片与原卷、草稿、固定组卷、控制日志和独立备份的指纹在各关键阶段一致。正常 Windows 注册卸载器再验收时，263 个数据文件逐字节一致。
- 已安装应用通过离线模拟渲染原卷并生成 A4 双 PDF。GitHub Actions Windows 构建及下载校验完成。无 Runtime 的完全离线部署 BLOCKED，干净 VM、中文用户和少数故障项状态见验收矩阵。

[报告](DEV-011_REPORT.md) · [24 项验收](DEV-011_TEST_RESULTS.md) · [已知事项](DEV-011_KNOWN_ISSUES.md) · [源码与证据](https://github.com/ghost114541/shandong-study-platform/tree/dev/dev-011-windows-installer) · [CI B 下载](https://github.com/ghost114541/shandong-study-platform/actions/runs/44577470728/artifacts/14558850936)

---

# DEV-010.1 资源库目录安全交接（2026-11-19）

**DEV-010.1 Windows 安全修复开发验收完成，待网页端 ChatGPT 独立源码审查。**

- 分支 `dev/dev-010-1-library-root-safety` 基于 `34bd1e67399e44487c032f9e65eb7eba2e10fd4d`。恢复与布局修复将候选建立在独立目录。配置、旧默认库及历史内层库受清理保护。
- Windows 已复核真实 NTFS junction、旧版嵌套库启动与安全迁移、八个真实 Tauri 强制终止点、C: 至 D: 迁移及双向回退。历史活动库缺图时按预期阻断，原库保留。目录符号链接和其余未测项见验收矩阵。

[专项报告](DEV-010-1_REPORT.md) · [目录安全](DEV-010-1_PATH_SAFETY_DESIGN.md) · [16 项验收与证据](DEV-010-1_TEST_RESULTS.md) · [已知问题](DEV-010-1_KNOWN_ISSUES.md)

---

# DEV-010 数据保护交接（2026-11-19）

**DEV-010 Windows 开发验收完成，待网页端 ChatGPT 独立源码审查。**

- 开发分支 `dev/dev-010-data-protection`，基准 `bde7b70f62e9656f3414dc28e03435da4fb1d1de`。实现提交 `5d97f428b8b0832946e1b1d191f8b91f432ac213`。Schema 9 增加备份历史、回收站和草稿，并通过持久日志在启动时切换完整资源库。
- Windows 原生试验从 Schema 8 升级，并将 2,507 个试题记录（2,506 道逻辑题）与 129 个已登记或兼容文件恢复到空白配置。业务表指纹、审核历史、同题、固定组卷及外部文件哈希一致。实际强制退出覆盖归档写入、恢复暂存及切换边界。C: 至 D: 迁移前后 130 个文件逐项一致。
- E2E-008 已通过 Windows 原生流程。试题、组卷和 PDF 截图草稿真实强制退出后可恢复。E2E-007 Windows 已验证隔离恢复，macOS 实机仍为 NOT TESTED。真实卷写满、历史 UI 脚本全量重跑等分项状态见矩阵。

[开发报告](DEV-010_REPORT.md) · [Schema 9](DEV-010_SCHEMA.md) · [验收矩阵与证据](DEV-010_TEST_RESULTS.md) · [已知问题](DEV-010_KNOWN_ISSUES.md)

---

# DEV-009 离线资源包交接（2026-11-19）

**DEV-009 Windows 开发验收完成，待网页端 ChatGPT 独立源码审查。**

- 分支 `dev/dev-009-resource-packs` 基于 `9453ae8722f243208d048fa77a0a6f5c30208a36`。资源管理支持本地 `.studyzip`、完整性与兼容校验、差异预览、增量升级、安装历史和中断恢复。
- Schema 8 记录包版本和来源归属。实际 Schema 7 数据库备份已原生升级，旧数据指纹及资源文件哈希一致。公共版本追加后，个人修订优先、原审核、收藏、用户区域和组卷固定引用均保留。
- E2E-006 使用 Windows 原生程序完整执行。实际强制终止覆盖暂存写入中、提交前、提交后未清理。合成大包 2,000 道题的性能及历史回归见测试矩阵。
- 原卷经 Microsoft Print to PDF 写出并核验单页。OID-004 继续约束正式资源发行，macOS 和强制断电的验证状态见已知问题。

[报告](DEV-009_REPORT.md) · [Schema 8](DEV-009_SCHEMA.md) · [协议 v1](DEV-009_PACK_FORMAT.md) · [POC-003](POC-003_REPORT.md) · [验收证据](DEV-009_TEST_RESULTS.md) · [已知问题](DEV-009_KNOWN_ISSUES.md)

---

# DEV-008 统一收藏交接（2026-11-18）

**DEV-008 Windows 开发验收完成，待网页端 ChatGPT 独立源码审查。**

- 分支 `dev/dev-008-favorites` 基于 `6a1b7ebe16073915c3fb7dd8b32f5100708d0b13`。SQLite Schema 7 支持试题、逻辑试卷与知识点收藏、收藏夹、重点、检索和打开实际资源。
- 人工同题合并展示并保留原始收藏关系。组卷通过已有入口固定修订。真实 Schema 6 库已用两次原生启动、历史表及文件哈希校验完成升级。
- 原生收藏工作流和离线重启回读通过，保留 12 张 Windows 截图。综合历史回归和双 PDF 内容检查通过。系统打印对话框已打开，单独的虚拟打印落盘复测未完成。

[报告](DEV-008_REPORT.md) · [Schema 7](DEV-008_SCHEMA.md) · [收藏设计](DEV-008_FAVORITES_DESIGN.md) · [界面设计](DEV-008_UI_DESIGN.md) · [测试矩阵](DEV-008_TEST_RESULTS.md) · [已知问题](DEV-008_KNOWN_ISSUES.md)

---

# DEV-007 原卷阅读与双向定位交接（2026-11-18）

**DEV-007 Windows 开发验收完成，待网页端 ChatGPT 独立源码审查。**

- 开发分支 `dev/dev-007-paper-reader` 源于已核验的 DEV-006 提交 `fc9c98e416565de83bb9111b60142f3733f3b670`。
- Schema 6 复用原试卷和出现记录，登记不可变 PDF 文件版本及多页矩形。真实 Schema 5 测试库通过备份升级、两次 Windows 原生启动和历史记录对比。
- 试卷库提供本地导入、离线阅读、文本搜索、原卷／答案／解析切换、截图进入试题编辑器、双向定位、原字节另存及 Windows 系统打印。DEV007-T01 至 T18、E2E-001 和 E2E-003 已执行并通过。
- Microsoft Print to PDF 输出实测通过。实体纸张打印、macOS 和低内存设备专项留待验证。OID-004 继续独立审查正式资源分发权。

[报告](DEV-007_REPORT.md) · [Schema 6](DEV-007_SCHEMA.md) · [导入设计](DEV-007_PDF_IMPORT_DESIGN.md) · [阅读器设计](DEV-007_READER_DESIGN.md) · [双向定位](DEV-007_BIDIRECTIONAL_LINK_DESIGN.md) · [验收证据](DEV-007_TEST_RESULTS.md) · [剩余事项](DEV-007_KNOWN_ISSUES.md)

---

# DEV-006 多题组卷交接（2026-11-18）

**状态：Windows 功能验收完成，待独立源码审查。** 分支为 `dev/dev-006-paper-composition`，基准为 `66ebd57`。

- 从 SQLite 检索和侧栏加入固定修订，支持草稿保护、题目与分组排序、整数分值和重启回读。组卷副本及新版本均独立保存。
- Schema 5 复用原组卷表。真实 DEV-005 测试库及 DEV-001 格式固定组卷已完成升级和重复启动验证。
- Windows WebView2 从 Rust 固定快照输出题卷及答案解析卷。原创数学、物理、化学样本各一题，两份 PDF 各两页。实测附件损坏、过期预览、未就绪打印视图和文件路径错误的失败保护。
- DEV-008 保留收藏作为独立任务。DEV-010 继续负责异常草稿恢复。正式跨学科模板、小问选择及 macOS 导出待后续验证。

[报告](DEV-006_REPORT.md) · [Schema 5](DEV-006_SCHEMA.md) · [组卷设计](DEV-006_COMPOSITION_DESIGN.md) · [PDF 设计](DEV-006_PDF_DESIGN.md) · [验收证据](DEV-006_TEST_RESULTS.md) · [后续事项](DEV-006_KNOWN_ISSUES.md)

---

# DEV-005 外部附件交接（2026-11-17）

**状态：Windows DEV005-T01 至 T14 已通过。** 分支为 `dev/dev-005-attachments`，基准为 `acb5f0b`。本轮完成原计划中尚待实现的外部附件服务。

- 同原卷使用一个可编辑表单并检查并发修改。检索侧栏按结果修订 ID 读取，历史修订只读，返回保留检索条件和页码。
- Schema 4 登记附件和修订关系，真实 PNG、JPEG、WebP、GIF 由 Rust 文件服务保存。新 SQLite 富文本使用稳定附件引用，旧 Base64 修订和 JSON 数据均通过回归。
- Windows 已实测选择 PNG、保存、重启、侧栏预览以及题卷和答案卷 PDF。校验失败或加载中时拦截导出，两份 PDF 的内嵌 PNG 与原始图片逐像素一致。
- 实际 DEV-004 测试库的 Schema 3 备份完成原生升级和重启。完整备份恢复、macOS、安装卸载和实体打印仍待验证。

[报告](DEV-005_REPORT.md) · [Schema 4](DEV-005_SCHEMA.md) · [附件与备份设计](DEV-005_ATTACHMENT_DESIGN.md) · [验收证据](DEV-005_TEST_RESULTS.md) · [已知事项](DEV-005_KNOWN_ISSUES.md)

---

# DEV-004 去重、高级检索与预览交接（2026-11-17）

**状态：DEV004-T01 至 T12 均通过。** 分支为 `dev/dev-004-advanced-search`，基准为 `d474607`。本轮对应原计划 DEV-005 的组合检索与侧边预览。

- 重复题知识点检索归一到主逻辑题，保留每条原始关联及其出处、修订、审核和组卷引用。
- Schema 3 支持本地难度、标签及按原卷维护的年份、地区、来源。实际 DEV-003 测试库升级及重启通过，旧迁移保持原样。
- Windows 实测组合筛选、分页、侧边预览、答案折叠、旧 IPC 回包隔离和返回原页。SQL 合成样本测试覆盖 10,000、50,000 道题。旧 SQLite、JSON 和 WebView2 PDF 均完成回归。
- 原计划的外部附件文件服务、完整卡片和批量操作仍待后续。正式题库性能及 macOS 尚未实测。

[报告](DEV-004_REPORT.md) · [Schema 3](DEV-004_SCHEMA.md) · [检索设计](DEV-004_SEARCH_DESIGN.md) · [日志和截图](DEV-004_TEST_RESULTS.md) · [遗留事项](DEV-004_KNOWN_ISSUES.md)

---

# DEV-003 知识点与试题检索交接（2026-11-17）

**状态：DEV003-T01 至 T12 均通过。** 分支为 `dev/dev-003-knowledge-search`，基准为 `fa218cb`。

- 界面按 UTC 日期显示有效审核、过期、争议及未来记录。到期日包含当天。
- Schema 2 初始化九大学科，保留既有 `math` 和所有修订。Windows 已实际完成知识点创建、别名、试题关联、关闭重启、组合搜索和打开原题。
- 搜索按逻辑题去重并返回当前可见修订。已测 10,000 和 50,000 道合成题的实际分页和延迟。
- 实际复制 DEV-002 测试库升级后，审核及修订原始数据一致，按原 ID 重新导出 PDF 与旧版逐页像素一致。旧 JSON 和新 SQLite 编辑/PDF 均回归通过。
- 九大学科目录只有演示知识点，正式分类、内容审定与真实题库性能仍待后续。

[开发报告](DEV-003_REPORT.md) · [Schema 2](DEV-003_SCHEMA.md) · [检索设计](DEV-003_SEARCH_DESIGN.md) · [测试日志和截图](DEV-003_TEST_RESULTS.md) · [遗留事项](DEV-003_KNOWN_ISSUES.md)

---

# DEV-002 数据契约与 SQLite 编辑交接（2026-11-17）

**状态：DEV002-T01 至 T10 均通过。** 开发分支为 `dev/dev-002-editor-sqlite`，基准为 `81001f81`。

- 默认工作区经 Rust IPC 读取 SQLite。新建数学题、公式、图片、两小问及答案已在 Windows 桌面实际保存并重启回读。后续保存新增不可变用户修订，旧基线返回冲突，审核按修订读取。
- 同一批富文本样本用于 Rust 和 TypeScript 校验。SQLite Schema 1 与迁移文件保持原样，原 POC-001B JSON 通过单独入口继续使用。
- WebView2 已用 SQLite 内容生成题卷和答案卷，旧 PDF 逐页渲染结果与基准一致。
- 正式批量 JSON 导入、外部附件文件服务、完整审核和多题组选界面留待后续任务。macOS、安装卸载与实体打印仍待实测。

[开发报告](DEV-002_REPORT.md) · [数据契约](DEV-002_CONTRACT.md) · [验收结果与交付证据](DEV-002_TEST_RESULTS.md) · [遗留事项](DEV-002_KNOWN_ISSUES.md)

---

# DEV-001 SQLite 开发交接（2026-11-16）

**状态：SQLite 数据层及 Windows 回归通过。** 开发分支为 `dev/dev-001-sqlite`，基准为 `ccda8e1`。

- 既有 Tauri 应用首次启动初始化 `study.sqlite3`。已加入版本化迁移、外键和完整性检查，并实现 DEC-039 逻辑计数与人工确认、DEC-040 逐修订审核、DEC-041 个人修订优先和组卷固定引用。
- 12 项数据库测试、2 项原 JSON 存储测试、4 项前端测试通过。隔离 Windows 配置下验证 Tauri 窗口、JSON 回读、模拟离线及三份 A4 PDF。旧编辑器与 PDF 引擎继续使用原路径。
- SRS DRAFT-0.2 仍待全文签核，macOS 实机尚未验证。本轮任务名称以用户给出的 DEV-001 为准。原开发草案的 DEV-002 数据库初始化与迁移范围已由本轮覆盖，可审查通过后按规划推进 DEV-003 最小 CRUD。

[开发报告](DEV-001_REPORT.md) · [数据库 Schema](DEV-001_SCHEMA.md) · [遗留事项](DEV-001_KNOWN_ISSUES.md)

以下为此前交接记录。

---

# POC-001B Windows 技术验证交接（2026-11-16）

**状态：本次 Windows 原生验证范围通过。SRS DRAFT-0.2 仍待全文签核。**

- 新增 `poc-001b/`。Windows x64 实测通过 Tauri 开发模式窗口、生产构建、富文本及公式编辑、图片、JSON 保存与重启回读、模拟断网回读和再次保存。
- Tauri 原生 WebView2 导出实际生成 A4 题卷 1 页、答案卷 1 页、长题卷 5 页。核对 3 道顶层题、6 个小问、总分 40、答案分离、公式与图片和跨页内容。
- 已生成 Windows x64 NSIS 安装器，交付路径及哈希见报告。macOS、物理断网、实体打印和安装／卸载回归列为未测试。
- DEC-039、DEC-040、DEC-041 保持已批准。正式入库、答案复核和组卷不可变修订引用由后续任务实现并测试。
- DEV-001 建议先固化版本化富文本契约和 SQLite 最小模型，加入批准规则的迁移与回归测试。结合规划中的 POC-002/003 和 macOS 实机结果再作正式技术定版。

[验证报告](POC-001B_REPORT.md) · [手动复验](POC-001B_MANUAL_TEST.md) · [遗留问题](POC-001B_KNOWN_ISSUES.md) · [运行说明](poc-001b/README.md)

以下为 ZIP 内原始历史记录。

---

# POC-001 补充开发状态（2026-11-16）

**已实际执行：POC-001 部分技术验证（PASS-PARTIAL）**。

- 新增 `poc-001/`：纯浏览器离线交互原型、原创测试题、MathJax SVG、本地 PDF 生成脚本、正式试卷 PDF 与独立答案 PDF。
- 示例测试输入：3 道独立顶层题、6 个小问、40 分，数学/物理/化学，10 个不同 LaTeX 公式和一张原创配图。
- 真实导出：A4 `poc-001/output/paper.pdf` 与 `poc-001/output/answers.pdf` 均为 1 页；渲染并检查中文、公式、图片和答案分离。
- `python poc-001/tests/test_poc.py` 返回 PASS；Node 语法检查通过。
- **没有运行成功的浏览器交互/富文本保存回读测试**：沙盒中页面导航遭管理员策略拦截。
- **没有**测试 Tauri、React、Tiptap、KaTeX、Windows 原生构建、macOS 构建或实机打印；缺少 npm 联网和对应运行环境。
- 技术结论仅限：使用本地 MathJax SVG + WeasyPrint，可将结构化测试题输出为视觉可读的两份 A4 PDF；**尚不能确定最终 PDF 引擎和编辑器选型**。
- 需求基线仍是 `DRAFT-0.2`，无 SRS 整体正式签核；DEC-039…041 保持已批准，不再重复征询。

**下一步明确任务：POC-001B**，在用户 Windows 原生开发环境安装 Tauri 2 / React / Tiptap Mathematics + KaTeX；执行编辑、保存、回读和 PDF 导出端到端测试，再完成 Mac 真实运行复核。详见 `poc-001/POC-001_TEST_REPORT.md`。

---

# PROJECT_STATUS — AI 辅助开发交接

> 最新更新：2026-11-10  
> 阶段：**核心三项数据规则已批准；SRS 全文待最终签核 / 尚未开始编码**。

## 当前事实

- 用户完成 38 轮需求讨论；各轮选项已收录 `docs/08-decisions.md`。
- 用户选择执行最后一次完整需求审计，并在确认后转向正式文档、技术 PoC 和端到端开发。
- 本包含 SRS、架构/数据模型初稿、资源包安全协议草案、QA 计划、任务计划、开放问题清单。
- **没有**已经运行的 Tauri 桌面程序，没有完成的跨平台 CI 构建，也没有经核对/许可审核的正式 300/2000/100 资源集合。
- 用户已于 2026-11-10 明确批准三项数据语义 DEC-039…041；其余技术实现细节仍须 PoC 验证，不得将 SRS 全文当作最终签署。

## 用户不可被改写的关键选择

- 离线、非商业、Windows/macOS；无在线答题。
- 九学科知识库 + 独立题/整卷双向关联；高级检索、可视化录题、PDF 阅读、智能组卷及答案分离。
- 固定浅色界面，不加深色主题；基本收藏，不加复杂个人笔记；不依赖 AI 自动识题或云同步。
- Tauri 2 + React + TypeScript + Rust + SQLite；Windows 原生开发，macOS CI 与发布前真实验证。
- V1 正式目标：300 篇均审核讲解、2000 道答案齐全且已核对的独立试题（解析≥95%）、100 份整卷（答案≥95%），均须合法分发。
- 受控变更、模块化文档、可验收的标准化小任务。

## 已批准且不可重新作为待决问题提出（docs/08-decisions.md）

1. `DEC-039 / OID-001`：顶层逻辑题唯一计数；小问单独统计；同题不同出处不重复增加正式题量。
2. `DEC-040 / OID-002`：答案核对必须具备审核人/标识、日期、依据及结论记录；纠错/争议复核留痕。
3. `DEC-041 / OID-003`：用户版优先显示、公共原版可切换、组卷保存时固定版本或内容快照，资源更新不覆盖用户版。

## 尚存待决风险（先看 docs/09-open-issues.md）

- `OID-004` 实际可合法发行资源能否达到 100 份整卷、2000 道题及相应知识讲解；须启动授权/核对清单。
- `OID-005` 旧系统与 Mac 平台的最低兼容版本；等待真实测试。
- `OID-006…014` 资源分配、保留期限、性能阈值、兼容细节等分配到 PoC / 开发任务。

## 下一位 ChatGPT/开发者的推荐第一步

1. 查阅 `README.md`、`docs/00-audit-report.md`、`docs/08-decisions.md`、`docs/09-open-issues.md`。
2. **勿重复询问 DEC-039…041**。检查 SRS 草案的其他未决/不一致处并推进最终审查，同时启动合法素材来源与核对工作清单。
3. 基于已批准数据语义细化核心模型，技术实现须在 PoC 中验证，避免过早锁死具体表结构。
4. 准备 `POC-001`：以少量原创/许可合规多学科样本验证富文本输入、数学公式、PDF 页面与答案分离。
5. 继续 `POC-002/003`，形成**真实**测试报告后再进入 `DEV-001` 等开发任务。

## 交接记录模板

```text
最近一次 Git commit：尚无（尚未建立应用代码仓库）
正在进行任务：需求审计草案/文档审查
通过的自动化测试：无
已知阻断：OID-004 的内容发行可行性；其他兼容/实现细节仍待 PoC 与正式 SRS 审核
本次生成文件：见 README.md；已纳入 DEC-039…041
下一建议：审查余下 SRS 条款，准备 POC-001/002/003 的执行环境与合规样本
```
