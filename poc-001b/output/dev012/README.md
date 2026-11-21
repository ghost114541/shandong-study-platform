# DEV-012 运行证据

- Windows 本机重跑了 Rust、TypeScript、NSIS、单题及组卷 PDF、附件、检索、知识点、收藏和原卷。系统打印初始等待超时，其后通过原生另存为对话框生成并渲染输出。 [打印面板](windows-system-print-panel.png) · [实际 PDF](windows-system-printed-original.pdf)
- macOS 证据包括运行环境、Rust 和前端日志、Info.plist、签名、架构、DMG 检查、构建 Manifest 与包哈希。
- `macos-pdf-probe-pages.png` 为真实 Mac 输出的逐页渲染总览。 [原 PDF 与逐页 PNG](https://github.com/ghost114541/shandong-study-platform/actions/runs/44902871747/artifacts/14706189719)
- `macos-shared-fixture/` 含最终 Mac CI 隔离应用的 7 份 PDF 与文字、图像、字体、页框和时序记录。 [应用运行与全部逐页 PNG](https://github.com/ghost114541/shandong-study-platform/actions/runs/44905827205/artifacts/14707503549)
- `roundtrip-fingerprints.json` 记录独立 Windows、Mac CI 和返回 Windows 的表项与外部文件对照，`migration-and-performance.json` 汇总归档哈希与时序。
- DMG、Mac 应用输出和原始合成归档可从 [正式交接](../../../DEV-012_REPORT.md) 的 GitHub Actions 链接获取。
