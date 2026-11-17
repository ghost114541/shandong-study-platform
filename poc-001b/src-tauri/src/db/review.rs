use super::{Database, DbError, ErrorKind, Result};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Passed,
    Disputed,
    Failed,
}

impl Verdict {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Passed => "passed",
            Self::Disputed => "disputed",
            Self::Failed => "failed",
        }
    }

    fn from_sql(value: &str) -> Result<Self> {
        match value {
            "passed" => Ok(Self::Passed),
            "disputed" => Ok(Self::Disputed),
            "failed" => Ok(Self::Failed),
            _ => Err(DbError::new(ErrorKind::Integrity, "未知审核结论。")),
        }
    }
}

pub struct ReviewInput<'a> {
    pub reviewer: &'a str,
    pub checked_on: &'a str,
    pub evidence: &'a str,
    pub verdict: Verdict,
    pub expires_on: Option<&'a str>,
    pub review_of: Option<i64>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct Review {
    pub id: i64,
    pub revision_id: i64,
    pub reviewer: String,
    pub checked_on: String,
    pub evidence: String,
    pub verdict: Verdict,
    pub expires_on: Option<String>,
    pub review_of: Option<i64>,
}

impl Database {
    pub fn record_review(&mut self, revision: i64, review: ReviewInput<'_>) -> Result<i64> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let json: String = tx.query_row(
            "SELECT content_json FROM question_revision WHERE id = ?1",
            [revision],
            |row| row.get(0),
        )?;
        if review.verdict == Verdict::Passed
            && !super::RevisionContent::from_json(&json)?.has_answers()
        {
            return Err(DbError::new(
                ErrorKind::InvalidContent,
                "通过审核要求整题或全部小问具有答案。",
            ));
        }
        tx.execute(
            "INSERT INTO verification_record
                (revision_id, reviewer, checked_on, evidence, verdict, expires_on, review_of)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                revision,
                review.reviewer,
                review.checked_on,
                review.evidence,
                review.verdict.as_sql(),
                review.expires_on,
                review.review_of
            ],
        )?;
        let id = tx.last_insert_rowid();
        tx.commit()?;
        Ok(id)
    }

    pub fn latest_review(&self, revision: i64) -> Result<Option<Review>> {
        self.connection.query_row(
            "SELECT id, revision_id, reviewer, checked_on, evidence, verdict, expires_on, review_of
             FROM verification_record WHERE revision_id = ?1 ORDER BY id DESC LIMIT 1",
            [revision],
            |row| Ok((
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?,
                row.get::<_, String>(5)?, row.get(6)?, row.get(7)?,
            )),
        ).optional()?.map(|(id, revision_id, reviewer, checked_on, evidence, verdict, expires_on, review_of)| {
            Ok(Review { id, revision_id, reviewer, checked_on, evidence, verdict: Verdict::from_sql(&verdict)?, expires_on, review_of })
        }).transpose()
    }

    pub fn verified_current_count(&self, as_of: &str) -> Result<i64> {
        let valid_date: bool =
            self.connection
                .query_row("SELECT date(?1, '+0 days') IS ?1", [as_of], |row| {
                    row.get(0)
                })?;
        if !valid_date {
            return Err(DbError::new(
                ErrorKind::InvalidContent,
                "统计日期必须使用有效的 YYYY-MM-DD。",
            ));
        }
        Ok(self.connection.query_row(
            "SELECT count(*)
             FROM current_question_revision AS current
             JOIN verification_record AS review ON review.id = (
                 SELECT id FROM verification_record
                 WHERE revision_id = current.id AND checked_on <= ?1
                 ORDER BY checked_on DESC, id DESC LIMIT 1
             )
             WHERE review.verdict = 'passed' AND (review.expires_on IS NULL OR review.expires_on >= ?1)
               AND NOT EXISTS (
                   SELECT 1 FROM question_duplicate WHERE duplicate_id = current.question_id
               )",
            [as_of], |row| row.get(0),
        )?)
    }
}
