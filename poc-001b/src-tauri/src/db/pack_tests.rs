use super::*;
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, OnceLock,
    },
    time::Duration,
};

fn fixtures() -> &'static Path {
    static DIRECTORY: OnceLock<tempfile::TempDir> = OnceLock::new();
    DIRECTORY
        .get_or_init(|| {
            let dir = tempfile::tempdir().unwrap();
            let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/dev009-fixtures.py");
            let status = Command::new("python")
                .arg(script)
                .arg(dir.path())
                .arg("--all")
                .status()
                .unwrap();
            assert!(status.success(), "generate isolated .studyzip fixtures");
            dir
        })
        .path()
}

fn pack(name: &str) -> Result<ValidatedPack> {
    ValidatedPack::read(&fixtures().join(format!("{name}.studyzip")))
}

fn fresh() -> (tempfile::TempDir, Database) {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(&root.path().join(DATABASE_FILENAME)).unwrap();
    (root, db)
}

fn scalar(db: &Database, sql: &str) -> i64 {
    db.connection.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn install(db: &mut Database, name: &str) -> Result<PackInstallResult> {
    db.install_pack(&mut pack(name)?, &AtomicBool::new(false), |_| {})
}

fn history(db: &Database) -> serde_json::Value {
    serde_json::to_value(db.resource_pack_history().unwrap()).unwrap()
}

fn personal(stem: &str) -> RevisionContent {
    RevisionContent::from_json(&json!({
        "schema_version":1, "question_type":"解答题","score":4,"parts":[],
        "stem":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":stem}]}]},
        "answer":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"个人答案"}]}]}
    }).to_string()).unwrap()
}

#[test]
fn dev009_t02_migrates_schema7_with_historical_revision_and_favorite() {
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join(DATABASE_FILENAME);
    let mut connection = Connection::open(&file).unwrap();
    connection
        .pragma_update(None, "foreign_keys", true)
        .unwrap();
    migrations::migrate(&mut connection, &migrations::MIGRATIONS[..7]).unwrap();
    let mut before = Database {
        connection,
        attachment_store: attachments::AttachmentStore::for_database(&file),
    };
    let revision = before
        .create_question_with_revision("from-seven", "math", &personal("Schema 7 数据"))
        .unwrap();
    before
        .change_favorites(FavoriteCommand::Add {
            collection: "default".into(),
            targets: vec![FavoriteRef {
                kind: favorites::FavoriteKind::Question,
                id: "from-seven".into(),
            }],
        })
        .unwrap();
    before
        .change_favorites(FavoriteCommand::Mark {
            target: FavoriteRef {
                kind: favorites::FavoriteKind::Question,
                id: "from-seven".into(),
            },
            important: true,
        })
        .unwrap();
    let old = before.revision(revision).unwrap();
    let history_count = scalar(&before, "SELECT count(*) FROM schema_migration");
    assert_eq!(history_count, 7);
    let sha_before = attachments::hash(&fs::read(&file).unwrap());
    drop(before);
    for _ in 0..2 {
        let after = Database::open(&file).unwrap();
        assert_eq!(after.schema_version().unwrap(), 8);
        assert_eq!(after.revision(revision).unwrap(), old);
        assert_eq!(after.favorite_counts().unwrap().important, 1);
        assert_eq!(scalar(&after, "SELECT count(*) FROM schema_migration"), 8);
        assert_eq!(
            scalar(
                &after,
                "SELECT count(*) FROM sqlite_schema WHERE name='knowledge_point_protect_update'"
            ),
            1
        );
        after.integrity_check().unwrap();
    }
    let sha_after = attachments::hash(&fs::read(file).unwrap());
    println!("schema 7 => 8; revision={revision}; pre={sha_before}; post={sha_after}; prior favorite=1; integrity=ok");
}

