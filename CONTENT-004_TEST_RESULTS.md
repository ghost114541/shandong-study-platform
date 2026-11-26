# CONTENT-004-B 验收矩阵

实测地点为 Windows 专用应用与隔离私人资源库。A 批次的矩阵和失败记录在 `83ad75133a258a79c361f3386b81827d3def81ec` 保存。

| 编号 | 状态 | B 实际结果 |
| --- | --- | --- |
| B-T01 | PASS | 开始前远程分支与指定 SHA 一致，并从 A 归档真实恢复。 |
| B-T02 | FAIL | 420/450，道题独立逻辑身份。新增 105/135。 |
| B-T03 | PASS | 33/32 套。历史合格基线 23 套，本批新增 10 套。 |
| B-T04 | PASS（差额已登记） | 9 科均新增。语文、英语、物理、化学分别差 10、13、4、3 道。 |
| B-T05 | PASS | 全库完整解析 345/420，即 82.14%。 |
| B-T06 | FAIL（覆盖目标） | 44/105 有可追溯的逐题实质核对，实际 41.90%。正式人工审核通过 0。 |
| B-T07 | PASS | 两套历史原卷各十页，均未含完整答案。从统计扣除。 |
| B-T08 | PASS | 6/6 转换件的原件和 PDF 字节长度、哈希、工具、转换日期与抽查结果登记。 |
| B-T09 | PASS（输出复验） | 三套真实样本均含全部题面和解析，A 所报内容缺失未复现。 |
| B-T10 | PASS | Windows 本地扩展盘符路径规范化后仍执行受控检查，联接点拒绝。 |
| B-T11 | PASS | 独立公式及表格节点经 Windows 原生编辑、导出与输出内容核对。 |
| B-T12 | PARTIAL | 收藏回开和旧修订读取已实测。当前搜索只能指定一个知识点，多个知识点同时过滤 BLOCKED。 |
| B-T13 | PASS | A 的固定引用、320 修订、业务记录和 565 个资源文件逐项相等。 |
| B-T14 | PASS | 应用实际备份、确认恢复、重启及活动库切换。848 个成员回读，43 张业务表和 847 个资源完全一致。 |
| B-T15 | PASS | 实测源码 SHA、二进制和执行字节绑定。交付追加报告及脱敏数据。 |
| B-T16 | PASS | 公共差异只含源码、原创夹具及脱敏证据，真实资料在私人归档。 |

## SCALE-T01 至 SCALE-T32 跟进

| 编号 | B 状态 | 依据 |
| --- | --- | --- |
| SCALE-T01 | PASS | 本次授权分支、远程及 A 指定 SHA 核对。 |
| SCALE-T02 | PARTIAL | 420/750 道。 |
| SCALE-T03 | PARTIAL | 阶段净增 214/544 道。 |
| SCALE-T04 | PASS | 九科均有新增。 |
| SCALE-T05 | PARTIAL | 九科 B 配额实际见覆盖表。 |
| SCALE-T06 | PARTIAL | 33/45 套阶段目标，已超过 B 批 32 套门槛。 |
| SCALE-T07 | PASS | 来源覆盖 420/420。 |
| SCALE-T08 | PASS | 可核索引与 PDF 页数、文件长度及 SHA-256。六份转换件保留双哈希。 |
| SCALE-T09 | PASS | 答案字段 420/420。 |
| SCALE-T10 | PASS | B 批 105/105 答案来源对应核对。 |
| SCALE-T11 | PASS | B 批 105/105 完整解析字段。实质核对单列。 |
| SCALE-T12 | PARTIAL | 82.14% 达到 B 的 80%，阶段 85% 继续开放。 |
| SCALE-T13 | PARTIAL | 对照来源、题号、区域、文本、选项和答案。图片库历史语义核查仍有覆盖缺口。 |
| SCALE-T14 | PASS | 共享材料组按一个逻辑题统计。合成小问分别验证。 |
| SCALE-T15 | PASS | A 的二次出处关系保全。 |
| SCALE-T16 | PASS | B 新题 105/105 关联到知识点节点。 |
| SCALE-T17 | PASS | 正式人工审核 0，原有地理争议和生物待核保留。 |
| SCALE-T18 | PASS | 实际导入因缺省分值中断，用同清单重放恢复。旧数据保全通过。 |
| SCALE-T19 | PASS | 已提交卷及题在同清单重放中恢复映射，数组与固定修订逐项核对。 |
| SCALE-T20 | PASS | A 的 320 条历史及当前修订逐项保全。 |
| SCALE-T21 | PASS | A 的 15 条固定引用逐项保全。 |
| SCALE-T22 | PARTIAL | 新英语资源为纸面练习，应用内听力 BLOCKED。 |
| SCALE-T23 | PASS | 恢复前后全库审计一致，结构异常 0。 |
| SCALE-T24 | PASS | Windows 九科各 3 道新增题实测。 |
| SCALE-T25 | PASS | 27 道应用原卷双向定位、编辑器附件和 PDF.js 画布实测。 |
| SCALE-T26 | PARTIAL | 双 PDF、单题 PDF、富文本公式/表格和收藏通过指定 Windows 用例。多知识点同时筛选 BLOCKED。 |
| SCALE-T27 | PASS | B 应用备份 848 个成员逐一验证。 |
| SCALE-T28 | PASS | 实际 Windows 界面预检、确认、关闭、重启及库切换。 |
| SCALE-T29 | PASS | 43 张业务表和 847 个资源逐项相等。 |
| SCALE-T30 | PASS | 脱敏交付。 |
| SCALE-T31 | PASS | 源码、换行、测试字节与原生 EXE 绑定。 |
| SCALE-T32 | PARTIAL | 71 个 Rust 库测试、9 个应用测试、37 个前端测试及 12 个 Node 内容桥回归通过。DEV-013 及 DEV-012 原生内容检查通过。部分旧脚本的硬编码测试标识仍阻断，Apple Silicon 实机未执行。 |

[EXPORT-T01 至 EXPORT-T15](CONTENT-004_PDF_EXPORT_TEST_RESULTS.md) · [Windows 脱敏日志](poc-001b/output/content004-b/windows-summary.json) · [恢复证据](poc-001b/output/content004-b/backup-restore-summary.json) · [源码绑定](poc-001b/output/content004-b/source-binding.json)
