use super::{Database, DbError, ErrorKind, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrashKind {
    Question,
    Knowledge,
    Paper,
}

impl TrashKind {
    fn name(self) -> &'static str {
        match self {
            Self::Question => "question",
            Self::Knowledge => "knowledge",
            Self::Paper => "paper",
        }
    }
}

#[derive(Serialize)]
pub struct TrashItem {
    pub id: i64,
    pub resource_type: String,
    pub target_id: String,
    pub deleted_at: String,
    pub context: Value,
}

impl Database {
    pub fn trash_items(&self) -> Result<Vec<TrashItem>> {
        let mut query = self.connection.prepare(
            "SELECT id,resource_type,target_id,deleted_at,context_json
            FROM trash_item WHERE restored_at IS NULL ORDER BY id DESC",
        )?;
        let rows = query.query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get::<_, String>(4)?,
            ))
        })?;
        let mut items = Vec::new();
        for row in rows {
            let (id, resource_type, target_id, deleted_at, context) = row?;
            let context =
                serde_json::from_str(&context).map_err(|_| invalid("回收站上下文损坏。"))?;
            items.push(TrashItem {
                id,
                resource_type,
                target_id,
                deleted_at,
                context,
            });
        }
        Ok(items)
    }

    pub fn move_to_trash(&mut self, kind: TrashKind, id: &str, operation: &str) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let context = describe_target(&tx, kind, id)?;
        match kind {
            TrashKind::Question => {
                if exists(
                    &tx,
                    "SELECT EXISTS(SELECT 1 FROM question_duplicate WHERE duplicate_id=?1)",
                    id,
                )? {
                    return Err(invalid(
                        "此试题属于人工确认的同题组。请从题库选择其主试题。",
                    ));
                }
                if exists(&tx, "SELECT EXISTS(SELECT 1 FROM question_members m
                    WHERE m.logical_id=?1 AND (
                        EXISTS(SELECT 1 FROM pack_question_owner o WHERE o.question_id=m.original_id)
                     OR EXISTS(SELECT 1 FROM question_revision r WHERE r.question_id=m.original_id AND r.scope='public')))", id)? {
                    return Err(invalid("公共试题及包含公共试题的同题组受保护。"));
                }
            }
            TrashKind::Knowledge => {
                if exists(
                    &tx,
                    "SELECT EXISTS(SELECT 1 FROM visible_knowledge WHERE parent_id=?1)",
                    id,
                )? {
                    return Err(invalid("请先处理仍在知识库中显示的子知识点。"));
                }
            }
            TrashKind::Paper => (),
        }
        tx.execute(
            "INSERT INTO trash_item(resource_type,target_id,operation_id,context_json)
             VALUES (?1,?2,?3,?4)",
            params![kind.name(), id, operation, context.to_string()],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn restore_trash(&mut self, item: i64) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (kind, target, stored): (String, String, String) = tx.query_row(
            "SELECT resource_type,target_id,context_json FROM trash_item WHERE id=?1 AND restored_at IS NULL",
            [item], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let kind = match kind.as_str() {
            "question" => TrashKind::Question,
            "knowledge" => TrashKind::Knowledge,
            "paper" => TrashKind::Paper,
            _ => return Err(invalid("未知的回收站资源类型。")),
        };
        let current = describe_target(&tx, kind, &target)?;
        let previous: Value =
            serde_json::from_str(&stored).map_err(|_| invalid("回收站上下文损坏。"))?;
        if current["subject"] != previous["subject"] {
            return Err(invalid("资源学科已变化，请检查原记录后再恢复。"));
        }
        match kind {
            TrashKind::Knowledge => {
                if let Some(parent) = current["parent"].as_str() {
                    if !exists(
                        &tx,
                        "SELECT EXISTS(SELECT 1 FROM visible_knowledge WHERE id=?1 AND enabled=1)",
                        parent,
                    )? {
                        return Err(invalid("请先恢复或启用父知识点。"));
                    }
                }
            }
            TrashKind::Question => {
                if exists(
                    &tx,
                    "SELECT EXISTS(SELECT 1 FROM question_duplicate WHERE duplicate_id=?1)",
                    &target,
                )? {
                    return Err(invalid("同题归属已变化，请检查人工重复题映射。"));
                }
                if exists(
                    &tx,
                    "SELECT EXISTS(SELECT 1 FROM question_occurrence o
                    JOIN trash_item t ON t.target_id=o.paper_id AND t.resource_type='paper'
                    WHERE o.question_id=?1 AND t.restored_at IS NULL)",
                    &target,
                )? {
                    return Err(invalid("请先恢复此题关联的原始试卷。"));
                }
                super::backup::check_related_files(
                    &tx,
                    self.attachment_store.base_path(),
                    &target,
                    false,
                )?;
            }
            TrashKind::Paper => super::backup::check_related_files(
                &tx,
                self.attachment_store.base_path(),
                &target,
                true,
            )?,
        }
        tx.execute(
            "UPDATE trash_item SET restored_at=CURRENT_TIMESTAMP WHERE id=?1",
            [item],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn clear_trash(&self) -> Result<()> {
        if self.trash_items()?.is_empty() {
            return Ok(());
        }
        Err(invalid(
            "本版本保留回收站中的资源和历史引用。请逐项恢复。清空操作已阻止。",
        ))
    }
}

fn describe_target(connection: &Connection, kind: TrashKind, id: &str) -> Result<Value> {
    let sql = match kind {
        TrashKind::Question => "SELECT q.subject_id, NULL, q.id FROM question q WHERE q.id=?1
            AND NOT EXISTS(SELECT 1 FROM pack_question_owner WHERE question_id=q.id)
            AND NOT EXISTS(SELECT 1 FROM question_revision WHERE question_id=q.id AND scope='public')",
        TrashKind::Knowledge => "SELECT k.subject_id, k.parent_id, k.title FROM knowledge_point k
            WHERE k.id=?1 AND k.origin='user'
            AND NOT EXISTS(SELECT 1 FROM pack_knowledge_owner WHERE knowledge_id=k.id)",
        TrashKind::Paper => "SELECT p.subject_id, NULL, p.title FROM paper p WHERE p.id=?1
            AND NOT EXISTS(SELECT 1 FROM pack_paper_owner WHERE paper_id=p.id)",
    };
    let (subject, parent, label): (Option<String>, Option<String>, String) = connection
        .query_row(sql, [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?
        .ok_or_else(|| invalid("资源不存在，或属于受保护的公共内容。"))?;
    let sql = match kind {
        TrashKind::Question => [
            "SELECT count(*) FROM favorite_target WHERE kind='question' AND original_id IN
                (SELECT original_id FROM question_members WHERE logical_id=?1)",
            "SELECT count(*) FROM question_occurrence WHERE question_id IN
                (SELECT original_id FROM question_members WHERE logical_id=?1)",
            "SELECT count(*) FROM effective_question_knowledge WHERE question_id IN
                (SELECT original_id FROM question_members WHERE logical_id=?1)",
            "SELECT count(*) FROM composition_item i JOIN question_revision r ON r.id=i.revision_id
                JOIN question_members m ON m.original_id=r.question_id WHERE m.logical_id=?1",
            "SELECT count(*) FROM question_duplicate WHERE canonical_id=?1",
            "SELECT count(*) FROM edit_draft WHERE object_id=?1 AND object_type='question' AND state='active'",
        ],
        TrashKind::Knowledge => [
            "SELECT count(*) FROM favorite_target WHERE kind='knowledge' AND original_id=?1",
            "SELECT 0 WHERE ?1 IS NOT NULL",
            "SELECT count(*) FROM effective_question_knowledge WHERE knowledge_id=?1",
            "SELECT 0 WHERE ?1 IS NOT NULL",
            "SELECT 0 WHERE ?1 IS NOT NULL",
            "SELECT 0 WHERE ?1 IS NOT NULL",
        ],
        TrashKind::Paper => [
            "SELECT count(*) FROM favorite_target WHERE kind='paper' AND original_id=?1",
            "SELECT count(*) FROM question_occurrence WHERE paper_id=?1",
            "SELECT 0 WHERE ?1 IS NOT NULL",
            "SELECT 0 WHERE ?1 IS NOT NULL",
            "SELECT 0 WHERE ?1 IS NOT NULL",
            "SELECT 0 WHERE ?1 IS NOT NULL",
        ],
    };
    let counts = sql
        .into_iter()
        .map(|query| connection.query_row(query, [id], |r| r.get::<_, i64>(0)))
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(json!({ "label":label, "subject":subject, "parent":parent,
        "favorites":counts[0], "occurrences":counts[1], "knowledge_links":counts[2],
        "compositions":counts[3], "duplicates":counts[4], "drafts":counts[5] }))
}

fn exists(connection: &Connection, sql: &str, id: &str) -> Result<bool> {
    Ok(connection.query_row(sql, [id], |r| r.get(0))?)
}

fn invalid(message: &str) -> DbError {
    DbError::new(ErrorKind::Conflict, message)
}
