# POC-001：离线富文本、公式、图片、多小问与 PDF 分离输出

> 2026-11-16 · 技术验证样品 · **不是**正式应用或正式题库。用户已确认的 DEC-039…041 与原 SRS 不受本 PoC 影响。需求基线仍为 `DRAFT-0.2`，未整体签核。

## 本包实际提供什么

- `index.html`、`styles.css`、`app.js`：不联网的浏览器交互原型，含题目切换、正文/小问/答案编辑、粗体/斜体、可编辑 LaTeX 公式、插入图片、下载/导入结构化 JSON、试卷/答案预览与打印。
- `vendor/mathjax/tex-svg.js`：已在包内的浏览器用 MathJax SVG 引擎（附上游 LICENSE；**未附带字体文件**）。它不依赖在线 CDN。
- `samples/questions.json`：三道自行编写的数学、物理、化学测试题，共六个小问，总分 40；配套图片为自制 SVG。
- `scripts/export_pdf.py`：使用 WeasyPrint + MathJax SVG 缓存生成可复现的 `output/paper.pdf`、`output/answers.pdf`；**仅是验证用生成路径，不是未来 Tauri 的最终导出引擎**。
- `tests/test_poc.py`：对示例数据、结构、PDF 页面与答案分离等进行自动检查。
- `output/`：已经生成的 PDF、对应 HTML 与页面预览 PNG（脚本产生的中间 HTML 可删除）。

## 使用方法（不需要安装任何插件）

**方法 1：直接双击** `index.html`，在现代浏览器中打开。各资源文件均随压缩包提供，不依赖联网。若浏览器对 `file://` 有安全限制，请使用方法 2。

**方法 2：本地 HTTP 服务（仅本机，不对公网开放）**

```bash
cd shandong_poc001
python -m http.server 8791 --bind 127.0.0.1
```

然后在浏览器打开 `http://127.0.0.1:8791/`。关闭命令行服务器即停止服务。

页面交互：在左侧选择试题，在下拉框选择整题题干或某个小问的题干/答案；可以编辑文字、加粗、插入公式或本地图片。点击“保存当前编辑”后下载 JSON。试卷和答案两个预览页均可通过浏览器的打印对话框选择“另存为 PDF”。

**从 JSON 重新生成独立的 PDF**：在装有 Python、WeasyPrint 的环境中执行：

```bash
python scripts/export_pdf.py --input samples/questions.json --out output
python tests/test_poc.py
```

如果要导出你从交互页面下载的 JSON：

```bash
python scripts/export_pdf.py --input poc001_questions_edited.json --out output
```

示例中的所有公式已预渲染到 `assets/math_svg_cache.json`，故直接导出内置样本**不需要 Node**；如添加新 LaTeX 表达式，则需要 `node` 和 `mathjax-full`（需要手动安装），也可以先通过浏览器预览/打印。建议导出前检查 PDF 的页面和公式。

## 本次已经做的检查

- Python 的导出脚本实际生成了 A4 题卷与答案卷，**各 1 页**，总分 40，3 个顶层题/6 个小问。
- 10 条公式转为独立 SVG 路径，数学/物理/化学符号与自制配图显示正常。
- 中文页面通过渲染截图人工检查；没有另起空白页、明显文本裁切或图文覆盖。
- 自动化数据与 PDF 检查通过；Node JS 语法检查通过。

## 尚未验证、不得宣称通过

- 当前沙盒浏览器导航被管理策略阻止（包括 `file://` 和 localhost），**未完成真实浏览器点击、富文本编辑保存回读、打印对话框端到端测试**。请在你的 Windows 电脑上执行这些测试。
- 尚未安装或测试 React、Tiptap、KaTeX、Tauri 2、Rust、SQLite，也没有生成 Windows/macOS 安装包。
- 使用 WeasyPrint 的 PDF 结果不能证明 Windows WebView2 或 macOS WebKit 的打印一致性；也未验证长题跨页、表格和极端公式边界。
- 数学公式转 SVG 路径后在 PDF 中视觉清晰，但公式本身不一定能被 PDF 文字搜索选中，正式方案需要综合搜索/无障碍需求再决定。
- 本 PoC 简化 JSON schema，不是最终可迁移到 SQLite 的生产数据模型；不具有授权资源入库和答案核对机制。

## 下一步（需要在用户 Windows 环境执行）

`POC-001B`：用官方 Tauri 2 + React + TypeScript 骨架，接入真实 Tiptap 数学扩展/KaTeX，验证保存→重新打开→再编辑，验证含数学、物理、化学公式与图片的 PDF 导出，并在 Edge WebView2 上验证 Windows 打印。测试成功后再为 `DEV-001` 冻结相应数据契约。参考 [Tauri 前置要求](https://v2.tauri.app/start/prerequisites/) 和 [Tiptap Mathematics 文档](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)。

## 许可与安全

本包自制的测试题与配图仅用于工程验证。第三方 MathJax JavaScript 使用上游 LICENSE 的许可条款。用户本地编辑的文件不会被本代码主动上传；导入不受信任 SVG/HTML 与正式资源包的安全校验必须在生产应用中另外实现。
