use super::{
    attachments, migrations, Database, DraftToken, DraftWrite, ErrorKind, RevisionContent, Scope,
    SearchQuery, TrashKind, DATABASE_FILENAME,
};
use rusqlite::Connection;
use serde_json::json;
use std::{fs, io::Cursor, path::Path};

fn open(path: &Path) -> Database {
    Database::open(&path.join(DATABASE_FILENAME)).unwrap()
}

fn item() -> RevisionContent {
    RevisionContent::from_json(r#"{
        "schema_version":1,"question_type":"解答题","score":4,"parts":[],
        "stem":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"DEV-010 数据保护"}]}]},
        "answer":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"4"}]}]}
    }"#).unwrap()
}

fn png() -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        8,
        8,
        image::Rgb([230, 101, 79]),
    ))
    .write_to(&mut bytes, image::ImageFormat::Png)
    .unwrap();
    bytes.into_inner()
}

fn draft(
    object: &str,
    sequence: i64,
    base_revision: Option<i64>,
    attachments: Vec<String>,
) -> DraftWrite {
    DraftWrite {
        token: DraftToken {
            id: "ab37cd49-1a35-4a37-a943-807cb9e02011".into(),
            sequence,
        },
        object_type: "question".into(),
        object_id: object.into(),
        base_revision,
        payload: json!({ "field":"stem", "content": item(), "sequence": sequence }),
        attachments,
    }
}

fn active_resource_path(root: &Path, hash: &str) -> std::path::PathBuf {
    root.join("attachments").join(&hash[..2]).join(hash)
}

#[test]
fn dev010_t03_t04_t12_backup_cancel_missing_image_and_space_cleanup() {
    let root = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let mut db = open(root.path());
    let image = db.import_attachment(&png(), Some("image/png")).unwrap();
    fs::write(root.path().join("questions.json"), "{}").unwrap();
    let destination = output.path().join("restore.knowbackup");
    let result = db
        .create_backup(&destination, "cancel", &mut |phase, _, _| {
            if phase == "archive" {
                return Err(super::DbError::new(ErrorKind::Busy, "cancelled at archive"));
            }
            Ok(())
        })
        .unwrap_err();
    assert_eq!(result.kind, ErrorKind::Busy);
    assert_eq!(fs::read_dir(output.path()).unwrap().count(), 0);
    assert_eq!(
        super::ensure_space(output.path(), u64::MAX)
            .unwrap_err()
            .kind,
        ErrorKind::FileAccess
    );
    let image_path = active_resource_path(root.path(), &image.sha256);
    fs::rename(&image_path, image_path.with_file_name("missing")).unwrap();
    assert!(db
        .create_backup(&destination, "missing", &mut |_, _, _| Ok(()))
        .is_err());
    assert_eq!(fs::read_dir(output.path()).unwrap().count(), 0);
    assert!(db
        .diagnostics(&mut |_, _, _| Ok(()))
        .unwrap()
        .issues
        .iter()
        .any(|s| s.contains(&image.sha256)));
    fs::rename(image_path.with_file_name("missing"), &image_path).unwrap();
    let manifest = db
        .create_backup(&destination, "ready", &mut |_, _, _| Ok(()))
        .unwrap();
    assert_eq!(manifest.file_count, 3);
    assert!(db
        .create_backup(&destination, "conflict", &mut |_, _, _| Ok(()))
        .is_err());
    let restored = tempfile::tempdir().unwrap();
    let result =
        super::unpack_backup(&destination, restored.path(), &mut |_, _, _| Ok(())).unwrap();
    assert_eq!(manifest.database_sha256, result.manifest.database_sha256);
    assert_eq!(
        fs::read(restored.path().join("questions.json")).unwrap(),
        b"{}"
    );
    assert_eq!(
        open(restored.path())
            .read_attachment(&image.id, None)
            .unwrap()
            .1,
        png()
    );
    assert!(db.backup_history().unwrap()[0].verified);
}

#[test]
fn dev010_t06_restore_old_schema_in_isolation() {
    let original = tempfile::tempdir().unwrap();
    let mut connection = Connection::open(original.path().join(DATABASE_FILENAME)).unwrap();
    migrations::migrate(&mut connection, &migrations::MIGRATIONS[..8]).unwrap();
    let before = Database {
        connection,
        attachment_store: attachments::AttachmentStore::for_database(
            &original.path().join(DATABASE_FILENAME),
        ),
    };
    before.create_question("schema8-origin", "math").unwrap();
    let staged = tempfile::tempdir().unwrap();
    let manifest = before
        .stage_library(staged.path(), &mut |_, _, _| Ok(()))
        .unwrap();
    assert_eq!(manifest.schema_version, 8);
    assert_eq!(
        super::validate_staged_library(staged.path(), manifest, &mut |_, _, _| Ok(()))
            .unwrap()
            .questions,
        1
    );
    assert_eq!(before.schema_version().unwrap(), 8);
    assert_eq!(open(staged.path()).schema_version().unwrap(), 9);
}

