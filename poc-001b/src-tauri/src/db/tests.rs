use super::*;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use tempfile::TempDir;

fn database() -> (TempDir, Database) {
    let temp = tempfile::tempdir().unwrap();
    let db = Database::open(&temp.path().join(DATABASE_FILENAME)).unwrap();
    (temp, db)
}

fn text(value: &str) -> Value {
    json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":value}]}]})
}

fn content(answer: &str) -> RevisionContent {
    RevisionContent {
        schema_version: CONTENT_VERSION,
        question_type: "解答题".into(),
        score: 6,
        stem: text("请写出推导过程"),
        answer: Some(text(answer)),
        analysis: Some(text("解析")),
        parts: Vec::new(),
        attachments: Vec::new(),
    }
}

fn question(db: &Database) {
    db.create_subject("math", "数学").unwrap();
    db.create_question("q1", "math").unwrap();
}

fn review(verdict: Verdict, date: &str, previous: Option<i64>) -> ReviewInput<'_> {
    ReviewInput {
        reviewer: "校对员01",
        checked_on: date,
        evidence: "内容核对记录 A",
        verdict,
        expires_on: None,
        review_of: previous,
    }
}

#[test]
fn dev003_t01_review_effective_by_utc_calendar_date() {
    let (_temp, mut db) = database();
    question(&db);
    let revision = db.append_revision("q1", Scope::Public, None, &content("答案")).unwrap();
    let check = |db: &Database, date, expected| {
        assert_eq!(db.review_as_of(revision, date).unwrap().0, expected);
        assert_eq!(db.verified_current_count(date).unwrap(), i64::from(expected == ReviewStatus::Passed));
    };
    check(&db, "2026-01-01", ReviewStatus::Unreviewed);
    let mut first = review(Verdict::Passed, "2026-01-03", None);
    first.expires_on = Some("2026-01-05");
    let a = db.record_review(revision, first).unwrap();
    check(&db, "2026-01-02", ReviewStatus::Scheduled);
    check(&db, "2026-01-05", ReviewStatus::Passed);
    check(&db, "2026-01-06", ReviewStatus::Expired);
    let b = db.record_review(revision, review(Verdict::Disputed, "2026-01-08", Some(a))).unwrap();
    check(&db, "2026-01-05", ReviewStatus::Passed);
    check(&db, "2026-01-08", ReviewStatus::Disputed);
    let c = db.record_review(revision, review(Verdict::Failed, "2026-01-09", Some(b))).unwrap();
    db.record_review(revision, review(Verdict::Passed, "2026-01-10", Some(c))).unwrap();
    check(&db, "2026-01-09", ReviewStatus::Failed);
    check(&db, "2026-01-10", ReviewStatus::Passed);
}

#[test]
fn test_001_initializes_schema_wal_foreign_keys_and_history() {
    let (_temp, db) = database();
    assert_eq!(db.schema_version().unwrap(), 1);
    let read = |sql| {
        db.connection
            .query_row(sql, [], |r| r.get::<_, i32>(0))
            .unwrap()
    };
    assert_eq!(read("PRAGMA foreign_keys"), 1);
    assert_eq!(read("PRAGMA busy_timeout"), 5000);
    assert_eq!(
        read("SELECT count(*) FROM schema_migration WHERE version = 1 AND length(checksum) = 64"),
        1
    );
    let journal: String = db
        .connection
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    assert_eq!(journal, "wal");
    for table in [
        "schema_migration",
        "subject",
        "knowledge_point",
        "question",
        "question_part",
        "paper",
        "question_occurrence",
        "question_duplicate",
        "question_revision",
        "verification_record",
        "composition",
        "composition_item",
    ] {
        let found: bool = db
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
                [table],
                |r| r.get(0),
            )
            .unwrap();
        assert!(found, "missing {table}");
    }
    db.integrity_check().unwrap();
}

