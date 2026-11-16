# POC-001B Windows 手动复验

## 1. 准备

1. 通过 Visual Studio Installer → 修改 → **使用 C++ 的桌面开发**，勾选 MSVC x64/x86 Build Tools 和 Windows 11 SDK（例如 10.0.26100）。安装器要求提权时请在管理员授权下完成。用新开的 **x64 Native Tools Command Prompt for Visual Studio** 或开发者 PowerShell 验证 `where.exe cl`、`where.exe link`、`where.exe rc`。
2. 从 [Rust 官方安装页](https://rustup.rs/) 下载 Windows x64 安装器，选用 MSVC 工具链。重开终端，检查 `rustup show`、`rustc -V` 和 `cargo -V`。若缺少 WebView2，安装 [Microsoft Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/#download)。
3. 在项目根进入 `poc-001b`，执行 `npm ci`、`npm test`、`npm run tauri dev`。窗口应有 Windows 标题栏，左侧显示数学、物理、化学三道题、6 个小问和 40 分。生产复验使用 `npm run tauri build` 生成的可执行文件。

## 2. 编辑、关闭、回读、再次保存

1. 进入数学整题，在首段插入 `回读回归 ABC 123`，选中文字设置粗体和斜体。点击现有函数公式，将其改为 `f(x)=x^2-8x+12`。另插入独立公式 `\sqrt{313}`。
2. 通过 **添加图片** 选择本机小于 5 MiB 的 PNG。确认新图片和内置函数图都能显示。切换到小问 1 的题干增加一处文字，再返回整题，确认两处编辑分别保留。
3. 点 **保存本地 JSON**。打开 `%APPDATA%\org.shandong-study.poc001b\questions.json`，核对题目 ID `poc-math-001`、小问 ID `p1`、`attrs.latex`、内置图引用 `poc001:parabola` 和 PNG 的 `data:image/png;base64,`。关闭整个窗口，确认进程退出。
4. 启动同一个可执行文件，检查默认显示修改后的内容，点击独立公式改为 `\frac{21}{7}` 后再次保存。对比保存前后 JSON，核对 ID、其他字段和附件。勾选 **查看公共原版**，确认内置题显示原文。
5. 关闭应用并备份 JSON。用临时内容 `{`、`{}`、`{"schema_version":99}` 各做一次独立启动，分别确认解析失败、结构无效、版本不兼容。每次确认保存按钮被禁用，原文件内容未被覆盖。关闭窗口并还原备份。

## 3. WebView2 PDF 与分页

1. 为复验原始输出，勾选 **查看公共原版** 后进入预览，或先备份并移走个人 JSON 后重启。分别预览并导出题卷、答案卷。在题卷预览勾选 **长题分页样本** 并导出。
2. 从 `%APPDATA%\org.shandong-study.poc001b\pdf` 打开 `paper.pdf`、`answers.pdf` 和 `paper-long.pdf`。三份均应为 A4。题号 1–3、小问 1.1、1.2、1.3、2.1、2.2、3.1 依次对应，合计 40 分。
3. 检查题卷无“顶点 (2,-1)”、末速度结论与化学反应产物。确认这些内容在答案卷可见。检查函数图、积分、分式、物理单位、化学上下标、箭头、中文和数字。长题逐页查看 01–36 段完整出现，末尾物理和化学小问可见。
4. 可运行以下命令核对尺寸、编号和分离，并生成逐页 PNG。

```powershell
cd poc-001b
python -m pip install pymupdf==1.26.7
python tests/check_pdf.py "$env:APPDATA\org.shandong-study.poc001b\pdf" --render .test-output/pages
```

## 4. 断网

关闭程序，断开电脑外网，再启动生产 EXE。核对内置函数图、保存的图片、已编辑公式与 KaTeX 字体。打开化学小问答案并单击公式，尝试改为 `\ce{2H2 + O2 -> 2H2O}`。保存、关闭、重开并导出 PDF，随后恢复网络。

也可运行 `node tests/windows-webview.mjs`。测试脚本通过本地调试端口连接真实 WebView2 窗口，使用应用目录创建测试用个人 JSON，并将截图和 PDF 复制到 `.test-output/`。发现已有个人 JSON 时，脚本会停止。复测前请先备份并移走已有文件。
