# DEV-012 独立审查后收尾报告

收尾在 `dev/dev-012-macos` 进行。起始工作区干净，`git fetch` 确认本地和远端均为 `094b6acfd119901a2acdf7943a905b90d1ce886d`。本轮只补强 macOS 打印、共享 PDF 验证及跨平台回归。项目基线仍为 Preview 0.2.1、SQLite Schema 9、备份协议 v1、资源包 `.studyzip` 及 DEC-039～041。

最终 CI 的源码和测试提交为 `b229d6d6b2a833e40c2ca88b5de5f49b2cb94cc0`。macOS arm64 与 Windows x64 的官方工作流均成功。Mac VM 通过 PDF-R01～R08 的可注入范围。Windows 测到实际 WebView2 PDF、原卷、固定修订和备份故障恢复。Windows→Mac→Windows 两条数据层往返各自保持 43 张业务表、102 条固定修订及已登记图片和原卷的 SHA-256。 [macOS CI](https://github.com/ghost114541/shandong-study-platform/actions/runs/44952652985) · [Windows CI](https://github.com/ghost114541/shandong-study-platform/actions/runs/44952653055)

## 实现与风险

- macOS 打印请求使用唯一操作编号。超时、取消等待或关窗先使结果失效，完成回调才释放 AppKit 对象及 Rust 的暂存目录。迟到回调不会发布 PDF，且只能结束对应任务。若原生回调永久缺失，应用仍会阻止并发打印，用户可以保存工作并重启恢复。 [生命周期设计](DEV-012_PRINT_LIFECYCLE.md)
- 保留 WebKit 的异步绘制，并在主线程执行应用侧打印状态和窗口处理。第一轮探针复现了禁用打印工作线程时的失控空白页，本轮恢复 WebKit 原有线程调度后通过独立探针。 [初次失败与后续验证](DEV-012_CLOSEOUT_TEST_RESULTS.md)
- 在既有 20／30／50 题合成卷增加简体中文、兼容字、全角字符、连续阅读材料中交错的根式积分分式，以及每个小问的可核对标记。打印样式约束短小问跨页。保留两份 PDF 核验后的原子发布行为；Windows WebView2 打印实现沿用。 [PDF 内容和边界](DEV-012_CLOSEOUT_TEST_RESULTS.md)
- Windows→macOS→Windows 的 CI 根据同一份合成档案写入、恢复及重新备份，比较全部业务表、固定修订和已登记资源。已知路径及数据安全测试使用既有探针。 [备份测试方法](DEV-012_BACKUP_MIGRATION.md)

## 修改文件

| 范围 | 文件 |
| --- | --- |
| AppKit 与 Rust 桥接 | `src-tauri/native/macos_print.m`、`src-tauri/src/pdf/macos.rs`、`src-tauri/build.rs` |
| 真实应用故障测试 | `src-tauri/src/dev012_smoke.rs`、`tests/macos-app-smoke.js`、`tests/macos-pdf-probe.m` |
| 分页及文字验证 | `src/style.css`、`src-tauri/examples/dev012_migration.rs`、`tests/macos-app-check.py`、`tests/macos-pdf-search.swift`、`tests/windows-webview.mjs` |
| CI 与证据 | `.github/workflows/macos-build-check.yml`、`poc-001b/output/dev012-closeout/` |
| 文档 | 本报告、`DEV-012_CLOSEOUT_TEST_RESULTS.md`、`DEV-012_PRINT_LIFECYCLE.md`、`DEV-012_KNOWN_ISSUES.md`、`DEV-012_MACOS_INSTALL_DESIGN.md`、`PROJECT_STATUS.md` |

表中的应用及测试路径以 `poc-001b/` 为根。

## 验收边界

当前宿主是 Windows x64，未接入可操作的授权 Apple Silicon 物理机。Mac VM 提供原生构建、应用和数据层证据。安装／重装、Gatekeeper 实机行为、系统拼音、原生打印和外置卷、经 Mac GUI 完成 E2E-007、异常退出与真机性能仍待后续实机验证。正式 Apple Developer 签名和公证、结构化表格及 Windows 无 Runtime 的完全离线安装继续列在项目验收范围。 [实机操作步骤](DEV-012_MACOS_INSTALL_DESIGN.md) · [已知问题](DEV-012_KNOWN_ISSUES.md)

源码、实际测试的提交 SHA、Windows 与 macOS 环境、状态、原始证据和性能记录见测试矩阵。最终是否结束 DEV-012 由网页端独立复审决定。 [收尾测试矩阵](DEV-012_CLOSEOUT_TEST_RESULTS.md)
