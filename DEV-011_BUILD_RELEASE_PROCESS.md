# DEV-011 内部构建与交付

在 Windows x64 MSVC 环境进入 `poc-001b`，按顺序执行。

```powershell
npm ci
npm run typecheck
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --bundles nsis -- --locked
./scripts/windows-installer-manifest.ps1 -BundleDirectory src-tauri/target/release/bundle/nsis -Destination preview-artifacts
```

Manifest 包含安装包完整 SHA-256、字节数、版本、打包及应用构建提交、架构、Windows 构建、工具链、签名状态、文件生成和校验 UTC 时间。收包后按 Manifest 检查 `Get-FileHash -Algorithm SHA256 -LiteralPath <安装包>`。校验和可用于比对文件完整性。发布者认证由 Authenticode 提供。本地证书盘点仅发现一张身份未经核实的自签名证书，因此使用未签名内部测试包。

GitHub Actions Windows 任务可手动触发，并在 DEV-011 开发分支源码提交时运行。它检出触发 SHA，用锁文件测试并构建 Windows x64 NSIS，上传安装器、日志与 Manifest，保留期为 14 天。CI 二进制按该次 Manifest 校验。

[构建工作流](.github/workflows/windows-installer-check.yml) · [本机构建证据](poc-001b/output/dev011) · [安装验收](DEV-011_TEST_RESULTS.md)
