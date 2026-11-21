# DEV-012 macOS 构建设计

Preview 0.2.1 复用 `org.shandong-study.knowpaper-preview`、展示名“知卷 KnowPaper（测试版）”和可执行文件名 `knowpaper-preview`。Mac 构建目标为 `aarch64-apple-darwin`。Intel 和 Universal 构建未列入本轮验收。macOS 13.0 是临时打包及部署下限。对该版本的运行兼容性仍待实测，见 OID-005。

Tauri 按 JSON Merge Patch 叠加 `tauri.macos.conf.json`。Mac 替换整组 bundle targets 和图标列表，输出 `.app`、`.dmg`。Windows 基础配置继续打包 x64 NSIS 并嵌入 WebView2 离线安装程序。Mac ICNS 源自原 Preview ICO。用低分辨率原图放大生成，保留现有标志。

```sh
cd poc-001b
npm ci
npm run typecheck
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --target aarch64-apple-darwin -- --locked
mkdir -p preview-artifacts
bash scripts/macos-package-check.sh
```

CI 固定 `macos-15`、Node 24.13.0 和 Rust 1.100.0，校验运行器与可执行文件的实际架构。Mac 系统框架和 Objective-C 编译步骤由目标特定 Cargo 配置启用。包检查、实际结果及下载地址见 [开发报告](DEV-012_REPORT.md) 与 [CI 设计](DEV-012_CI_DESIGN.md)。 [Tauri 平台配置规则](https://v2.tauri.app/develop/configuration-files/) · [GitHub 托管运行器规格](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
