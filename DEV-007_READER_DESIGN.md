
# DEV-007 内置阅读器

试卷库延迟加载 PDF.js 6.5.438，Vite 将 worker、CMap、标准字体和 ICC 资源打入应用。页码输入和缩略图都跳转同一单页视图。阅读时只绘制当前页面及附近最多五张缩略图。切换 PDF 关闭旧 worker 和二进制会话，缩放和翻页取消旧绘制，脱离视图的画布释放像素缓冲。失效的异步结果不得更新当前视图或持续占用会话。

关键词搜索逐页读取 PDF.js 提取的文字并汇总命中页，显示该页的原始文本区域高亮。图片扫描件在没有文字时显示 OCR 边界提示。浏览渲染器只使用页面画布和本地文本。PDF 脚本、XFA、交互式表单、外部链接、PDF 附件和文档发起的导航均无界面入口。应用 CSP 仅允许自身的脚本及 worker，外部 PDF 字节通过逻辑 ID 接口读取。[PDF.js 发布记录](https://github.com/mozilla/pdf.js/releases)

浏览、捕获和打印画布限边长 4096 像素且面积最多 1,200 万像素。PDF.js 单图上限为 1,600 万像素。截取采用固定 144 DPI，从原页面重绘选区，图片经 5 MiB 附件服务验证，每题截图合计上限 24 MiB。达到上限需缩小用户选区，分辨率不变。

原卷另存保留原始字节。Windows 系统打印使用 WebView2 的 `ShowPrintUI(System)`。用户确认页范围后依次生成打印页，每批最多 100 页、最多 48 MiB PNG 和 7,200 万像素。输出是页面栅格，可使用系统打印机和虚拟打印目标。[WebView2 系统打印接口](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/print)
