# DEV-006 Schema 5

Schema 5 扩展原有的 `composition` 和 `composition_item`。迁移 1 至 4 沿用原文件和校验记录，新迁移由原有事务迁移器登记，并与 `PRAGMA user_version = 5` 一起提交。

| 表 | 新增列 | 含义 |
| --- | --- | --- |
| `composition` | `settings_json` | 学科或范围、可选时长、题距、作答空间、按顺序保存的分组名称。纸张固定为 A4。 |
| `composition` | `previous_id` | 直接上一版的组卷 ID。每次保存都分配独立 ID，独立组卷及副本留空。 |
| `composition` | `item_count` | 配置组卷的预期条目数。SQLite 拦截超出保存范围的插入，Rust 读取时验证数量和位置连续性。 |
| `composition_item` | `settings_json` | 条目分组、整题整数分值及按固定修订小问顺序排列的整数分值。 |

组卷标题及创建时间沿用原表。条目继续使用 `(composition_id, position)` 和指向 `(question_id, revision_id)` 的复合外键。保存用立即事务同时写入表头及全部条目，并在提交前回读。现有条目触发器保护固定引用，新触发器保护表头并限制配置组卷的条目范围。Rust 校验有效分组、组序、修订所有权、主逻辑题去重和小问分值汇总。

DEV-001 历史组卷的四个新列保持空值。读取时沿用原顺序、原固定修订及其原始整数分值，使用默认 A4、4 mm 题距、0 mm 作答空间和单一「试题」分组。用户从旧卷建立新组卷时，新副本使用显式 Schema 5 配置。若历史条目后来被认定属于同一主逻辑题，旧卷仍按原组成打开，新保存的普通组卷必须先移除重复项。

升级依据见 [Windows 测试记录](DEV-006_TEST_RESULTS.md) 和 [迁移源码](poc-001b/src-tauri/migrations/0005_composition.sql)。