#[test]
fn test_002_reopens_same_database_without_reapplying_migration() {
    let (temp, mut db) = database();
    question(&db);
    let id = db
        .append_revision("q1", Scope::Public, None, &content("一"))
        .unwrap();
    let before: String = db
        .connection
        .query_row("SELECT applied_at FROM schema_migration", [], |r| r.get(0))
        .unwrap();
    drop(db);
    let reopened = Database::open(&temp.path().join(DATABASE_FILENAME)).unwrap();
    let remaining: (i32, String) = reopened
        .connection
        .query_row(
            "SELECT count(*), min(applied_at) FROM schema_migration",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(remaining, (1, before));
    assert_eq!(reopened.current_revision("q1").unwrap().unwrap().id, id);
}

#[test]
fn test_004_counts_unique_questions_separately_from_parts_and_occurrences() {
    let (_temp, mut db) = database();
    question(&db);
    db.create_question("q2", "math").unwrap();
    let mut first = content("整题答案");
    first.parts = (1..=3)
        .map(|i| PartContent {
            id: format!("p{i}"),
            score: 2,
            prompt: text("小问题干"),
            answer: Some(text("小问答案")),
            analysis: None,
        })
        .collect();
    db.append_revision("q1", Scope::Public, None, &first)
        .unwrap();
    db.append_revision("q2", Scope::Public, None, &first)
        .unwrap();
    // Identical text does not merge questions. Give the second logical question no parts.
    db.append_revision("q2", Scope::User, None, &content("二"))
        .unwrap();
    db.create_paper("p1", "试卷一").unwrap();
    db.create_paper("p2", "试卷二").unwrap();
    db.record_occurrence("p1", "1", "q1").unwrap();
    db.record_occurrence("p2", "3", "q1").unwrap();
    assert_eq!(
        db.counts().unwrap(),
        Counts {
            logical_questions: 2,
            current_parts: 3,
            occurrences: 2
        }
    );
    assert_eq!(db.occurrences_for("q1").unwrap().len(), 2);
    assert_eq!(
        db.record_occurrence("p2", "3", "q2").unwrap_err().kind,
        ErrorKind::Constraint
    );
}

#[test]
fn explicit_duplicate_confirmation_preserves_existing_sources_and_revisions() {
    let (_temp, mut db) = database();
    question(&db);
    db.create_question("q2", "math").unwrap();
    let same = content("相同内容");
    let canonical = db
        .append_revision("q1", Scope::Public, None, &same)
        .unwrap();
    let duplicate = db
        .append_revision("q2", Scope::Public, None, &same)
        .unwrap();
    db.create_paper("p1", "试卷").unwrap();
    db.record_occurrence("p1", "2", "q2").unwrap();
    db.save_composition("before-dedupe", "旧卷", &[duplicate])
        .unwrap();
    assert_eq!(db.counts().unwrap().logical_questions, 2);
    db.confirm_duplicate("q2", "q1", "录入员", "2026-11-16", "比对原卷和截图")
        .unwrap();
    assert_eq!(db.counts().unwrap().logical_questions, 1);
    assert_eq!(
        db.occurrences_for("q1").unwrap()[0].recorded_question_id,
        "q2"
    );
    assert_eq!(db.current_revision("q1").unwrap().unwrap().id, canonical);
    assert_eq!(
        db.load_composition("before-dedupe").unwrap().items[0]
            .revision
            .id,
        duplicate
    );
    assert_eq!(
        db.confirm_duplicate("q1", "q2", "录入员", "2026-11-16", "循环")
            .unwrap_err()
            .kind,
        ErrorKind::Constraint
    );
}

#[test]
fn test_005_verification_is_version_bound_and_honors_review_chain_and_expiry() {
    let (_temp, mut db) = database();
    question(&db);
    let a = db
        .append_revision("q1", Scope::Public, None, &content("原答案"))
        .unwrap();
    let a_review = db
        .record_review(a, review(Verdict::Passed, "2026-11-12", None))
        .unwrap();
    assert_eq!(db.verified_current_count("2026-11-16").unwrap(), 1);
    let b = db
        .append_revision("q1", Scope::Public, Some(a), &content("修改后的答案"))
        .unwrap();
    assert_eq!(db.verified_current_count("2026-11-16").unwrap(), 0);
    assert!(db.latest_review(b).unwrap().is_none());
    assert_eq!(db.latest_review(a).unwrap().unwrap().id, a_review);
    assert_eq!(
        db.record_review(b, review(Verdict::Passed, "2026-11-16", Some(a_review)))
            .unwrap_err()
            .kind,
        ErrorKind::Constraint
    );

    let mut passed = review(Verdict::Passed, "2026-11-16", None);
    passed.expires_on = Some("2026-11-18");
    let first = db.record_review(b, passed).unwrap();
    assert_eq!(db.verified_current_count("2026-11-18").unwrap(), 1);
    assert_eq!(db.verified_current_count("2026-11-19").unwrap(), 0);
    let disputed = db
        .record_review(b, review(Verdict::Disputed, "2026-11-17", Some(first)))
        .unwrap();
    assert_eq!(db.verified_current_count("2026-11-16").unwrap(), 1);
    assert_eq!(db.verified_current_count("2026-11-17").unwrap(), 0);
    assert_eq!(
        db.record_review(b, review(Verdict::Passed, "2026-11-17", Some(first)))
            .unwrap_err()
            .kind,
        ErrorKind::Constraint
    );
    let failed = db
        .record_review(b, review(Verdict::Failed, "2026-11-18", Some(disputed)))
        .unwrap();
    assert_eq!(db.verified_current_count("2026-11-18").unwrap(), 0);
    let pass_again = db
        .record_review(b, review(Verdict::Passed, "2026-11-19", Some(failed)))
        .unwrap();
    let latest = db.latest_review(b).unwrap().unwrap();
    assert_eq!(
        (
            latest.id,
            latest.revision_id,
            latest.verdict,
            latest.review_of
        ),
        (pass_again, b, Verdict::Passed, Some(failed))
    );
    assert_eq!(
        (
            latest.reviewer.as_str(),
            latest.checked_on.as_str(),
            latest.evidence.as_str()
        ),
        ("校对员01", "2026-11-19", "内容核对记录 A")
    );
    assert_eq!(db.verified_current_count("2026-11-19").unwrap(), 1);
    assert_eq!(
        db.verified_current_count("2026-02-30").unwrap_err().kind,
        ErrorKind::InvalidContent
    );
}

#[test]
fn test_006_user_revision_is_selected_and_public_original_is_unchanged() {
    let (_temp, mut db) = database();
    question(&db);
    let original = content("公共答案");
    let public = db
        .append_revision("q1", Scope::Public, None, &original)
        .unwrap();
    let user = db
        .append_revision("q1", Scope::User, Some(public), &content("用户答案"))
        .unwrap();
    let selected = db.current_revision("q1").unwrap().unwrap();
    assert_eq!(
        (selected.id, selected.scope, selected.base_revision_id),
        (user, Scope::User, Some(public))
    );
    let preserved = db.public_original("q1").unwrap().unwrap();
    assert_eq!(preserved.id, public);
    assert_eq!(preserved.content, original);
}

#[test]
fn test_007_public_update_preserves_user_revision_and_first_public_content() {
    let (temp, mut db) = database();
    question(&db);
    let public = db
        .append_revision("q1", Scope::Public, None, &content("公共原答"))
        .unwrap();
    let personal = content("用户编辑答");
    let user = db
        .append_revision("q1", Scope::User, Some(public), &personal)
        .unwrap();
    let public_new = db
        .append_revision("q1", Scope::Public, Some(public), &content("公共新答"))
        .unwrap();
    drop(db);
    let db = Database::open(&temp.path().join(DATABASE_FILENAME)).unwrap();
    assert_eq!(db.public_original("q1").unwrap().unwrap().id, public);
    assert_eq!(db.current_revision("q1").unwrap().unwrap().id, user);
    assert_eq!(db.revision(user).unwrap().unwrap().content, personal);
    assert_eq!(
        db.revision(public_new).unwrap().unwrap().scope,
        Scope::Public
    );
}

#[test]
fn test_008_saved_composition_reopens_pinned_revision_and_rolls_back_missing_items() {
    let (temp, mut db) = database();
    question(&db);
    let original = content("固定答案");
    let a = db
        .append_revision("q1", Scope::Public, None, &original)
        .unwrap();
    db.save_composition("composition", "样例组卷", &[a])
        .unwrap();
    let b = db
        .append_revision("q1", Scope::User, Some(a), &content("后续修改"))
        .unwrap();
    assert_eq!(
        db.save_composition("incomplete", "部分失败", &[a, -1])
            .unwrap_err()
            .kind,
        ErrorKind::Missing
    );
    assert_eq!(
        db.load_composition("incomplete").unwrap_err().kind,
        ErrorKind::Missing
    );
    drop(db);
    let mut reopened = Database::open(&temp.path().join(DATABASE_FILENAME)).unwrap();
    assert_eq!(reopened.current_revision("q1").unwrap().unwrap().id, b);
    let saved = reopened.load_composition("composition").unwrap();
    assert_eq!(saved.items[0].revision.id, a);
    assert_eq!(saved.items[0].revision.content, original);
}

#[test]
fn test_009_blocks_revision_mutation_deletion_and_cross_question_references() {
    let (_temp, mut db) = database();
    question(&db);
    let err = db
        .append_revision("q1", Scope::Public, Some(1), &content("自引用"))
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::Constraint);
    let id = db
        .append_revision("q1", Scope::Public, None, &content("初始"))
        .unwrap();
    db.create_question("q2", "math").unwrap();
    let mut cross_ref_content = content("跨题");
    cross_ref_content.parts.push(PartContent {
        id: "rollback-part".into(),
        score: 6,
        prompt: text("小问"),
        answer: None,
        analysis: None,
    });
    assert_eq!(
        db.append_revision("q2", Scope::User, Some(id), &cross_ref_content)
            .unwrap_err()
            .kind,
        ErrorKind::Constraint
    );
    let count: i32 = db
        .connection
        .query_row(
            "SELECT count(*) FROM question_part WHERE question_id = 'q2'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    db.save_composition("paper", "保留原内容", &[id]).unwrap();
    for sql in [
        "DELETE FROM question_revision WHERE id = ?1",
        "UPDATE question_revision SET scope = 'user' WHERE id = ?1",
        "INSERT OR REPLACE INTO question_revision(id, question_id, scope, content_version, content_json)
         SELECT id, question_id, 'user', content_version, content_json FROM question_revision WHERE id = ?1",
        "INSERT INTO composition_item VALUES ('paper', 2, 'q2', ?1)",
        "INSERT OR REPLACE INTO composition_item VALUES ('paper', 1, 'q1', ?1)",
        "DELETE FROM composition_item WHERE revision_id = ?1",
    ] {
        assert_eq!(DbError::from(db.connection.execute(sql, [id]).unwrap_err()).kind, ErrorKind::Constraint, "{sql}");
    }
    assert_eq!(
        db.load_composition("paper").unwrap().items[0].revision.id,
        id
    );
    db.integrity_check().unwrap();
}

#[test]
fn rich_text_round_trip_keeps_latex_attachment_and_part_id_and_rejects_bad_content() {
    let (temp, mut db) = database();
    question(&db);
    let mut value = content("工整答案");
    value.attachments.push(Attachment {
        id: "fig".into(),
        media_type: "image/png".into(),
        byte_size: 68,
        sha256: "ab".repeat(32),
    });
    value.stem = json!({"type":"doc","content":[
        {"type":"paragraph","content":[{"type":"text","text":"文字","marks":[{"type":"bold"},{"type":"italic"}]},
            {"type":"inlineMath","attrs":{"latex":"  x^2  "}}]},
        {"type":"blockMath","attrs":{"latex":r"\ce{H2 + Cl2 -> 2HCl}"}},
        {"type":"image","attrs":{"src":"attachment:fig","alt":"外部附件"}},
        {"type":"image","attrs":{"src":"data:image/png;base64,AAAA"}},
        {"type":"image","attrs":{"src":"poc001:parabola"}}
    ]});
    value.parts.push(PartContent {
        id: "p1".into(),
        score: 6,
        prompt: text("小问"),
        answer: Some(text("答案")),
        analysis: Some(text("解析")),
    });
    let id = db
        .append_revision("q1", Scope::Public, None, &value)
        .unwrap();
    drop(db);
    let mut db = Database::open(&temp.path().join(DATABASE_FILENAME)).unwrap();
    assert_eq!(db.revision(id).unwrap().unwrap().content, value);
    assert_eq!(
        RevisionContent::from_json(r#"{"schema_version":4294967296}"#)
            .unwrap_err()
            .kind,
        ErrorKind::UnsupportedContent
    );
    let mut invalid = value.clone();
    invalid.attachments.clear();
    assert_eq!(
        db.append_revision("q1", Scope::User, Some(id), &invalid)
            .unwrap_err()
            .kind,
        ErrorKind::InvalidContent
    );
    invalid = value;
    invalid.parts[0].answer = Some(json!({"type":"doc","content":[{"type":"paragraph"}]}));
    let no_answer = db
        .append_revision("q1", Scope::User, Some(id), &invalid)
        .unwrap();
    assert_eq!(
        db.record_review(no_answer, review(Verdict::Passed, "2026-11-16", None))
            .unwrap_err()
            .kind,
        ErrorKind::InvalidContent
    );
}

#[test]
fn validates_knowledge_hierarchy_and_structured_database_errors() {
    let (temp, db) = database();
    db.create_subject("math", "数学").unwrap();
    db.create_subject("physics", "物理").unwrap();
    db.create_knowledge_point("function", "math", None, "函数")
        .unwrap();
    db.create_knowledge_point("quadratic", "math", Some("function"), "二次函数")
        .unwrap();
    assert_eq!(
        db.create_knowledge_point("motion", "physics", Some("function"), "运动")
            .unwrap_err()
            .kind,
        ErrorKind::Constraint
    );

    let path = temp.path().join(DATABASE_FILENAME);
    let other = Database::open(&path).unwrap();
    let locking_connection = Connection::open(&path).unwrap();
    locking_connection.execute_batch("BEGIN IMMEDIATE").unwrap();
    other.connection.busy_timeout(Duration::ZERO).unwrap();
    assert_eq!(
        other.create_paper("locked", "冲突").unwrap_err().kind,
        ErrorKind::Busy
    );
    locking_connection.execute_batch("ROLLBACK").unwrap();
    other.create_paper("locked", "重试成功").unwrap();

    let corrupt = temp.path().join("corrupt.sqlite3");
    fs::write(&corrupt, b"this is not SQLite").unwrap();
    assert!(matches!(Database::open(&corrupt), Err(error) if error.kind == ErrorKind::Corrupt));
    assert_eq!(fs::read(&corrupt).unwrap(), b"this is not SQLite");
    assert!(
        matches!(Database::open(&corrupt.join("bad.sqlite3")), Err(error) if error.kind == ErrorKind::FileAccess)
    );

    let unrelated = temp.path().join("foreign.sqlite3");
    let raw = Connection::open(&unrelated).unwrap();
    raw.execute("CREATE TABLE legacy (name TEXT)", []).unwrap();
    raw.execute("INSERT INTO legacy VALUES (?1)", params!["preserve"])
        .unwrap();
    assert!(
        matches!(Database::open(&unrelated), Err(error) if error.kind == ErrorKind::IncompatibleDatabase)
    );
    assert_eq!(
        raw.query_row("SELECT name FROM legacy", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "preserve"
    );

    locking_connection
        .pragma_update(None, "user_version", 99)
        .unwrap();
    assert!(
        matches!(Database::open(&path), Err(error) if error.kind == ErrorKind::IncompatibleDatabase)
    );
    locking_connection
        .pragma_update(None, "user_version", 1)
        .unwrap();
    locking_connection
        .pragma_update(None, "foreign_keys", false)
        .unwrap();
    locking_connection
        .execute(
            "INSERT INTO question VALUES ('orphan', 'no-such-subject')",
            [],
        )
        .unwrap();
    assert_eq!(db.integrity_check().unwrap_err().kind, ErrorKind::Integrity);
    assert!(matches!(Database::open(&path), Err(error) if error.kind == ErrorKind::Integrity));
}
#[test]
fn dev002_shared_rich_text_contract() {
    let cases: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../../tests/revision-contract.json")).unwrap();
    for case in cases {
        let result = RevisionContent::from_json(&case["content"].to_string());
        assert_eq!(
            result.is_ok(),
            case["valid"].as_bool().unwrap(),
            "{}: {:?}",
            case["name"],
            result
        );
        if let Ok(content) = result {
            let serialized = content.to_json().unwrap();
            assert_eq!(RevisionContent::from_json(&serialized).unwrap(), content);
        }
    }
}

#[test]
fn dev002_editor_atomic_create_reopen_and_revision_conflicts() {
    let (temp, mut db) = database();
    db.ensure_editor_subject().unwrap();
    db.ensure_editor_subject().unwrap();
    assert_eq!(
        db.subjects().unwrap(),
        vec![Subject {
            id: "math".into(),
            name: "数学".into()
        }]
    );
    let input = content("答案 A");
    assert_eq!(
        db.create_question_with_revision("no-orphan", "missing", &input)
            .unwrap_err()
            .kind,
        ErrorKind::Constraint
    );
    assert!(db.questions().unwrap().is_empty());
    let a = db
        .create_question_with_revision("editor-q", "math", &input)
        .unwrap();
    assert_eq!(
        db.questions().unwrap(),
        vec![QuestionSummary {
            id: "editor-q".into(),
            subject_id: "math".into(),
            current_revision_id: Some(a),
        }]
    );
    db.record_review(a, review(Verdict::Passed, "2026-11-16", None))
        .unwrap();
    let original_json: String = db
        .connection
        .query_row(
            "SELECT content_json FROM question_revision WHERE id=?1",
            [a],
            |row| row.get(0),
        )
        .unwrap();
    drop(db);
    let path = temp.path().join(DATABASE_FILENAME);
    let mut first = Database::open(&path).unwrap();
    let mut second = Database::open(&path).unwrap();
    assert_eq!(
        first.current_revision("editor-q").unwrap().unwrap().content,
        input
    );
    assert_eq!(second.current_revision("editor-q").unwrap().unwrap().id, a);
    let update = content("答案 B");
    let b = first
        .append_user_revision("editor-q", Some(a), &update)
        .unwrap();
    assert_eq!(
        second
            .append_user_revision("editor-q", Some(a), &content("过期"))
            .unwrap_err()
            .kind,
        ErrorKind::Conflict
    );
    assert_eq!(
        second
            .revisions("editor-q")
            .unwrap()
            .iter()
            .map(|row| row.id)
            .collect::<Vec<_>>(),
        vec![b, a]
    );
    let current = second.current_revision("editor-q").unwrap().unwrap();
    assert_eq!(current.base_revision_id, Some(a));
    assert_eq!(current.content, update);
    assert_eq!(
        second.latest_review(a).unwrap().unwrap().verdict,
        Verdict::Passed
    );
    assert!(second.latest_review(b).unwrap().is_none());
    let preserved: String = second
        .connection
        .query_row(
            "SELECT content_json FROM question_revision WHERE id=?1",
            [a],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(preserved, original_json);

    let lock = first
        .connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    second
        .connection
        .busy_timeout(std::time::Duration::ZERO)
        .unwrap();
    assert_eq!(
        second
            .append_user_revision("editor-q", Some(b), &update)
            .unwrap_err()
            .kind,
        ErrorKind::Busy
    );
    drop(lock);
    let mut invalid = update;
    invalid.stem = json!({"type":"not_supported"});
    assert_eq!(
        second
            .append_user_revision("editor-q", Some(b), &invalid)
            .unwrap_err()
            .kind,
        ErrorKind::InvalidContent
    );
    assert_eq!(second.revisions("editor-q").unwrap().len(), 2);
}

#[test]
fn dev002_editor_branches_from_public_without_changing_original() {
    let (_temp, mut db) = database();
    question(&db);
    let original = content("公共答案");
    let public = db
        .append_revision("q1", Scope::Public, None, &original)
        .unwrap();
    let private = db
        .append_user_revision("q1", Some(public), &content("用户答案"))
        .unwrap();
    let current = db.current_revision("q1").unwrap().unwrap();
    assert_eq!(
        (current.id, current.base_revision_id, current.scope),
        (private, Some(public), Scope::User)
    );
    assert_eq!(db.public_original("q1").unwrap().unwrap().content, original);
    assert_eq!(db.revision(public).unwrap().unwrap().content, original);
}
