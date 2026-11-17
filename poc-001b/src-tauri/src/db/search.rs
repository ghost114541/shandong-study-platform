use super::{Database, DbError, ErrorKind, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchQuery {
    pub subject_id: Option<String>,
    pub knowledge_id: Option<String>,
    pub keyword: Option<String>,
    pub descendants: bool,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct SearchHit {
    pub id: String,
    pub subject_id: String,
    pub current_revision_id: i64,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
pub struct SearchPage {
    pub hits: Vec<SearchHit>,
    pub has_next: bool,
}

impl Database {
    pub fn search_questions(&self, query: &SearchQuery) -> Result<SearchPage> {
        let keyword = query.keyword.as_deref().unwrap_or_default().trim();
        if keyword.chars().take(121).count() > 120 || keyword.chars().any(char::is_control) {
            return Err(DbError::new(
                ErrorKind::InvalidContent,
                "搜索关键词最多 120 个字符，且不能包含控制字符。",
            ));
        }
        if !(1..=100).contains(&query.page_size) {
            return Err(DbError::new(
                ErrorKind::InvalidContent,
                "每页应包含 1–100 道题。",
            ));
        }
        let offset = i64::from(query.page) * i64::from(query.page_size);
        if offset > 1_000_000 {
            return Err(DbError::new(
                ErrorKind::InvalidContent,
                "分页参数超出支持范围。",
            ));
        }

        let sql = search_sql(
            query.subject_id.is_some(),
            query.knowledge_id.is_some(),
            !keyword.is_empty(),
        );
        let mut statement = self.connection.prepare_cached(&sql)?;
        let rows = statement.query_map(
            params![
                query.subject_id,
                query.knowledge_id,
                query.descendants,
                keyword,
                query.page_size + 1,
                offset
            ],
            |row| {
                Ok(SearchHit {
                    id: row.get(0)?,
                    subject_id: row.get(1)?,
                    current_revision_id: row.get(2)?,
                    snippet: row.get(3)?,
                })
            },
        )?;
        let mut hits = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        let has_next = hits.len() > query.page_size as usize;
        hits.truncate(query.page_size as usize);
        Ok(SearchPage { hits, has_next })
    }
}

pub(super) fn search_sql(subject: bool, knowledge: bool, keyword: bool) -> String {
    let mut sql = String::new();
    if knowledge {
        sql.push_str(
            "WITH RECURSIVE selected(id, subject_id) AS (
                SELECT id, subject_id FROM knowledge_point WHERE id = ?2 AND enabled = 1
                UNION
                SELECT k.id, k.subject_id FROM selected s
                JOIN knowledge_point k ON k.subject_id = s.subject_id AND k.parent_id = s.id
                WHERE ?3 AND k.enabled = 1
             ) ",
        );
    }
    sql.push_str(
        "SELECT q.id, q.subject_id, r.id,
                substr(search.text, max(1, instr(lower(search.text), lower(?4)) - 24), 140)
         FROM logical_question q JOIN current_question_revision r ON r.question_id = q.id
         JOIN revision_search_text search ON search.revision_id = r.id
         WHERE 1 ",
    );
    if subject {
        sql.push_str("AND q.subject_id = ?1 ");
    }
    if knowledge {
        sql.push_str(
            "AND q.id IN (
                SELECT link.logical_id FROM selected s JOIN logical_question_knowledge link ON link.knowledge_id = s.id
             ) ",
        );
    }
    if keyword {
        sql.push_str("AND instr(lower(search.text), lower(?4)) > 0 ");
    }
    sql.push_str("ORDER BY q.id LIMIT ?5 OFFSET ?6");
    sql
}
