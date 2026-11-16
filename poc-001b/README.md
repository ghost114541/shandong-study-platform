# POC-001B · Windows 桌面原型

在待签核的 SRS DRAFT-0.2 下验证 `FR-EDT-001…003`、`FR-CMP-002…005` 中的编辑、回读与 PDF 路径。样本和图直接取自相邻的 `poc-001/`，构建时请保留两者的目录关系。

## Windows 原生 PowerShell

安装 Visual Studio 或 C++ Build Tools 的 **使用 C++ 的桌面开发**、MSVC x64/x86 与 Windows 10/11 SDK。需要 Edge WebView2 Evergreen Runtime、Windows MSVC Rust、Node.js 24 和 Git。安装完毕后在新终端执行。 [Tauri 2 前置要求](https://v2.tauri.app/start/prerequisites/)

```powershell
cd poc-001b
npm ci
npm run typecheck
npm test
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

关闭开发窗口后执行 `npm run tauri build`。Windows 打包目标配置为 NSIS，安装器目录为 `src-tauri/target/release/bundle/nsis/`。

## 使用

首次启动打开内置三道试题。左侧选择整题，在下拉框切换整题题干、小问题干与答案。选中文字后切换粗体或斜体。使用工具栏插入两种公式，单击已有公式编辑 LaTeX。图片支持 PNG、JPEG、WebP 或 GIF，单张上限 5 MiB。

**保存本地 JSON** 写入 `%APPDATA%\org.shandong-study.poc001b\questions.json`，重启后优先载入。勾选 **查看公共原版** 可查看内置样本。内置 SVG 以逻辑标识引用，添加的图片随 JSON 内嵌，整份文件上限 32 MiB。Rust 在目标目录写临时文件、同步后原子替换。发现语法、版本或结构错误时，启动时显示详情并禁用保存，保留待恢复文件。

**题卷预览** 与 **答案卷预览** 分别显示对应内容。**导出当前 PDF** 通过 WebView2 `PrintToPdf` 将当前预览输出为 `paper.pdf`、`answers.pdf` 或 `paper-long.pdf`。结果在 `%APPDATA%\org.shandong-study.poc001b\pdf`。长题开关用于预览和导出压力样本。导出按当时预览内容生成独立 PDF。持久化组卷配置和不可变修订引用留待正式开发。

见 [测试报告](../POC-001B_REPORT.md) 与 [手动复验步骤](../POC-001B_MANUAL_TEST.md)。