#[test]
fn dev009_t03_to_t07_checks_container_manifest_and_decode_failures() {
    let cancelled =
        ValidatedPack::read_cancellable(&fixtures().join("small.studyzip"), &AtomicBool::new(true))
            .err()
            .unwrap();
    assert!(cancelled.message.contains("校验已取消"));
    let checks = [
        ("missing-manifest", "缺少"),
        ("json", "JSON"),
        ("duplicate-key", "JSON"),
        ("protocol", "不兼容"),
        ("schema", "不兼容"),
        ("app", "不兼容"),
        ("content", "不兼容"),
        ("format", "不兼容"),
        ("version", "JSON"),
        ("traversal", "路径"),
        ("absolute", "路径"),
        ("drive", "路径"),
        ("unc", "路径"),
        ("reserved", "路径"),
        ("case", "冲突"),
        ("overlap", "目录"),
        ("link", "类型"),
        ("fifo", "类型"),
        ("duplicate-path", "重复"),
        ("ratio", "压缩比"),
        ("member-count", "成员数量"),
        ("member-size", "大小"),
        ("total-size", "总解压"),
        ("corrupt", "SHA-256"),
        ("size", "字节"),
        ("missing", "数量"),
        ("extra", "数量"),
        ("duplicate-id", "重复"),
        ("image", "图片"),
        ("pdf", "PDF"),
        ("attachment", "图片"),
    ];
    for (name, expected) in checks {
        let error = pack(&format!("case-{name}"))
            .err()
            .unwrap_or_else(|| panic!("accepted {name}"));
        assert!(error.message.contains(expected), "{name}: {error:?}");
        println!("rejected {name}: {error}");
    }
    let loaded = pack("small").unwrap();
    assert_eq!(loaded.questions.len(), 4);
    assert_eq!(loaded.papers.len(), 1);
    assert_eq!(loaded.blobs.len(), 4);
    assert_eq!(loaded.rights.entries.len(), 1);
}

#[test]
fn dev009_t08_preflight_rejects_bad_hierarchy_references_and_ownership() {
    let (_root, mut db) = fresh();
    for (fixture, text) in [("parent", "缺失"), ("cycle", "循环"), ("knowledge", "缺失")] {
        let pack = pack(&format!("case-{fixture}")).unwrap();
        assert!(db.preview_pack(&pack).err().unwrap().message.contains(text));
    }
    db.create_question_with_revision("kp009-q-0000", "math", &personal("我建立的题目"))
        .unwrap();
    let preview = db.preview_pack(&pack("small").unwrap()).unwrap();
    assert_eq!(preview.diff.conflicts, 1);
    assert!(preview.conflicts[0].contains("个人"));
    assert_eq!(scalar(&db, "SELECT count(*) FROM pack_operation"), 0);
    assert_eq!(
        install(&mut db, "small").err().unwrap().kind,
        ErrorKind::Conflict
    );
    assert_eq!(
        db.current_revision("kp009-q-0000").unwrap().unwrap().scope,
        Scope::User
    );
}

