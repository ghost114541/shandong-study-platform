use super::favorites::{FavoriteKind, FavoriteSort};
use super::*;
use serde_json::json;
use std::{
    fs,
    sync::{Arc, Barrier},
    time::Instant,
};

fn open() -> (tempfile::TempDir, Database) {
    let temp = tempfile::tempdir().unwrap();
    let db = Database::open(&temp.path().join(DATABASE_FILENAME)).unwrap();
    (temp, db)
}

fn reference(kind: FavoriteKind, id: &str) -> FavoriteRef {
    FavoriteRef {
        kind,
        id: id.into(),
    }
}

fn question(id: &str) -> FavoriteRef {
    reference(FavoriteKind::Question, id)
}

fn content(text: &str) -> RevisionContent {
    RevisionContent::from_json(&json!({
        "schema_version":1, "question_type":"解答题", "score":4, "parts":[],
        "stem":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]},
        "answer":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"4"}]}]}
    }).to_string()).unwrap()
}

fn folder(db: &mut Database, name: &str) -> String {
    db.change_favorite_collection(CollectionCommand::Create { name: name.into() })
        .unwrap();
    db.favorite_collections()
        .unwrap()
        .into_iter()
        .find(|entry| entry.name == name)
        .unwrap()
        .id
}

fn add(db: &mut Database, collection: &str, targets: Vec<FavoriteRef>) -> Result<()> {
    db.change_favorites(FavoriteCommand::Add {
        collection: collection.into(),
        targets,
    })
}

fn remove(db: &mut Database, collection: &str, target: FavoriteRef) -> Result<()> {
    db.change_favorites(FavoriteCommand::Remove {
        collection: collection.into(),
        target,
        expected_relations: None,
    })
}

fn mark(db: &mut Database, target: FavoriteRef, important: bool) {
    db.change_favorites(FavoriteCommand::Mark { target, important })
        .unwrap();
}

#[test]
fn dev008_t01_t02_upgrade_retains_migrations_and_default_stays_unique() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(DATABASE_FILENAME);
    let mut connection = Connection::open(&path).unwrap();
    connection
        .pragma_update(None, "foreign_keys", true)
        .unwrap();
    migrations::migrate(&mut connection, &migrations::MIGRATIONS[..6]).unwrap();
    connection.execute_batch(
        "INSERT INTO question(id, subject_id) VALUES ('before', 'math');
         INSERT INTO paper(id, title) VALUES ('p', '原试卷');
         INSERT INTO question_occurrence(paper_id, source_key, question_id) VALUES ('p', '1', 'before');",
    ).unwrap();
    drop(connection);
    for _ in 0..2 {
        let db = Database::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap() as usize, migrations::MIGRATIONS.len());
        let favorites_installed: bool = db.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=7 AND name='favorites')",
            [], |row| row.get(0),
        ).unwrap();
        assert!(favorites_installed);
        assert_eq!(db.occurrences_for("before").unwrap()[0].paper_id, "p");
        let folders = db.favorite_collections().unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].id, "default");
        assert!(folders[0].is_default);
        assert!(db
            .connection
            .execute("DELETE FROM favorite_collection WHERE is_default = 1", [])
            .is_err());
        assert!(db
            .connection
            .execute(
                "INSERT INTO favorite_target(paper_id) VALUES ('unknown')",
                []
            )
            .is_err());
        assert!(db
            .connection
            .execute(
                "INSERT INTO favorite_target(paper_id, question_id) VALUES ('p', 'before')",
                []
            )
            .is_err());
        assert!(db
            .connection
            .execute(
                "INSERT INTO favorite_target(kind, paper_id) VALUES ('invalid', 'p')",
                []
            )
            .is_err());
        assert!(db
            .connection
            .execute("INSERT INTO favorite_collection(name) VALUES ('   ')", [])
            .is_err());
        assert!(db
            .connection
            .execute(
                "INSERT INTO favorite_member VALUES ('default', -1, 'invalid')",
                []
            )
            .is_err());
        db.integrity_check().unwrap();
    }
}

