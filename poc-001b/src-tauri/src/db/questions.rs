use super::{Database, DbError, ErrorKind, Result, RevisionContent};
use rusqlite::{params, OptionalExtension, Row, TransactionBehavior};
use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    Public,
    User,
}

impl Scope {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::User => "user",
        }
    }
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Revision {
    pub id: i64,
    pub question_id: String,
    pub base_revision_id: Option<i64>,
    pub scope: Scope,
    pub content: RevisionContent,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Subject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct QuestionSummary {
    pub id: String,
    pub subject_id: String,
    pub current_revision_id: Option<i64>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct RevisionSummary {
    pub id: i64,
    pub base_revision_id: Option<i64>,
    pub scope: Scope,
}

type StoredRevision = (i64, String, Option<i64>, String, i64, String);

impl Revision {
    pub(super) fn read_row(row: &Row<'_>) -> rusqlite::Result<StoredRevision> {
        Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
        ))
    }

    pub(super) fn decode(
        (id, question_id, base_revision_id, scope, version, json): StoredRevision,
    ) -> Result<Self> {
        let content = RevisionContent::from_json(&json)?;
        if version != i64::from(content.schema_version) {
            return Err(DbError::new(
                ErrorKind::Integrity,
                "富文本版本列与内容不一致。",
            ));
        }
        let scope = decode_scope(&scope)?;
        Ok(Self {
            id,
            question_id,
            base_revision_id,
            scope,
            content,
        })
    }
}

