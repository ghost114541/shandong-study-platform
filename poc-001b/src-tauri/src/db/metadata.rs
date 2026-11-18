use super::{Database, DbError, ErrorKind, Result};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PaperMetadata {
    pub year: Option<i32>,
    pub region: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct PaperOccurrence {
    pub paper_id: String,
    pub original_id: String,
    pub position: String,
    pub title: String,
    #[serde(flatten)]
    pub metadata: PaperMetadata,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct QuestionMetadata {
    pub difficulty: Option<u8>,
    pub tags: Vec<String>,
    pub inherited_tags: Vec<String>,
    pub origins: Vec<PaperOccurrence>,
}

impl Database {
    pub fn question_metadata(&self, question: &str) -> Result<QuestionMetadata> {
        let logical: String = self.connection.query_row(
            "SELECT logical_id FROM question_identity WHERE original_id = ?1",
            [question],
            |r| r.get(0),
        )?;
        let difficulty = self
            .connection
            .query_row(
                "SELECT difficulty FROM question_annotation WHERE question_id = ?1",
                [&logical],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        let mut tag_query = self.connection.prepare(
            "SELECT t.tag, t.question_id FROM question_members m JOIN question_tag t ON t.question_id = m.original_id
             WHERE m.logical_id = ?1 ORDER BY t.tag",
        )?;
        let mut rows = tag_query.query([&logical])?;
        let mut tags = Vec::new();
        let mut inherited_tags = BTreeSet::new();
        while let Some(row) = rows.next()? {
            let tag: String = row.get(0)?;
            if row.get::<_, String>(1)? == logical {
                tags.push(tag);
            } else {
                inherited_tags.insert(tag);
            }
        }
        let mut origin_query = self.connection.prepare(
            "SELECT o.paper_id, o.question_id, o.source_key, p.title, p.year, p.region, p.source
             FROM question_members m JOIN question_occurrence o ON o.question_id = m.original_id
             JOIN effective_paper p ON p.id = o.paper_id
             WHERE m.logical_id = ?1 ORDER BY p.year IS NULL, p.year DESC, o.paper_id, o.source_key",
        )?;
        let origins = origin_query
            .query_map([&logical], |r| {
                Ok(PaperOccurrence {
                    paper_id: r.get(0)?,
                    original_id: r.get(1)?,
                    position: r.get(2)?,
                    title: r.get(3)?,
                    metadata: PaperMetadata {
                        year: r.get(4)?,
                        region: r.get(5)?,
                        source: r.get(6)?,
                    },
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(QuestionMetadata {
            difficulty,
            tags,
            inherited_tags: inherited_tags.into_iter().collect(),
            origins,
        })
    }

    pub fn save_question_metadata(
        &mut self,
        question: &str,
        difficulty: Option<u8>,
        tags: &[String],
    ) -> Result<()> {
        if difficulty.is_some_and(|d| !(1..=5).contains(&d)) || tags.len() > 32 {
            return Err(invalid("难度须为 1–5 或未标注，每题最多 32 个本地标签。"));
        }
        let tags = tags
            .iter()
            .map(|tag| label(tag))
            .collect::<Result<BTreeSet<_>>>()?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let logical: String = tx.query_row(
            "SELECT logical_id FROM question_identity WHERE original_id = ?1",
            [question],
            |r| r.get(0),
        )?;
        tx.execute(
            "INSERT INTO question_annotation(question_id, difficulty) VALUES (?1, ?2)
             ON CONFLICT(question_id) DO UPDATE SET difficulty = excluded.difficulty",
            params![logical, difficulty],
        )?;
        tx.execute(
            "DELETE FROM question_tag WHERE question_id = ?1",
            [&logical],
        )?;
        for tag in tags {
            tx.execute(
                "INSERT INTO question_tag(question_id, tag) VALUES (?1, ?2)",
                params![logical, tag],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn add_paper_occurrence(
        &mut self,
        question: &str,
        paper: &str,
        title: Option<&str>,
        position: &str,
    ) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(title) = title {
            tx.execute(
                "INSERT INTO paper(id, title) VALUES (?1, ?2)",
                params![label(paper)?, label(title)?],
            )?;
        }
        tx.execute("INSERT INTO question_occurrence(paper_id, source_key, question_id) VALUES (?1, ?2, ?3)",
                   params![label(paper)?, label(position)?, question])?;
        tx.commit()?;
        Ok(())
    }

    pub fn save_paper_metadata(&mut self, paper: &str, expected: &PaperMetadata, meta: &PaperMetadata) -> Result<()> {
        if meta.year.is_some_and(|year| !(1..=9999).contains(&year)) {
            return Err(invalid("年份须为 1–9999 或未标注。"));
        }
        let clean = |value: &Option<String>| -> Result<Option<String>> {
            value
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(|v| label(v).map(str::to_owned))
                .transpose()
        };
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = tx.query_row(
            "SELECT year, region, source FROM effective_paper WHERE id = ?1",
            [paper],
            |r| Ok(PaperMetadata { year: r.get(0)?, region: r.get(1)?, source: r.get(2)? }),
        )?;
        if &current != expected {
            return Err(DbError::new(ErrorKind::Conflict, "原卷标注已在别处更新。请先重新读取原卷标注。"));
        }
        tx.execute(
            "INSERT INTO paper_user_metadata(paper_id, year, region, source) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(paper_id) DO UPDATE SET year = excluded.year, region = excluded.region, source = excluded.source",
            params![paper, meta.year, clean(&meta.region)?, clean(&meta.source)?],
        )?;
        tx.commit()?;
        Ok(())
    }
}

pub(super) fn label(value: &str) -> Result<&str> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().take(121).count() > 120
        || value.chars().any(char::is_control)
    {
        return Err(invalid("请填写 1–120 个字符，内容不能含控制字符。"));
    }
    Ok(value)
}

pub(super) fn invalid(message: &str) -> DbError {
    DbError::new(ErrorKind::InvalidContent, message)
}
