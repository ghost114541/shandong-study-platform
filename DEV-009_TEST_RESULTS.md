
# DEV-009 验收记录

Windows 11 25H2 x64，Build 26200.9974，Intel Core i7-14650HX，16 GB RAM，WebView2 157.0.4341.60。Windows Tauri 测试为隔离配置调试版。主链验收使用 Win32 文件选择器、原生窗口句柄、WebView2 渲染、真实 SQLite 和实际外部文件。E2E-006 的离线环节使用 WebView2 断网与禁用 HTTP 缓存。

| 编号 | 结果 | 实际覆盖 |
| --- | --- | --- |
| DEV009-T01 | PASS | POC-003 ZIP 读取与限额，真实 Rust 子进程提交前后被终止 |
| DEV009-T02 | PASS | 备份 DEV-008 实测 Schema 7 库，Tauri 原生升级到 8，7 条迁移旧校验和、历史表与外部文件保持一致 |
| DEV009-T03 | PASS | 合法 Manifest、JSONL、权利清单、大小及数量声明 |
| DEV009-T04 | PASS | 未知格式、版本、Schema、富文本版本及不合法 SemVer 拒绝 |
| DEV009-T05 | PASS | 路径穿越、绝对盘符及 UNC、大小写和层级冲突、保留名、软链接、FIFO、重复成员拒绝 |
| DEV009-T06 | PASS | 压缩比、成员数、单文件限制、总解压限制和读循环实际字节上限 |
| DEV009-T07 | PASS | 清单哈希、声明大小、缺失和多余成员拒绝 |
| DEV009-T08 | PASS | 原生读取标准节点；缺父节点、循环、缺知识引用及个人所有权冲突拒绝；标准保护触发器仍有效 |
| DEV009-T09 | PASS | 实际公共试题、修订、小问、公式、图片与答案读取；缺附件引用拒绝 |
| DEV009-T10 | PASS | 实际原卷、答案、解析三种 PDF 入库；Windows 原卷可渲染；Rust 检查全部文件和双向定位 |
| DEV009-T11 | PASS | 1.0.0 首装、关闭并在新进程回读，文件 SHA-256 与 SQLite 完整性核验 |
| DEV009-T12 | PASS | 重复安装提示，重复无新安装尝试、记录或修订 |
| DEV009-T13 | PASS | 同包同版本异字节和异包占用 ID 均拒绝 |
| DEV009-T14 | PASS | 1.1.0 公共内容新增和更新；拒绝降级与过期预览；未变内容复用修订 |
| DEV009-T15 | PASS | 个人修订仍默认、原版和新版均可读，原审核绑定原修订，新修订无审核 |
| DEV009-T16 | PASS | 收藏和重点不漂移，原 PDF 与原定位保留，本地元数据及用户区域保留 |
| DEV009-T17 | PASS | 原生打开固定组卷，原修订记录和快照不变 |
| DEV009-T18 | PASS | 实际文件及 SQLite 故障注入，回滚、重试、取消、同哈希复用和禁止覆盖 |
| DEV009-T19 | PASS | 强制终止真实 Tauri，覆盖暂存未写完、发布后提交前、已提交未清理，三次均复核磁盘和 SQLite |
| DEV009-T20 | PASS | 两个独立 SQLite 连接实际竞争，安装锁拒绝第二个写入 |
| DEV009-T21 | PASS | 安装版本、历史、失败、中断与异常哈希；手动恢复检查以及原生离线显示 |
| DEV009-T22 | PASS | Windows 原生入口、文件选择、预览、实际确认和安装状态 |
| DEV009-T23 | PASS | 4、500、2,000 道顶层合成题，记录阶段耗时、安装查询、进程内存和磁盘变化 |
| DEV009-T24 | PASS | 八套原生历史用例、五组原生 PDF 输出复核，另核验 Windows 原卷系统虚拟打印落盘 |
| E2E-006 | PASS | 安装→重复→升级尝试中断→恢复并最终升级→损坏包拒绝→个人版、收藏、重点及组卷可用 |

[POC-003 原始日志](poc-001b/output/dev009/poc003-rust.log) · [Rust 64 项](poc-001b/output/dev009/rust.log) · [TypeScript 34 项](poc-001b/output/dev009/typescript.log) · [Windows 构建](poc-001b/output/dev009/windows-build.log) · [原生流程](poc-001b/output/dev009/windows-ui.log) · [SQLite 与磁盘快照](poc-001b/output/dev009/windows-state-snapshots.json) · [SHA-256](poc-001b/output/dev009/SHA256SUMS)

## 故障注入

| 项目 | 方法 |
| --- | --- |
| 1–7 | 真 ZIP 样本校验和 SQLite 计划预检。Manifest 解析、文件 SHA-256、解压限制和读循环、坏图片/PDF、缺父节点、缺附件引用、个人 ID 冲突 |
| 8、10、11 | Rust 隔离文件系统。阻塞暂存目录、写后篡改暂存、预先创建同路径异字节文件 |
| 9、14、15 | 实际 Tauri 进程通过 Windows 终止。分别在文件写入中、SQLite 提交前、SQLite 提交后停机 |
| 12、13 | SQLite 实际触发器故障。分别拒绝资源插入、拒绝成功状态登记 |
| 16 | 两个真实数据库连接争抢应用目录安装锁 |
| 17 | 实际改写／删除已安装外部文件后运行完整性检查 |
| 18 | 恢复时保留阻塞路径，操作保持待处理。移开阻塞物后恢复成功。额外测试已提交但发布路径缺失时用有效暂存重新发布 |

