# CONTENT-004-B 收尾验收矩阵

在 Windows 专用应用与隔离私人库实测。原 B 检查点矩阵和 PDF 专项矩阵保留历史结论。

| 编号 | 结果 | 实测依据 |
| --- | --- | --- |
| FINISH-T01 | PASS | 工作分支、远程 B 基线及 A、阶段基线的祖先关系核对。起始活动库与应用归档的 43 张业务表和 847 个资源一致。 |
| FINISH-T02 | PASS | 全库当前独立逻辑题 450。 |
| FINISH-T03 | PASS | B 相对 A 新增 135，其中收尾 30。 |
| FINISH-T04 | PASS | 语文增 10、英语增 13、物理增 4、化学增 3，九科覆盖。 |
| FINISH-T05 | PASS | 原 33 套合格完整卷逐套保留。选录卷按原适用边界登记。 |
| FINISH-T06 | PASS | 答案字段和来源均为 450/450。 |
| FINISH-T07 | PASS | B 批答案来源对应 135/135。 |
| FINISH-T08 | PASS | B 批完整解析 135/135。全库 375/450（83.33%）。 |
| FINISH-T09 | PASS | B 批实质解析核对通过 123/135（91.11%），门槛为 122。 |
| FINISH-T10 | PASS | 79 条新增通过记录绑定实际当前修订。3 道纠错由应用正常接口创建、回读并重新核对。正式人工审核 0。 |
| FINISH-T11 | PASS | 420 道既有题、425 条既有修订及 847 个原资源逐项比对。 |
| FINISH-T12 | PASS | 15 条历史固定引用完全保留，另有 2 条新抽检固定引用。 |
| FINISH-T13 | PASS | 两批预检无问题，重放恢复已有记录，无新增重复逻辑题。全库来源审计结构异常 0。 |
| FINISH-T14 | PASS | 四科各 2 道新题通过原生搜索、按裁区打开、题面附件加载及 PDF.js 原卷定位。 |
| FINISH-T15 | PASS | 语文共享题和物理电路题各 1 道。两份 PDF 的合法路径成功返回，两页均渲染并查看，固定修订、图片像素及文字逐项匹配。语文题面裁区可见上一段标题碎片，题面与四小问完整。 |
| FINISH-T16 | PASS | 实际应用备份、归档成员长度和哈希检查、应用预检、确认、重启及活动库切换。恢复前后业务表、资源及全库审计一致。 |
| FINISH-T17 | PASS | 指定基线、实测源码、执行字节和实际 EXE 哈希绑定。逐修订纠错使用私人测试辅助脚本及既有应用接口。 |
| FINISH-T18 | PASS | 提交文件仅含报告、来源元数据及汇总证据。原件、题面、答案、解析、截图、音频、数据库和备份单独保存在私人目录。 |

[Windows 抽检](poc-001b/output/content004-b-final/windows-summary.json) · [PDF 抽检](poc-001b/output/content004-b-final/pdf-export-summary.json) · [恢复比较](poc-001b/output/content004-b-final/backup-restore-summary.json) · [源码绑定](poc-001b/output/content004-b-final/source-binding.json)
