use super::{composition::load_fixed_items, Database, DbError, ErrorKind, Result, Revision};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaperSettings {
    pub scope: String,
    pub duration_minutes: Option<u16>,
    pub gap_mm: u8,
    pub answer_space_mm: u8,
    pub groups: Vec<String>,
}

impl Default for PaperSettings {
    fn default() -> Self {
        Self {
            scope: String::new(),
            duration_minutes: None,
            gap_mm: 4,
            answer_space_mm: 0,
            groups: vec!["试题".into()],
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaperPoints {
    pub group: String,
    pub score: u32,
    pub part_scores: Vec<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaperSelection {
    pub revision_id: i64,
    pub points: PaperPoints,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaperDraft {
    pub title: String,
    pub previous_id: Option<String>,
    pub settings: PaperSettings,
    pub items: Vec<PaperSelection>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct PaperHeader {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub previous_id: Option<String>,
    pub legacy: bool,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct PaperQuestion {
    pub revision: Revision,
    pub logical_id: String,
    pub subject: String,
    pub snippet: String,
    pub summary: String,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct PaperItem {
    pub question: PaperQuestion,
    pub points: PaperPoints,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct SavedPaper {
    pub header: PaperHeader,
    pub settings: PaperSettings,
    pub items: Vec<PaperItem>,
}

fn invalid(message: impl Into<String>) -> DbError {
    DbError::new(ErrorKind::InvalidContent, message)
}

const MAX_ITEMS: usize = 500;

fn validate_settings(title: &str, settings: &PaperSettings) -> Result<()> {
    let mut unique = HashSet::new();
    if title.trim().is_empty()
        || title.chars().count() > 160
        || settings.scope.chars().count() > 160
        || settings
            .duration_minutes
            .is_some_and(|time| !(1..=1440).contains(&time))
        || settings.gap_mm > 20
        || settings.answer_space_mm > 60
        || settings.groups.is_empty()
        || settings.groups.len() > 50
        || settings.groups.iter().any(|name| {
            name.trim().is_empty()
                || name.trim() != name
                || name.chars().count() > 40
                || !unique.insert(name)
        })
    {
        return Err(invalid("请检查试卷标题、时间、版式和唯一的分组名称。"));
    }
    Ok(())
}

fn validate_item(
    revision: &Revision,
    points: &PaperPoints,
    settings: &PaperSettings,
) -> Result<usize> {
    if points.part_scores.len() != revision.content.parts.len()
        || (!points.part_scores.is_empty()
            && points
                .part_scores
                .iter()
                .map(|&score| u64::from(score))
                .sum::<u64>()
                != u64::from(points.score))
    {
        return Err(invalid(format!(
            "修订 #{} 的小问分值与整题分值不一致。",
            revision.id
        )));
    }
    settings
        .groups
        .iter()
        .position(|group| group == &points.group)
        .ok_or_else(|| invalid("题目的分组不存在。"))
}

const HEADER: &str =
    "SELECT id, title, created_at, previous_id, settings_json IS NULL FROM composition";

fn header(row: &rusqlite::Row<'_>) -> rusqlite::Result<PaperHeader> {
    Ok(PaperHeader {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
        previous_id: row.get(3)?,
        legacy: row.get(4)?,
    })
}

fn question(db: &Connection, revision: Revision) -> Result<PaperQuestion> {
    let (logical_id, subject, snippet, summary) = db.query_row(
        "SELECT COALESCE(d.canonical_id, q.id), s.name, substr(COALESCE(t.text, ''), 1, 100),
                COALESCE((SELECT group_concat(title, '、') FROM (
                    SELECT DISTINCT k.title FROM question_knowledge l JOIN knowledge_point k ON k.id = l.knowledge_id
                    WHERE l.question_id = q.id OR l.question_id = d.canonical_id
                    ORDER BY k.title LIMIT 3
                )), (SELECT '来源 ' || p.title || ' · ' || o.source_key
                     FROM question_occurrence o JOIN paper p ON p.id = o.paper_id
                     WHERE o.question_id = q.id OR o.question_id = d.canonical_id
                     ORDER BY p.title, o.source_key LIMIT 1), '')
         FROM question q JOIN subject s ON s.id = q.subject_id
         LEFT JOIN question_duplicate d ON d.duplicate_id = q.id
         LEFT JOIN revision_search_text t ON t.revision_id = ?2 WHERE q.id = ?1",
        params![revision.question_id, revision.id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    Ok(PaperQuestion {
        revision,
        logical_id,
        subject,
        snippet,
        summary,
    })
}

fn json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|error| invalid(error.to_string()))
}

fn decode<T: serde::de::DeserializeOwned>(value: &str) -> Result<T> {
    serde_json::from_str(value)
        .map_err(|error| DbError::new(ErrorKind::Integrity, format!("组卷配置无法读取：{error}")))
}

impl Database {
    pub fn create_composed_paper(&mut self, draft: &PaperDraft) -> Result<SavedPaper> {
        let id: String =
            self.connection
                .query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))?;
        self.save_paper(&id, draft)
    }

    pub fn select_paper_question(
        &self,
        revision_id: i64,
        existing: &[i64],
    ) -> Result<PaperQuestion> {
        if existing.len() >= MAX_ITEMS {
            return Err(invalid("组卷篮最多容纳 500 道题。"));
        }
        let tx = self.connection.unchecked_transaction()?;
        let selected = question(&tx, pinned_revision(&tx, revision_id)?)?;
        let mut logical = tx.prepare(
            "SELECT COALESCE(d.canonical_id, r.question_id)
             FROM question_revision r LEFT JOIN question_duplicate d ON d.duplicate_id = r.question_id
             WHERE r.id = ?1",
        )?;
        for id in existing {
            let id: String = logical.query_row([id], |row| row.get(0))?;
            if id == selected.logical_id {
                return Err(invalid("这道逻辑题已在组卷篮中。"));
            }
        }
        Ok(selected)
    }

    pub fn latest_paper_question(&self, question_id: &str) -> Result<PaperQuestion> {
        let revision = self
            .current_revision(question_id)?
            .ok_or_else(|| DbError::new(ErrorKind::Missing, "当前没有可用的题目修订。"))?;
        question(&self.connection, revision)
    }

    pub fn list_papers(&self) -> Result<Vec<PaperHeader>> {
        let mut statement = self
            .connection
            .prepare(&format!("{HEADER} ORDER BY created_at DESC, rowid DESC"))?;
        let papers = statement
            .query_map([], header)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(papers)
    }

    pub fn save_paper(&mut self, id: &str, draft: &PaperDraft) -> Result<SavedPaper> {
        let title = draft.title.trim();
        validate_settings(title, &draft.settings)?;
        if !(1..=MAX_ITEMS).contains(&draft.items.len()) {
            return Err(invalid("每份新组卷须包含 1 至 500 道题。"));
        }

        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT INTO composition(id, title, settings_json, previous_id, item_count)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id,
                title,
                json(&draft.settings)?,
                draft.previous_id,
                draft.items.len() as i64
            ],
        )?;
        let mut logical_ids = HashSet::new();
        let mut previous_group = 0;
        for (index, item) in draft.items.iter().enumerate() {
            let revision = pinned_revision(&tx, item.revision_id)?;
            let group = validate_item(&revision, &item.points, &draft.settings)?;
            let question = question(&tx, revision)?;
            if !logical_ids.insert(question.logical_id) {
                return Err(invalid("组卷包含同一道逻辑题，请移除重复项。"));
            }
            if group < previous_group {
                return Err(invalid("题目顺序须与分组顺序一致。"));
            }
            previous_group = group;
            tx.execute(
                "INSERT INTO composition_item(composition_id, position, question_id, revision_id, settings_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, (index + 1) as i64, question.revision.question_id, item.revision_id, json(&item.points)?],
            )?;
        }
        let saved = load_paper(&tx, id)?;
        tx.commit()?;
        Ok(saved)
    }

    pub fn load_paper(&mut self, id: &str) -> Result<SavedPaper> {
        let tx = self.connection.transaction()?;
        let paper = load_paper(&tx, id)?;
        tx.commit()?;
        Ok(paper)
    }
}

fn pinned_revision(db: &Connection, id: i64) -> Result<Revision> {
    let row = db
        .query_row(
            "SELECT id, question_id, base_revision_id, scope, content_version, content_json
         FROM question_revision WHERE id = ?1",
            [id],
            Revision::read_row,
        )
        .optional()?
        .ok_or_else(|| DbError::new(ErrorKind::Missing, format!("找不到组卷所需修订 {id}。")))?;
    Revision::decode(row)
}

fn load_paper(db: &Connection, id: &str) -> Result<SavedPaper> {
    let sql = format!("{HEADER} WHERE id = ?1");
    let header = db.query_row(&sql, [id], header)?;
    let (config, count): (Option<String>, Option<i64>) = db.query_row(
        "SELECT settings_json, item_count FROM composition WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let settings: PaperSettings = config
        .as_deref()
        .map(decode)
        .transpose()?
        .unwrap_or_default();
    if !header.legacy {
        validate_settings(&header.title, &settings)?;
    }
    let mut statement = db.prepare(
        "SELECT settings_json FROM composition_item
         WHERE composition_id = ?1 ORDER BY position",
    )?;
    let configs = statement
        .query_map([id], |row| row.get::<_, Option<String>>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let fixed = load_fixed_items(db, id)?;
    if configs.len() != fixed.len()
        || (!header.legacy && count != Some(fixed.len() as i64))
        || (header.legacy && count.is_some())
    {
        return Err(DbError::new(
            ErrorKind::Integrity,
            "已保存组卷的题目数量不完整。",
        ));
    }
    let mut items = Vec::new();
    let mut previous_group = 0;
    for (item, config) in fixed.into_iter().zip(configs) {
        if item.position != items.len() as i64 + 1 {
            return Err(DbError::new(ErrorKind::Integrity, "组卷题序损坏。"));
        }
        let revision = item.revision;
        let points = match (config, header.legacy) {
            (Some(config), false) => decode(&config)?,
            (None, true) => PaperPoints {
                group: settings.groups[0].clone(),
                score: revision.content.score,
                part_scores: revision
                    .content
                    .parts
                    .iter()
                    .map(|part| part.score)
                    .collect(),
            },
            _ => return Err(DbError::new(ErrorKind::Integrity, "组卷条目配置不完整。")),
        };
        let group = validate_item(&revision, &points, &settings)?;
        if group < previous_group {
            return Err(DbError::new(ErrorKind::Integrity, "已保存的分组顺序损坏。"));
        }
        previous_group = group;
        items.push(PaperItem {
            question: question(db, revision)?,
            points,
        });
    }
    Ok(SavedPaper {
        header,
        settings,
        items,
    })
}