提交前终止时只有 1.0.0 可见，恢复清除属于中断操作的文件。提交后终止时 1.1.0 和状态已存在，重新打开只完成清理。Windows 测试也尝试在提交前故障点通过 `WM_CLOSE` 关闭应用，进程按预期保持开启，随后才强制终止。实际故障点由隔离标识、调试断言和显式 Cargo 特性共同限制。

## 原生截图

[01 首页](poc-001b/output/dev009/screenshots/01-resource-home.png) · [02 原生选择器](poc-001b/output/dev009/screenshots/02-native-file-picker.png) · [03 Manifest](poc-001b/output/dev009/screenshots/03-manifest-and-integrity.png) · [04 校验及来源](poc-001b/output/dev009/screenshots/04-source-and-validation.png) · [05 差异](poc-001b/output/dev009/screenshots/05-install-diff.png) · [06 确认](poc-001b/output/dev009/screenshots/06-confirm.png) · [07 进度](poc-001b/output/dev009/screenshots/07-commit-progress.png) · [08 完成](poc-001b/output/dev009/screenshots/08-installed.png) · [09 安装列表](poc-001b/output/dev009/screenshots/09-installed-and-history.png) · [10 重复提示](poc-001b/output/dev009/screenshots/10-duplicate.png) · [11 公共升级](poc-001b/output/dev009/screenshots/11-public-upgrade-diff.png) · [12 个人修订](poc-001b/output/dev009/screenshots/12-personal-revision-preserved.png) · [13 损坏包](poc-001b/output/dev009/screenshots/13-damaged-pack-rejected.png) · [14 恢复结果](poc-001b/output/dev009/screenshots/14-interruption-recovered.png) · [15 离线安装历史](poc-001b/output/dev009/screenshots/15-offline-restart-history.png) · [16 原卷渲染](poc-001b/output/dev009/screenshots/16-native-original-pdf.png)

Windows 文件选择器截图仅遮盖了系统快捷访问栏。原生流程用界面创建个人修订及收藏，用原生 IPC 标记重点和保存固定组卷，再从对应界面和 SQLite 状态回读。

## 历史回归与系统打印

Windows 历史用例分别验证旧 JSON、SQLite 编辑与审核、九学科知识库、高级组合检索与分页、外部图片、固定组卷、原卷阅读和收藏。检索和附件套件使用备份的实际数据库、历史外部图片与分页样本。回归中的双卷、公式、附件像素和题答分离有独立输出检查。 [原生回归状态](poc-001b/output/dev009/regression/status.txt) · [PDF 内容状态](poc-001b/output/dev009/regression/pdf-status.txt)

原卷系统打印使用 Windows 系统对话框中选中的 Microsoft Print to PDF 驱动。一页原卷在自动等待超时后实际写盘，由独立脚本核验单页内容并渲染，检查了首卷页的合成题干和抛物线。 [等待与后续结果](poc-001b/output/dev009/regression/system-print.log) · [实际输出 PDF](poc-001b/output/dev009/regression/system-printed-original.pdf)

## 性能

| 样本 | ZIP 字节 | 成员 | 解压字节 | 安装 ms | 查询 ms | 应用 / WebView2 采样工作集峰值 MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 小包，4 题 | 4,891 | 9 | 8,911 | 149.6 | 3.9 | 95.1 / 488.6 |
| 中包，500 题 | 481,428 | 59 | 488,965 | 554.9 | 7.4 | 104.2 / 520.2 |
| 大包，2,000 题 | 1,856,857 | 129 | 1,875,966 | 1,776.7 | 16.2 | 129.2 / 522.3 |

[原始性能 JSON](poc-001b/output/dev009/performance.json) 包含 ZIP、Manifest、校验、计划、暂存、发布与 SQLite 事务、端到端、查询、进程采样及磁盘差值。小包端到端包含界面确认与轮询，中大包用同一原生 IPC 测量确认后的安装。Rust 的 `commit_ms` 包含发布、SQL 及提交。内存以约 25 ms 间隔采样，WebView2 后代进程工作集相加可能重复计算共享页。合成的小文件和调试版结果只适用于本次采样。

## 复现

1. 在 `poc-001b` 运行 `python tests/dev009-fixtures.py .test-output/dev009-fixtures --all`、`npm run typecheck`、`npm test` 与 `cargo test --locked --manifest-path src-tauri/Cargo.toml -- --nocapture`。
2. 用 MSVC 和 Windows SDK 配置执行 `npm run tauri -- build --debug --no-bundle --features dev009-test-hooks --config <隔离配置>`。配置标识使用 `org.shandong-study.dev009-<8位十六进制>`，与 `POC001B_TEST_APP_IDENTIFIER` 一致。
3. 将 `KNOWPAPER_DEV009_SCHEMA7_SOURCE` 指向已有 DEV-008 隔离验收库目录，目标隔离目录须尚未存在。执行 `node tests/windows-resource-packs.mjs <exe>`。性能采样用 `KNOWPAPER_DEV009_PERF=1`，Python 需能导入 psutil。
4. 历史原生回归继续用 `tests/windows-webview.mjs`。高级检索需要 SQLite 测试生成的数据库与附件，附件回归紧接高级检索的分页样本。使用新隔离目录运行其他历史用例。
