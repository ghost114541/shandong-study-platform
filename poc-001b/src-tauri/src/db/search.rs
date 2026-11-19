use super::{
    metadata::{invalid, label},
    Database, Result, ReviewStatus,
};
use rusqlite::{params_from_iter, types::Value};
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
    pub year_from: Option<i32>,
    pub year_to: Option<i32>,
    #[serde(default)]
    pub year_unknown: bool,
    pub region: Option<TextFilter>,
    pub source: Option<TextFilter>,
    pub difficulty: Option<u8>,
    pub question_type: Option<TextFilter>,
    pub tag: Option<TextFilter>,
    pub review_status: Option<ReviewStatus>,
    #[serde(default)]
    pub sort: SearchSort,
    #[serde(default)]
    pub descending: bool,
}

#[derive(Deserialize)]
#[serde(
    tag = "mode",
    content = "value",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum TextFilter {
    Exact(String),
    Missing,
}

#[derive(Default, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchSort {
    #[default]
    Id,
    Year,
    Difficulty,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct SearchHit {
    pub id: String,
    pub subject_id: String,
    pub current_revision_id: i64,
    pub snippet: String,
    pub question_type: Option<String>,
    pub difficulty: Option<u8>,
    pub source_label: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SearchPage {
    pub hits: Vec<SearchHit>,
    pub has_next: bool,
}

impl Database {
    pub fn search_questions(&self, query: &SearchQuery) -> Result<SearchPage> {
        let (sql, values) = search_plan(query)?;
        let mut statement = self.connection.prepare_cached(&sql)?;
        let rows = statement.query_map(params_from_iter(values), |row| {
            Ok(SearchHit {
                id: row.get(0)?,
                subject_id: row.get(1)?,
                current_revision_id: row.get(2)?,
                snippet: row.get(3)?,
                question_type: row.get(4)?,
                difficulty: row.get(5)?,
                source_label: row.get(6)?,
            })
        })?;
        let mut hits = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        let has_next = hits.len() > query.page_size as usize;
        hits.truncate(query.page_size as usize);
        Ok(SearchPage { hits, has_next })
    }
}

#[derive(Default)]
struct Bindings(Vec<Value>);

impl Bindings {
    fn add(&mut self, value: impl Into<Value>) -> String {
        self.0.push(value.into());
        format!("?{}", self.0.len())
    }

    fn text_filter(&mut self, column: &str, filter: &TextFilter) -> Result<String> {
        Ok(match filter {
            TextFilter::Exact(value) => {
                format!("{column} = {}", self.add(label(value)?.to_owned()))
            }
            TextFilter::Missing => format!("{column} IS NULL"),
        })
    }
}

const SOURCE_TABLES: &str =
    "question_members m JOIN question_occurrence o ON o.question_id = m.original_id
     JOIN visible_paper pm ON pm.id = o.paper_id";

pub(super) fn search_plan(query: &SearchQuery) -> Result<(String, Vec<Value>)> {
    let keyword = query.keyword.as_deref().unwrap_or_default().trim();
    if !keyword.is_empty() {
        label(keyword)?;
    }
    if !(1..=100).contains(&query.page_size) {
        return Err(invalid("每页应包含 1–100 道题。"));
    }
    let offset = i64::from(query.page) * i64::from(query.page_size);
    if offset > 1_000_000 {
        return Err(invalid("分页参数超出支持范围。"));
    }
    if [query.year_from, query.year_to]
        .into_iter()
        .flatten()
        .any(|n| !(1..=9999).contains(&n))
        || matches!((query.year_from, query.year_to), (Some(a), Some(b)) if a > b)
        || (query.year_unknown && (query.year_from.is_some() || query.year_to.is_some()))
    {
        return Err(invalid("请输入有效的年份范围，或只选择未标注年份。"));
    }
    if query.difficulty.is_some_and(|n| n > 5) {
        return Err(invalid("难度范围无效。"));
    }

    let mut binds = Bindings::default();
    let mut ctes = Vec::new();
    let mut conditions = Vec::new();
    if let Some(subject) = &query.subject_id {
        conditions.push(format!("q.subject_id = {}", binds.add(subject.clone())));
    }
    if let Some(point) = &query.knowledge_id {
        let point = binds.add(point.clone());
        let descendants = binds.add(i64::from(query.descendants));
        ctes.push(format!(
            "selected(id, subject_id) AS (
            SELECT id, subject_id FROM visible_knowledge WHERE id = {point} AND enabled = 1
            UNION
            SELECT k.id, k.subject_id FROM selected s
            JOIN visible_knowledge k ON k.subject_id = s.subject_id AND k.parent_id = s.id
            WHERE {descendants} AND k.enabled = 1
        )"
        ));
        conditions.push(
            "q.id IN (SELECT link.logical_id FROM selected s
                         JOIN logical_question_knowledge link ON link.knowledge_id = s.id)"
                .into(),
        );
    }
    let keyword_value = binds.add(keyword.to_owned());
    let keyword_position = format!("instr(lower(search.text), lower({keyword_value}))");
    if !keyword.is_empty() {
        conditions.push(format!("{keyword_position} > 0"));
    }
    if let Some(filter) = &query.question_type {
        conditions.push(binds.text_filter("search.question_type", filter)?);
    }
    if let Some(difficulty) = query.difficulty {
        conditions.push(if difficulty == 0 {
            "a.difficulty IS NULL".into()
        } else {
            format!("a.difficulty = {}", binds.add(i64::from(difficulty)))
        });
    }
    if let Some(tag) = &query.tag {
        let (operator, predicate) = match tag {
            TextFilter::Exact(tag) => (
                "IN",
                format!("WHERE t.tag = {}", binds.add(label(tag)?.to_owned())),
            ),
            TextFilter::Missing => ("NOT IN", String::new()),
        };
        conditions.push(format!(
            "q.id {operator} (SELECT m.logical_id FROM question_tag t
            JOIN question_members m ON m.original_id = t.question_id {predicate})"
        ));
    }

    let mut origin_conditions = Vec::new();
    if query.year_unknown {
        origin_conditions.push("pm.year IS NULL".into());
    }
    if let Some(year) = query.year_from {
        origin_conditions.push(format!("pm.year >= {}", binds.add(i64::from(year))));
    }
    if let Some(year) = query.year_to {
        origin_conditions.push(format!("pm.year <= {}", binds.add(i64::from(year))));
    }
    for (column, filter) in [("pm.region", &query.region), ("pm.source", &query.source)] {
        if let Some(filter) = filter {
            origin_conditions.push(binds.text_filter(column, filter)?);
        }
    }
    let origin_predicate = if origin_conditions.is_empty() {
        "1".into()
    } else {
        origin_conditions.join(" AND ")
    };
    let year_column = if !origin_conditions.is_empty() || query.sort == SearchSort::Year {
        ctes.push(format!(
            "matched_origins AS (
            SELECT m.logical_id, max(pm.year) AS sort_year FROM {SOURCE_TABLES}
            WHERE {origin_predicate} GROUP BY m.logical_id
        )"
        ));
        if !origin_conditions.is_empty() {
            let allow_empty = query.year_from.is_none()
                && query.year_to.is_none()
                && !matches!(query.region, Some(TextFilter::Exact(_)))
                && !matches!(query.source, Some(TextFilter::Exact(_)));
            let predicate = if allow_empty {
                "(y.logical_id IS NOT NULL OR NOT EXISTS (
                     SELECT 1 FROM question_members m JOIN question_occurrence o ON o.question_id = m.original_id
                     WHERE m.logical_id = q.id))"
            } else {
                "y.logical_id IS NOT NULL"
            };
            conditions.push(predicate.into());
        }
        (
            "y.sort_year",
            "LEFT JOIN matched_origins y ON y.logical_id = q.id",
        )
    } else {
        ("NULL", "")
    };

    let review_join = if let Some(review) = query.review_status {
        let expected = binds.add(review.as_sql().to_owned());
        conditions.push(format!(
            "(CASE
            WHEN v.id IS NULL THEN CASE WHEN EXISTS (
                SELECT 1 FROM verification_record WHERE revision_id = r.id
            ) THEN 'scheduled' ELSE 'unreviewed' END
            WHEN v.verdict = 'passed' AND v.expires_on < date('now') THEN 'expired'
            ELSE v.verdict END) = {expected}"
        ));
        "LEFT JOIN verification_record v ON v.id = (
            SELECT id FROM verification_record WHERE revision_id = r.id AND checked_on <= date('now')
            ORDER BY checked_on DESC, id DESC LIMIT 1)"
    } else {
        ""
    };

    let direction = if query.descending { "DESC" } else { "ASC" };
    let order = match query.sort {
        SearchSort::Id => format!("result_id {direction}"),
        SearchSort::Year => format!("sort_year IS NULL, sort_year {direction}, result_id ASC"),
        SearchSort::Difficulty => {
            format!("difficulty IS NULL, difficulty {direction}, result_id ASC")
        }
    };
    let predicate = if conditions.is_empty() {
        "1".into()
    } else {
        conditions.join(" AND ")
    };
    let limit = binds.add(i64::from(query.page_size + 1));
    let offset = binds.add(offset);
    ctes.push(format!(
        "page_rows AS MATERIALIZED (
        SELECT q.id AS result_id, q.subject_id, r.id AS revision_id,
               substr(search.text, max(1, {keyword_position} - 24), 140) AS snippet,
               search.question_type, a.difficulty, {} AS sort_year
        FROM visible_question q JOIN current_question_revision r ON r.question_id = q.id
        JOIN revision_search_text search ON search.revision_id = r.id
        LEFT JOIN question_annotation a ON a.question_id = q.id
        {} {review_join}
        WHERE {predicate} ORDER BY {order} LIMIT {limit} OFFSET {offset}
    )",
        year_column.0, year_column.1
    ));
    Ok((
        format!(
            "WITH RECURSIVE {}
        SELECT result_id, subject_id, revision_id, snippet, question_type, difficulty, (
            SELECT substr(trim(coalesce(pm.year || ' · ', '') || coalesce(pm.region || ' · ', '')
                || pm.title || coalesce(' · ' || pm.source, '')), 1, 180)
            FROM {SOURCE_TABLES}
            WHERE m.logical_id = page_rows.result_id AND {origin_predicate}
            ORDER BY pm.year IS NULL, pm.year DESC, o.paper_id, o.source_key LIMIT 1
        ) FROM page_rows ORDER BY {order}",
            ctes.join(", ")
        ),
        binds.0,
    ))
}
