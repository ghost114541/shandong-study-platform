# POC-001 实际测试报告

- 日期：2026-11-16
- 状态：**部分验证通过（PASS-PARTIAL）**，不是完整技术验收。
- 前置约束：当前沙盒无法连接 npm 依赖仓库；不能安装 Tiptap/Tauri；Chromium/Playwright 对文件 URL 与 127.0.0.1 页面导航均返回 `net::ERR_BLOCKED_BY_ADMINISTRATOR`。
- 验证范围：独立离线浏览器编辑原型的静态代码 + MathJax（Node 转 SVG）+ WeasyPrint PDF 生成。

## 输入与环境

| 项目 | 实际条件 |
|---|---|
| 数据 | 3 道原创顶层题、6 个小问、数学/物理/化学各 1 道，总分 40 |
| 公式 | 10 个不同 LaTeX 表达式，MathJax 转自包含 SVG |
| 图片 | 1 个原创的二次函数示意 SVG |
| Python | 3.13 |
| Node | 22.16 |
| WeasyPrint | 68.0 |
| PyMuPDF | 1.26.7 |
| 浏览器 | Chromium 144，受导航策略阻拦，实际浏览器操作未测 |

## 可核查的结果

| 测试项 | 实际结果 | 判定 |
|---|---|---|
| JSON 解析/版本校验 | 结构字段有效；3 个唯一题目 ID | PASS |
| 小问与分值求和 | 6 个小问、40 分；题目小问分值匹配题目分值 | PASS |
| MathJax 公式渲染 | 10 条公式生成 SVG；PDF 中可见分式、积分、上下标、化学反应箭头 | PASS（视觉） |
| 自制图片嵌入 | 抛物线图片在 PDF 正常显示 | PASS（视觉） |
| PDF 题卷/答案分离 | `paper.pdf` 与 `answers.pdf` 不同文档；小问编号一致 | PASS |
| PDF 标准页幅 | 二者均为 A4，595.3 × 841.9 pt | PASS |
| PDF 页面与排版 | 二者均为 1 页；截图确认无空白页/明显裁切 | PASS（给定样本） |
| 中文字符 | PDF 页面可读，中文正常 | PASS（给定样本） |
| JS 语法 | `node --check` 对 app.js 与 tex_to_svg.cjs 均成功 | PASS |
| 自动检查脚本 | `python tests/test_poc.py` 通过 | PASS |
| 页面富文本编辑/JSON 保存回读 | 无法实际操纵浏览器（策略阻断） | NOT TESTED |
| Windows Tauri + React/Tiptap | 依赖未安装、无 Windows 工具链 | NOT TESTED |
| macOS Tauri 实机运行 | 无 Mac 设备 | NOT TESTED |
| 超长题目跨页和复杂表格 | 未提供对应压力样本 | NOT TESTED |
| 数学内容文本检索 | SVG 为路径表示，不保证可提取公式文字 | OPEN |

## 严格结论

已验证：**给定原创样本**能够使用本地 MathJax SVG + WeasyPrint 生成中文 A4 试题卷和独立答案卷，并可通过预览确认基本公式与图像质量。

未验证：浏览器交互与持久化、正式 Tiptap/KaTeX 集成、Tauri 桌面能力、真正的 Windows/macOS 安装及浏览器打印的一致性。因此本 PoC 不能用于宣布 `FR-EDT-001…003` 和 `FR-CMP-002…005` 全部通过。

## 风险与下一步验收条件

1. 在 Windows 原生环境安装 Tauri 2 + React + Tiptap Mathematics/KaTeX；执行编辑→JSON 保存→关闭→重新打开→修改公式→再次保存闭环。
2. 使用 Windows WebView2 和 macOS WebKit 对比实时预览、纸张分页和 PDF 实际打印，确认是否采用浏览器打印或独立引擎。
3. 加入长题、多页共享材料、图表、化学式、混合中文英文、高分辨率图片、多重分页的压力样本。
4. 审核输入 HTML/附件安全、数据结构版本及资源包隔离；不允许未经审查的 HTML 进入生产题库。
5. 以上完成后形成 `POC-001B` 报告，才进入正式组件选型和发布标准冻结。
