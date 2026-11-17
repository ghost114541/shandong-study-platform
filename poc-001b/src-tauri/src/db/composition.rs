use super::{Database, DbError, ErrorKind, Result, Revision};
use rusqlite::{params, Connection, TransactionBehavior};

#[derive(Debug, PartialEq)]
pub struct SavedItem {
    pub position: i64,
    pub revision: Revision,
}

#[derive(Debug, PartialEq)]
pub struct Composition {
    pub id: String,
    pub title: String,
    pub items: Vec<SavedItem>,
}

impl Database {
    pub fn save_composition(&mut self, id: &str, title: &str, revisions: &[i64]) -> Result<()> {
        if revisions.is_empty() {
            return Err(DbError::new(
                ErrorKind::InvalidContent,
                "组卷至少需要一道题。",
            ));
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT INTO composition(id, title) VALUES (?1, ?2)",
            params![id, title],
        )?;
        for (index, revision_id) in revisions.iter().enumerate() {
            let inserted = tx.execute(
                "INSERT INTO composition_item(composition_id, position, question_id, revision_id)
                 SELECT ?1, ?2, question_id, id FROM question_revision WHERE id = ?3",
                params![id, (index + 1) as i64, revision_id],
            )?;
            if inserted != 1 {
                return Err(DbError::new(
                    ErrorKind::Missing,
                    format!("找不到组卷所需修订 {revision_id}。"),
                ));
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn load_composition(&mut self, id: &str) -> Result<Composition> {
        let tx = self.connection.transaction()?;
        let title = tx.query_row("SELECT title FROM composition WHERE id = ?1", [id], |row| {
            row.get(0)
        })?;
        let items = load_fixed_items(&tx, id)?;
        tx.commit()?;
        Ok(Composition {
            id: id.to_owned(),
            title,
            items,
        })
    }
}

pub(super) fn load_fixed_items(db: &Connection, id: &str) -> Result<Vec<SavedItem>> {
    let mut statement = db.prepare(
        "SELECT r.id, r.question_id, r.base_revision_id, r.scope, r.content_version, r.content_json,
                i.position, i.revision_id
         FROM composition_item i LEFT JOIN question_revision r
           ON r.question_id = i.question_id AND r.id = i.revision_id
         WHERE i.composition_id = ?1 ORDER BY i.position",
    )?;
    let mut rows = statement.query([id])?;
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        if row.get::<_, Option<i64>>(0)?.is_none() {
            let id: i64 = row.get(7)?;
            return Err(DbError::new(
                ErrorKind::Missing,
                format!("已保存组卷缺少固定修订 {id}，或修订归属不符。"),
            ));
        }
        items.push(SavedItem {
            position: row.get(6)?,
            revision: Revision::decode(Revision::read_row(row)?)?,
        });
    }
    if items.is_empty() {
        return Err(DbError::new(ErrorKind::Integrity, "已保存组卷没有题目。"));
    }
    Ok(items)
}
