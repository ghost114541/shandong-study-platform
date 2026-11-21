# DEV-012 PDF 验证

验证档案包含 PDF、SHA-256、字节数、页数、各页 MediaBox、字体清单、图片清单、提取文本与 PNG。检查连续题号、题卷与答案卷分隔、分组和总分、持续多页的阅读段落、数学和化学公式、图片、空白页和导航误入。打印引擎产生的 PDF 哈希用于核对传输和存档。

- WebKit 独立 HTML PoC 两次输出 10 页 A4。逐页渲染结果见 [PoC 报告](DEV-012_PDF_POC.md)。
- 应用级夹具新增 20、30、50 道原创跨学科组卷和 100 页合成扫描 PDF。隔离的 macOS 应用命令导出单份 PDF 与三组双 PDF，并检查错误快照身份被拒绝。
- Windows 仍用 WebView2 导出，使用历史原生测试及 Poppler 重新检查。具体结果和未覆盖项见 [验收矩阵](DEV-012_TEST_RESULTS.md)。
- PDFKit 原卷系统面板、打印页范围和从面板保存 PDF 需要实机证据。正式视觉验收仍需代表性的受力图、真实地图、复杂表格和更大资源密度样本。

Windows 原生应用使用共享夹具成功打开 100 页扫描 PDF，生成 1 页单份 PDF 和 20、30、50 题双卷。题卷页数分别为 12、17、27，答案卷页数分别为 7、11、17。首次共享夹具导出发现恢复草稿通知进入单份 PDF，修复打印样式后，同样条件下重复导出，PDF 文本无恢复通知。所有双卷通过题号、长材料、分组、总分、公式字体、图片、A4、非空页及正文与答案分隔检查。 [Windows PDF 与分析](poc-001b/output/dev012/windows-shared-fixture/) · [Windows 运行摘要](poc-001b/output/dev012/windows-shared-fixture-result.json)

| 样本 | Mac 题卷／答案卷页数 | Windows 题卷／答案卷页数 |
| --- | ---: | ---: |
| 20 道 | 12／7 | 12／7 |
| 30 道 | 18／10 | 17／11 |
| 50 道 | 27／17 | 27／17 |

Mac 与 Windows 的 7 份 PDF 分别核对了抽取文字的边界，没有越过对应页框。抽查 Mac 示例、50 题题卷的首页、含图页、末页以及答案卷首页和末页。中文、图片、行内和独立公式及题号可见，50 题题卷第 8 页底部的小问分值标题与第 9 页的正文分开。两平台 30 题分页不同，题号和材料完整。 [Mac 输出与字体、图片、文本分析](poc-001b/output/dev012/macos-shared-fixture/) · [Mac 实际输出渲染](poc-001b/output/dev012/macos-app-pdf-pages.png)

```sh
pdfinfo -box paper.pdf
pdffonts paper.pdf
pdfimages -list paper.pdf
pdftotext -layout paper.pdf paper-text.txt
pdftoppm -png -r 120 paper.pdf paper-page
shasum -a 256 paper.pdf answers.pdf
```
