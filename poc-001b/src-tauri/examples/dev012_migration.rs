#[path = "../src/library_paths.rs"]
mod library_paths;
#[path = "../src/library_root.rs"]
mod library_root;
#[path = "../src/storage.rs"]
mod storage;

use library_root::{LibraryRoot, Phase};
use serde_json::json;
use shandong_poc_001b::db::{
    preflight_backup_space, unpack_backup, Database, DraftToken, DraftWrite, FavoriteCommand,
    TrashKind, DATABASE_FILENAME,
};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

const KNOWLEDGE: &str = "dev012-portable-knowledge";
const TRASHED: &str = "dev012-portable-trash";
const DRAFT: &str = "ab37cd49-1a35-4a37-a943-807cb9e02012";

fn open(root: &mut LibraryRoot) -> Database {
    root.open_database(
        |db| db.verify_library().map_err(|error| error.message),
        |phase| eprintln!("restore startup: {phase}"),
    )
    .unwrap()
}

fn seed(legacy: &Path, destination: &Path) {
    assert_eq!(std::env::consts::OS, "windows");
    let work = tempfile::tempdir().unwrap();
    unpack_backup(legacy, work.path(), &mut |_, _, _| Ok(())).unwrap();
    let mut db = Database::open(&work.path().join(DATABASE_FILENAME)).unwrap();
    db.create_knowledge_point(KNOWLEDGE, "math", None, "DEV-012 原创自定义知识点")
        .unwrap();
    db.add_knowledge_alias(KNOWLEDGE, "跨平台别名").unwrap();
    db.change_favorites(FavoriteCommand::Mark {
        target: serde_json::from_value(json!({"kind": "knowledge", "id": KNOWLEDGE})).unwrap(),
        important: true,
    })
    .unwrap();
    db.create_knowledge_point(TRASHED, "math", None, "DEV-012 回收站样本")
        .unwrap();
    db.move_to_trash(TrashKind::Knowledge, TRASHED, "dev012-trash")
        .unwrap();
    db.put_draft(&DraftWrite {
        token: DraftToken {
            id: DRAFT.into(),
            sequence: 1,
        },
        object_type: "question".into(),
        object_id: "dev012-synthetic-draft".into(),
        base_revision: None,
        payload: json!({"field": "stem", "text": "原创自动草稿"}),
        attachments: Vec::new(),
    })
    .unwrap();
    let manifest = db
        .create_backup(destination, "dev012-windows", &mut |_, _, _| Ok(()))
        .unwrap();
    assert_eq!(
        (manifest.schema_version, manifest.platform.as_str()),
        (9, "windows")
    );
    println!("{}", serde_json::to_string_pretty(&manifest).unwrap());
}

fn restore(archive: &Path, output: &Path) {
    assert_eq!(std::env::consts::OS, "macos");
    let lab = tempfile::tempdir().unwrap();
    let profile = lab.path().join("知卷 DEV-012");
    let mut root = LibraryRoot::lock(&profile).unwrap();
    let empty = open(&mut root);
    assert_eq!(empty.schema_version().unwrap(), 9);
    assert!(empty.questions().unwrap().is_empty());
    drop(empty);

    let start = Instant::now();
    let parent = root.managed_parent().unwrap();
    preflight_backup_space(archive, &parent).unwrap();
    let candidate = root.create_stage(&parent).unwrap();
    root.update(Phase::Staging, None).unwrap();
    let preview = unpack_backup(archive, &candidate, &mut |_, _, _| Ok(())).unwrap();
    assert_eq!(
        (
            preview.manifest.schema_version,
            preview.manifest.platform.as_str()
        ),
        (9, "windows")
    );
    root.update(Phase::Verified, None).unwrap();
    root.queue_switch().unwrap();
    drop(root);

    let mut root = LibraryRoot::lock(&profile).unwrap();
    drop(open(&mut root));
    assert_eq!(root.active(), &candidate);
    assert_eq!(
        root.previous(),
        Some(profile.canonicalize().unwrap().as_path())
    );
    assert_eq!(root.phase(), Phase::Complete);
    drop(root);

    let mut root = LibraryRoot::lock(&profile).unwrap();
    let db = open(&mut root);
    assert_eq!(root.active(), &candidate);
    assert_eq!(db.subjects().unwrap().len(), 9);
    assert_eq!(db.draft_payload(DRAFT).unwrap()["text"], "原创自动草稿");
    assert!(db
        .trash_items()
        .unwrap()
        .iter()
        .any(|row| row.target_id == TRASHED));
    assert!(db
        .diagnostics(&mut |_, _, _| Ok(()))
        .unwrap()
        .issues
        .is_empty());
    let restore_seconds = start.elapsed().as_secs_f64();
    let start = Instant::now();
    let manifest = db
        .create_backup(output, "dev012-macos", &mut |_, _, _| Ok(()))
        .unwrap();
    assert_eq!(
        (manifest.schema_version, manifest.platform.as_str()),
        (9, "macos")
    );
    println!(
        "{}",
        json!({
            "restoreSeconds": restore_seconds,
            "backupSeconds": start.elapsed().as_secs_f64(),
            "windowsManifest": preview.manifest,
            "macosManifest": manifest,
        })
    );
}

fn main() {
    let args: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    let [mode, input, output] = args.as_slice() else {
        panic!("Usage: dev012_migration <seed|restore> <input archive> <new output archive>");
    };
    let input = input.canonicalize().unwrap();
    let output = std::env::current_dir().unwrap().join(output);
    fs::create_dir_all(output.parent().unwrap()).unwrap();
    match mode.to_str() {
        Some("seed") => seed(&input, &output),
        Some("restore") => restore(&input, &output),
        _ => panic!("Expected seed or restore"),
    }
}
