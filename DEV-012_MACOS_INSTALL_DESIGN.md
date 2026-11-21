# DEV-012 macOS 安装与实机验收

内部 Preview DMG 含签名方式为 ad-hoc 的 arm64 `.app` 与 Applications 链接。CI 包结构与挂载检查覆盖 Info.plist、架构、依赖、图标、文件清单、签名和 DMG 完整性。正式 Developer ID、公证和 stapling 留待发布准备。

在授权 Apple Silicon Mac 的独立测试账户记录机型、芯片、内存、操作系统、APFS 格式、权限与安装位置。先核对构建提交和 DMG SHA-256，打开 DMG，拖到 Applications，记录 Gatekeeper 提示和正常启动。若当前系统允许对受信任测试包作单应用例外，使用系统提供的该应用专用操作。 [Apple 应用安全说明](https://support.apple.com/102445)

```sh
sw_vers
system_profiler SPHardwareDataType
diskutil info /
shasum -a 256 "知卷 KnowPaper（测试版）_0.2.1_aarch64.dmg"
hdiutil verify "知卷 KnowPaper（测试版）_0.2.1_aarch64.dmg"
app='/Applications/知卷 KnowPaper（测试版）.app'
plutil -p "$app/Contents/Info.plist"
file "$app/Contents/MacOS/knowpaper-preview"
codesign --display --verbose=4 "$app"
spctl --assess --type execute --verbose=4 "$app"
```

1. 操作完整学习链：创建数学题、键入中文、插入公式和图片、保存、检索、收藏、组卷并导出两份 PDF。
2. 导入可搜索和 100 页扫描原卷，测试缩略图、旋转、选区、跨页截图、双向定位、切换答案和解析、保存原始字节及系统打印预览。
3. 使用 Windows 合成备份完成 [E2E-007](DEV-012_BACKUP_MIGRATION.md)。然后测试正常和异常关闭、草稿恢复、回收站、备份校验和外部卷位置迁移。
4. 安装正常、重复、升级及损坏的 `.studyzip`，观察个人修订、收藏及固定组卷。记录应用与 WebKit 进程的内存、冷／热启动和各关键操作耗时。
5. 退出应用，只删除 Applications 中本次安装的 `.app`。重装同一 DMG，回读原库、恢复库、图片、PDF、收藏、组卷及草稿。保留 Application Support 与外部卷中的数据。

按任务验收表保留安装、主页、九学科、编辑、阅读、截图、定位、PDF、打印、收藏、资源包、Windows 恢复、草稿和重开的 18 类实机截图。记录证据 SHA。

## 收尾实机复测

在独立测试账户下载 [收尾矩阵](DEV-012_CLOSEOUT_TEST_RESULTS.md) 指定 CI 提交的 DMG 和 Windows 合成备份。建立独立的证据目录，记录测试日期和时区、系统构建号、机型、芯片、内存、安装包 SHA-256 与应用二进制 SHA-256。截图前隐去序列号、系统账户名和外置卷的私人信息。

1. 核对 DMG 与应用二进制 SHA-256。安装后从 Finder 启动，记录 Gatekeeper 实际反应，退出再启动。分别记录一次未预热启动及三次正常重启，从打开应用至主界面可交互计时。
2. 用系统拼音录入简体中文并粘贴文本。插入分式、带上下标的积分、根式和化学式，执行撤销、重做并保存。打开一份实际 SQLite 单题，导出 PDF 并用预览查看、复制和检索。
3. 经原生文件选择器从带中文、空格及组合字符的目录导入可搜索的多页 PDF。执行缩略图、检索、页码跳转和旋转。抓取选区并保存，重开题目后从题目定位原卷，再从原卷定位同一道题。记录原卷和截图附件的 SHA-256。外置 APFS 及大小写敏感 APFS 分别复跑路径场景。
4. 用同一套合成资料依次导出 20／30／50 题双卷。核对题号、小问分值及答案隔离，记录耗时。打开 PDFKit 打印面板，选择原卷页范围并保存 PDF，核对页数及内容。重开面板测试取消，再确认单题和组卷导出仍可用。
5. 从资源库管理页通过 GUI 选择 Windows 备份，完成预检、确认、退出和重启，核对个人修订优先、公版仍可读、审核记录不继承、收藏、固定组卷、原卷双向关联、草稿和回收站。执行一次损坏备份拒绝和一次恢复后回退。记录备份和恢复用时，并对比导出档案的表指纹和资源 SHA-256。
6. 在合成测试数据中保存草稿后，从活动监视器强制退出该测试应用，重启并恢复草稿。正常退出后只删除本次测试的应用包，重装同一 DMG 并重新核对合成库。保留用户数据目录。
7. 从活动监视器记录应用与 WebKit 相关进程的常驻内存。用同一套数据连续导出十次，记录起始、峰值、完成后和失败恢复后的样本。另记录 100 页原卷首屏耗时。保留 PDF、截图、日志与备份指纹，对证据文件逐份计算 SHA-256。