#[test]
fn dev009_t09_to_t17_import_upgrade_and_preserve_user_resources() {
    let (root, mut db) = fresh();
    let preview = db.preview_pack(&pack("small").unwrap()).unwrap();
    assert_eq!(preview.diff.questions.added, 4);
    assert_eq!(preview.diff.knowledge.added, 2);
    assert_eq!(preview.diff.papers.added, 1);
    assert_eq!(preview.diff.pdfs.added, 3);
    assert_eq!(preview.diff.images.added, 1);
    assert_eq!(scalar(&db, "SELECT count(*) FROM pack_operation"), 0);
    assert!(!install(&mut db, "small").unwrap().already_installed);
    assert!(install(&mut db, "small").unwrap().already_installed);
    assert_eq!(scalar(&db, "SELECT count(*) FROM pack_operation"), 1);
    assert_eq!(db.counts().unwrap().logical_questions, 4);
    assert_eq!(scalar(&db, "SELECT count(*) FROM question_part"), 4);
    assert_eq!(scalar(&db, "SELECT count(*) FROM verification_record"), 0);
    assert!(db
        .preview_pack(&pack("case-conflict").unwrap())
        .unwrap()
        .conflicts[0]
        .contains("字节不同"));
    assert!(
        db.preview_pack(&pack("crash").unwrap()).unwrap().conflicts[0].contains("另一个资源包")
    );
    assert!(db
        .preview_pack(&pack("case-same-revision").unwrap())
        .unwrap()
        .conflicts[0]
        .contains("其他内容"));

    let first = "kp009-q-0000";
    let original = db.public_original(first).unwrap().unwrap();
    let original_attachment = original.content.attachments[0].clone();
    let pixels = db
        .read_attachment(&original_attachment.id, Some(&original_attachment))
        .unwrap()
        .1;
    assert_eq!(
        original.content.stem["content"][0]["content"][1]["type"],
        "inlineMath"
    );
    let edited = db
        .append_user_revision(first, Some(original.id), &personal("我的个人修订"))
        .unwrap();
    let own = db
        .create_question_with_revision("personal-only", "math", &personal("个人自建题"))
        .unwrap();
    db.confirm_duplicate("personal-only", first, "编辑", "2026-11-18", "人工确认样本")
        .unwrap();
    db.record_review(
        original.id,
        ReviewInput {
            reviewer: "审查员",
            checked_on: "2026-11-18",
            evidence: "样本原始答案",
            verdict: Verdict::Passed,
            expires_on: None,
            review_of: None,
        },
    )
    .unwrap();
    let review = db.latest_review(original.id).unwrap();
    db.save_composition("kp-pin", "固定公共首版和个人版", &[original.id, edited])
        .unwrap();
    let saved = db.load_composition("kp-pin").unwrap();
    db.change_favorite_collection(CollectionCommand::Create {
        name: "历史收藏夹".into(),
    })
    .unwrap();
    let folder = db
        .favorite_collections()
        .unwrap()
        .into_iter()
        .find(|f| f.name == "历史收藏夹")
        .unwrap();
    let target = FavoriteRef {
        kind: favorites::FavoriteKind::Question,
        id: first.into(),
    };
    db.change_favorites(FavoriteCommand::Add {
        collection: folder.id.clone(),
        targets: vec![target.clone()],
    })
    .unwrap();
    db.change_favorites(FavoriteCommand::Mark {
        target: target.clone(),
        important: true,
    })
    .unwrap();
    let favorite = serde_json::to_value(db.favorite_status(&target).unwrap()).unwrap();
    db.add_knowledge_alias("kp009-math", "我的别名").unwrap();
    db.create_user_knowledge(
        "personal-subtree",
        "math",
        Some("kp009-math"),
        "用户子节点",
        99,
    )
    .unwrap();
    db.set_question_knowledge(first, "personal-subtree", true)
        .unwrap();
    db.set_question_knowledge(first, "kp009-math-child", false)
        .unwrap();

    let paper = db.paper_records().unwrap().pop().unwrap();
    assert_eq!(paper.files.len(), 3);
    for file in &paper.files {
        assert!(db.paper_pdf(&file.id).unwrap().1.starts_with(b"%PDF-"));
    }
    let first_pdf = paper.files.iter().find(|f| f.role == "original").unwrap();
    let pdf_id = first_pdf.id.clone();
    let pdf_before = db.paper_pdf(&pdf_id).unwrap().1;
    let user_region = PdfRegion {
        page_index: 0,
        rect: [0.15, 0.15, 0.75, 0.25],
    };
    db.link_pdf_regions(
        first,
        &RegionLink {
            file_id: pdf_id.clone(),
            source_key: "1".into(),
            regions: vec![user_region.clone()],
        },
        true,
    )
    .unwrap();
    assert_eq!(db.region_question(&pdf_id, "1", 0).unwrap().id, first);
    let expected = PaperMetadata {
        year: paper.year,
        region: paper.region,
        source: paper.source,
    };
    let overlay = PaperMetadata {
        year: Some(2030),
        region: None,
        source: Some("我的标注".into()),
    };
    db.save_paper_metadata(&paper.id, &expected, &overlay)
        .unwrap();

    let newer = db.preview_pack(&pack("upgrade").unwrap()).unwrap();
    assert_eq!(
        (
            newer.diff.questions.added,
            newer.diff.questions.updated,
            newer.diff.personal_revisions
        ),
        (1, 4, 1)
    );
    assert_eq!(
        (newer.diff.knowledge.updated, newer.diff.knowledge.unchanged),
        (1, 1)
    );
    assert!(!install(&mut db, "upgrade").unwrap().already_installed);
    assert!(db.preview_pack(&pack("small").unwrap()).unwrap().conflicts[0].contains("降级"));
    assert!(install(&mut db, "upgrade").unwrap().already_installed);
    assert_eq!(scalar(&db, "SELECT count(*) FROM pack_version"), 2);
    drop(db);

    let mut db = Database::open(&root.path().join(DATABASE_FILENAME)).unwrap();
    db.recover_resource_packs().unwrap();
    db.integrity_check().unwrap();
    assert_eq!(db.current_revision(first).unwrap().unwrap().id, edited);
    assert_eq!(db.public_original(first).unwrap().unwrap(), original);
    assert_eq!(
        db.current_revision("personal-only").unwrap().unwrap().id,
        own
    );
    let newer = db
        .revisions(first)
        .unwrap()
        .into_iter()
        .find(|r| r.scope == Scope::Public && r.id != original.id)
        .unwrap();
    assert!(db.latest_review(newer.id).unwrap().is_none());
    assert_eq!(db.latest_review(original.id).unwrap(), review);
    assert_eq!(db.load_composition("kp-pin").unwrap(), saved);
    assert_eq!(
        serde_json::to_value(db.favorite_status(&target).unwrap()).unwrap(),
        favorite
    );
    assert_eq!(
        db.read_attachment(&original_attachment.id, None).unwrap().1,
        pixels
    );
    assert_eq!(
        db.question_knowledge_ids(first).unwrap(),
        ["personal-subtree"]
    );
    assert_eq!(scalar(&db, "SELECT count(*) FROM question_duplicate"), 1);
    assert_eq!(db.counts().unwrap().logical_questions, 5);
    let points = db.knowledge_points("math").unwrap();
    let public = points
        .iter()
        .find(|point| point.id == "kp009-math")
        .unwrap();
    assert!(public.title.contains("新版"));
    assert!(
        public.aliases.contains(&"我的别名".into())
            && public.aliases.contains(&"公共新别名".into())
    );
    assert!(points
        .iter()
        .any(|p| p.id == "personal-subtree" && p.parent_id.as_deref() == Some("kp009-math")));
    assert!(db
        .connection
        .execute(
            "UPDATE knowledge_point SET title='非法直接改名' WHERE id='kp009-math'",
            []
        )
        .is_err());
    let paper = db.paper_records().unwrap().pop().unwrap();
    assert!(paper.title.contains("新版"));
    assert_eq!(
        (paper.year, paper.region, paper.source),
        (overlay.year, overlay.region, overlay.source)
    );
    assert_eq!(paper.files.len(), 6);
    assert_eq!(db.paper_pdf(&pdf_id).unwrap().1, pdf_before);
    let old_locations = db.pdf_locations(Some(&pdf_id), None).unwrap();
    assert_eq!(old_locations[0].region, user_region);
    assert_eq!(db.pdf_locations(None, Some(first)).unwrap().len(), 2);
    assert_eq!(
        db.region_question(&pdf_id, "1", 0)
            .unwrap()
            .current_revision_id,
        Some(edited)
    );
    let get_hits = |text: &str| {
        db.search_questions(&SearchQuery {
            keyword: Some(text.into()),
            page_size: 30,
            ..Default::default()
        })
        .unwrap()
        .hits
    };
    assert_eq!(get_hits("资源包新版检索题").len(), 4);
    assert_eq!(get_hits("我的个人修订")[0].id, first);
    assert_eq!(history(&db)["operations"].as_array().unwrap().len(), 2);
    println!("protected user revision={edited}, historical public={}, new public={}, composition pinned, favorites/marks, duplicate, old PDF/regions, attachment, user knowledge/aliases, local metadata", original.id,newer.id);
}