#[test]
fn dev010_t15_t19_trash_preserves_fixed_references_and_public_rules() {
    let root = tempfile::tempdir().unwrap();
    let mut db = open(root.path());
    let revision = db
        .create_question_with_revision("personal", "math", &item())
        .unwrap();
    db.save_composition("pin", "历史组卷", &[revision]).unwrap();
    db.create_question("original", "math").unwrap();
    db.append_revision("original", Scope::Public, None, &item())
        .unwrap();
    assert!(db
        .move_to_trash(TrashKind::Question, "original", "deny")
        .is_err());
    db.move_to_trash(TrashKind::Question, "personal", "q")
        .unwrap();
    assert!(!db
        .questions()
        .unwrap()
        .iter()
        .any(|item| item.id == "personal"));
    assert!(!db
        .search_questions(&SearchQuery {
            page_size: 25,
            ..SearchQuery::default()
        })
        .unwrap()
        .hits
        .iter()
        .any(|item| item.id == "personal"));
    assert!(db.clear_trash().is_err());
    assert!(db
        .append_user_revision("personal", Some(revision), &item())
        .is_err());
    assert_eq!(
        db.load_composition("pin").unwrap().items[0].revision.id,
        revision
    );
    let removed = db.trash_items().unwrap();
    assert_eq!(removed[0].context["compositions"], 1);
    db.restore_trash(removed[0].id).unwrap();
    assert_eq!(
        db.current_revision("personal").unwrap().unwrap().id,
        revision
    );

    db.create_knowledge_point("parent", "math", None, "父知识点")
        .unwrap();
    db.create_knowledge_point("child", "math", Some("parent"), "子知识点")
        .unwrap();
    assert!(db
        .move_to_trash(TrashKind::Knowledge, "parent", "deny-parent")
        .is_err());
    db.move_to_trash(TrashKind::Knowledge, "child", "child-op")
        .unwrap();
    let child = db.trash_items().unwrap()[0].id;
    db.move_to_trash(TrashKind::Knowledge, "parent", "parent-op")
        .unwrap();
    assert!(db.restore_trash(child).is_err());
    db.restore_trash(db.trash_items().unwrap()[0].id).unwrap();
    db.restore_trash(child).unwrap();
    db.create_paper("personal-paper", "原创个人原卷").unwrap();
    db.move_to_trash(TrashKind::Paper, "personal-paper", "paper-op")
        .unwrap();
    assert!(!db
        .paper_records()
        .unwrap()
        .iter()
        .any(|item| item.id == "personal-paper"));
    db.restore_trash(db.trash_items().unwrap()[0].id).unwrap();
    assert!(db
        .paper_records()
        .unwrap()
        .iter()
        .any(|item| item.id == "personal-paper"));
    db.integrity_check().unwrap();
}

#[test]
fn dev010_t24_t25_draft_orders_writes_and_commits_formal_save_atomically() {
    let root = tempfile::tempdir().unwrap();
    let mut db = open(root.path());
    let image = db.import_attachment(&png(), Some("image/png")).unwrap();
    let payload = draft("new", 2, None, vec![image.id.clone()]);
    assert!(db.put_draft(&payload).unwrap());
    assert!(!db.put_draft(&draft("new", 1, None, vec![])).unwrap());
    assert_eq!(db.draft_payload(&payload.token.id).unwrap()["sequence"], 2);

    assert!(db
        .put_draft(&draft("new", 3, None, vec!["missing".into()]))
        .is_err());
    assert_eq!(db.drafts().unwrap()[0].sequence, 2);
    let file = active_resource_path(root.path(), &image.sha256);
    fs::rename(&file, file.with_file_name("unavailable")).unwrap();
    assert!(db.draft_payload(&payload.token.id).is_err());
    fs::rename(file.with_file_name("unavailable"), &file).unwrap();
    assert!(db
        .create_question_and_close_draft(
            "new",
            "math",
            &item(),
            None,
            Some(&DraftToken {
                id: payload.token.id.clone(),
                sequence: 1
            })
        )
        .is_err());
    assert!(db.current_revision("new").unwrap().is_none());
    let revision = db
        .create_question_and_close_draft("new", "math", &item(), None, Some(&payload.token))
        .unwrap();
    assert!(db.drafts().unwrap().is_empty());
    assert!(!db
        .put_draft(&draft("new", 99, Some(revision), vec![]))
        .unwrap());

    let mut conflict = draft("new", 1, Some(revision), vec![]);
    conflict.token.id = "cb37cd49-1a35-4a37-a943-807cb9e02011".into();
    assert!(db.put_draft(&conflict).unwrap());
    let next = db
        .append_user_revision("new", Some(revision), &item())
        .unwrap();
    assert!(db.drafts().unwrap()[0].conflict);
    assert!(db
        .append_user_revision_and_close_draft("new", Some(revision), &item(), Some(&conflict.token))
        .is_err());
    assert_eq!(db.current_revision("new").unwrap().unwrap().id, next);
    assert_eq!(db.drafts().unwrap()[0].id, conflict.token.id);
}

#[cfg(windows)]
#[test]
fn dev010_t28_ntfs_permission_denial_does_not_publish_a_backup() {
    use std::process::Command;

    let root = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let path = output.path();
    let username = std::env::var("USERNAME").unwrap();
    let deny = format!("{username}:(OI)(CI)(W)");
    let status = Command::new("icacls.exe")
        .arg(path)
        .args(["/deny", &deny])
        .output()
        .unwrap();
    assert!(
        status.status.success(),
        "icacls could not deny writes to the test directory"
    );

    let db = open(root.path());
    let destination = path.join("denied.knowbackup");
    let result = db.create_backup(&destination, "denied", &mut |_, _, _| Ok(()));
    let restored = Command::new("icacls.exe")
        .arg(path)
        .args(["/remove:d", &username])
        .output()
        .unwrap();
    assert!(
        restored.status.success(),
        "icacls could not restore the test directory permissions"
    );

    assert_eq!(result.unwrap_err().kind, ErrorKind::FileAccess);
    assert!(!destination.exists());
    assert_eq!(fs::read_dir(path).unwrap().count(), 0);
    println!(
        "NTFS denied writes to the isolated backup directory; archive publication did not occur."
    );
}
