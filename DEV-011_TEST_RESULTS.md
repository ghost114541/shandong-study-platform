# DEV-011 Windows 验收矩阵

Windows 11 家庭中文版 x64，Build 26200，Core i7-14650HX，约 16 GB RAM，WebView2 157.0.4341.60。开发机上使用此前从未启动的 Preview 命名空间，以及 D: 上全新的合成资源库目录。A 和 B 都从真实 NSIS 安装。实际运行令牌为 Medium Integrity，管理员组 SID 为 deny-only。所有题卷、图片和历史资料为原创或合成样本。

| 编号 | 结果 | 实际核对 |
| --- | --- | --- |
| DEV011-T01 | PASS | Windows MSVC Release 构建并生成 0.2.0、0.2.1 两个 x64 NSIS 安装包。 |
| DEV011-T02 | PASS | 实测安装器、窗口标题、程序 PE 版本、HKCU 展示名称和版本一致，两个版本共用 Preview 身份。 |
| DEV011-T03 | PASS | 用非提升的本地令牌运行向导，安装到当前用户 LocalAppData。 |
| DEV011-T04 | CONDITIONAL PASS | Preview 配置目录、程序目录和 HKCU 记录初始均不存在。通过开始菜单 .lnk 启动，Schema 9 初始化，题库为空。独立干净 Windows VM 未测。 |
| DEV011-T05 | CONDITIONAL PASS | 向导名称与图标、开始菜单链接目标、桌面选项和 HKCU 卸载入口均已确认。通过 .lnk 实际启动。缺 Windows 设置和开始菜单界面的独立截图。 |
| DEV011-T06 | CONDITIONAL PASS | 真正安装的 B 在仅含 Windows 系统目录的 PATH 下启动并离线回读。无开发工具的独立机器未测。 |
| DEV011-T07 | PASS | Win11 上已有登记的 WebView2 157.0.4341.60，A 和 B 安装及多次启动成功。 |
| DEV011-T08 | BLOCKED | 包内嵌签名有效的 Microsoft x64 Standalone Runtime。缺少可安全使用的无 Runtime 断网 Windows 快照。 |
| DEV011-T09 | CONDITIONAL PASS | WebView2 离线模拟、禁用缓存及无可用应用代理的条件下，安装后的 B 打开 SQLite、九学科、检索、实际 PDF 页面和双向定位，并导出带公式和图片的组卷。宿主网络未切断。 |
| DEV011-T10 | CONDITIONAL PASS | 程序目录含空格，安装器与快捷方式含中文，D: 资源库路径同时含中文和空格。中文 Windows 用户名未测。 |
| DEV011-T11 | PASS | 使用原生目录选择器迁移到 D:，重启后从 D: 启动，C: 回退库保留，升级和重装仍按日志打开 D:。 |
| DEV011-T12 | PASS | B→B 实际重复安装返回 0，程序、版本、快捷方式和数据一致。 |
| DEV011-T13 | PASS | A→B 交互式原位升级返回 0，保持一个 HKCU 安装项、固定安装路径和可用开始菜单链接。 |
| DEV011-T14 | PASS | 逐表比较两库 43 项 SQLite 表指纹及备份历史。活动库 130 项、回退库 129 项外部或兼容文件逐项哈希一致。日志和独立备份指纹一致。 |
| DEV011-T15 | CONDITIONAL PASS | A 持有工作会话且库内有可恢复未正式保存草稿时，B 返回 10。原进程继续运行，重装后通过应用回读草稿有效负载。自动保存写入瞬间未定点注入。 |
| DEV011-T16 | CONDITIONAL PASS | 在备份原生文件对话框和待切换状态尝试升级，均返回 10。短暂的备份写入、资源包提交、恢复写入和打印过程未分别定点注入。 |
| DEV011-T17 | PASS | B 在位时 A 安装返回 11。合成活动库 Schema 99 被已安装应用拒绝，拒绝期间 SQLite 文件哈希一致，复原 Schema 9 后通过两库指纹校验。 |
| DEV011-T18 | PASS | B 卸载返回 0，移除 EXE、卸载项、安装目录及两类快捷方式。SQLite、图片、原卷、控制日志、回退库和独立备份保留。 |
| DEV011-T19 | PASS | 重新运行 B 安装包后，旧收藏、固定组卷、草稿、原卷与试题互查均可通过已安装应用回读。 |
| DEV011-T20 | CONDITIONAL PASS | 已运行截断、校验、目录 ACL、提取强制终止、并发安装、版本拒绝、主 EXE 占用、程序损坏、快捷方式失败和配置锁权限拒绝等。满盘和无 Runtime 部署失败未测。 |
| DEV011-T21 | PASS | 生成产物 Manifest。两份本机验收包的 SHA-256、大小、源提交和 Authenticode NotSigned 已核对。 |
| DEV011-T22 | PASS | GitHub Actions Windows 原生构建及下载完成，测试、打包、上传通过。下载 ZIP 与包内 EXE 的 SHA-256 分别符合 GitHub 和 Manifest。 |
| DEV011-T23 | PASS | 安装后重读历史资料并实际输出 A4 题卷及答案解析卷各 1 页。题卷中的公式和本地图片已渲染核对。 |
| DEV011-T24 | CONDITIONAL PASS | Rust 78 项、TypeScript 34 项通过，另运行已安装应用的核心数据链。历史所有专项原生 GUI 用例未逐项重跑。 |

