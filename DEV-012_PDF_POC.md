# DEV-012 WebKit A4 打印实验

AppKit 同步打印在 `macos-15` VM 上持续写入空白页。首次失败文件含超过 87 万个未闭合的页对象，90 秒 watchdog 停止了进程。WebKit 的打印视图异步计算页范围，并允许 AppKit 在次线程绘制。切换到 `runOperationModalForWindow`，并由回调确认完成。探针额外设 32 MiB 输出上限和进程超时。

用相同的原生函数两次打印独立 HTML 样本。两份均输出 10 页 A4（595 × 842 pt），提取文本完全一致。150 条有序编号阅读段落完整。检测到 KaTeX 字体和图片，未检测到导航标签或空白页。检查首页原尺寸渲染与 10 页缩略总览，中文、行内和独立数学公式、化学式、表格、图片及分页均可见。文件字节因时间等元数据可不同。

```sh
cd poc-001b
npm ci
bash tests/macos-pdf-check.sh
```

探针仅使用合成 HTML，应用内同一后端的运行结果见应用级证据。 [同步失败日志](poc-001b/output/dev012/job-136841149372.log) · [异步成功的 Actions Job](https://github.com/ghost114541/shandong-study-platform/actions/runs/44902871747/job/136842268652) · [两份 PDF 与逐页 PNG](https://github.com/ghost114541/shandong-study-platform/actions/runs/44902871747/artifacts/14706189719)
