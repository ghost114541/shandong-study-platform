use super::{DbError, ErrorKind, Result};
use rusqlite::{params, Connection, TransactionBehavior};
use sha2::{Digest, Sha256};

const APPLICATION_ID: i32 = 0x53484431;

pub(super) struct Migration {
    pub version: i32,
    pub name: &'static str,
    pub sql: &'static str,
}

pub(super) const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "core",
        sql: include_str!("../../migrations/0001_core.sql"),
    },
    Migration {
        version: 2,
        name: "knowledge",
        sql: include_str!("../../migrations/0002_knowledge.sql"),
    },
    Migration {
        version: 3,
        name: "search_metadata",
        sql: include_str!("../../migrations/0003_search_metadata.sql"),
    },
    Migration {
        version: 4,
        name: "attachments",
        sql: include_str!("../../migrations/0004_attachments.sql"),
    },
    Migration {
        version: 5,
        name: "composition",
        sql: include_str!("../../migrations/0005_composition.sql"),
    },
    Migration {
        version: 6,
        name: "paper_files",
        sql: include_str!("../../migrations/0006_paper_files.sql"),
    },
    Migration {
        version: 7,
        name: "favorites",
        sql: include_str!("../../migrations/0007_favorites.sql"),
    },
    Migration {
        version: 8,
        name: "resource_packs",
        sql: include_str!("../../migrations/0008_resource_packs.sql"),
    },
    Migration {
        version: 9,
        name: "data_protection",
        sql: include_str!("../../migrations/0009_data_protection.sql"),
    },
];

pub(super) fn verify_snapshot_schema(connection: &Connection, expected: i32) -> Result<()> {
    let version: i32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let app: i32 = connection.query_row("PRAGMA application_id", [], |row| row.get(0))?;
    if app != APPLICATION_ID || version != expected || !(1..=MIGRATIONS.len() as i32).contains(&version) {
        return Err(DbError::new(ErrorKind::IncompatibleDatabase, "备份数据库的应用标识或 Schema 版本不符。"));
    }
    let mut reference = Connection::open_in_memory()?;
    reference.pragma_update(None, "foreign_keys", true)?;
    migrate(&mut reference, &MIGRATIONS[..version as usize])?;

    fn schema(db: &Connection) -> Result<Vec<(String, String, String, Option<String>)>> {
        let mut query = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema
            WHERE name NOT GLOB 'sqlite_stat*' ORDER BY type,name")?;
        let rows = query.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?,
            r.get::<_, Option<String>>(3)?.map(|sql| sql.replace("\r\n", "\n")))))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
    if schema(connection)? != schema(&reference)? {
        return Err(DbError::new(ErrorKind::IncompatibleDatabase, "备份数据库表、视图或触发器与登记版本不符。"));
    }
    fn history(db: &Connection) -> Result<Vec<(i32, String, String)>> {
        let mut query = db.prepare("SELECT version,name,checksum FROM schema_migration ORDER BY version")?;
        let rows = query.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
    if history(connection)? != history(&reference)? {
        return Err(DbError::new(ErrorKind::Migration, "备份数据库迁移校验不符。"));
    }
    Ok(())
}

pub(super) fn apply(connection: &mut Connection) -> Result<()> {
    migrate(connection, MIGRATIONS)
}