fn contents_count(root: &Path, folders: &[&str]) -> usize {
    folders
        .iter()
        .filter_map(|folder| fs::read_dir(root.join(folder)).ok())
        .flatten()
        .flatten()
        .filter_map(|entry| fs::read_dir(entry.path()).ok())
        .flatten()
        .count()
}

fn fail_trigger(db: &Database, name: &str, table: &str, operation: &str, when: &str) {
    db.connection
        .execute_batch(&format!(
            "CREATE TEMP TRIGGER {name} BEFORE {operation} ON {table} {when}
         BEGIN SELECT RAISE(ABORT, 'isolated DEV-009 failure'); END;"
        ))
        .unwrap();
}

#[test]
fn dev009_t18_faults_at_staging_publication_sqlite_and_result_registration() {
    for phase in [
        "staging_unwritable",
        "staged_corrupt",
        "existing_target",
        "sqlite_resource",
        "sqlite_result",
        "cancel",
    ] {
        let (root, mut db) = fresh();
        let mut pack = pack("small").unwrap();
        let cancel = AtomicBool::new(false);
        let first = pack.blobs.keys().next().unwrap().clone();
        let first_item = &pack.blobs[&first];
        let target = root
            .path()
            .join(first_item.role.folder().unwrap())
            .join(&first[..2])
            .join(&first);
        let staged = root.path().join("pack-staging");
        match phase {
            "staging_unwritable" => fs::write(&staged, b"foreign file").unwrap(),
            "existing_target" => {
                fs::create_dir_all(target.parent().unwrap()).unwrap();
                fs::write(&target, b"existing invalid bytes").unwrap();
            }
            "sqlite_resource" => fail_trigger(&db, "resource_fail", "question", "INSERT", ""),
            "sqlite_result" => fail_trigger(
                &db,
                "result_fail",
                "pack_operation",
                "UPDATE",
                "WHEN NEW.state='installed'",
            ),
            _ => {}
        }
        let result = db.install_pack(&mut pack, &cancel, |progress| {
            if progress.phase == "staged" && phase == "staged_corrupt" {
                let file = fs::read_dir(&staged)
                    .unwrap()
                    .flatten()
                    .flat_map(|entry| fs::read_dir(entry.path()).unwrap().flatten())
                    .find(|f| f.file_name().to_string_lossy().ends_with(&first))
                    .unwrap();
                fs::write(file.path(), b"changed stage").unwrap();
            }
            if progress.phase == "staged" && phase == "cancel" {
                cancel.store(true, Ordering::Release);
            }
        });
        assert!(result.is_err(), "{phase}");
        assert_eq!(scalar(&db, "SELECT count(*) FROM pack_version"), 0);
        assert_eq!(scalar(&db, "SELECT count(*) FROM pack_question_owner"), 0);
        assert_eq!(
            scalar(
                &db,
                "SELECT count(*) FROM pack_operation WHERE state='failed'"
            ),
            1
        );
        if phase == "staging_unwritable" {
            assert_eq!(fs::read(&staged).unwrap(), b"foreign file");
            assert!(db.recover_resource_packs().is_err());
            assert_eq!(history(&db)["operations"][0]["pending_cleanup"], true);
            fs::remove_file(&staged).unwrap();
            db.recover_resource_packs().unwrap();
        } else if phase == "existing_target" {
            assert_eq!(fs::read(&target).unwrap(), b"existing invalid bytes");
            fs::remove_file(target).unwrap();
        } else if phase.starts_with("sqlite_") {
            db.connection
                .execute_batch(
                    "DROP TRIGGER IF EXISTS resource_fail; DROP TRIGGER IF EXISTS result_fail;",
                )
                .unwrap();
        }
        assert_eq!(
            contents_count(root.path(), &["attachments", "paper-pdfs", "pack-staging"]),
            0,
            "{phase}"
        );
        assert!(!install(&mut db, "small").unwrap().already_installed);
        assert_eq!(scalar(&db, "SELECT count(*) FROM pack_version"), 1);
        println!(
            "{phase}: rollback, safe cleanup, retry success; original failure = {}",
            result.err().unwrap()
        );
    }
}

