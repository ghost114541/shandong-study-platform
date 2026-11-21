# DEV-012 Windows 至 macOS 备份恢复

CI 在 Windows 上用原生 SQLite 和应用备份实现，从已提交的 DEV-010 合成备份初始化隔离库，再添加原创题目、长材料、图片、合成扫描卷、固定组卷、自定义知识点与别名、重点、草稿及回收站记录。新归档使用 Schema 9 和 `.knowbackup` v1。源夹具另有九学科、公共和个人版本、人工同题、原修订审核、三种 PDF 角色、原卷区域和资源包记录。

Mac 数据探针从空库启用 Schema 9，预检归档、创建候选、验证、排队、释放配置锁，再重新打开并核对活动库和回退点。再次重开后核对九学科、草稿、回收站及库诊断，由 macOS 写出新的归档。两份归档对比业务表全部记录、固定组卷修订、各图片及 PDF SHA-256，并验证数据库、成员路径和 ZIP 清单。备份日志和 SQLite 自增内部状态由各端各自维护。

实际完成 Windows → Mac CI → 隔离本机 Windows 往返。三份归档的 43 张业务表、102 条固定组卷引用和 131 项外部或兼容文件一致，其中 65 项图片、65 项 PDF、1 项旧版 JSON。在 Windows 和 Mac 上均由应用的 SQLite、验证、切换及备份代码处理。 [逐项往返指纹](poc-001b/output/dev012/roundtrip-fingerprints.json) · [摘要、SHA-256 和时序](poc-001b/output/dev012/migration-and-performance.json) · [Windows 源归档](https://github.com/ghost114541/shandong-study-platform/actions/runs/44903462734/artifacts/14706747130) · [Mac 再次归档](https://github.com/ghost114541/shandong-study-platform/actions/runs/44903462734/artifacts/14707277544)

实机 E2E-007 用独立 macOS Preview 账户打开 Windows 归档。通过原生对话框预检、确认，退出并重启。核对收藏、题库、原卷及答案/解析切换、双向定位、固定组卷、草稿、审核和同题。再创建 Mac 备份并输出档案 SHA。反向恢复到另一个隔离 Windows 库是独立验证。

```powershell
cd poc-001b
cargo run --locked --manifest-path src-tauri/Cargo.toml --example dev012_migration -- seed output/dev010/original-fixture.knowbackup scratch/windows.knowbackup
python tests/dev012-backup-fingerprint.py scratch/windows.knowbackup
```

```sh
cd poc-001b
cargo run --locked --manifest-path src-tauri/Cargo.toml --example dev012_migration -- restore scratch/windows.knowbackup scratch/macos.knowbackup
python3 tests/dev012-backup-fingerprint.py scratch/windows.knowbackup scratch/macos.knowbackup
```

```powershell
cargo run --locked --manifest-path src-tauri/Cargo.toml --example dev012_migration -- restore scratch/macos.knowbackup scratch/windows-return.knowbackup
python tests/dev012-backup-fingerprint.py scratch/windows.knowbackup scratch/macos.knowbackup scratch/windows-return.knowbackup
```

[原备份协议](DEV-010_BACKUP_FORMAT.md) · [安全切换设计](DEV-010-1_PATH_SAFETY_DESIGN.md) · [当前实测结果](DEV-012_TEST_RESULTS.md)
