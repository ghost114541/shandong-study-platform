# DEV-012 已知问题

| 级别 | 类型 | 问题与验收边界 |
| --- | --- | --- |
| P0 | BLOCKED | Apple Silicon 实机安装、完整行为链和 E2E-007 缺授权的物理测试机。GitHub Actions 是 VM，单列其构建、打印与数据证据。 |
| P1 | NOT TESTED | macOS 13.0/14.x 和 Intel 兼容未测。13.0 仅为临时最低打包版本。OID-005 继续开放。 |
| P1 | NOT TESTED | Mac 原卷 PDFKit 打印面板、页范围、保存 PDF、用户取消需实机。 |
| P1 | NOT TESTED | 外置 APFS、大小写敏感卷、原生对话框、系统输入法及 Cmd 操作需实机。 |
| P1 | 已由源码验证 | 当前版本的富文本契约无结构化表格节点。独立 HTML PoC 仅证明 PDF 引擎能绘制表格，应用中已有图片可以用于表格内容。 |
| P1 | 已复现与修复 | WebKit 同步打印在 CI 持续生成空白页。异步 AppKit 实现通过两次 10 页的回归。 |
| P1 | 已复现与修复 | Apple 标准系统路径别名导致原卷导入失败。只处理根拥有且链接目标精确匹配的系统项，保留其余无跟随校验。 |
| P1 | 已复现与修复 | 带恢复草稿的库导出单题或示例 PDF 时，启动通知曾出现在正文上方。打印样式现隐藏通知，并由共享夹具覆盖。 |
| P1 | 已复现与修复 | macOS 15.8.2 的系统 WebKit 缺少 PDF.js 标准构建使用的 `Map.getOrInsertComputed`。同版本兼容发行文件已通过 Mac CI 100 页原卷和 Windows 原卷回归。 |
| P2 | 已复现 | Windows 原生面板显示系统预览不可用。进入另存为对话框后，Microsoft Print to PDF 实际落盘并核对了选中的原卷页。 |
| P2 | 已复现 | Mac 50 题合成题卷一个小问的分值标题留在上一页底部，正文接在下一页。正文与公式完整，题号未丢失。 |
| P2 | NOT TESTED | 4 GB / 8 GB Mac 及真实外部存储性能、真实地图与复杂原卷、全部视觉对照待测。 |
| P2 | 发布边界 | 当前 Mac 测试包 ad-hoc 签名，Developer ID、公证及 stapling 待正式发布准备。Windows 无 Runtime 的完全离线首次安装仍沿用 DEV-011 开放问题。 |
