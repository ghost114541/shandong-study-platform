# CONTENT-002 私人来源清单 v1

侧车 JSON 保存在私人目录。数据库保留 Schema 9。命令需要 Python 3.11 以上，资源和数据库选择由调用者明确提供。

```powershell
python -B poc-001b/scripts/content002_trace_audit.py <study.sqlite3> <CONTENT-002_PRIVATE_TRACE.json> --private-root <私人素材根目录> --as-of 2026-11-24 --source-register CONTENT-001_SOURCE_REGISTER.csv
```

可选参数 `--source-register` 交叉核对登记 ID、来源及下载网址、取得日期、哈希、入库状态和使用范围。退出码 0 表示关联通过，1 表示至少一处关联异常，2 表示数据无法读取或根结构错误。详细输出可能含私人记录 ID、路径或其他关联标识，公开时仅保留脱敏聚合结果。

## 结构

- `version` 为 1。`paper_ids` 明确列出本次审计的逻辑原卷。审计检查范围内的数据库出现记录、PDF 版本和题目区域。
- `resources` 每条登记一个已入库 PDF 文件版本，字段为 `resource_id`、`source_url`、可选 `download_url`、`downloaded_sha256`、`subject_id`、`paper_id`、`paper_file_id`、`paper_file_role`、`page_count`、相对私人根目录的 `path`、`usage_scope`、`retrieved_on`、`imported_at`、`updated_at`。角色允许 `original`、`answer`、`analysis`。答案文件无题目 ID。候选素材由来源登记表管理。
- `links` 每条关联某一 PDF 原卷版本里的一个出现位置和一条具体修订。字段为 `resource_id`、`source_key`、`question_id`、整数 `revision_id`、有序 `regions`、可选 `answer_resource_id`、`answer_status`、`analysis_status`、`review_status`、`imported_at`、`updated_at`。区域含零基 `page_index` 和归一化 `rect=[x0,y0,x1,y1]`。日期字段为 ISO 日历日期。
- `compositions` 用保存时独立采集的 `composition_id` 和按顺序保存的 `items` 固定基线。每项写 `position`、`question_id`、`revision_id`。基线随组卷建立记录，重新审计时沿用。
- 回填真实审核须对比实际修订的 SQLite `verification_record`，并填写匹配的 `checked_at`、`reviewer`、`evidence`。审核状态为 `unreviewed`、`passed`、`disputed`、`failed` 或 `expired`。答案状态为 `present`、`missing` 或 `pending`。解析状态为 `complete`、`partial`、`missing` 或 `pending`。`complete` 表示整题或每个小问均录有解析字段，解析准确性与充分性仍由人工审核判断。

用户通过应用保存后，将输出的实际新修订 ID 追加到对应出处。用该修订的答案、解析及审核状态填写新条目，保留旧关联及组卷基线。修订快照保留内容版本，原卷区间读取应用当前保存的出现位置。若在应用中更正同一 PDF 版本的区域，侧车中该位置的各修订关联应更新为同一规范化区域，保留原文件版本记录。

审计以 SQLite 只读快照检查身份、文件角色、区域、修订祖先、审核和组卷固定引用。私人下载和应用资源库的受控副本均复算 SHA-256，与数据库登记比较。哈希一致可确认检查过的字节仍在，初次 PDF 完整性和答案事实核对由取证流程承担。DEC-039 的计数以 `question_identity.logical_id` 去重，别名或跨卷来源只增加出处。DEC-040 的正式状态读取指定日期时适用的修订级审核。DEC-041 通过当前修订视图及独立组卷快照核对。

## 原创合成示例

```json
{
  "version": 1,
  "paper_ids": ["sample-paper"],
  "resources": [
    {
      "resource_id": "sample-file",
      "source_url": "https://example.invalid/exam",
      "download_url": "https://example.invalid/exam.pdf",
      "downloaded_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "subject_id": "math",
      "paper_id": "sample-paper",
      "paper_file_id": "sample-pdf",
      "paper_file_role": "original",
      "page_count": 1,
      "path": "sample.pdf",
      "usage_scope": "PERSONAL_ONLY",
      "retrieved_on": "2026-11-24",
      "imported_at": "2026-11-24",
      "updated_at": "2026-11-24"
    }
  ],
  "links": [
    {
      "resource_id": "sample-file",
      "question_id": "sample-question",
      "revision_id": 7,
      "source_key": "1",
      "regions": [{"page_index": 0, "rect": [0.1, 0.2, 0.9, 0.4]}],
      "answer_status": "present",
      "analysis_status": "missing",
      "review_status": "unreviewed",
      "imported_at": "2026-11-24",
      "updated_at": "2026-11-24"
    }
  ],
  "compositions": [
    {
      "composition_id": "sample-composition",
      "items": [{"position": 1, "question_id": "sample-question", "revision_id": 7}]
    }
  ]
}
```