#[test]
fn dev008_t03_t04_create_rename_reorder_validate() {
    let (_temp, mut db) = open();
    let a = folder(&mut db, "Practice");
    let b = folder(&mut db, "复习");
    assert_eq!(
        db.change_favorite_collection(CollectionCommand::Create {
            name: " practice ".into()
        })
        .unwrap_err()
        .kind,
        ErrorKind::Conflict
    );
    for name in ["　", "坏\t名称", "坏\0名称", &"长".repeat(81)] {
        assert_eq!(
            db.change_favorite_collection(CollectionCommand::Create { name: name.into() })
                .unwrap_err()
                .kind,
            ErrorKind::InvalidContent
        );
    }
    db.change_favorite_collection(CollectionCommand::Rename {
        id: b.clone(),
        name: "　模拟题　".into(),
    })
    .unwrap();
    db.change_favorite_collection(CollectionCommand::Reorder {
        id: b.clone(),
        direction: -1,
    })
    .unwrap();
    let folders = db.favorite_collections().unwrap();
    assert_eq!(
        folders
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        ["default", &b, &a]
    );
    assert_eq!(folders[1].name, "模拟题");
    assert_eq!(
        db.change_favorite_collection(CollectionCommand::Delete {
            id: a.clone() + "missing"
        })
        .unwrap_err()
        .kind,
        ErrorKind::Missing
    );
    assert_eq!(
        db.change_favorite_collection(CollectionCommand::Delete {
            id: "default".into()
        })
        .unwrap_err()
        .kind,
        ErrorKind::InvalidContent
    );
    assert_eq!(
        add(&mut db, &a, vec![question("unknown")])
            .unwrap_err()
            .kind,
        ErrorKind::Missing
    );
    assert!(serde_json::from_value::<FavoriteRef>(json!({"kind":"unknown","id":"x"})).is_err());
}

