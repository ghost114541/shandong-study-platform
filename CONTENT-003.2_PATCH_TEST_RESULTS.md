# CONTENT-003.2 最小补丁验收矩阵

执行日期为 2026-11-25，实测候选源码为 `030a6a1a7f0c1781efc8dd44275622ee4a5a9e73`。

| 编号 | 结果 | 实际证据 |
| --- | --- | --- |
| PATCH-T01 | PASS | UTF-8 JavaScript 与 Rust 的导入、备份、恢复标题匹配。 |
| PATCH-T02 | PASS | 替换为错误窗口标题会触发同一契约断言。批处理测试替身校验了真实传参。 |
| PATCH-T03 | PASS | Windows 原生选择器按窗口标题及进程匹配，原创单页合成 PDF 入库，文件和实际存储哈希相同。 |
| PATCH-T04 | PASS | 第二份 PDF 文件 IPC 完成后注入中断。相同 manifest 续跑及重放均复用文件。原 PDF 版本、资源与登记比对通过。 |
| PATCH-T05 | PASS | 合成应用库为 1 个顶层逻辑题、3 条修订和 2 处原卷出现关系。 |
| PATCH-T06 | PASS | 侧车重建后全库审计 0 错误。3 条修订保留原内容来源，新原卷登记为 1 条独立出现关系。 |
| PATCH-T07 | PASS | 重放前后登记、关联、业务记录及资源一致。篡改同源区域被拒，写入前后状态一致。 |
| PATCH-T08 | PASS | 组卷历史修订 B 的固定引用保持一致，当前修订 C 和历史内容保持一致。 |
| PATCH-T09 | PASS | 初始 A 的内容核对和历史 B 的正式通过仍归属各自修订。C 的正式通过和内容核对数均为 0。伪造出现记录审核字段被识别。 |
| PATCH-T10 | PASS | Node 14 项、Python 35 项及 Windows 原生目标身份保护通过。构建隔离 EXE 时 TypeScript 检查通过。 |
| PATCH-T11 | PASS | 私人资源与哈希清单 50 项相符。真实库前后核验 43 张业务表、330 个归档资源、206 题和 211 条修订，结构错误 0。 |
| PATCH-T12 | PASS | 关键脚本执行字节、Git blob 和 EXE SHA-256 均有记录。最终交付保留测试候选功能及测试树。 |

Windows 首次启动在 WebView2 注册目标页前返回，尚未导入。确认隔离库为空后以同一候选源码重试，以下日志保留了脱敏启动失败摘要及实际通过事件。

- [Windows 原生测试](poc-001b/output/content003-2-patch/native.log)
- [Node、Python 和身份保护](poc-001b/output/content003-2-patch/regression.log)
- [版本哈希](poc-001b/output/content003-2-patch/source-binding.json)