fn decode_scope(scope: &str) -> Result<Scope> {
    match scope {
        "public" => Ok(Scope::Public),
        "user" => Ok(Scope::User),
        _ => Err(DbError::new(ErrorKind::Integrity, "题目修订范围无效。")),
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct Counts {
    pub logical_questions: i64,
    pub current_parts: i64,
    pub occurrences: i64,
}

#[derive(Debug, Eq, PartialEq)]
pub struct Occurrence {
    pub paper_id: String,
    pub source_key: String,
    pub recorded_question_id: String,
}

impl Database {
    pub fn subjects(&self) -> Result<Vec<Subject>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name FROM subject ORDER BY CASE id
                WHEN 'chinese' THEN 1 WHEN 'math' THEN 2 WHEN 'english' THEN 3
                WHEN 'physics' THEN 4 WHEN 'chemistry' THEN 5 WHEN 'biology' THEN 6
                WHEN 'politics' THEN 7 WHEN 'history' THEN 8 WHEN 'geography' THEN 9 ELSE 10 END, id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(Subject {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn questions(&self) -> Result<Vec<QuestionSummary>> {
        self.recent_questions(-1)
    }

    pub fn recent_questions(&self, limit: i64) -> Result<Vec<QuestionSummary>> {
        let mut statement = self.connection.prepare(
            "SELECT q.id, q.subject_id, r.id FROM logical_question q
             LEFT JOIN current_question_revision r ON r.question_id = q.id
             ORDER BY r.id DESC, q.id LIMIT ?1",
        )?;
        let rows = statement.query_map([limit], |row| {
            Ok(QuestionSummary {
                id: row.get(0)?,
                subject_id: row.get(1)?,
                current_revision_id: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn revisions(&self, question: &str) -> Result<Vec<RevisionSummary>> {
        let mut statement = self.connection.prepare(
            "SELECT id, base_revision_id, scope FROM question_revision WHERE question_id = ?1 ORDER BY id DESC",
        )?;
        let rows = statement.query_map([question], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get::<_, String>(2)?))
        })?;
        rows.map(|row| {
            let (id, base_revision_id, scope) = row?;
            Ok(RevisionSummary {
                id,
                base_revision_id,
                scope: decode_scope(&scope)?,
            })
        })
        .collect()
    }

    pub fn create_subject(&self, id: &str, name: &str) -> Result<()> {
        self.connection.execute(
            "INSERT INTO subject (id, name) VALUES (?1, ?2)",
            params![id, name],
        )?;
        Ok(())
    }

    pub fn create_question(&self, id: &str, subject: &str) -> Result<()> {
        insert_question(&self.connection, id, subject)
    }

    pub fn create_paper(&self, id: &str, title: &str) -> Result<()> {
        self.connection.execute(
            "INSERT INTO paper (id, title) VALUES (?1, ?2)",
            params![id, title],
        )?;
        Ok(())
    }

    pub fn record_occurrence(&self, paper: &str, source_key: &str, question: &str) -> Result<()> {
        self.connection.execute("INSERT INTO question_occurrence (paper_id, source_key, question_id) VALUES (?1, ?2, ?3)",
            params![paper, source_key, question])?;
        Ok(())
    }

    pub fn confirm_duplicate(
        &self,
        duplicate: &str,
        canonical: &str,
        reviewer: &str,
        on: &str,
        evidence: &str,
    ) -> Result<()> {
        self.connection.execute(
            "INSERT INTO question_duplicate (duplicate_id, canonical_id, reviewer, confirmed_on, evidence)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![duplicate, canonical, reviewer, on, evidence],
        )?;
        Ok(())
    }

    pub fn occurrences_for(&self, canonical: &str) -> Result<Vec<Occurrence>> {
        let mut statement = self.connection.prepare(
            "SELECT paper_id, source_key, question_id FROM question_occurrence
             JOIN question_identity i ON i.original_id = question_id
             WHERE i.logical_id = (SELECT logical_id FROM question_identity WHERE original_id = ?1)
             ORDER BY paper_id, source_key",
        )?;
        let rows = statement.query_map([canonical], |row| {
            Ok(Occurrence {
                paper_id: row.get(0)?,
                source_key: row.get(1)?,
                recorded_question_id: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn counts(&self) -> Result<Counts> {
        Ok(self.connection.query_row(
            "SELECT count(*), coalesce(sum(json_array_length(r.content_json, '$.parts')), 0),
                    (SELECT count(*) FROM question_occurrence)
             FROM logical_question q
             LEFT JOIN current_question_revision r ON r.question_id = q.id",
            [],
            |row| {
                Ok(Counts {
                    logical_questions: row.get(0)?,
                    current_parts: row.get(1)?,
                    occurrences: row.get(2)?,
                })
            },
        )?)
    }

    pub fn append_revision(
        &mut self,
        question: &str,
        scope: Scope,
        base: Option<i64>,
        content: &RevisionContent,
    ) -> Result<i64> {
        let json = content.to_json()?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let id = insert_revision(
            &tx,
            &self.attachment_store,
            question,
            scope,
            base,
            content,
            &json,
        )?;
        tx.commit()?;
        Ok(id)
    }

    pub fn create_question_with_revision(
        &mut self,
        question: &str,
        subject: &str,
        content: &RevisionContent,
    ) -> Result<i64> {
        let json = content.to_json()?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        insert_question(&tx, question, subject)?;
        let id = insert_revision(
            &tx,
            &self.attachment_store,
            question,
            Scope::User,
            None,
            content,
            &json,
        )?;
        tx.commit()?;
        Ok(id)
    }

    pub fn append_user_revision(
        &mut self,
        question: &str,
        expected_current: Option<i64>,
        content: &RevisionContent,
    ) -> Result<i64> {
        let json = content.to_json()?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = tx
            .query_row(
                "SELECT id FROM current_question_revision WHERE question_id = ?1",
                [question],
                |row| row.get(0),
            )
            .optional()?;
        if current != expected_current {
            return Err(DbError::new(
                ErrorKind::Conflict,
                "当前修订已改变。请保留修改并检查最新修订后再继续。",
            ));
        }
        let id = insert_revision(
            &tx,
            &self.attachment_store,
            question,
            Scope::User,
            current,
            content,
            &json,
        )?;
        tx.commit()?;
        Ok(id)
    }

    pub fn current_revision(&self, question: &str) -> Result<Option<Revision>> {
        self.get_revision(
            "SELECT id, question_id, base_revision_id, scope, content_version, content_json
             FROM current_question_revision WHERE question_id = ?1",
            question,
        )
    }

    pub fn public_original(&self, question: &str) -> Result<Option<Revision>> {
        self.get_revision(
            "SELECT id, question_id, base_revision_id, scope, content_version, content_json
             FROM question_revision WHERE question_id = ?1 AND scope = 'public' ORDER BY id LIMIT 1",
            question,
        )
    }

    pub fn revision(&self, id: i64) -> Result<Option<Revision>> {
        self.get_revision(
            "SELECT id, question_id, base_revision_id, scope, content_version, content_json
             FROM question_revision WHERE id = ?1",
            id,
        )
    }

    fn get_revision(&self, sql: &str, key: impl rusqlite::ToSql) -> Result<Option<Revision>> {
        self.connection
            .query_row(sql, [key], Revision::read_row)
            .optional()?
            .map(Revision::decode)
            .transpose()
    }
}

fn insert_question(connection: &rusqlite::Connection, id: &str, subject: &str) -> Result<()> {
    connection.execute(
        "INSERT INTO question (id, subject_id) VALUES (?1, ?2)",
        params![id, subject],
    )?;
    Ok(())
}

fn insert_revision(
    connection: &rusqlite::Connection,
    store: &super::attachments::AttachmentStore,
    question: &str,
    scope: Scope,
    base: Option<i64>,
    content: &RevisionContent,
    json: &str,
) -> Result<i64> {
    for attachment in &content.attachments {
        store.verify_declaration(connection, attachment)?;
    }
    for part in &content.parts {
        connection.execute("INSERT INTO question_part (question_id, id) VALUES (?1, ?2) ON CONFLICT (question_id, id) DO NOTHING",
            params![question, part.id])?;
    }
    connection.execute(
        "INSERT INTO question_revision (question_id, scope, base_revision_id, content_version, content_json)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![question, scope.as_sql(), base, content.schema_version, json],
    )?;
    let id = connection.last_insert_rowid();
    for attachment in &content.attachments {
        connection.execute(
            "INSERT INTO revision_attachment(revision_id, attachment_id) VALUES (?1, ?2)",
            params![id, attachment.id],
        )?;
    }
    Ok(id)
}
