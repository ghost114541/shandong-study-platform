use super::{content::supported_version, Database, DbError, ErrorKind, Result, ReviewStatus};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FavoriteKind {
    Question,
    Paper,
    Knowledge,
}

impl FavoriteKind {
    fn key(self) -> &'static str {
        match self {
            Self::Question => "question",
            Self::Paper => "paper",
            Self::Knowledge => "knowledge",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FavoriteRef {
    pub kind: FavoriteKind,
    pub id: String,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum CollectionCommand {
    Create { name: String },
    Rename { id: String, name: String },
    Reorder { id: String, direction: i8 },
    Delete { id: String },
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum FavoriteCommand {
    Add {
        collection: String,
        targets: Vec<FavoriteRef>,
    },
    Remove {
        collection: String,
        target: FavoriteRef,
        expected_relations: Option<i64>,
    },
    Transfer {
        from: String,
        to: String,
        target: FavoriteRef,
        move_item: bool,
    },
    Mark {
        target: FavoriteRef,
        important: bool,
    },
}

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct FavoriteCounts {
    pub relations: i64,
    pub targets: i64,
    pub questions: i64,
    pub papers: i64,
    pub knowledge: i64,
    pub important: i64,
}

#[derive(Debug, Serialize)]
pub struct FavoriteCollection {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub counts: FavoriteCounts,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct FavoriteMembership {
    pub id: String,
    pub name: String,
    pub relations: i64,
}

#[derive(Debug, Serialize)]
pub struct FavoriteStatus {
    pub logical_id: String,
    pub important: bool,
    pub collections: Vec<FavoriteMembership>,
}

#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct FavoriteQuery {
    pub collection: Option<String>,
    pub kind: Option<FavoriteKind>,
    pub important: bool,
    pub keyword: String,
    pub sort: FavoriteSort,
    pub page: u32,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FavoriteSort {
    #[default]
    Recent,
    Name,
}

const PAGE_SIZE: u32 = 20;

// Uses the unique original identity and the existing canonical index for point lookups.
const RESOLVED_TARGETS: &str = "
    SELECT id FROM favorite_target WHERE kind = ?1 AND original_id = ?2
    UNION ALL
    SELECT t.id FROM question_duplicate d JOIN favorite_target t ON t.question_id = d.duplicate_id
    WHERE ?1 = 'question' AND d.canonical_id = ?2";

#[derive(Debug, Serialize)]
pub struct FavoritePage {
    pub items: Vec<FavoriteItem>,
    pub has_next: bool,
}

#[derive(Debug, Serialize)]
pub struct FavoritePaperVersion {
    pub id: String,
    pub name: String,
    pub pages: u32,
    pub available: bool,
}

#[derive(Debug, Serialize)]
pub struct FavoriteItem {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub added_at: String,
    pub important: bool,
    pub subject_id: Option<String>,
    pub subject: Option<String>,
    pub revision_id: Option<i64>,
    pub question_type: Option<String>,
    pub review: Option<ReviewStatus>,
    pub year: Option<i32>,
    pub region: Option<String>,
    pub parent: Option<String>,
    pub unavailable: Option<&'static str>,
    pub versions: Vec<FavoritePaperVersion>,
    pub collections: Vec<FavoriteMembership>,
}

const GROUPS: &str = "
    active AS MATERIALIZED (
        SELECT f.kind, f.logical_id, max(f.important) AS important
        FROM favorite_identity f
        GROUP BY f.kind, f.logical_id
    ),
    grouped AS (
        SELECT f.kind, f.logical_id, max(m.added_at) AS added_at, count(*) AS relations
        FROM favorite_member m JOIN favorite_identity f ON f.id = m.target_id
        WHERE m.collection_id = ?1 OR ?1 IS NULL
        GROUP BY f.kind, f.logical_id
    )";

impl Database {
    pub fn favorite_collections(&self) -> Result<Vec<FavoriteCollection>> {
        let mut query = self.connection.prepare(
            "WITH marked AS (
                SELECT kind, logical_id, max(important) AS important
                FROM favorite_identity GROUP BY kind, logical_id
             ), folded AS (
                SELECT m.collection_id, f.kind, f.logical_id, count(*) AS relations
                FROM favorite_member m JOIN favorite_identity f ON f.id = m.target_id
                GROUP BY m.collection_id, f.kind, f.logical_id
             ), counts AS (
                SELECT f.collection_id, sum(f.relations) AS relations, count(*) AS targets,
                   sum(f.kind = 'question') AS questions, sum(f.kind = 'paper') AS papers,
                   sum(f.kind = 'knowledge') AS knowledge, sum(marked.important) AS important
                FROM folded f JOIN marked USING (kind, logical_id) GROUP BY f.collection_id
             )
             SELECT c.id, c.name, c.is_default, coalesce(n.relations, 0), coalesce(n.targets, 0),
                coalesce(n.questions, 0), coalesce(n.papers, 0), coalesce(n.knowledge, 0), coalesce(n.important, 0)
             FROM favorite_collection c LEFT JOIN counts n ON n.collection_id = c.id
             ORDER BY c.sort_order, c.id",
        )?;
        let rows = query.query_map([], |row| {
            Ok(FavoriteCollection {
                id: row.get(0)?,
                name: row.get(1)?,
                is_default: row.get(2)?,
                counts: read_counts(row, 3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn favorite_counts(&self) -> Result<FavoriteCounts> {
        Ok(self.connection.query_row(
            &format!(
                "WITH {GROUPS}
             SELECT coalesce(sum(g.relations), 0), count(*),
                coalesce(sum(g.kind = 'question'), 0), coalesce(sum(g.kind = 'paper'), 0),
                coalesce(sum(g.kind = 'knowledge'), 0), coalesce(sum(a.important), 0)
             FROM grouped g JOIN active a USING (kind, logical_id)"
            ),
            [Option::<String>::None],
            |row| read_counts(row, 0),
        )?)
    }

    pub fn change_favorite_collection(&mut self, command: CollectionCommand) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        match command {
            CollectionCommand::Create { name } => {
                let name = collection_name(&tx, &name, None)?;
                tx.execute(
                    "INSERT INTO favorite_collection(name, sort_order)
                     SELECT ?1, coalesce(max(sort_order) + 1, 0) FROM favorite_collection",
                    [name],
                )?;
            }
            CollectionCommand::Rename { id, name } => {
                require_collection(&tx, &id)?;
                let name = collection_name(&tx, &name, Some(&id))?;
                tx.execute(
                    "UPDATE favorite_collection SET name = ?2,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                    params![id, name],
                )?;
            }
            CollectionCommand::Reorder { id, direction } => {
                if !matches!(direction, -1 | 1) {
                    return Err(invalid("收藏夹只能上移或下移一位。"));
                }
                let mut statement =
                    tx.prepare("SELECT id FROM favorite_collection ORDER BY sort_order, id")?;
                let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
                let mut ids = rows.collect::<rusqlite::Result<Vec<_>>>()?;
                let position = ids
                    .iter()
                    .position(|value| value == &id)
                    .ok_or_else(missing_collection)?;
                if let Some(next) = position
                    .checked_add_signed(direction.into())
                    .filter(|i| *i < ids.len())
                {
                    ids.swap(position, next);
                    let mut update = tx.prepare(
                        "UPDATE favorite_collection SET sort_order = ?2,
                         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                         WHERE id = ?1 AND sort_order <> ?2",
                    )?;
                    for (index, collection) in ids.iter().enumerate() {
                        update.execute(params![collection, index as i64])?;
                    }
                }
            }
            CollectionCommand::Delete { id } => {
                require_collection(&tx, &id)?;
                if id == "default" {
                    return Err(invalid("默认收藏夹不可删除。"));
                }
                tx.execute("DELETE FROM favorite_collection WHERE id = ?1", [&id])?;
                prune_targets(&tx)?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn change_favorites(&mut self, command: FavoriteCommand) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        match command {
            FavoriteCommand::Add {
                collection,
                targets,
            } => {
                require_collection(&tx, &collection)?;
                if targets.is_empty() || targets.len() > 500 {
                    return Err(invalid("每次请选择 1 至 500 项资源。"));
                }
                for target in &targets {
                    let id = logical_id(&tx, target)?;
                    let kind = target.kind.key();
                    if !membership_exists(&tx, &collection, kind, &id)? {
                        tx.prepare_cached(
                            "INSERT INTO favorite_target(question_id, paper_id, knowledge_id)
                             VALUES (CASE WHEN ?1 = 'question' THEN ?2 END,
                                CASE WHEN ?1 = 'paper' THEN ?2 END, CASE WHEN ?1 = 'knowledge' THEN ?2 END)
                             ON CONFLICT(kind, original_id) DO NOTHING",
                        )?.execute(params![kind, target.id])?;
                        tx.prepare_cached(
                            "INSERT INTO favorite_member(collection_id, target_id)
                             SELECT ?1, id FROM favorite_target WHERE kind = ?2 AND original_id = ?3",
                        )?.execute(params![collection, kind, target.id])?;
                    }
                }
            }
            FavoriteCommand::Remove {
                collection,
                target,
                expected_relations,
            } => {
                require_collection(&tx, &collection)?;
                let id = logical_id(&tx, &target)?;
                let removed = remove_members(&tx, &collection, target.kind.key(), &id)?;
                if removed != 0
                    && expected_relations
                        .is_some_and(|count| i64::try_from(removed).ok() != Some(count))
                {
                    return Err(DbError::new(
                        ErrorKind::Conflict,
                        "收藏关系已变化，请关闭对话框并重新确认。",
                    ));
                }
                prune_targets(&tx)?;
            }
            FavoriteCommand::Transfer {
                from,
                to,
                target,
                move_item,
            } => {
                require_collection(&tx, &from)?;
                require_collection(&tx, &to)?;
                let id = logical_id(&tx, &target)?;
                let kind = target.kind.key();
                if !membership_exists(&tx, &from, kind, &id)?
                    && !(move_item && membership_exists(&tx, &to, kind, &id)?)
                {
                    return Err(DbError::new(
                        ErrorKind::Missing,
                        "来源收藏已不存在，请刷新后重试。",
                    ));
                }
                if from != to {
                    tx.execute(
                        &format!(
                            "INSERT INTO favorite_member(collection_id, target_id, added_at)
                         SELECT ?4, m.target_id, CASE WHEN ?5 THEN m.added_at
                             ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END
                         FROM favorite_member m
                         WHERE m.collection_id = ?3 AND m.target_id IN ({RESOLVED_TARGETS})
                         ON CONFLICT(collection_id, target_id) DO NOTHING"
                        ),
                        params![kind, id, from, to, move_item],
                    )?;
                    if move_item {
                        remove_members(&tx, &from, kind, &id)?;
                    }
                }
            }
            FavoriteCommand::Mark { target, important } => {
                let id = logical_id(&tx, &target)?;
                let kind = target.kind.key();
                let exists = tx.query_row(
                    &format!(
                        "SELECT EXISTS (SELECT 1 FROM favorite_member
                     WHERE target_id IN ({RESOLVED_TARGETS}))"
                    ),
                    params![kind, id],
                    |row| row.get::<_, bool>(0),
                )?;
                if !exists {
                    return Err(invalid("请先收藏该资源。"));
                }
                tx.execute(
                    &format!(
                        "UPDATE favorite_target SET important = ?3
                     WHERE id IN ({RESOLVED_TARGETS})"
                    ),
                    params![kind, id, important],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn favorite_status(&self, target: &FavoriteRef) -> Result<FavoriteStatus> {
        let logical_id = logical_id(&self.connection, target)?;
        let kind = target.kind.key();
        let important = self.connection.prepare_cached(&format!(
            "SELECT coalesce(max(important), 0) FROM favorite_target WHERE id IN ({RESOLVED_TARGETS})",
        ))?.query_row(
            params![kind, logical_id], |row| row.get(0),
        )?;
        Ok(FavoriteStatus {
            collections: memberships(&self.connection, kind, &logical_id)?,
            important,
            logical_id,
        })
    }

    pub fn favorite_statuses(&self, targets: &[FavoriteRef]) -> Result<Vec<FavoriteStatus>> {
        if targets.len() > 500 {
            return Err(invalid("每次最多读取 500 项收藏状态。"));
        }
        targets
            .iter()
            .map(|target| self.favorite_status(target))
            .collect()
    }

    pub fn favorite_page(&self, query: &FavoriteQuery) -> Result<FavoritePage> {
        if let Some(id) = &query.collection {
            require_collection(&self.connection, id)?;
        }
        let keyword = query.keyword.trim();
        if keyword.chars().count() > 120 || keyword.chars().any(char::is_control) {
            return Err(invalid("收藏搜索最多 120 个字符，且不能包含控制字符。"));
        }
        let order = match query.sort {
            FavoriteSort::Recent => "added_at DESC, kind, logical_id",
            FavoriteSort::Name => "title COLLATE NOCASE, kind, logical_id",
        };
        let mut statement = self.connection.prepare(&format!(
            "WITH {GROUPS}, details AS (
                SELECT g.kind, g.logical_id, g.added_at, a.important,
                    coalesce(p.title, k.title, nullif(trim(substr(st.text, 1, 144)), ''), g.logical_id) AS title,
                    s.id AS subject_id, s.name AS subject, r.id AS revision_id,
                    st.question_type, p.year, p.region, parent.title AS parent, k.enabled, r.content_version
                FROM grouped g JOIN active a USING (kind, logical_id)
                LEFT JOIN effective_paper p ON g.kind = 'paper' AND p.id = g.logical_id
                LEFT JOIN effective_knowledge_point k ON g.kind = 'knowledge' AND k.id = g.logical_id
                LEFT JOIN effective_knowledge_point parent ON parent.id = k.parent_id
                LEFT JOIN question q ON g.kind = 'question' AND q.id = g.logical_id
                LEFT JOIN subject s ON s.id = coalesce(q.subject_id, p.subject_id, k.subject_id)
                LEFT JOIN current_question_revision r ON r.question_id = q.id
                LEFT JOIN revision_search_text st ON st.revision_id = r.id
                WHERE (?2 IS NULL OR g.kind = ?2) AND (NOT ?3 OR a.important)
                 AND (?4 = '' OR instr(lower(coalesce(st.text, p.title, k.title, '')), lower(?4)) > 0
                    OR instr(lower(g.logical_id), lower(?4)) > 0
                    OR instr(lower(coalesce(s.name, '')), lower(?4)) > 0
                    OR instr(lower(coalesce(st.question_type, p.region, parent.title, '')), lower(?4)) > 0
                    OR instr(coalesce(cast(p.year AS TEXT), ''), ?4) > 0
                    OR EXISTS (SELECT 1 FROM effective_knowledge_alias x WHERE x.knowledge_id = k.id
                        AND instr(lower(x.alias), lower(?4)) > 0))
             )
             SELECT * FROM details ORDER BY {order} LIMIT ?5 OFFSET ?6"
        ))?;
        let mut rows = statement.query(params![
            query.collection,
            query.kind.map(FavoriteKind::key),
            query.important,
            keyword,
            PAGE_SIZE + 1,
            i64::from(query.page) * i64::from(PAGE_SIZE),
        ])?;
        let mut items = Vec::new();
        while let Some(row) = rows.next()? {
            if items.len() == PAGE_SIZE as usize {
                return Ok(FavoritePage {
                    items,
                    has_next: true,
                });
            }
            let kind: String = row.get(0)?;
            let id: String = row.get(1)?;
            let revision_id: Option<i64> = row.get(7)?;
            let review = revision_id
                .map(|revision| self.review_today(revision).map(|(status, _)| status))
                .transpose()?;
            let versions = if kind == "paper" {
                self.favorite_paper_versions(&id)?
            } else {
                Vec::new()
            };
            let disabled = !row.get::<_, Option<bool>>(12)?.unwrap_or(true);
            let content_version = row.get::<_, Option<u32>>(13)?;
            let unavailable = match kind.as_str() {
                "question" if revision_id.is_none() => Some("试题暂无可读修订。"),
                "question" if !content_version.is_some_and(supported_version) => {
                    Some("试题修订格式暂不支持。")
                }
                "knowledge" if disabled => Some("知识点已停用。"),
                "paper" if versions.is_empty() => Some("试卷尚无原卷 PDF 版本。"),
                "paper" if !versions.iter().any(|version| version.available) => {
                    Some("原卷 PDF 文件缺失或无法读取。")
                }
                _ => None,
            };
            items.push(FavoriteItem {
                collections: memberships(&self.connection, &kind, &id)?,
                id,
                kind,
                revision_id,
                review,
                unavailable,
                versions,
                added_at: row.get(2)?,
                important: row.get(3)?,
                title: row.get(4)?,
                subject_id: row.get(5)?,
                subject: row.get(6)?,
                question_type: row.get(8)?,
                year: row.get(9)?,
                region: row.get(10)?,
                parent: row.get(11)?,
            });
        }
        Ok(FavoritePage {
            items,
            has_next: false,
        })
    }

    fn favorite_paper_versions(&self, paper: &str) -> Result<Vec<FavoritePaperVersion>> {
        let mut statement = self.connection.prepare(
            "SELECT id, original_name, page_count, sha256, byte_size FROM paper_file
             WHERE paper_id = ?1 AND role = 'original' ORDER BY imported_at DESC, rowid DESC",
        )?;
        let mut rows = statement.query([paper])?;
        let mut versions = Vec::new();
        while let Some(row) = rows.next()? {
            let hash: String = row.get(3)?;
            versions.push(FavoritePaperVersion {
                id: row.get(0)?,
                name: row.get(1)?,
                pages: row.get(2)?,
                available: self.paper_bytes_available(&hash, u64::from(row.get::<_, u32>(4)?)),
            });
        }
        Ok(versions)
    }
}

fn read_counts(row: &rusqlite::Row<'_>, offset: usize) -> rusqlite::Result<FavoriteCounts> {
    Ok(FavoriteCounts {
        relations: row.get(offset)?,
        targets: row.get(offset + 1)?,
        questions: row.get(offset + 2)?,
        papers: row.get(offset + 3)?,
        knowledge: row.get(offset + 4)?,
        important: row.get(offset + 5)?,
    })
}

fn invalid(message: &str) -> DbError {
    DbError::new(ErrorKind::InvalidContent, message)
}

fn missing_collection() -> DbError {
    DbError::new(ErrorKind::Missing, "收藏夹已不存在。")
}

fn require_collection(db: &Connection, id: &str) -> Result<()> {
    db.query_row(
        "SELECT 1 FROM favorite_collection WHERE id = ?1",
        [id],
        |_| Ok(()),
    )
    .optional()?
    .ok_or_else(missing_collection)
}

fn collection_name<'a>(db: &Connection, name: &'a str, id: Option<&str>) -> Result<&'a str> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(invalid(
            "收藏夹名称须为 1 至 80 个字符，且不能包含控制字符。",
        ));
    }
    if db.query_row(
        "SELECT EXISTS (SELECT 1 FROM favorite_collection WHERE name = ?1 AND id IS NOT ?2)",
        params![trimmed, id],
        |row| row.get::<_, bool>(0),
    )? {
        return Err(DbError::new(ErrorKind::Conflict, "已有同名收藏夹。"));
    }
    Ok(trimmed)
}

fn logical_id(db: &Connection, target: &FavoriteRef) -> Result<String> {
    let sql = match target.kind {
        FavoriteKind::Question => "SELECT logical_id FROM question_identity WHERE original_id = ?1",
        FavoriteKind::Paper => "SELECT id FROM paper WHERE id = ?1",
        FavoriteKind::Knowledge => "SELECT id FROM knowledge_point WHERE id = ?1",
    };
    db.prepare_cached(sql)?
        .query_row([&target.id], |row| row.get(0))
        .optional()?
        .ok_or_else(|| DbError::new(ErrorKind::Missing, "收藏资源不存在。"))
}

fn memberships(db: &Connection, kind: &str, id: &str) -> Result<Vec<FavoriteMembership>> {
    let mut statement = db.prepare_cached(&format!(
        "SELECT c.id, c.name, count(*) FROM favorite_member m
         JOIN favorite_collection c ON c.id = m.collection_id
         WHERE m.target_id IN ({RESOLVED_TARGETS}) GROUP BY c.id ORDER BY c.sort_order, c.id",
    ))?;
    let rows = statement.query_map(params![kind, id], |row| {
        Ok(FavoriteMembership {
            id: row.get(0)?,
            name: row.get(1)?,
            relations: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn membership_exists(db: &Connection, collection: &str, kind: &str, id: &str) -> Result<bool> {
    Ok(db
        .prepare_cached(&format!(
            "SELECT EXISTS (SELECT 1 FROM favorite_member
         WHERE collection_id = ?3 AND target_id IN ({RESOLVED_TARGETS}))",
        ))?
        .query_row(params![kind, id, collection], |row| row.get(0))?)
}

fn remove_members(db: &Connection, collection: &str, kind: &str, id: &str) -> Result<usize> {
    Ok(db.execute(
        &format!("DELETE FROM favorite_member WHERE collection_id = ?3 AND target_id IN ({RESOLVED_TARGETS})"),
        params![kind, id, collection],
    )?)
}

fn prune_targets(db: &Connection) -> Result<()> {
    // Retain a merged group's mark even if the originally marked membership was removed.
    // Once all its memberships are gone, remove the group's private collection state.
    db.execute(
        "WITH live AS MATERIALIZED (
            SELECT DISTINCT f.kind, f.logical_id
            FROM favorite_identity f JOIN favorite_member m ON m.target_id = f.id
         )
         DELETE FROM favorite_target WHERE id IN (
            SELECT f.id FROM favorite_identity f LEFT JOIN live USING (kind, logical_id)
            WHERE live.logical_id IS NULL
         )",
        [],
    )?;
    Ok(())
}
