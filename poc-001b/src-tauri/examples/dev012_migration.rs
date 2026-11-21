#[path = "../src/library_paths.rs"]
mod library_paths;
#[path = "../src/library_root.rs"]
mod library_root;
#[path = "../src/storage.rs"]
mod storage;

use library_root::{LibraryRoot, Phase};
use lopdf::{dictionary, Document, Object, Stream};
use serde_json::{json, Value};
use shandong_poc_001b::db::{
    preflight_backup_space, unpack_backup, Database, DraftToken, DraftWrite, FavoriteCommand,
    ImportPaper, PaperDraft, PaperPoints, PaperSelection, PaperSettings, RevisionContent,
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

fn paragraph(text: &str) -> Value {
    json!({"type":"paragraph","content":[{"type":"text","text":text}]})
}

fn create_compositions(db: &mut Database) {
    let subjects = [
        "math",
        "chinese",
        "english",
        "physics",
        "chemistry",
        "biology",
        "politics",
        "history",
        "geography",
    ];
    let illustration = db
        .import_attachment(include_bytes!("../icons/icon.png"), Some("image/png"))
        .unwrap();
    let revisions: Vec<i64> = (1..=50).map(|number| {
        let mut stem = vec![
            paragraph(&format!("STEM-{number:03} 原创跨平台试题")),
            json!({"type":"paragraph","content":[
                {"type":"text","text":"行内公式与化学式："},
                {"type":"inlineMath","attrs":{"latex":r"2\mathrm{H_2}+\mathrm{O_2}\to2\mathrm{H_2O}"}}
            ]}),
            json!({"type":"blockMath","attrs":{"latex":r"\int_0^1 x^2\,dx=\frac13"}}),
        ];
        if number % 3 == 0 {
            stem.push(json!({"type":"image","attrs":{"src":format!("attachment:{}", illustration.id),"alt":"原创图示"}}));
        }
        if number == 1 {
            for index in 1..=55 {
                stem.push(paragraph(&format!("READ-{index:03} 阅读材料：山间的云雾随气温变化，观测者沿溪记录各处的风向和水位。")));
            }
        }
        let attachments = if number % 3 == 0 { vec![&illustration] } else { Vec::new() };
        let content = RevisionContent::from_json(&json!({
            "schema_version":1, "question_type":"解答题", "score":4,
            "stem":{"type":"doc","content":stem},
            "answer":{"type":"doc","content":[paragraph(&format!("ANSWER-{number:03} 原创答案"))]},
            "analysis":{"type":"doc","content":[paragraph("由记录推导结论，并说明适用条件。")]},
            "parts":[
                {"id":"a","score":2,"prompt":{"type":"doc","content":[paragraph("列出已知量。")]}},
                {"id":"b","score":2,"prompt":{"type":"doc","content":[paragraph("解释结果。")]}}
            ],
            "attachments":attachments
        }).to_string()).unwrap();
        db.create_question_with_revision(&format!("dev012-mixed-{number:03}"), subjects[(number - 1) % subjects.len()], &content).unwrap()
    }).collect();
    for count in [20, 30, 50] {
        let group = "合成试题";
        let draft = PaperDraft {
            title: format!("DEV-012 原创混合卷 {count}"),
            previous_id: None,
            settings: PaperSettings {
                groups: vec![group.into()],
                ..Default::default()
            },
            items: revisions[..count]
                .iter()
                .map(|&revision_id| PaperSelection {
                    revision_id,
                    points: PaperPoints {
                        group: group.into(),
                        score: 4,
                        part_scores: vec![2, 2],
                    },
                })
                .collect(),
        };
        db.create_composed_paper(&draft).unwrap();
    }
}

fn create_scan(db: &mut Database, path: &Path) {
    let mut pdf = Document::with_version("1.5");
    let pages_root = pdf.new_object_id();
    let raster = image::load_from_memory(include_bytes!("../icons/icon.png"))
        .unwrap()
        .thumbnail_exact(160, 160)
        .into_rgb8();
    let image = pdf.add_object(Stream::new(
        dictionary! {
            "Type" => "XObject", "Subtype" => "Image", "Width" => raster.width(),
            "Height" => raster.height(), "BitsPerComponent" => 8, "ColorSpace" => "DeviceRGB",
        },
        raster.into_raw(),
    ));
    let contents = pdf.add_object(Stream::new(
        dictionary! {},
        b"q 160 0 0 160 60 600 cm /Scan Do Q".to_vec(),
    ));
    let resources = pdf.add_object(dictionary! { "XObject" => dictionary! { "Scan" => image } });
    let pages: Vec<Object> = (0..100)
        .map(|_| {
            Object::Reference(pdf.add_object(dictionary! {
                "Type" => "Page", "Parent" => pages_root, "Contents" => contents,
            }))
        })
        .collect();
    pdf.objects.insert(
        pages_root,
        Object::Dictionary(dictionary! {
            "Type" => "Pages", "Count" => 100, "Kids" => pages, "Resources" => resources,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        }),
    );
    let catalog = pdf.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_root });
    pdf.trailer.set("Root", catalog);
    pdf.compress();
    pdf.save(path).unwrap();
    let registered = db
        .import_paper_pdf(
            path,
            &ImportPaper {
                paper_id: None,
                title: "DEV-012 原创 100 页扫描样本".into(),
                subject_id: "physics".into(),
                year: None,
                region: None,
                source: None,
                role: "original".into(),
            },
        )
        .unwrap();
    assert_eq!(registered.page_count, 100);
}

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
    create_compositions(&mut db);
    create_scan(&mut db, &work.path().join("dev012-scan.pdf"));
    db.create_knowledge_point(KNOWLEDGE, "math", None, "DEV-012 原创自定义知识点")
        .unwrap();
    db.add_knowledge_alias(KNOWLEDGE, "跨平台别名").unwrap();
    let favorite = json!({"kind": "knowledge", "id": KNOWLEDGE});
    let collection = db.favorite_collections().unwrap().remove(0).id;
    db.change_favorites(FavoriteCommand::Add {
        collection,
        targets: vec![serde_json::from_value(favorite.clone()).unwrap()],
    })
    .unwrap();
    db.change_favorites(FavoriteCommand::Mark {
        target: serde_json::from_value(favorite).unwrap(),
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
    let (source, destination, backup_id) = match std::env::consts::OS {
        "macos" => ("windows", "macos", "dev012-macos"),
        "windows" => ("macos", "windows", "dev012-roundtrip-windows"),
        platform => panic!("This fixture runs on macOS or Windows, not {platform}"),
    };
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
        (9, source)
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
        .create_backup(output, backup_id, &mut |_, _, _| Ok(()))
        .unwrap();
    assert_eq!(
        (manifest.schema_version, manifest.platform.as_str()),
        (9, destination)
    );
    println!(
        "{}",
        json!({
            "restoreSeconds": restore_seconds,
            "backupSeconds": start.elapsed().as_secs_f64(),
            "inputManifest": preview.manifest,
            "outputManifest": manifest,
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
