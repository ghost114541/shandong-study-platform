# DEV-010.1 资源库目录安全专项修复

基准分支 `dev/dev-010-data-protection`，基准 SHA `34bd1e67399e44487c032f9e65eb7eba2e10fd4d`。本地检出和拉取后的远程目标一致。开发分支 `dev/dev-010-1-library-root-safety`，实现提交 `96ad6d746f97925ab5fe57582983f9429b8e9bd8`。

- `library_paths.rs` 和 `library_root.rs` 检查实际文件系统身份、目录祖先、重解析点、候选归属与控制边界。切换日志写入成功后才更新活动指针。默认配置目录及历史内层目录仍受清理保护。
- `protection_ipc.rs` 与 `db/backup.rs` 在分配候选前检查容量。恢复与安全修复采用同级独立容器，跨卷迁移使用相同候选和切换规则。原库保持可回退。
- `data-management.tsx`、`data-protection-api.ts` 和 `main.tsx` 显示历史嵌套、修复入口、保留库路径与清理保护原因。实际目录删除只在 Rust 测试沙箱执行。

Windows 原生验证包括默认库恢复、双向回退、C: → D: 迁移、版本 1 旧版嵌套库安全迁移、受保护目录和真实 NTFS junction、八个真实 Tauri 强制终止点。修复前后比对 2,507 个试题记录及 129 个登记或兼容文件，保持原有数据库和资源哈希。旧版内层缺图时修复按预期阻断，原位保留。Schema 9、备份格式以及 DEC-039～041 沿用。

[目录设计](DEV-010-1_PATH_SAFETY_DESIGN.md) · [旧版迁移](DEV-010-1_LEGACY_MIGRATION.md) · [T01～T16 与证据](DEV-010-1_TEST_RESULTS.md) · [已知问题](DEV-010-1_KNOWN_ISSUES.md) · [项目状态](PROJECT_STATUS.md)
