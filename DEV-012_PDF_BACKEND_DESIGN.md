# DEV-012 PDF 后端设计

| 入口 | Windows | macOS |
| --- | --- | --- |
| 单题和示例 | WebView2 `PrintToPdf` | WKWebView `printOperationWithPrintInfo:` 与 AppKit 异步打印 |
| 组卷双 PDF | 同一 Windows 后端 | 同一 macOS 后端 |
| 原卷系统打印 | 现有 PDF.js 打印页和 WebView2 系统面板 | 已登记原始 PDF 字节、PDFKit 和 AppKit 系统面板 |

生成 PDF 时使用 A4 纵向、四边 15 mm、无打印页眉页脚。AppKit 必须异步运行打印操作，使 WebKit 能回传分页。Rust 等待完成回调，60 秒超时后拒绝发布，暂存目录由在途操作保留至回调结束。输出通过 PDF 解析及非空页树检查后原子保存。稿件的精确排版和长题完整性通过实际输出的页框、文本、字体、图像清单和页面渲染检查。

双卷仍由已保存组卷和固定 `revision_id` 构造两个快照。受控打印窗口绑定一次性任务 token 和 URL。DOM 校验顺序、分组、分值、小问、图片数量及解码结果，并拒绝字体和 KaTeX 错误。题卷和答案卷先进入同一卷的暂存目录。两份都完成后一次改名发布。

Mac 原卷系统打印从数据库重新取得文件字节，校验大小和 SHA-256。PDFKit 保留原卷矢量与页结构，打印面板预设所选页范围。实机预览、系统面板的“存储为 PDF”和取消行为仍须复核。 [Apple WKWebView 打印接口](https://developer.apple.com/documentation/webkit/wkwebview/printoperation%28with%3A%29) · [WebKit MiniBrowser 使用方式](https://github.com/WebKit/WebKit/blob/main/Tools/MiniBrowser/mac/WK2BrowserWindowController.m) · [PDFKit 打印接口](https://developer.apple.com/documentation/pdfkit/pdfdocument/printoperation%28for%3Ascalingmode%3Aautorotate%3A%29?changes=la__8)
