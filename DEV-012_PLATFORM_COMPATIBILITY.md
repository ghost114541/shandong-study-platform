# DEV-012 平台与文件兼容

数据根由 Tauri `app_data_dir()` 提供。典型 macOS 配置目录为 `~/Library/Application Support/org.shandong-study.knowpaper-preview`，可能因用户或系统配置不同而变化。活动数据库和附件可能已迁移到日志登记的目录。恢复以独立候选库和本机日志完成，不导入另一平台的活动库路径或回退库指针。

Mac 文件选择与资源库校验只映射根拥有且链接目标精确匹配的系统别名 `/var → /private/var`、`/tmp → /private/tmp`。随后对每级路径执行原安全校验。原卷导入从卷根通过无跟随目录句柄打开，保留普通文件、大小限制和 SHA-256 登记。其余符号链接拒绝规则及 Windows junction 拒绝继续生效。保存原卷和备份时以目录真实身份检查包含关系，包括同一卷的大小写或别名路径。

Schema 9、迁移历史、备份 v1 和 `.studyzip` 协议沿用。图片和 PDF 根据资源 ID、内容哈希与相对目录读取。DEC-039～041 的逻辑题身份、固定修订、审核记录和个人版优先仍由既有 SQLite 规则执行。

PDF.js 继续使用 6.5.438、分块 IPC、应用内离线 worker、CMaps 及本地字体。应用主模块、文字层和 worker 采用该版本的兼容发行文件，覆盖系统 WebKit 缺少 `Map.getOrInsertComputed` 的实测情况。需要在隔离测试账户覆盖实际文件选择器、外部 `/Volumes`、大小写敏感 APFS、Unicode 名称及系统快捷键。富文本契约当前无表格节点，表格排版放在独立 HTML PoC 验证。 [验收矩阵](DEV-012_TEST_RESULTS.md)
