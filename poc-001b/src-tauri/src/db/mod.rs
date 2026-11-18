mod attachments;
mod composition;
mod content;
mod error;
mod favorites;
mod knowledge;
mod metadata;
mod migrations;
mod paper_composition;
mod paper_files;
mod paper_print;
mod questions;
mod review;
mod search;

pub use attachments::{AttachmentIntegrity, MAX_IMAGE_BYTES};
pub use composition::{Composition, SavedItem};
pub use content::{Attachment, PartContent, RevisionContent, CONTENT_VERSION};
pub use error::{DbError, ErrorKind, Result};
pub use favorites::{
    CollectionCommand, FavoriteCollection, FavoriteCommand, FavoriteCounts, FavoritePage,
    FavoriteQuery, FavoriteRef, FavoriteStatus,
};
pub use knowledge::{KnowledgeLink, KnowledgePoint};
pub use metadata::{PaperMetadata, PaperOccurrence, QuestionMetadata};
pub use paper_files::{ImportPaper, Location, PaperFile, PaperRecord, PdfRegion, RegionLink};
pub use paper_composition::{PaperDraft, PaperHeader, PaperItem, PaperPoints, PaperQuestion, PaperSelection, PaperSettings, SavedPaper};
pub use paper_print::{CompositionPrintSnapshot, PreparedPrintPair, PrintPair};
pub use questions::{Counts, Occurrence, QuestionSummary, Revision, RevisionSummary, Scope, Subject};
pub use review::{Review, ReviewInput, ReviewStatus, Verdict};
pub use search::{SearchHit, SearchPage, SearchQuery, SearchSort, TextFilter};

use rusqlite::Connection;
use std::{fs, path::Path, time::Duration};

pub const DATABASE_FILENAME: &str = "study.sqlite3";
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

pub struct Database {
    connection: Connection,
    attachment_store: attachments::AttachmentStore,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            fs::create_dir_all(parent).map_err(|error| {
                DbError::new(
                    ErrorKind::FileAccess,
                    format!("创建数据库目录失败。{error}"),
                )
            })?;
        }
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(BUSY_TIMEOUT)?;
        connection.pragma_update(None, "foreign_keys", true)?;
        connection.pragma_update(None, "recursive_triggers", true)?;
        migrations::apply(&mut connection)?;
        let journal: String =
            connection.query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
        if !journal.eq_ignore_ascii_case("wal") {
            return Err(DbError::new(
                ErrorKind::FileAccess,
                format!("无法启用 WAL，实际模式为 {journal}。"),
            ));
        }
        connection.pragma_update(None, "synchronous", "FULL")?;
        Ok(Self {
            connection,
            attachment_store: attachments::AttachmentStore::for_database(path),
        })
    }

    pub fn schema_version(&self) -> Result<i32> {
        Ok(self
            .connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))?)
    }

    pub fn integrity_check(&self) -> Result<()> {
        check_integrity(&self.connection, true)
    }
}

fn check_integrity(connection: &Connection, full: bool) -> Result<()> {
    let query = if full {
        "PRAGMA integrity_check"
    } else {
        "PRAGMA quick_check"
    };
    let mut statement = connection.prepare(query)?;
    let mut rows = statement.query([])?;
    let first: String = rows
        .next()?
        .ok_or_else(|| DbError::new(ErrorKind::Integrity, "SQLite 完整性检查无结果。"))?
        .get(0)?;
    if first != "ok" || rows.next()?.is_some() {
        return Err(DbError::new(
            ErrorKind::Integrity,
            format!("SQLite 完整性检查失败。{first}"),
        ));
    }
    let mut statement = connection.prepare("PRAGMA foreign_key_check")?;
    if let Some(row) = statement.query([])?.next()? {
        let table: String = row.get(0)?;
        return Err(DbError::new(
            ErrorKind::Integrity,
            format!("表 {table} 存在失效的外键引用。"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod favorites_tests;
#[cfg(test)]
mod paper_tests;