## 安装故障用例

| 场景 | 结论与观察 |
| --- | --- |
| 1. 安装包截断 | PASS。截为 2 MiB 后 NSIS 显示完整性错误并返回 2。A 仍在位。 |
| 2. SHA-256 不符 | PASS。截断包与原 Manifest 不匹配。正常包在启动前按 Manifest 核对。 |
| 3. 目录不可写 | PASS。专用 Preview 目录实际 NTFS ACL 拒绝，返回 13，撤销测试 ACL 后可重试。 |
| 4. 磁盘空间不足 | NOT TESTED。没有对日常物理卷做填盘试验。 |
| 5. 进程终止 | PASS。观察到 `knowpaper-preview.next` 写入时终止 NSIS，驱动报告 SIGTERM，旧 EXE 和登记有效，重跑返回 0。 |
| 6. 同版已安装 | PASS。B 重复安装及损坏文件修复均返回 0。 |
| 7. 更新版已安装 | PASS。B 在位时运行 A，返回 11。 |
| 8. 应用运行期间升级 | PASS。安装器返回 10；未结束原应用进程。 |
| 9. 安装器并行 | PASS。第一向导仍打开时第二安装器返回 10。 |
| 10. WebView2 部署失败 | BLOCKED。现有系统 Runtime 保持完整，无安全的缺失环境。 |
| 11. 快捷方式写入失败 | PASS。正在持有开始菜单 .lnk 的不允许写入句柄时安装返回 14，释放后返回 0。 |
| 12. 卸载过程失败 | PASS。锁定 EXE 后卸载返回 13，Windows 卸载项与程序保留。 |
| 13. 旧程序文件被占用 | PASS。锁定 EXE 进行覆盖安装返回 13，原 EXE 的哈希一致。 |
| 14. 首次启动数据库失败 | PASS。Schema 99 和配置锁 ACL 分别触发启动错误，恢复测试条件后回读。 |
| 15. 用户配置权限拒绝 | PASS。专用 profile.lock 被实际 NTFS ACL 拒绝，恢复原 ACL 后正常启动，两库指纹一致。 |
| 16. 已迁移到独立卷 | PASS。活动库在 D:，C: 回退库和控制日志指纹均一致。 |
| 17. 日志含待切换状态 | CONDITIONAL PASS。待重启期间 B 返回 10，正常退出重启完成切换。待切换后完全退出并直接升级的独立变体未测。 |
| 18. 卸载后重装 | PASS。B 卸载移除程序及入口，重装后正常使用原资料。 |

记录指纹前执行 SQLite 完整性和外键检查。活动库包含 2,508 条合成试题记录，回退库包含 2,507 条。测试保留公共及个人修订、审核、人工同题、知识点与别名、收藏、固定 `revision_id`、资源包历史、草稿与回收站。应用实际回读并检查固定修订、收藏及原卷区域对应关系。PDF 输出是额外生成的文件，其哈希单独列出。

[安装和跨卷日志](poc-001b/output/dev011/native-acceptance.log) · [升级、失败、卸载与重装](poc-001b/output/dev011/native-resume.log) · [补充故障结果](poc-001b/output/dev011/acceptance/supplemental-faults.json) · [逐表和逐文件指纹](poc-001b/output/dev011/acceptance/data-fingerprints.json) · [实际截图](poc-001b/output/dev011/acceptance/screenshots) · [PDF 校验](poc-001b/output/dev011/pdf-verification/pdf-files.json) · [GitHub Actions 构建](https://github.com/ghost114541/shandong-study-platform/actions/runs/44577470728)