pub(super) fn migrate(connection: &mut Connection, migrations: &[Migration]) -> Result<()> {
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
    fn dev004_t02_schema_two_preserves_records_and_pinned_revision() {
        use crate::db::{ReviewInput, RevisionContent, Scope, Verdict};
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("schema2.sqlite3");
        let mut connection = Connection::open(&path).unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        migrate(&mut connection, &MIGRATIONS[..2]).unwrap();
        let mut old = Database {
            connection,
            attachment_store: super::super::attachments::AttachmentStore::for_database(&path),
        };
        let content = RevisionContent::from_json(r#"{
            "schema_version":1,"question_type":"解答题","score":4,"parts":[],
            "stem":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"原始题干"}]}]},
            "answer":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"原始答案"}]}]}
        }"#).unwrap();
        old.create_question("a", "math").unwrap();
        old.create_question("b", "math").unwrap();
        old.append_revision("a", Scope::Public, None, &content)
            .unwrap();
        let b = old
            .append_revision("b", Scope::User, None, &content)
            .unwrap();
        old.connection.execute(
            "INSERT INTO question_knowledge(question_id,knowledge_id,subject_id)
             VALUES ('b','dev003-demo-functions','math')",
            [],
        ).unwrap();
        old.create_paper("source", "旧原卷").unwrap();
        old.record_occurrence("source", "3", "b").unwrap();
        old.confirm_duplicate("b", "a", "复核员", "2026-11-17", "题干确认")
            .unwrap();
        old.record_review(
            b,
            ReviewInput {
                reviewer: "复核员",
                checked_on: "2026-11-17",
                evidence: "核对答案",
                verdict: Verdict::Passed,
                expires_on: None,
                review_of: None,
            },
        )
        .unwrap();
        old.save_composition("pin", "旧组卷", &[b]).unwrap();
        let review = old.latest_review(b).unwrap();
        let pinned = old.load_composition("pin").unwrap();
        drop(old);
        for _ in 0..2 {
            let mut new = Database::open(&path).unwrap();
            assert_eq!(new.schema_version().unwrap() as usize, MIGRATIONS.len());
            assert_eq!(new.latest_review(b).unwrap(), review);
            assert_eq!(new.load_composition("pin").unwrap(), pinned);
            assert_eq!(
                new.question_knowledge_ids("b").unwrap(),
                ["dev003-demo-functions"]
            );
            assert_eq!(
                new.question_knowledge_links("a").unwrap()[0].original_id,
                "b"
            );
            let metadata = new.question_metadata("a").unwrap();
            assert_eq!(metadata.difficulty, None);
            assert_eq!(metadata.origins[0].title, "旧原卷");
            assert_eq!(metadata.origins[0].metadata.year, None);
            assert_eq!(
                new.connection
                    .query_row(
                        "SELECT question_type FROM revision_search_text WHERE revision_id=?1",
                        [b],
                        |r| r.get::<_, String>(0)
                    )
                    .unwrap(),
                "解答题"
            );
            new.integrity_check().unwrap();
        }
    }

    fn schema_one(path: &std::path::Path) -> Database {
        let mut connection = Connection::open(path).unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        connection
            .pragma_update(None, "recursive_triggers", true)
            .unwrap();
        migrate(&mut connection, &MIGRATIONS[..1]).unwrap();
        let db = Database {
            connection,
            attachment_store: super::super::attachments::AttachmentStore::for_database(path),
        };
        db.create_subject("math", "数学").unwrap();
        db
    }

    #[test]
    fn test_003_failed_upgrade_rolls_back_ddl_data_and_version() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("test.sqlite3");
        let mut db = schema_one(&path);
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

    #[test]
    fn dev003_t02_t10_upgrade_preserves_schema_one_user_data_and_pins() {
        use crate::db::{ReviewInput, RevisionContent, Scope, SearchQuery, Verdict};
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("old.sqlite3");
        let mut old = schema_one(&path);
        let item = RevisionContent::from_json(r#"{
            "schema_version":1,"question_type":"解答","score":4,"parts":[],
            "stem":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"迁移前函数"}]}]},
            "answer":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"答案"}]}]}
        }"#).unwrap();
        old.connection.execute("INSERT INTO knowledge_point(id, subject_id, title) VALUES ('legacy-point', 'math', '原知识点')", []).unwrap();
        let a = old
            .create_question_with_revision("legacy-q", "math", &item)
            .unwrap();
        let b = old
            .append_revision("legacy-q", Scope::User, Some(a), &item)
            .unwrap();
        old.record_review(
            a,
            ReviewInput {
                reviewer: "迁移测试员",
                checked_on: "2026-11-10",
                evidence: "原始记录",
                verdict: Verdict::Passed,
                expires_on: None,
                review_of: None,
            },
        )
        .unwrap();
        old.save_composition("old-composition", "固定修订的原组卷", &[a])
            .unwrap();
        let before = old.load_composition("old-composition").unwrap();
        let review = old.latest_review(a).unwrap();
        let revision = old.current_revision("legacy-q").unwrap();
        let historical: (String, String) = old
            .connection
            .query_row(
                "SELECT checksum, applied_at FROM schema_migration WHERE version=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        drop(old);

        for _ in 0..2 {
            let mut db = Database::open(&path).unwrap();
            assert_eq!(db.schema_version().unwrap() as usize, MIGRATIONS.len());
            assert_eq!(db.subjects().unwrap().len(), 9);
            assert_eq!(db.load_composition("old-composition").unwrap(), before);
            assert_eq!(db.latest_review(a).unwrap(), review);
            assert_eq!(db.current_revision("legacy-q").unwrap(), revision);
            assert!(db
                .knowledge_points("math")
                .unwrap()
                .iter()
                .any(|p| p.id == "legacy-point" && p.origin == "user"));
            let hits = db
                .search_questions(&SearchQuery {
                    subject_id: Some("math".into()),
                    keyword: Some("迁移前".into()),
                    page_size: 10,
                    ..Default::default()
                })
                .unwrap()
                .hits;
            assert_eq!(hits.len(), 1);
            assert_eq!(hits[0].current_revision_id, b);
            assert_eq!(
                db.connection
                    .query_row(
                        "SELECT checksum, applied_at FROM schema_migration WHERE version=1",
                        [],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .unwrap(),
                historical
            );
            db.integrity_check().unwrap();
        }
    }

    #[test]
    fn dev003_t10_schema_two_failure_rolls_back_subjects_and_ddl() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("rollback.sqlite3");
        let old = schema_one(&path);
        old.connection.execute_batch("CREATE TABLE question_knowledge(marker TEXT); INSERT INTO question_knowledge VALUES ('preserve');").unwrap();
        drop(old);
        assert!(matches!(Database::open(&path), Err(error) if error.kind == ErrorKind::Migration));
        let raw = Connection::open(&path).unwrap();
        assert_eq!(
            raw.query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            raw.query_row("SELECT count(*) FROM subject", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            raw.query_row(
                "SELECT count(*) FROM pragma_table_info('knowledge_point') WHERE name='origin'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            raw.query_row("SELECT marker FROM question_knowledge", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "preserve"
        );
    }
}
