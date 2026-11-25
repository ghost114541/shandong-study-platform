# CONTENT-004 截至 A 批次的验收矩阵

验收环境为专用 Windows 构建及恢复后的真实私人学习库。PASS（A）指当前 A 批次证据，阶段最终状态见各项与报告。

| 编号 | 状态 | 依据 |
| --- | --- | --- |
| SCALE-T01 | PASS | GitHub 分支和 Git 远程查询均确认授权基线。 |
| SCALE-T02 | PARTIAL | 315/750，道题以活动库逻辑题记录为准。 |
| SCALE-T03 | PARTIAL | 109/544，净增计算剔除两条重复逻辑题。 |
| SCALE-T04 | PASS（A） | 9 科均存在实际可用资源且均有新增。 |
| SCALE-T05 | PARTIAL | 各科实际数和差额见九科表。 |
| SCALE-T06 | PARTIAL | 25/45 套应用内完整卷，活动库 35 条卷记录。 |
| SCALE-T07 | PASS（A） | 315/315 来源记录完整，PDF 与外部音频分别验证。 |
| SCALE-T08 | PASS（A） | 逐份复查已导入 PDF 长度、页数和 SHA-256。 |
| SCALE-T09 | PASS（A） | 315/315 有答案字段，见质量摘要。 |
| SCALE-T10 | PASS（A） | 109/109 新题对应到参考来源与题号或材料区域。 |
| SCALE-T11 | PASS（A） | 109/109 有实质解析，逐题证据在私人区。 |
| SCALE-T12 | PARTIAL | 240/315（76.19%），未达到 85%。 |
| SCALE-T13 | PASS（A） | 来源与区域预检、题面附件哈希、跨卷文本比对和人工辅助判读。两处已知重复改为独立出现关系。提取不足的图片题仍有比较覆盖边界。 |
| SCALE-T14 | PASS（A） | 同一材料及多小问按顶层逻辑单元计。 |
| SCALE-T15 | PASS（A） | 两项英语第二出处进入独立出现关系，原修订来源保留。 |
| SCALE-T16 | PASS（A） | 新增题关联缺失为 0，并按实际考点人工辅助映射。 |
| SCALE-T17 | PASS（A） | 正式人工审核通过 0，内容核对另计。现有两项地理争议及两条生物待核留存。 |
| SCALE-T18 | PASS（A） | 保存两次中断证据，核对写入范围后完成原生恢复和重放。 |
| SCALE-T19 | PASS（A） | A 子批次重放复用卷与题。登记文件哈希一致。 |
| SCALE-T20 | PASS（A） | 211 条既有修订与基线逐行相等。 |
| SCALE-T21 | PASS（A） | 15 条既有固定引用及其修订逐行相等。 |
| SCALE-T22 | PASS（A） | 英语纸面、应用外练习音频和应用内支持状态分别登记。 |
| SCALE-T23 | PASS（A） | 恢复前后全库审计一致，结构异常 0。 |
| SCALE-T24 | PASS（A） | 九科查询找到实际新增标识，每科 3 道。 |
| SCALE-T25 | PASS（A） | 27 道实际打开，原卷反查并由题目回到 PDF.js 原卷画布。 |
| SCALE-T26 | PARTIAL | 抽查 PDF 内公式、图像和图表，以及知识点关联。富文本独立公式节点、结构化表格节点、多知识点筛选和收藏历史未在本次原生专项复跑。组卷导出实测缺少第三题的图片和解析。 |
| SCALE-T27 | PASS（A） | 应用内生成检查点备份，逐成员校验见恢复对比。 |
| SCALE-T28 | PASS（A） | 应用实际恢复预检、确认、关闭、启动和活动库切换。 |
| SCALE-T29 | PASS（A） | 43 张业务表与归档资源逐项一致。 |
| SCALE-T30 | PASS（A） | 提交范围为源码、元数据、统计与脱敏证据。 |
| SCALE-T31 | PASS（A） | Windows 执行文件、Git 源码及 EXE 哈希已绑定。窗口测试 Git blob 与执行字节差异来自一个 CRLF 行尾。 |
| SCALE-T32 | PASS（A） | Node 14 项、Python 35 项和 7 项原生身份拒绝回归。 |

[实测版本绑定](poc-001b/output/content004/source-binding.json) · [Windows 脱敏摘要](poc-001b/output/content004/windows-summary.json)
