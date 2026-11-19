# DEV-010 知卷数据保护

开发分支 `dev/dev-010-data-protection`。基准为从 GitHub 拉取并核对的 `dev/dev-009-resource-packs` 完整 SHA `bde7b70f62e9656f3414dc28e03435da4fb1d1de`。开始前工作区干净。实现提交为 `5d97f428b8b0832946e1b1d191f8b91f432ac213`。本次原生测试程序 SHA-256 见 [构建指纹](poc-001b/output/dev010/windows-exe-sha256.txt)。

- Schema 9 新增备份历史、回收站、自动草稿和附件关联。迁移 1–8 由原迁移器校验。恢复操作日志在固定的应用控制子目录，随当前配置保留。
- Rust `backup.rs` 与 `protection.rs` 实现 WAL 在线快照、流式归档、隔离预检和本地诊断。 `library_root.rs` 与 `protection_ipc.rs` 提供耐久切换、原库回退、容量检查、原生文件对话框、取消和进度。
- Rust `trash.rs`、`drafts.rs` 与 `draft_trash_ipc.rs` 接入现有知识、试题、试卷和组卷路径。试题/组卷正式保存与关闭对应草稿共用事务。保留公共资源、已审核记录、个人修订、人工同题、收藏和固定组卷。
- React `data-management.tsx`、`trash-button.tsx`、`data-protection-api.ts` 和 `use-autosave.ts` 提供数据管理、删除确认、草稿状态和恢复入口。既有 Tiptap 编辑历史与离开确认继续使用。

[测试矩阵与证据](DEV-010_TEST_RESULTS.md)记录每项验收及原始数据。归档样本来自独立 Windows 合成资料配置。SHA-256 与 Manifest 可在交付目录复核。macOS 实机、真实磁盘耗尽以及历史 Windows 端到端脚本的完整重跑仍有验证缺口。

[Schema 9](DEV-010_SCHEMA.md) · [备份格式](DEV-010_BACKUP_FORMAT.md) · [备份机制](DEV-010_BACKUP_DESIGN.md) · [恢复机制](DEV-010_RESTORE_DESIGN.md) · [迁移机制](DEV-010_STORAGE_MIGRATION.md) · [回收站](DEV-010_TRASH_DESIGN.md) · [草稿](DEV-010_DRAFT_DESIGN.md) · [界面](DEV-010_UI_DESIGN.md) · [已知问题](DEV-010_KNOWN_ISSUES.md)