#[test]
fn dev009_t20_cross_connection_concurrency_and_t21_integrity_history() {
    let (root, mut second) = fresh();
    let path = root.path().join(DATABASE_FILENAME);
    let (entered, wait_for_entry) = mpsc::sync_channel(0);
    let (release, pause) = mpsc::sync_channel(0);
    let worker_path = path.clone();
    let worker = std::thread::spawn(move || {
        let mut db = Database::open(&worker_path).unwrap();
        db.install_pack(
            &mut pack("small").unwrap(),
            &AtomicBool::new(false),
            |event| {
                if event.phase == "staged" {
                    entered.send(()).unwrap();
                    pause.recv_timeout(Duration::from_secs(15)).unwrap();
                }
            },
        )
        .unwrap()
    });
    wait_for_entry
        .recv_timeout(Duration::from_secs(15))
        .unwrap();
    assert_eq!(
        install(&mut second, "small").err().unwrap().kind,
        ErrorKind::Busy
    );
    release.send(()).unwrap();
    worker.join().unwrap();
    assert_eq!(scalar(&second, "SELECT count(*) FROM pack_operation"), 1);
    let pack = pack("small").unwrap();
    let (&ref sha, blob) = pack.blobs.iter().next().unwrap();
    let path: PathBuf = root
        .path()
        .join(blob.role.folder().unwrap())
        .join(&sha[..2])
        .join(sha);
    let original = fs::read(&path).unwrap();
    fs::write(&path, vec![42; original.len()]).unwrap();
    second.recover_resource_packs().unwrap();
    assert!(history(&second)["versions"][0]["integrity_error"].is_string());
    assert_eq!(second.preview_pack(&pack).unwrap().diff.conflicts, 1);
    fs::remove_file(&path).unwrap();
    second.recover_resource_packs().unwrap();
    assert!(history(&second)["versions"][0]["integrity_error"].is_string());
    fs::write(&path, original).unwrap();
    second.recover_resource_packs().unwrap();
    assert!(history(&second)["versions"][0]["integrity_error"].is_null());
}

