use super::{Database, DbError, ErrorKind, PaperDraft, PaperItem, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize)]
pub struct DraftToken {
    pub id: String,
    pub sequence: i64,
}

#[derive(Deserialize)]
pub struct DraftWrite {
    pub token: DraftToken,
    pub object_type: String,
    pub object_id: String,
    pub base_revision: Option<i64>,
    pub payload: Value,
    pub attachments: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DraftRecord {
    pub id: String,
    pub object_type: String,
    pub object_id: String,
    pub base_revision: Option<i64>,
    pub saved_at: String,
    pub sequence: i64,
    pub conflict: bool,
}

impl Database {
    pub fn put_draft(&mut self, draft: &DraftWrite) -> Result<bool> {
        validate_token(&draft.token)?;
        if !matches!(draft.object_type.as_str(), "question" | "composition")
            || draft.object_id.is_empty()
            || draft.object_id.len() > 200
            || !draft.payload.is_object()
            || draft.attachments.len() > 4096
            || (draft.object_type == "composition" && draft.base_revision.is_some())
        {
            return Err(invalid("草稿用途或内容无效。"));
        }
        let json = draft.payload.to_string();
        if json.len() > 16 * 1024 * 1024 {
            return Err(invalid("草稿超过 16 MiB，请缩小编辑内容。"));
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(base) = draft.base_revision {
            let id: String = tx.query_row(
                "SELECT question_id FROM question_revision WHERE id=?1",
                [base],
                |r| r.get(0),
            )?;
            if id != draft.object_id {
                return Err(invalid("草稿基准属于另一道题。"));
            }
        }
        let changed = tx.execute(
            "INSERT INTO edit_draft (id,object_type,object_id,base_revision,format_version,payload_json,sequence,state)
             VALUES (?1,?2,?3,?4,1,?5,?6,'active')
             ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sequence=excluded.sequence,
                 base_revision=excluded.base_revision,edited_at=CURRENT_TIMESTAMP,saved_at=CURRENT_TIMESTAMP
             WHERE edit_draft.state='active' AND excluded.sequence>edit_draft.sequence
                 AND edit_draft.object_type=excluded.object_type AND edit_draft.object_id=excluded.object_id",
            params![draft.token.id, draft.object_type, draft.object_id, draft.base_revision, json, draft.token.sequence],
        )?;
        if changed > 0 {
            tx.execute(
                "DELETE FROM draft_attachment WHERE draft_id=?1",
                [&draft.token.id],
            )?;
            for id in &draft.attachments {
                tx.execute(
                    "INSERT INTO draft_attachment VALUES (?1,?2) ON CONFLICT DO NOTHING",
                    params![draft.token.id, id],
                )?;
            }
        }
        tx.commit()?;
        Ok(changed > 0)
    }

    pub fn drafts(&self) -> Result<Vec<DraftRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT d.id,d.object_type,d.object_id,d.base_revision,d.saved_at,d.sequence,
              d.object_type='question' AND
              (d.base_revision IS NOT (SELECT id FROM current_question_revision r WHERE r.question_id=d.object_id))
             FROM edit_draft d WHERE d.state='active' ORDER BY d.saved_at DESC,d.rowid DESC",
        )?;
        let rows = statement.query_map([], |r| {
            Ok(DraftRecord {
                id: r.get(0)?,
                object_type: r.get(1)?,
                object_id: r.get(2)?,
                base_revision: r.get(3)?,
                saved_at: r.get(4)?,
                sequence: r.get(5)?,
                conflict: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn draft_payload(&self, id: &str) -> Result<Value> {
        let payload: String = self.connection.query_row(
            "SELECT payload_json FROM edit_draft WHERE id=?1 AND state='active'",
            [id],
            |r| r.get(0),
        )?;
        let mut query = self
            .connection
            .prepare("SELECT attachment_id FROM draft_attachment WHERE draft_id=?1")?;
        for value in query.query_map([id], |r| r.get::<_, String>(0))? {
            self.read_attachment(&value?, None)?;
        }
        let data: Value =
            serde_json::from_str(&payload).map_err(|_| invalid("草稿 JSON 无法读取。"))?;
        if let Some(file) = data
            .pointer("/screenshot/link/file_id")
            .and_then(Value::as_str)
        {
            self.paper_pdf(file)?;
        }
        Ok(data)
    }

    pub fn composition_draft_items(&self, draft: &PaperDraft) -> Result<Vec<PaperItem>> {
        let mut ids = Vec::new();
        let mut items = Vec::new();
        if let Some(parent) = &draft.previous_id {
            self.connection
                .query_row(
                    "SELECT 1 FROM composition WHERE id=?1",
                    [parent],
                    |_| Ok(()),
                )?;
        }
        let mut previous_group = 0;
        for item in &draft.items {
            let question = self.select_paper_question(item.revision_id, &ids)?;
            let group = super::paper_composition::validate_item(
                &question.revision,
                &item.points,
                &draft.settings,
            )?;
            if group < previous_group {
                return Err(invalid("组卷草稿题序与分组不一致。"));
            }
            previous_group = group;
            ids.push(item.revision_id);
            items.push(PaperItem {
                question,
                points: item.points.clone(),
            });
        }
        Ok(items)
    }

    pub fn discard_draft(&mut self, token: &DraftToken, kind: &str, target: &str) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        close_draft(&tx, token, kind, target)?;
        tx.commit()?;
        Ok(())
    }
}

pub(super) fn close_draft(
    db: &Connection,
    token: &DraftToken,
    kind: &str,
    target: &str,
) -> Result<()> {
    validate_token(token)?;
    let current: Option<(i64, String, String, String)> = db
        .query_row(
            "SELECT sequence,object_type,object_id,state FROM edit_draft WHERE id=?1",
            [&token.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    if let Some((sequence, object_type, object_id, state)) = current {
        if sequence > token.sequence
            || object_type != kind
            || object_id != target
            || state == "closed"
        {
            return Err(invalid("草稿已在其他操作中更新或关闭，请重新打开。"));
        }
    }
    db.execute(
        "INSERT INTO edit_draft(id,object_type,object_id,format_version,payload_json,sequence,state)
         VALUES (?1,?2,?3,1,'{}',?4,'closed')
         ON CONFLICT(id) DO UPDATE SET payload_json='{}',base_revision=NULL,sequence=excluded.sequence,state='closed'",
        params![token.id,kind,target,token.sequence],
    )?;
    db.execute(
        "DELETE FROM draft_attachment WHERE draft_id=?1",
        [&token.id],
    )?;
    Ok(())
}

fn validate_token(token: &DraftToken) -> Result<()> {
    if token.id.len() != 36
        || !token
            .id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        || !(1..=9_007_199_254_740_991).contains(&token.sequence)
    {
        return Err(invalid("草稿操作标识无效。"));
    }
    Ok(())
}

fn invalid(message: &str) -> DbError {
    DbError::new(ErrorKind::Conflict, message)
}