#[test]
fn dev008_t05_t07_t09_t14_merge_keep_source_and_cross_folder_mark() {
    let (_temp, mut db) = open();
    let review = folder(&mut db, "期末复习");
    let move_to = folder(&mut db, "数学重点");
    db.create_question("A", "math").unwrap();
    db.create_question("B", "math").unwrap();
    add(&mut db, "default", vec![question("A"), question("B")]).unwrap();
    add(&mut db, &review, vec![question("A")]).unwrap();
    mark(&mut db, question("B"), true);
    db.confirm_duplicate("B", "A", "复核员", "2026-11-18", "原题人工核对")
        .unwrap();
    assert_eq!(
        db.favorite_counts().unwrap(),
        FavoriteCounts {
            relations: 3,
            targets: 1,
            questions: 1,
            important: 1,
            ..Default::default()
        }
    );
    let status = db.favorite_status(&question("B")).unwrap();
    assert_eq!(status.logical_id, "A");
    assert_eq!(status.collections.len(), 2);
    assert_eq!(status.collections[0].relations, 2);
    assert_eq!(
        db.change_favorites(FavoriteCommand::Remove {
            collection: "default".into(),
            target: question("B"),
            expected_relations: Some(1),
        })
        .unwrap_err()
        .kind,
        ErrorKind::Conflict
    );
    assert_eq!(
        db.favorite_status(&question("B")).unwrap().collections[0].relations,
        2
    );
    add(&mut db, &review, vec![question("B")]).unwrap();
    assert_eq!(db.favorite_counts().unwrap().relations, 3);
    let saved = db
        .favorite_page(&FavoriteQuery {
            collection: Some(review.clone()),
            important: true,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(saved.items.len(), 1);
    assert_eq!(saved.items[0].id, "A");
    assert_eq!(saved.items[0].unavailable, Some("试题暂无可读修订。"));
    for move_item in [false, true, true] {
        db.change_favorites(FavoriteCommand::Transfer {
            from: "default".into(),
            to: move_to.clone(),
            target: question("A"),
            move_item,
        })
        .unwrap();
    }
    let original = db
        .connection
        .query_row(
            "SELECT group_concat(original_id, ',') FROM (
         SELECT t.original_id FROM favorite_target t JOIN favorite_member m ON m.target_id=t.id
         WHERE m.collection_id=?1 ORDER BY t.original_id)",
            [&move_to],
            |r| r.get::<_, String>(0),
        )
        .unwrap();
    assert_eq!(original, "A,B");
    remove(&mut db, &move_to, question("A")).unwrap();
    remove(&mut db, &move_to, question("B")).unwrap();
    assert!(db.favorite_status(&question("A")).unwrap().important);
    assert_eq!(
        db.favorite_status(&question("B")).unwrap().collections[0].id,
        review
    );
    mark(&mut db, question("B"), false);
    assert!(!db.favorite_status(&question("A")).unwrap().important);
    assert_eq!(db.questions().unwrap().len(), 1);
    assert_eq!(
        db.connection
            .query_row("SELECT count(*) FROM question", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        2
    );
    remove(&mut db, &review, question("A")).unwrap();
    assert_eq!(db.favorite_counts().unwrap().relations, 0);
    assert_eq!(
        db.connection
            .query_row("SELECT count(*) FROM favorite_target", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    db.integrity_check().unwrap();
}

#[test]
fn dev008_t08_t17_concurrent_idempotency_failed_batch_and_delete_roll_back() {
    let (temp, mut db) = open();
    let path = temp.path().join(DATABASE_FILENAME);
    let folder = folder(&mut db, "并发");
    db.create_question("same", "math").unwrap();
    db.create_question("other", "math").unwrap();
    let gate = Arc::new(Barrier::new(3));
    let workers = (0..2)
        .map(|_| {
            let (gate, path, folder) = (gate.clone(), path.clone(), folder.clone());
            std::thread::spawn(move || {
                gate.wait();
                let mut connection = Database::open(&path).unwrap();
                add(
                    &mut connection,
                    &folder,
                    vec![question("same"), question("same")],
                )
                .unwrap();
            })
        })
        .collect::<Vec<_>>();
    gate.wait();
    for thread in workers {
        thread.join().unwrap();
    }
    assert_eq!(db.favorite_counts().unwrap().relations, 1);
    assert!(add(
        &mut db,
        &folder,
        vec![question("other"), question("absent")]
    )
    .is_err());
    db.connection
        .execute_batch(
            "CREATE TRIGGER test_member_failure BEFORE INSERT ON favorite_member
         WHEN (SELECT original_id FROM favorite_target WHERE id = NEW.target_id) = 'other'
         BEGIN SELECT RAISE(ABORT, 'injected write interrupted'); END;
         CREATE TRIGGER test_delete_failure BEFORE DELETE ON favorite_member
         BEGIN SELECT RAISE(ABORT, 'injected delete constraint'); END;",
        )
        .unwrap();
    assert!(add(
        &mut db,
        "default",
        vec![question("same"), question("other")]
    )
    .is_err());
    assert!(db
        .change_favorite_collection(CollectionCommand::Delete { id: folder.clone() })
        .is_err());
    assert_eq!(db.favorite_counts().unwrap().relations, 1);
    assert_eq!(
        db.favorite_status(&question("same")).unwrap().collections[0].id,
        folder
    );
    assert!(db
        .favorite_status(&question("other"))
        .unwrap()
        .collections
        .is_empty());
    assert_eq!(
        db.connection
            .query_row("SELECT count(*) FROM favorite_target", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    db.integrity_check().unwrap();
}

#[test]
fn dev008_t08_collection_delete_and_add_are_serialized() {
    let (temp, mut db) = open();
    let path = temp.path().join(DATABASE_FILENAME);
    let folder = folder(&mut db, "竞争");
    db.create_question("resource", "math").unwrap();
    let worker_path = path.clone();
    let worker_folder = folder.clone();
    let gate = Arc::new(Barrier::new(2));
    let worker_gate = gate.clone();
    let worker = std::thread::spawn(move || {
        let mut db = Database::open(&worker_path).unwrap();
        worker_gate.wait();
        add(&mut db, &worker_folder, vec![question("resource")])
    });
    gate.wait();
    db.change_favorite_collection(CollectionCommand::Delete { id: folder })
        .unwrap();
    if let Err(error) = worker.join().unwrap() {
        assert_eq!(error.kind, ErrorKind::Missing);
    }
    assert!(db
        .favorite_status(&question("resource"))
        .unwrap()
        .collections
        .is_empty());
    assert_eq!(db.favorite_collections().unwrap().len(), 1);
    assert_eq!(db.questions().unwrap().len(), 1);
    db.integrity_check().unwrap();
}

#[test]
fn dev008_t06_t10_t16_multi_type_pdf_versions_metadata_and_safe_folder_delete() {
    let (temp, mut db) = open();
    let folder = folder(&mut db, "完整性");
    let selected = temp.path().join("original.pdf");
    let fixture = include_bytes!("../../../output/dev007/fixtures/original.pdf");
    fs::write(&selected, fixture).unwrap();
    let mut import = ImportPaper {
        paper_id: None,
        role: "original".into(),
        title: "原创数学卷".into(),
        subject_id: "math".into(),
        year: Some(2026),
        region: Some("山东".into()),
        source: None,
    };
    let pdf = db.import_paper_pdf(&selected, &import).unwrap();
    import.paper_id = Some(pdf.paper_id.clone());
    fs::write(
        &selected,
        include_bytes!("../../../output/dev007/fixtures/answer.pdf"),
    )
    .unwrap();
    let original2 = db.import_paper_pdf(&selected, &import).unwrap();
    import.role = "answer".into();
    let answer = db.import_paper_pdf(&selected, &import).unwrap();

    let q = db
        .create_question_with_revision("A", "math", &content("重点试题"))
        .unwrap();
    db.record_occurrence(&pdf.paper_id, "1", "A").unwrap();
    db.record_review(
        q,
        ReviewInput {
            reviewer: "教师",
            checked_on: "2025-01-01",
            evidence: "手工核对",
            verdict: Verdict::Passed,
            expires_on: None,
            review_of: None,
        },
    )
    .unwrap();
    db.save_composition("paper", "已固定", &[q]).unwrap();
    let pinned = db.load_composition("paper").unwrap();
    let image = db
        .import_attachment(
            include_bytes!("../../../output/dev007/artifacts/capture-1.png"),
            None,
        )
        .unwrap();
    let image_before = db.read_attachment(&image.id, None).unwrap();
    db.create_knowledge_point(
        "user-math",
        "math",
        Some("dev003-demo-functions"),
        "用户知识点",
    )
    .unwrap();
    db.set_question_knowledge("A", "user-math", true).unwrap();
    add(
        &mut db,
        &folder,
        vec![
            question("A"),
            reference(FavoriteKind::Paper, &pdf.paper_id),
            reference(FavoriteKind::Knowledge, "user-math"),
            reference(FavoriteKind::Knowledge, "dev003-demo-functions"),
        ],
    )
    .unwrap();
    db.rename_user_knowledge("user-math", "更名后").unwrap();
    db.add_knowledge_alias("user-math", "形参").unwrap();
    let page = db
        .favorite_page(&FavoriteQuery {
            keyword: "形参".into(),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(page.items[0].title, "更名后");
    assert!(page.items[0].parent.is_some());
    db.connection
        .execute(
            "UPDATE knowledge_point SET enabled=0 WHERE id='user-math'",
            [],
        )
        .unwrap();
    let disabled = db
        .favorite_page(&FavoriteQuery {
            keyword: "形参".into(),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(disabled.items[0].unavailable, Some("知识点已停用。"));
    let papers = FavoriteQuery {
        kind: Some(FavoriteKind::Paper),
        keyword: "山东".into(),
        ..Default::default()
    };
    let page = db.favorite_page(&papers).unwrap();
    assert_eq!(page.items[0].versions.len(), 2);
    assert!(page.items[0]
        .versions
        .iter()
        .all(|version| version.available));
    assert_eq!(page.items[0].year, Some(2026));
    db.change_favorite_collection(CollectionCommand::Delete { id: folder })
        .unwrap();
    assert_eq!(db.favorite_counts().unwrap().relations, 0);
    assert_eq!(db.paper_pdf(&pdf.id).unwrap().1, fixture);
    assert!(db.paper_pdf(&original2.id).is_ok());
    assert!(db.paper_pdf(&answer.id).is_ok());
    assert_eq!(db.occurrences_for("A").unwrap().len(), 1);
    assert_eq!(db.revisions("A").unwrap().len(), 1);
    assert_eq!(db.latest_review(q).unwrap().unwrap().reviewer, "教师");
    assert_eq!(db.load_composition("paper").unwrap(), pinned);
    assert_eq!(db.read_attachment(&image.id, None).unwrap(), image_before);
    assert_eq!(db.question_knowledge_ids("A").unwrap(), ["user-math"]);
    db.integrity_check().unwrap();

    add(
        &mut db,
        "default",
        vec![reference(FavoriteKind::Paper, &pdf.paper_id)],
    )
    .unwrap();
    for digest in [pdf.sha256, original2.sha256] {
        fs::remove_file(
            temp.path()
                .join("paper-pdfs")
                .join(&digest[..2])
                .join(&digest),
        )
        .unwrap();
    }
    let unavailable = db.favorite_page(&papers).unwrap();
    assert_eq!(
        unavailable.items[0].unavailable,
        Some("原卷 PDF 文件缺失或无法读取。")
    );
    assert_eq!(db.favorite_counts().unwrap().papers, 1);
}

#[test]
fn dev008_t13_t15_t18_latest_user_revision_review_and_fixed_selection_survive_reopen() {
    let (temp, mut db) = open();
    db.create_question("A", "math").unwrap();
    let public = db
        .append_revision("A", Scope::Public, None, &content("公共原版"))
        .unwrap();
    let user = db
        .append_user_revision("A", Some(public), &content("个人版本"))
        .unwrap();
    db.record_review(
        user,
        ReviewInput {
            reviewer: "教师",
            checked_on: "2025-01-01",
            evidence: "旧答案",
            verdict: Verdict::Passed,
            expires_on: None,
            review_of: None,
        },
    )
    .unwrap();
    add(&mut db, "default", vec![question("A")]).unwrap();
    mark(&mut db, question("A"), true);
    let selected = db.favorite_page(&FavoriteQuery::default()).unwrap().items[0]
        .revision_id
        .unwrap();
    assert_eq!(
        db.select_paper_question(selected, &[]).unwrap().revision.id,
        user
    );
    assert!(db.select_paper_question(selected, &[user]).is_err());
    db.save_composition("fixed", "固定修订", &[selected])
        .unwrap();
    let current = db
        .append_user_revision("A", Some(user), &content("最新版本"))
        .unwrap();
    assert_eq!(db.public_original("A").unwrap().unwrap().id, public);
    assert_eq!(
        db.latest_review(user).unwrap().unwrap().verdict,
        Verdict::Passed
    );
    drop(db);
    let mut db = Database::open(&temp.path().join(DATABASE_FILENAME)).unwrap();
    let next = db
        .favorite_page(&FavoriteQuery {
            keyword: "最新".into(),
            sort: FavoriteSort::Name,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(next.items[0].revision_id, Some(current));
    assert_eq!(next.items[0].review, Some(ReviewStatus::Unreviewed));
    assert!(next.items[0].important);
    assert_eq!(
        db.load_composition("fixed").unwrap().items[0].revision.id,
        user
    );
}

#[test]
fn dev008_t10_t19_mixed_1000_and_5000_query_benchmark() {
    for size in [1000, 5000] {
        let (_temp, mut db) = open();
        let additional = folder(&mut db, "性能");
        let mut batch = Vec::new();
        let fixture = content("合成函数练习");
        for index in 0..size {
            let id = format!("sample-{index:04}");
            let kind = match index % 3 {
                0 => {
                    db.create_question_with_revision(&id, "math", &fixture)
                        .unwrap();
                    FavoriteKind::Question
                }
                1 => {
                    db.create_paper(&id, &id).unwrap();
                    FavoriteKind::Paper
                }
                _ => {
                    db.create_knowledge_point(&id, "math", None, &id).unwrap();
                    FavoriteKind::Knowledge
                }
            };
            batch.push(reference(kind, &id));
        }
        let timer = Instant::now();
        for (index, chunk) in batch.chunks(250).enumerate() {
            add(
                &mut db,
                if index % 2 == 0 {
                    "default"
                } else {
                    &additional
                },
                chunk.to_vec(),
            )
            .unwrap();
        }
        let batch_time = timer.elapsed();
        db.confirm_duplicate(
            "sample-0003",
            "sample-0000",
            "复核员",
            "2026-11-18",
            "人工核对",
        )
        .unwrap();
        let counts = db.favorite_counts().unwrap();
        assert_eq!(counts.relations, size);
        assert_eq!(counts.targets, size - 1);
        let timer = Instant::now();
        let collections = db.favorite_collections().unwrap();
        let sidebar = timer.elapsed();
        assert_eq!(collections.len(), 2);
        assert_eq!(
            collections
                .iter()
                .map(|item| item.counts.relations)
                .sum::<i64>(),
            size
        );
        let timer = Instant::now();
        let first = db.favorite_page(&FavoriteQuery::default()).unwrap();
        let all = timer.elapsed();
        assert_eq!(first.items.len(), 20);
        assert!(first.has_next);
        let timer = Instant::now();
        let first_filtered = db
            .favorite_page(&FavoriteQuery {
                collection: Some(additional.clone()),
                kind: Some(FavoriteKind::Knowledge),
                sort: FavoriteSort::Name,
                keyword: "sample".into(),
                ..Default::default()
            })
            .unwrap();
        let filtered = timer.elapsed();
        let timer = Instant::now();
        let second_filtered = db
            .favorite_page(&FavoriteQuery {
                collection: Some(additional),
                kind: Some(FavoriteKind::Knowledge),
                sort: FavoriteSort::Name,
                keyword: "sample".into(),
                page: 1,
                ..Default::default()
            })
            .unwrap();
        let turn_page = timer.elapsed();
        assert_eq!(second_filtered.items.len(), 20);
        assert!(first_filtered.items[0].title < first_filtered.items[19].title);
        assert!(first_filtered.items[19].title < second_filtered.items[0].title);
        let timer = Instant::now();
        mark(&mut db, question("sample-0000"), true);
        let toggle = timer.elapsed();
        assert_eq!(db.favorite_counts().unwrap().important, 1);
        println!("Schema 7 synthetic relations={size} batch_total_ms={:.3} sidebar_ms={:.3} first_page_ms={:.3} filter_ms={:.3} page_2_ms={:.3} mark_ms={:.3}",
            batch_time.as_secs_f64() * 1000., sidebar.as_secs_f64() * 1000., all.as_secs_f64() * 1000.,
            filtered.as_secs_f64() * 1000., turn_page.as_secs_f64() * 1000., toggle.as_secs_f64() * 1000.);
    }
}
