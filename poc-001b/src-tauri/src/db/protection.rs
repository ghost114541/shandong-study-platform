use super::{check_integrity, Database, DbError, ErrorKind, Result, BUSY_TIMEOUT};
use rusqlite::{
    backup::{Backup, StepResult},
    Connection,
};
use std::{
    fs,
    path::Path,
    time::{Duration, Instant},
};

impl Database {
    /// Call while holding the application database guard. All managed resource
    /// writes share that guard, so the file inventory can use the same freeze.
    pub fn online_snapshot(
        &self,
        destination: &Path,
        mut progress: impl FnMut(u64, u64) -> Result<()>,
    ) -> Result<()> {
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map_err(file_error)?;
        drop(file);
        let mut snapshot = Connection::open(destination)?;
        snapshot.pragma_update(None, "synchronous", "FULL")?;
        let source = self.connection.unchecked_transaction()?;
        source.query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
            row.get::<_, i64>(0)
        })?;
        {
            let backup = Backup::new(&source, &mut snapshot)?;
            let start = Instant::now();
            loop {
                let state = backup.step(128)?;
                let stats = backup.progress();
                progress(
                    (stats.pagecount - stats.remaining).max(0) as u64,
                    stats.pagecount.max(0) as u64,
                )?;
                match state {
                    StepResult::Done => break,
                    StepResult::Busy | StepResult::Locked => {
                        if start.elapsed() >= BUSY_TIMEOUT {
                            return Err(DbError::new(
                                ErrorKind::Busy,
                                "数据库繁忙，无法完成在线快照。",
                            ));
                        }
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    _ => (),
                }
            }
        }
        source.commit()?;
        let mode: String =
            snapshot.query_row("PRAGMA journal_mode=DELETE", [], |row| row.get(0))?;
        if mode != "delete" {
            return Err(DbError::new(ErrorKind::Integrity, "快照未脱离 WAL。"));
        }
        check_integrity(&snapshot, true)?;
        snapshot.close().map_err(|(_, error)| error)?;
        fs::OpenOptions::new()
            .write(true)
            .open(destination)
            .and_then(|file| file.sync_all())
            .map_err(file_error)
    }
}

pub(super) fn file_error(error: std::io::Error) -> DbError {
    DbError::new(ErrorKind::FileAccess, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{attachments, migrations, DATABASE_FILENAME};

    #[test]
    fn dev010_t02_snapshot_has_committed_wal_and_excludes_open_transaction() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join(DATABASE_FILENAME);
        let db = Database::open(&path).unwrap();
        let writer = Connection::open(&path).unwrap();
        writer
            .execute_batch(
                "PRAGMA wal_autocheckpoint=0;
            INSERT INTO subject VALUES ('committed','已提交');
            BEGIN IMMEDIATE;
            INSERT INTO subject VALUES ('pending','未提交');",
            )
            .unwrap();
        assert!(path.with_extension("sqlite3-wal").metadata().unwrap().len() > 32);
        let snapshot = root.path().join("snapshot.sqlite3");
        db.online_snapshot(&snapshot, |_, _| Ok(())).unwrap();
        let raw = Connection::open(&snapshot).unwrap();
        let ids: String = raw
            .query_row(
                "SELECT group_concat(id) FROM subject WHERE id IN ('committed','pending')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ids, "committed");
        writer.execute_batch("ROLLBACK").unwrap();
        assert!(!snapshot.with_extension("sqlite3-wal").exists());
    }

    #[test]
    fn dev010_t01_upgrade_schema_eight_preserves_rows_and_migration_history() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join(DATABASE_FILENAME);
        let mut connection = Connection::open(&path).unwrap();
        migrations::migrate(&mut connection, &migrations::MIGRATIONS[..8]).unwrap();
        let old = Database {
            connection,
            attachment_store: attachments::AttachmentStore::for_database(&path),
        };
        old.connection
            .execute(
                "INSERT INTO question(id,subject_id) VALUES ('legacy','math')",
                [],
            )
            .unwrap();
        fn history(db: &Database) -> String {
            db.connection.query_row("SELECT group_concat(checksum || applied_at) FROM
                (SELECT checksum,applied_at FROM schema_migration WHERE version<=8 ORDER BY version)",
                [], |r| r.get(0)).unwrap()
        }
        let before = history(&old);
        drop(old);
        let new = Database::open(&path).unwrap();
        assert_eq!(new.schema_version().unwrap(), 9);
        assert_eq!(history(&new), before);
        assert!(new
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM question WHERE id='legacy')",
                [],
                |r| r.get::<_, bool>(0)
            )
            .unwrap());
        new.integrity_check().unwrap();
    }
}
