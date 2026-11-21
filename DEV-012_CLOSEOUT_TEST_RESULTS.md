# DEV-012 收尾测试矩阵

## 版本与环境

| 环境 | 源码与测试范围 |
| --- | --- |
| 本轮起点 | `094b6acfd119901a2acdf7943a905b90d1ce886d`，远端与本地一致。 |
| 源码与 CI SHA | `1f324beb131416762fe7e087352de2192e649c17` 实际构建和运行。 `63972c5fcb3944d57947b3eee7db3d31291e5b54` 补充检查程序与 CI，`b229d6d6b2a833e40c2ca88b5de5f49b2cb94cc0` 修正版 PDFKit 检索证据。 [首次应用运行](https://github.com/ghost114541/shandong-study-platform/actions/runs/44950383835) · [完成 PDF 内容与数据核对的 CI](https://github.com/ghost114541/shandong-study-platform/actions/runs/44951432971) · [最终 macOS CI](https://github.com/ghost114541/shandong-study-platform/actions/runs/44952652985) · [最终 Windows CI](https://github.com/ghost114541/shandong-study-platform/actions/runs/44952653055) |
| 原生 Windows | Windows 11 家庭版中文 x64（26200），HP OMEN 16-am0xxx、Intel i7-14650HX。WebView2 157.0.4341.60，Rust 1.100.0 MSVC，Windows SDK 10.0.26100.0，Node 24.13.0，Tauri CLI 2.12.5。原生共享样本使用隔离 Release 二进制，恢复故障用隔离 Debug 构建。 |
| 官方 macOS | GitHub Actions `macos-15` arm64 VM，macOS 15.8.2（24H232）、Xcode 16.4（16F6）、Rust 1.100.0、Node 24.13.0。 |
| 实机 | **BLOCKED**。当前 Windows 主机无可操作的授权 Apple Silicon，未执行实机。 [复现步骤](DEV-012_MACOS_INSTALL_DESIGN.md) |

## A · 生命周期

| 编号 | 场景 | 验证及边界 |
| --- | --- | --- |
| PDF-R01 | 正常 PDF 并释放任务 | **PASS（Mac VM）**。原生 A4 探针两次 10 页，应用真实单份和三套双卷完成。 |
| PDF-R02 | AppKit 交接前启动失败 | **PASS（注入）**。测试应用断言特定错误，随后请求实际进入打印。 |
| PDF-R03 | 打印超时 | **PASS（注入）**。缩短测试期限，延后 AppKit 完成交付，核对 Rust 超时与隔离提示。系统永久不回调 **NOT TESTED**。 |
| PDF-R04 | 迟到完成 | **PASS（注入）**。延后交付后同进程重新生成 PDF，无进程崩溃或异常退出。 |
| PDF-R05 | 关窗 | **PASS（注入）**。关闭原生答案窗再交付完成事件，应用取得指定关窗错误。真实系统绘制中关窗 **NOT TESTED**。 |
| PDF-R06 | 两个请求重叠 | **PASS（注入）**。首单处于活动状态时，实际第二次 IPC 取得专用 busy 错误。 |
| PDF-R07 | 题卷成功，答案失败 | **PASS（注入）**。Windows 暂停第二视图，Mac 关闭答案窗。两个平台均核对发布目录和暂存，未发现部分批次。 |
| PDF-R08 | 恢复后再导出 | **PASS（Mac VM 与 Windows 原生）**。Mac 迟到完成后重新生成单份，并在答案失败之后导出三个完整批次。Windows 原生组卷重试通过。 |

## B · PDF 内容与分页

- Windows 原生应用已运行单份示例及 20／30／50 题双卷。题卷 12／17／27 页，答案卷 7／11／17 页。程序核对所有页的 A4 尺寸、可提取词坐标、空白页、55 条材料、题序、小问正文、答案隔离及界面文字。抽查真实栅格化的第 1～3 页，简体中文及 KaTeX 的根式、积分、分式、上下标和化学式均可读。三个样本未找到在页末孤立的小问分值标题。
- Mac 原生 VM 题卷 12／18／27 页，答案卷 7／10／17 页。上述结构检查通过，50 题第 1～3 页的公式和正文栅格化核对通过。三个样本均未再发现孤立分值标题。
- Windows PyMuPDF 对简体样句、兼容字 `神` 与全角 `ＡＢＣ１２３` 各命中一次。用 `神` 或 `ABC123` 替代原字面时各命中零次。Mac PDFKit 对四个常见简体词和完整样句均命中。对 `中文`、`全角` 零命中，对 `中⽂`（U+2F42）、`全⻆`（U+2EC6）命中，页面字形正常。NFKC 可还原 `⽂`，U+2EC6 需要额外匹配规则。这个 P2 影响字面复制和检索。 [PDFKit 实测记录](poc-001b/output/dev012-closeout/macos-pdfkit-search.json)
- 超大或复杂题目继续以 P2 跟踪分页限制。结构化 Tiptap 表格仍归入 V1 综合验收。

## C · 数据安全

| 场景 | 运行与核对 |
| --- | --- |
| 整库指纹、固定修订和资源 | **PASS（原生数据层）**。Windows CI → Mac CI → 本机 Windows 及全 CI 返程均已执行。各自三份合成备份的 SQLite 完整性、外键、ZIP 成员、43 张业务表、102 条固定修订引用、65 个图片和 65 个 PDF 的 SHA-256 一致。另有 1 项旧版 JSON 指纹一致。 |
| 个人修订和公共原版、历史审核 | Windows Rust 原生通过 `test_006`、`test_007`、`test_005` 和收藏／固定修订复开测试。检查历史审核与新个人修订的版本边界。 |
| 原卷双向关联 | Windows 原生 Reader 流程通过选区截图、回读源 PDF 和题目双向定位。保存以及再次导出时核对附件及原 PDF 内容。 |
| 草稿、回收站、损坏备份和回退 | Windows Rust 原生覆盖草稿保存、回收站保留固定引用、损坏备份及失败候选库。Windows GUI 注入实际拒绝七个损坏／不兼容档案，核对有效库原指纹。多处强制退出后确认候选库及回退点，恢复后核对草稿和回收站。 |
| 路径安全 | Windows Rust 的普通路径、大小写、真实 NTFS junction、ACL Denied 测试已运行。Windows 实际应用在间接链接处以 OS 681 拒绝导入，换成普通文件通过。跨平台探针的隔离库带中文路径。Mac 外置卷、大小写敏感 APFS、真实系统输入法及原生文件对话框 **BLOCKED**。 |

## D／E · 平台回归

| 平台 | 验收记录 |
| --- | --- |
| Windows 原生 | **PASS（已执行范围）**。Rust 库 69 项、应用 9 项，TypeScript 34 项及类型检查通过。WebView2 单题、三套双卷、错配快照拒绝、第二卷暂停以及附件 SHA 错误时拒绝发布、PDF.js 三种角色、PDF 导入阅读和跨页截图、收藏和 SQLite 读写通过。NSIS 本机与官方 x64 CI 构建完成，CI ZIP 与内部安装包已独立核验 SHA-256。 |
| Windows 安装生命周期 | 无 Runtime 的完全断网首次安装 **NOT TESTED**。历史 DEV-011 全套生命周期未重跑。 |
| macOS arm64 VM | **PASS（已执行范围）**。Rust 68 项库测试和 7 项应用测试、TypeScript 34 项、A4 探针、应用生命周期注入、PDF 内容、PDFKit 普通简体词检索与跨平台数据核对通过。`.app`／`.dmg` 结构与 ad-hoc 签名检查通过。Gatekeeper 分发评估拒绝 ad-hoc 签名包。 |
| Apple Silicon 实机 | DMG 安装重启、输入法、真实原卷与截图、双向定位、单题／双卷、PDFKit 系统选页保存和取消、外置卷、GUI E2E-007、恢复、卸载重装、强制退出、性能均 **BLOCKED**。Intel 和 macOS 13／14 兼容 **NOT TESTED**。 |

## 性能观察

| 样本 | Windows x64 本机 | macOS arm64 VM |
| --- | ---: | ---: |
| 单份 PDF | 215 ms | 492 ms |
| 20／30／50 题双卷 | 1,018／1,107／1,644 ms | 965／1,044／1,341 ms |
| 已登记 100 页扫描卷首屏 | 133 ms | 482 ms |
| 连续导出与恢复 | 第二卷注入失败后，三次正常导出的应用常驻内存为 48.8／50.2／50.1 MiB。含 WebView2 进程族为 542.5／559.9／582.4 MiB。 | 注入超时 1,127 ms，等待迟到完成后的实际重试 2,090 ms。应用常驻内存采样峰值约 112.9 MiB，WebKit 子进程未计入。 |
| 备份及恢复 | GUI 备份及对话框 2,603 ms，预检及对话框 1,547 ms。本机返程数据层恢复 995 ms，再次备份 828 ms。最终 Windows CI 返程恢复 1,474 ms，再次备份 849 ms。 | 最终 Mac CI 数据层恢复约 670 ms，再次备份约 680 ms。 |

各数据来自指定机器及样本的单轮测量。Windows 常驻内存为离散采样。旧版 Mac VM 同类双卷基线为 730／838／1,050 ms，首屏为 286 ms。硬件、夹具和负载条件分别记录。

## 失败记录

| 版本及环境 | 复现与期望 | 实际与处理 |
| --- | --- | --- |
| `1182202` 官方 Mac VM，首轮探针及应用 | 运行 `bash tests/macos-pdf-check.sh`，应连续获得两份有效多页 PDF。隔离应用应完成输出流程。 | 禁用 AppKit 工作线程后持续写入空白页，探针触发 32 MiB 限制并收到 `SIGXFSZ`。应用在 270 秒被 watchdog 停止。`111cfca` 恢复 WebKit 原有调度并将应用回调转到主队列。修订后探针和隔离应用均通过。 [探针 Job](https://github.com/ghost114541/shandong-study-platform/actions/runs/44950004408/job/136985633496) · [应用 Job](https://github.com/ghost114541/shandong-study-platform/actions/runs/44950004408/job/136986585651) |
| `111cfca` 前的 Windows 样本与早期测试入口 | 在新的 DEV-012 隔离标识通过正式入口导出三套双卷，应识别 Schema 9 和合法公式。 | 旧脚本按 Schema 1 验证新标识，修正后受控视图还拒绝了错误转义的 LaTeX 夹具。最终使用修正夹具通过。 |
| `1f324be` Mac VM，应用 PDF 检查 | 测试应把人眼看到的简体字、复制语义和兼容字的实际码位分别核对。 | App 成功完成故障注入及三个双卷，检查程序因 `全⻆` 无法被 NFKC 归一化而停止。用原始 PDF 确认 U+2EC6 与 U+2F42，并在 `63972c5` 显式检测相应码位。保留初次失败。 [首次应用 Job](https://github.com/ghost114541/shandong-study-platform/actions/runs/44950383835/job/136987650360) |
| `63972c5` Mac VM，PDFKit 独立检索 | 用 Swift 在原生 PDF 上执行字面词项检索，应分别记录 `神` 和 `神`。 | Swift 字典按规范等价合并两个键，程序报 `Duplicate values for key` 并退出 133。应用生命周期、七份 PDF 内容与返程指纹先前已通过。`b229d6d` 改为按输入码位保存有序检索记录，修订后的 PDFKit 任务通过。 [PDFKit 失败 Job](https://github.com/ghost114541/shandong-study-platform/actions/runs/44951432971/job/136990861908) |
| 本机工具及历史探针 | 使用新的隔离资料和合适构建运行 Windows Rust 及原生回归。 | 初次缺 `cl.exe`，再试缺 SDK 头文件。初始化 VS 开发 Shell 并使用本机 SDK 后 Rust 通过。旧 GUI 探针还遇到隔离标识规则、缺失的 psutil、夹具 junction 和 Release 禁用故障钩子。重新使用合成资料白名单、普通文件、已备依赖及启用钩子的 Debug 版本。缺少附件分页种子也在试验副本中补齐。原始失败日志保留。 |

## 证据

[证据及 SHA-256 清单](poc-001b/output/dev012-closeout/) · [Mac DMG、App 与应用数据](https://github.com/ghost114541/shandong-study-platform/actions/runs/44952652985/artifacts/14726272691) · [Windows 合成备份](https://github.com/ghost114541/shandong-study-platform/actions/runs/44952652985/artifacts/14726725499) · [返程指纹](https://github.com/ghost114541/shandong-study-platform/actions/runs/44952652985/artifacts/14726249725) · [Windows NSIS](https://github.com/ghost114541/shandong-study-platform/actions/runs/44952653055/artifacts/14726636455)
