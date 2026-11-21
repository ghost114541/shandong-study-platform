# DEV-012 CI 设计

工作流 `.github/workflows/macos-build-check.yml` 的 push 触发只针对 DEV-012 分支及程序、测试、脚本改动。使用确切 SHA 和只读仓库权限，checkout 不保留凭据。构建产物保留 14 天。

| Job | 验证与产物 |
| --- | --- |
| `windows-fixture` | 在 Windows 生成新的合成备份，校验逐表指纹、资源和清单 |
| `build` | Apple Silicon 环境、npm ci、TS 类型检查与测试、原生 Rust 测试、Windows 源归档恢复、反向备份、arm64 Release、先打正式 Preview 包，再运行隔离应用测试 |
| `pdf-probe` | 将 WebKit 原生打印代码连入独立 AppKit 探针，检查两次 A4 输出及视觉文件 |
| Windows installer | 既有 Windows 工作流增加 DEV-012 分支，复跑原生测试与 NSIS |

DMG 包检查通过 `lipo`、`file`、`otool`、`plutil`、`codesign`、`spctl`、`hdiutil`、挂载文件对照与 SHA-256 完成。构建记录保留 Gatekeeper 状态，内部 ad-hoc 包预期会被正式分发检查拒绝。应用自动化编译使用专用测试功能和隔离 ID。发行用 DMG 是此前独立打出的标准 Preview 应用。

CI 使用 GitHub 托管 macOS VM。实机交互安装、打印面板、系统快捷键、外置卷、卸载重装及完整 GUI 恢复单独验收。 [工作流](https://github.com/ghost114541/shandong-study-platform/actions/workflows/macos-build-check.yml) · [证据及实际构建](DEV-012_REPORT.md)
