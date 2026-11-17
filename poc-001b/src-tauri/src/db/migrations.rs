use super::{DbError, ErrorKind, Result};
use rusqlite::{params, Connection, TransactionBehavior};
use sha2::{Digest, Sha256};

const APPLICATION_ID: i32 = 0x53484431;

pub(super) struct Migration {
    pub version: i32,
    pub name: &'static str,
    pub sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "core",
    sql: include_str!("../../migrations/0001_core.sql"),
}];

pub(super) fn apply(connection: &mut Connection) -> Result<()> {
    migrate(connection, MIGRATIONS)
}

fn migrate(connection: &mut Connection, migrations: &[Migration]) -> Result<()> {
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let app_id: i32 = tx.query_row("PRAGMA application_id", [], |row| row.get(0))?;
    let current: i32 = tx.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if !(0..=migrations.len() as i32).contains(&current)
        || (current > 0 && app_id != APPLICATION_ID)
        || (current == 0 && app_id != 0)
    {
        return Err(DbError::new(
            ErrorKind::IncompatibleDatabase,
            format!("无法打开数据库，应用标识 {app_id:#x}，Schema 版本 {current}。"),
        ));
    }
    if current == 0 {
        let objects: i64 = tx.query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
            [],
            |row| row.get(0),
        )?;
        if objects != 0 {
            return Err(DbError::new(
                ErrorKind::IncompatibleDatabase,
                "数据库已有未识别的表或索引。",
            ));
        }
        tx.execute_batch(
            "CREATE TABLE schema_migration (
                version INTEGER PRIMARY KEY CHECK (version > 0),
                name TEXT NOT NULL UNIQUE,
                checksum TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) STRICT;",
        )?;
        tx.pragma_update(None, "application_id", APPLICATION_ID)?;
    }
    let history = {
        let mut query = tx
            .prepare("SELECT version, name, checksum FROM schema_migration ORDER BY version")
            .map_err(|error| {
                let error = DbError::from(error);
                if error.kind == ErrorKind::Sqlite {
                    DbError::new(ErrorKind::Migration, format!("缺少有效迁移历史。{error}"))
                } else {
                    error
                }
            })?;
        let rows = query.query_map([], |row| {
            Ok((
                row.get::<_, i32>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    if history.len() != current as usize {
        return Err(DbError::new(
            ErrorKind::Migration,
            "迁移历史与数据库版本不一致。",
        ));
    }
    for (index, migration) in migrations.iter().enumerate() {
        let version = (index + 1) as i32;
        let checksum = Sha256::digest(migration.sql.replace("\r\n", "\n"))
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        if migration.version != version {
            return Err(DbError::new(ErrorKind::Migration, "迁移编号必须连续。"));
        }
        if let Some((saved_version, name, saved_checksum)) = history.get(index) {
            if *saved_version != version || name != migration.name || saved_checksum != &checksum {
                return Err(DbError::new(
                    ErrorKind::Migration,
                    format!("已执行迁移 {version} 的名称或校验值不匹配。"),
                ));
            }
            continue;
        }
        tx.execute_batch(migration.sql).map_err(|error| {
            let error = DbError::from(error);
            DbError::new(
                if matches!(
                    error.kind,
                    ErrorKind::Busy | ErrorKind::FileAccess | ErrorKind::Corrupt
                ) {
                    error.kind
                } else {
                    ErrorKind::Migration
                },
                format!("迁移 {version} ({}) 失败。{error}", migration.name),
            )
        })?;
        tx.execute(
            "INSERT INTO schema_migration(version, name, checksum) VALUES (?1, ?2, ?3)",
            params![version, migration.name, checksum],
        )?;
        tx.pragma_update(None, "user_version", version)?;
    }
    super::check_integrity(&tx, false)?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn test_003_failed_upgrade_rolls_back_ddl_data_and_version() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("test.sqlite3");
        let mut db = Database::open(&path).unwrap();
        db.create_subject("math", "数学").unwrap();
        let migrations = [
            Migration { ..MIGRATIONS[0] },
            Migration {
                version: 2,
                name: "injected_failure",
                sql: "CREATE TABLE partial (id INTEGER); INSERT INTO subject VALUES ('bad', '回滚'); INSERT INTO missing VALUES (1);",
            },
        ];
        assert_eq!(
            migrate(&mut db.connection, &migrations).unwrap_err().kind,
            ErrorKind::Migration
        );
        drop(db);
        let db = Database::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), 1);
        assert_eq!(
            db.connection
                .query_row("SELECT count(*) FROM schema_migration", [], |r| r
                    .get::<_, i32>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.connection
                .query_row("SELECT id FROM subject", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "math"
        );
        assert!(!db
            .connection
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM sqlite_schema WHERE name = 'partial')",
                [],
                |r| r.get::<_, bool>(0)
            )
            .unwrap());
        db.integrity_check().unwrap();
    }
}
