# KnowPaper 完整备份格式 v1

扩展名 `.knowbackup`。容器是 ZIP，归档可使用 ZIP64。程序写出存储成员，逐文件流式校验。归档包含个人数据，内容未加密，也没有发布者签名。

| 路径 | 内容 |
| --- | --- |
| `manifest.json` | UTF-8 JSON，格式 `knowpaper-backup`，版本 `1`。 |
| `study.sqlite3` | 可独立打开的 SQLite 快照，使用 DELETE 日志模式。 |
| `attachments/<前两位>/<SHA-256>` | SQLite 登记的所有图片内容。 |
| `paper-pdfs/<前两位>/<SHA-256>` | SQLite 登记的所有原卷、答案和解析 PDF。 |
| `questions.json` | 如果存在，原样保存旧版 JSON 演示题库。 |

清单包含应用版本、Schema、UTC 创建时间、来源平台、数据库摘要、文件数、解包总体积。每个成员记录逻辑路径、类型、大小和小写 SHA-256。清单自身不计入文件数与总体积。每个内容地址在其资源目录中只有一个成员。读取器检查严格路径白名单、同名条目、外部属性、字节数、哈希和清单与数据库登记的对应关系。

当前清单上限 64 MiB，文件数上限 250,000。受目标卷空间和单项资源的业务导入限额约束。低版本 Schema 先在隔离目录迁移。未知格式或较高 Schema 拒绝恢复。

[原生备份归档](poc-001b/output/dev010/original-fixture.knowbackup) · [实际 Manifest](poc-001b/output/dev010/manifest-sample.json) · [归档 SHA-256](poc-001b/output/dev010/backup-sha256.txt)