#[test]
fn dev009_reuses_unchanged_revision_and_rejects_stale_confirmation() {
    let (_root, mut db) = fresh();
    install(&mut db, "small").unwrap();
    let mut upgrade = pack("upgrade").unwrap();
    let old_preview = db.preview_pack(&upgrade).unwrap();
    let reused = db
        .preview_pack(&pack("same-revision-reused").unwrap())
        .unwrap();
    assert_eq!(reused.diff.questions.unchanged, 4);
    install(&mut db, "same-revision-reused").unwrap();
    assert_eq!(scalar(&db, "SELECT count(*) FROM question_revision"), 4);
    let stale = db
        .install_pack_confirmed(
            &mut upgrade,
            Some(old_preview.base_version_id),
            &AtomicBool::new(false),
            |_| {},
        )
        .err()
        .unwrap();
    assert_eq!(stale.kind, ErrorKind::Conflict);
    assert!(stale.message.contains("预览后发生变化"));
    assert_eq!(scalar(&db, "SELECT count(*) FROM pack_operation"), 2);
    install(&mut db, "upgrade").unwrap();
    assert_eq!(scalar(&db, "SELECT count(*) FROM question_revision"), 9);
}

#[test]
fn dev009_committed_cleanup_republishes_a_missing_link_from_valid_stage() {
    let (root, mut db) = fresh();
    let mut pack = pack("small").unwrap();
    let (sha, blob) = pack.blobs.iter().next().unwrap();
    let target = root
        .path()
        .join(blob.role.folder().unwrap())
        .join(&sha[..2])
        .join(sha);
    let expected_sha = sha.clone();
    db.install_pack(&mut pack, &AtomicBool::new(false), |event| {
        if event.phase == "committed" {
            fs::remove_file(&target).unwrap();
        }
    })
    .unwrap();
    assert_eq!(attachments::hash(&fs::read(&target).unwrap()), expected_sha);
    assert_eq!(scalar(&db, "SELECT pending_cleanup FROM pack_operation"), 0);
    assert_eq!(contents_count(root.path(), &["pack-staging"]), 0);
    db.recover_resource_packs().unwrap();
    assert!(history(&db)["versions"][0]["integrity_error"].is_null());
}
