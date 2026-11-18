use super::{Database, DbError, ErrorKind, Result};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

#[derive(Debug, PartialEq, Serialize)]
pub struct KnowledgePoint {
    pub id: String,
    pub subject_id: String,
    pub title: String,
    pub parent_id: Option<String>,
    pub origin: String,
    pub sort_order: i32,
    pub enabled: bool,
    pub aliases: Vec<String>,
    pub question_count: i64,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct KnowledgeLink {
    pub knowledge_id: String,
    pub original_id: String,
    pub title: String,
}

impl Database {
    pub fn knowledge_points(&self, subject: &str) -> Result<Vec<KnowledgePoint>> {
        let mut statement = self.connection.prepare(
            "SELECT k.id, k.subject_id, k.title, k.parent_id, k.origin, k.sort_order, k.enabled,
                    (SELECT json_group_array(alias ORDER BY alias) FROM effective_knowledge_alias WHERE knowledge_id = k.id),
                    (SELECT count(DISTINCT link.logical_id) FROM logical_question_knowledge link
                     JOIN current_question_revision r ON r.question_id = link.logical_id
                     WHERE link.knowledge_id = k.id AND k.enabled = 1)
             FROM effective_knowledge_point k WHERE k.subject_id = ?1
             ORDER BY k.sort_order, k.title, k.id",
        )?;
        let mut rows = statement.query([subject])?;
        let mut points = Vec::new();
        while let Some(row) = rows.next()? {
            let aliases: String = row.get(7)?;
            points.push(KnowledgePoint {
                id: row.get(0)?,
                subject_id: row.get(1)?,
                title: row.get(2)?,
                parent_id: row.get(3)?,
                origin: row.get(4)?,
                sort_order: row.get(5)?,
                enabled: row.get(6)?,
                aliases: serde_json::from_str(&aliases)
                    .map_err(|err| DbError::new(ErrorKind::Integrity, err.to_string()))?,
                question_count: row.get(8)?,
            });
        }
        Ok(points)
    }

    pub fn create_knowledge_point(
        &self,
        id: &str,
        subject: &str,
        parent: Option<&str>,
        title: &str,
    ) -> Result<()> {
        self.create_user_knowledge(id, subject, parent, title, 0)
    }

    pub fn create_user_knowledge(
        &self,
        id: &str,
        subject: &str,
        parent: Option<&str>,
        title: &str,
        sort_order: i32,
    ) -> Result<()> {
        let title = validate_label(title)?;
        self.connection.execute(
            "INSERT INTO knowledge_point(id, subject_id, parent_id, title, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, subject, parent, title, sort_order],
        )?;
        Ok(())
    }

    pub fn rename_user_knowledge(&self, id: &str, title: &str) -> Result<()> {
        let title = validate_label(title)?;
        let changed = self.connection.execute(
            "UPDATE knowledge_point SET title = ?2 WHERE id = ?1 AND origin = 'user'",
            params![id, title],
        )?;
        if changed == 0 {
            return Err(DbError::new(
                ErrorKind::Constraint,
                "只能重命名存在的用户知识点。公共标准知识点可添加别名或下级。",
            ));
        }
        Ok(())
    }

    pub fn add_knowledge_alias(&self, id: &str, alias: &str) -> Result<()> {
        self.connection.execute(
            "INSERT INTO knowledge_alias(knowledge_id, alias) VALUES (?1, ?2) ON CONFLICT DO NOTHING",
            params![id, validate_label(alias)?],
        )?;
        Ok(())
    }

    pub fn question_knowledge_ids(&self, question: &str) -> Result<Vec<String>> {
        let mut statement = self.connection.prepare(
            "SELECT knowledge_id FROM effective_question_knowledge WHERE question_id = ?1 ORDER BY knowledge_id",
        )?;
        let rows = statement.query_map([question], |row| row.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn question_knowledge_links(&self, question: &str) -> Result<Vec<KnowledgeLink>> {
        let mut statement = self.connection.prepare(
            "SELECT link.knowledge_id, link.original_id, k.title
             FROM logical_question_knowledge link JOIN effective_knowledge_point k ON k.id = link.knowledge_id
             WHERE link.logical_id = (SELECT logical_id FROM question_identity WHERE original_id = ?1)
             ORDER BY k.title, link.knowledge_id, link.original_id",
        )?;
        let rows = statement.query_map([question], |row| Ok(KnowledgeLink {
            knowledge_id: row.get(0)?, original_id: row.get(1)?, title: row.get(2)?,
        }))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn set_question_knowledge(
        &mut self,
        question: &str,
        point: &str,
        linked: bool,
    ) -> Result<()> {
        if !linked {
            let tx = self.connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            tx.execute(
                "DELETE FROM question_knowledge WHERE question_id = ?1 AND knowledge_id = ?2",
                params![question, point],
            )?;
            tx.execute(
                "INSERT INTO pack_knowledge_hidden(question_id, knowledge_id)
                 SELECT question_id, knowledge_id FROM effective_question_knowledge
                 WHERE question_id=?1 AND knowledge_id=?2 ON CONFLICT DO NOTHING",
                params![question, point],
            )?;
            tx.commit()?;
            return Ok(());
        }
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let subject: Option<String> = tx.query_row(
            "SELECT q.subject_id FROM question q JOIN knowledge_point k ON k.subject_id = q.subject_id
             WHERE q.id = ?1 AND k.id = ?2 AND k.enabled = 1",
            params![question, point],
            |row| row.get(0),
        ).optional()?;
        let subject = subject.ok_or_else(|| {
            DbError::new(ErrorKind::Constraint, "请选择与试题同学科的已启用知识点。")
        })?;
        tx.execute(
            "DELETE FROM pack_knowledge_hidden WHERE question_id=?1 AND knowledge_id=?2",
            params![question, point],
        )?;
        tx.execute(
            "INSERT INTO question_knowledge(question_id, knowledge_id, subject_id)
             VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING",
            params![question, point, subject],
        )?;
        tx.commit()?;
        Ok(())
    }
}

fn validate_label(label: &str) -> Result<&str> {
    let label = label.trim();
    if label.is_empty()
        || label.chars().take(121).count() > 120
        || label.chars().any(char::is_control)
    {
        return Err(DbError::new(
            ErrorKind::InvalidContent,
            "知识点名称和别名应包含 1–120 个字符。",
        ));
    }
    Ok(label)
}
