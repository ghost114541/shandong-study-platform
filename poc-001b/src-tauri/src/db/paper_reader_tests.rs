use super::*;
use crate::db::RevisionContent;
use lopdf::{dictionary, Document, Object};
use std::fs;

fn pdf(pages: usize, marker: &str) -> Vec<u8> {
    let mut doc = Document::with_version("1.7");
    let tree = doc.new_object_id();
    let children: Vec<Object> = (0..pages)
        .map(|_| {
            doc.add_object(dictionary! { "Type" => "Page", "Parent" => tree })
                .into()
        })
        .collect();
    doc.objects.insert(
        tree,
        dictionary! {
            "Type" => "Pages", "Kids" => children, "Count" => pages as i64,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()]
        }
        .into(),
    );
    let catalog = doc.add_object(dictionary! {
        "Type" => "Catalog", "Pages" => tree, "Fixture" => Object::string_literal(marker)
    });
    doc.trailer.set("Root", catalog);
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    bytes
}

fn imported() -> ImportPaper {
    ImportPaper {
        paper_id: None,
        title: "原创验收卷".into(),
        subject_id: "math".into(),
        year: Some(2026),
        region: Some("山东".into()),
        source: Some("原创测试".into()),
        role: "original".into(),
    }
}

fn content() -> RevisionContent {
    RevisionContent::from_json(r#"{
      "schema_version":1,"question_type":"解答题","score":0,"parts":[],
      "stem":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"原创试题"}]}]}
    }"#).unwrap()
}

fn connection(temp: &tempfile::TempDir) -> Database {
    Database::open(&temp.path().join("study.sqlite3")).unwrap()
}

fn regions(id: &str, key: &str) -> RegionLink {
    RegionLink {
        file_id: id.into(),
        source_key: key.into(),
        regions: vec![
            PdfRegion {
                page_index: 0,
                rect: [0.1, 0.2, 0.5, 0.6],
            },
            PdfRegion {
                page_index: 1,
                rect: [0.2, 0.3, 0.6, 0.7],
            },
        ],
    }
}

#[test]
fn dev007_dedup_distinct_papers_same_name_versions_and_hash_failures() {
    let temp = tempfile::tempdir().unwrap();
    let mut db = connection(&temp);
    let bytes = pdf(6, "first");
    let selected = temp.path().join("same.pdf");
    fs::write(&selected, &bytes).unwrap();
    let first = db.import_paper_pdf(&selected, &imported()).unwrap();
    let twin = db.import_paper_pdf(&selected, &imported()).unwrap();
    let same_paper = ImportPaper {
        paper_id: Some(first.paper_id.clone()),
        ..imported()
    };
    let repeated = db.import_paper_pdf(&selected, &same_paper).unwrap();
    fs::write(&selected, pdf(6, "second")).unwrap();
    let changed = db.import_paper_pdf(&selected, &same_paper).unwrap();
    assert_ne!(first.paper_id, twin.paper_id);
    assert_ne!(first.id, twin.id);
    assert_eq!(first.sha256, twin.sha256);
    assert_eq!(first.id, repeated.id);
    assert_ne!(first.sha256, changed.sha256);
    assert_ne!(first.id, changed.id);
    assert_eq!(first.original_name, changed.original_name);
    assert_eq!(db.paper_pdf(&first.id).unwrap().1, bytes);
    assert!(db.paper_pdf("../study.sqlite3").is_err());
    let file = temp
        .path()
        .join(FOLDER)
        .join(&first.sha256[..2])
        .join(&first.sha256);
    fs::write(&file, vec![b'x'; bytes.len()]).unwrap();
    assert_eq!(
        db.paper_pdf(&first.id).unwrap_err().kind,
        ErrorKind::AttachmentHashMismatch
    );
    fs::remove_file(&file).unwrap();
    assert_eq!(
        db.paper_pdf(&first.id).unwrap_err().kind,
        ErrorKind::FileAccess
    );
    assert_eq!(db.paper_pdf(&changed.id).unwrap().0.page_count, 6);
    drop(db);
    let db = connection(&temp);
    assert_eq!(db.paper_records().unwrap().len(), 2);
    assert_eq!(db.counts().unwrap().logical_questions, 0);
    db.integrity_check().unwrap();
}

