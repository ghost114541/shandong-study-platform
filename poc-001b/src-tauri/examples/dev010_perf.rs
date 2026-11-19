use serde_json::json;
use shandong_poc_001b::db::{
    unpack_backup, Database, ImportPaper, RevisionContent, DATABASE_FILENAME,
};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

fn elapsed(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn benchmark(assets: &Path, questions: usize, images: usize, pdfs: usize) -> serde_json::Value {
    let work = tempfile::tempdir().unwrap();
    let source = work.path().join("source");
    let start = Instant::now();
    let mut db = Database::open(&source.join(DATABASE_FILENAME)).unwrap();
    let init_ms = elapsed(start);
    let mut references = Vec::new();
    for index in 0..images {
        let bytes = fs::read(assets.join(format!("formula-{index:02}.png"))).unwrap();
        references.push(db.import_attachment(&bytes, Some("image/png")).unwrap());
    }
    for index in 0..pdfs {
        db.import_paper_pdf(
            &assets.join(format!("scan-{index:02}.pdf")),
            &ImportPaper {
                paper_id: None,
                title: format!("原创扫描卷 {index:02}"),
                subject_id: "math".into(),
                year: Some(2026),
                region: None,
                source: Some("DEV010 原创合成试卷".into()),
                role: "original".into(),
            },
        )
        .unwrap();
    }
    for index in 0..questions {
        let attachment = &references[index % references.len()];
        let content = RevisionContent::from_json(&json!({
            "schema_version":1, "question_type":"解答题", "score":4, "parts":[],
            "attachments":[attachment],
            "stem":{"type":"doc","content":[
                {"type":"paragraph","content":[{"type":"text","text":format!("原创试题 {index}。画出二次函数的图像。")}]},
                {"type":"blockMath","attrs":{"latex":format!("x^2+{index}x-12")}},
                {"type":"image","attrs":{"src":format!("attachment:{}", attachment.id),"alt":"原创公式图片"}}
            ]},
            "answer":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"配方法"}]}]}
        }).to_string()).unwrap();
        db.create_question_with_revision(&format!("dev010-perf-{index}"), "math", &content)
            .unwrap();
    }

    let bytes_before = db.estimated_library_bytes().unwrap();
    let archive = work.path().join("library.knowbackup");
    let source_before = Instant::now();
    let mut phases = BTreeMap::new();
    let manifest = db
        .create_backup(&archive, "performance", &mut |phase, _, _| {
            phases
                .entry(phase.to_owned())
                .or_insert_with(|| elapsed(source_before));
            Ok(())
        })
        .unwrap();
    let backup_ms = elapsed(source_before);
    let archive_bytes = archive.metadata().unwrap().len();

    let stage = work.path().join("stage");
    fs::create_dir(&stage).unwrap();
    let restore_start = Instant::now();
    let mut restore_phases = BTreeMap::new();
    let preview = unpack_backup(&archive, &stage, &mut |phase, _, _| {
        restore_phases
            .entry(phase.to_owned())
            .or_insert_with(|| elapsed(restore_start));
        Ok(())
    })
    .unwrap();
    let precheck_ms = elapsed(restore_start);
    assert_eq!(preview.questions, questions as u64);
    assert_eq!(preview.papers, pdfs as u64);
    let reopen_start = Instant::now();
    let restored = Database::open(&stage.join(DATABASE_FILENAME)).unwrap();
    let reopen_ms = elapsed(reopen_start);
    let check_start = Instant::now();
    assert!(restored
        .diagnostics(&mut |_, _, _| Ok(()))
        .unwrap()
        .issues
        .is_empty());
    let check_ms = elapsed(check_start);
    let restored_bytes = restored.estimated_library_bytes().unwrap();
    json!({
        "questions": questions, "images": images, "scan_pdfs": pdfs, "pages_per_pdf": 22,
        "bytes_before": bytes_before, "archive_bytes": archive_bytes, "restored_bytes": restored_bytes,
        "initial_db_open_ms": init_ms, "backup_total_ms": backup_ms, "backup_phase_start_ms": phases,
        "restore_precheck_ms": precheck_ms, "restore_phase_start_ms": restore_phases, "database_reopen_ms": reopen_ms,
        "integrity_check_ms": check_ms, "manifest_bytes": manifest.total_bytes,
        "disk_increment_bytes": archive_bytes + restored_bytes,
    })
}

fn main() {
    let assets = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .expect("pass original synthetic performance assets"),
    )
    .canonicalize()
    .unwrap();
    #[cfg(windows)]
    let assets = assets
        .to_str()
        .and_then(|path| path.strip_prefix(r"\\?\"))
        .map(PathBuf::from)
        .unwrap_or(assets);
    for case in [(35, 5, 1), (500, 26, 3), (2000, 46, 6)] {
        println!("{}", benchmark(&assets, case.0, case.1, case.2));
    }
}
