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