#[test]
fn dev007_bad_pdf_copy_interrupted_directory_failure_and_sql_rollback() {
    let temp = tempfile::tempdir().unwrap();
    let mut db = connection(&temp);
    let bytes = pdf(2, "copy");
    assert!(db
        .import_pdf_bytes("fake.pdf", b"not a pdf", &imported())
        .is_err());
    assert!(db
        .import_pdf_bytes("cut.pdf", b"%PDF-1.7\n%%EOF", &imported())
        .is_err());
    assert!(db
        .import_pdf_bytes("large.pdf", &vec![0; MAX_BYTES + 1], &imported())
        .is_err());
    assert!(db
        .import_pdf_bytes("pages.pdf", &pdf(501, ""), &imported())
        .is_err());
    assert!(db
        .import_paper_pdf(Path::new("relative.pdf"), &imported())
        .is_err());

    let digest = hash(&bytes);
    let dirs = db
        .attachment_store
        .resource_shard(FOLDER, &digest, true)
        .unwrap();
    let failed = install_with(&dirs, &digest, &bytes, |file| {
        file.write_all(&bytes[..bytes.len() / 2])?;
        Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "simulated mid-copy failure",
        ))
    });
    assert_eq!(failed.unwrap_err().kind(), io::ErrorKind::Interrupted);
    assert!(!dirs.try_exists(&digest).unwrap());
    let pending = format!(".{digest}.tmp");
    assert!(!dirs.try_exists(&pending).unwrap());
    // Abrupt stop before unwinding. The next import must replace this partial temp.
    dirs.write(&pending, &bytes[..32]).unwrap();
    db.connection
        .execute_batch(
            "CREATE TEMP TRIGGER reject_pdf BEFORE INSERT ON main.paper_file
        BEGIN SELECT RAISE(ABORT, 'injected registration failure'); END",
        )
        .unwrap();
    assert!(db
        .import_pdf_bytes("recovery.pdf", &bytes, &imported())
        .is_err());
    assert!(!dirs.try_exists(&digest).unwrap());
    assert!(db.paper_records().unwrap().is_empty());
    db.connection
        .execute_batch("DROP TRIGGER reject_pdf")
        .unwrap();
    drop(dirs);

    // A regular file in place of the managed directory prevents resource writes.
    fs::rename(temp.path().join(FOLDER), temp.path().join("blocked-store")).unwrap();
    fs::write(temp.path().join(FOLDER), b"not a directory").unwrap();
    assert!(db
        .import_pdf_bytes("recovery.pdf", &bytes, &imported())
        .is_err());
    assert!(db.paper_records().unwrap().is_empty());
    fs::remove_file(temp.path().join(FOLDER)).unwrap();
    fs::rename(temp.path().join("blocked-store"), temp.path().join(FOLDER)).unwrap();
    let recovered = db
        .import_pdf_bytes("recovery.pdf", &bytes, &imported())
        .unwrap();
    assert_eq!(db.paper_pdf(&recovered.id).unwrap().1, bytes);
    assert_eq!(db.paper_records().unwrap().len(), 1);
    db.integrity_check().unwrap();
}

#[test]
fn dev007_cross_page_alias_correction_and_failed_new_question_are_consistent() {
    let temp = tempfile::tempdir().unwrap();
    let mut db = connection(&temp);
    let first = db
        .import_pdf_bytes("source.pdf", &pdf(2, "one"), &imported())
        .unwrap();
    let same_paper = ImportPaper {
        paper_id: Some(first.paper_id.clone()),
        ..imported()
    };
    let version = db
        .import_pdf_bytes("source.pdf", &pdf(2, "new"), &same_paper)
        .unwrap();
    let answer = db
        .import_pdf_bytes(
            "answer.pdf",
            &pdf(2, "two"),
            &ImportPaper {
                role: "answer".into(),
                ..same_paper
            },
        )
        .unwrap();
    let other = db
        .import_pdf_bytes("other.pdf", &pdf(2, "three"), &imported())
        .unwrap();

    let mut bad = regions(&first.id, "bad");
    bad.regions[1].page_index = 2;
    assert!(db
        .create_question_with_source("bad", "math", &content(), Some(&bad))
        .is_err());
    assert!(db.current_revision("bad").unwrap().is_none());
    assert_eq!(db.counts().unwrap().logical_questions, 0);
    assert!(db.import_attachment(b"bad PNG", Some("image/png")).is_err());

    let link = regions(&first.id, "第 1 题");
    let revision = db
        .create_question_with_source("alias", "math", &content(), Some(&link))
        .unwrap();
    let canonical_revision = db
        .create_question_with_revision("canonical", "math", &content())
        .unwrap();
    db.confirm_duplicate("alias", "canonical", "验收", "2026-11-18", "人工比对合成题")
        .unwrap();
    db.link_pdf_regions("canonical", &regions(&other.id, "第 2 题"), false)
        .unwrap();
    assert_eq!(db.pdf_locations(None, Some("canonical")).unwrap().len(), 4);
    assert_eq!(db.pdf_locations(None, Some("alias")).unwrap().len(), 4);
    assert_eq!(
        db.region_question(&first.id, "第 1 题", 1)
            .unwrap()
            .current_revision_id,
        Some(revision)
    );
    assert_eq!(
        db.region_question(&other.id, "第 2 题", 0)
            .unwrap()
            .current_revision_id,
        Some(canonical_revision)
    );
    assert!(db.region_question(&version.id, "第 1 题", 1).is_err());
    assert!(db
        .link_pdf_regions("alias", &regions(&version.id, "第 1 题"), true)
        .is_err());
    assert!(db
        .link_pdf_regions("alias", &regions(&answer.id, "第 1 题"), false)
        .is_err());
    bad.regions[1].rect = [0.1, 0.1, 1.01, 0.5];
    bad.regions[1].page_index = 1;
    assert!(db.link_pdf_regions("alias", &bad, false).is_err());
    let correction = RegionLink {
        regions: vec![link.regions[1].clone()],
        ..link
    };
    db.link_pdf_regions("alias", &correction, true).unwrap();
    assert_eq!(
        db.pdf_locations(Some(&first.id), None).unwrap()[0]
            .region
            .page_index,
        1
    );
    assert_eq!(db.current_revision("alias").unwrap().unwrap().id, revision);
    assert_eq!(db.verified_current_count("2026-11-18").unwrap(), 0);
    let counts = db.counts().unwrap();
    assert_eq!(counts.logical_questions, 1);
    assert_eq!(counts.occurrences, 2);
    db.integrity_check().unwrap();
}
