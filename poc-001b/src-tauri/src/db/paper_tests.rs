use super::{
    Database, ErrorKind, PaperDraft, PaperPoints, PaperSelection, PaperSettings, RevisionContent,
    Scope,
};
use serde_json::{json, Value};

fn doc(text: &str) -> Value {
    json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]})
}

fn content(stem: &str) -> RevisionContent {
    RevisionContent::from_json(
        &json!({
            "schema_version": 1, "question_type": "解答题", "score": 3,
            "stem": doc(stem), "answer": doc("TOP_ANSWER"), "analysis": doc("TOP_ANALYSIS"),
            "parts": [
                {"id":"one","score":1,"prompt":doc("PART_PROMPT"),"answer":doc("PART_ANSWER")},
                {"id":"two","score":2,"prompt":doc("SECOND_PROMPT"),"analysis":doc("PART_ANALYSIS")}
            ],
        })
        .to_string(),
    )
    .unwrap()
}

fn draft(revisions: &[i64]) -> PaperDraft {
    PaperDraft {
        title: "固定组卷".into(),
        previous_id: None,
        settings: PaperSettings::default(),
        items: revisions
            .iter()
            .map(|&id| PaperSelection {
                revision_id: id,
                points: PaperPoints {
                    group: "试题".into(),
                    score: 7,
                    part_scores: vec![2, 5],
                },
            })
            .collect(),
    }
}

#[test]
fn dev006_failed_duplicate_and_bad_points_roll_back_version() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("study.sqlite3")).unwrap();
    let a = db
        .create_question_with_revision("main", "math", &content("A"))
        .unwrap();
    let b = db
        .create_question_with_revision("alias", "math", &content("B"))
        .unwrap();
    assert_eq!(
        db.select_paper_question(b, &[a]).unwrap().logical_id,
        "alias"
    );
    db.confirm_duplicate("alias", "main", "审核人", "2026-11-18", "原题比对")
        .unwrap();
    assert_eq!(
        db.select_paper_question(a, &[b]).unwrap_err().kind,
        ErrorKind::InvalidContent
    );
    let original = db.save_paper("original", &draft(&[a])).unwrap();
    db.create_paper("source", "原创练习原卷").unwrap();
    db.record_occurrence("source", "2", "main").unwrap();
    assert_eq!(
        db.load_paper("original").unwrap().items[0].question.summary,
        "来源 原创练习原卷 · 2"
    );

    let mut invalid = draft(&[a, b]);
    invalid.previous_id = Some("original".into());
    assert_eq!(
        db.save_paper("duplicate", &invalid).unwrap_err().kind,
        ErrorKind::InvalidContent
    );
    invalid.items.pop();
    invalid.items[0].points.score = 8;
    assert_eq!(
        db.save_paper("bad-points", &invalid).unwrap_err().kind,
        ErrorKind::InvalidContent
    );
    invalid.items[0].points.score = 7;
    invalid.items[0].revision_id = 98765;
    assert_eq!(
        db.save_paper("missing-pin", &invalid).unwrap_err().kind,
        ErrorKind::Missing
    );

    assert_eq!(db.list_papers().unwrap().len(), 1);
    let unchanged = db.load_paper("original").unwrap();
    assert_eq!(unchanged.header, original.header);
    assert_eq!(
        unchanged.items[0].question.revision,
        original.items[0].question.revision
    );
    assert_eq!(unchanged.items[0].points, original.items[0].points);
    assert_eq!(db.revision(a).unwrap().unwrap().content.score, 3);
    assert!(db
        .connection
        .execute(
            "UPDATE composition SET title='overwrite' WHERE id='original'",
            []
        )
        .is_err());
    assert!(db.connection.execute(
        "INSERT INTO composition_item(composition_id, position, question_id, revision_id, settings_json)
         VALUES ('original', 2, 'main', ?1, '{}')", [a],
    ).is_err());
}

#[test]
fn dev006_projection_is_disjoint_and_identity_stays_pinned() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("study.sqlite3")).unwrap();
    let old = db
        .create_question_with_revision("main", "math", &content("STEM_OLD"))
        .unwrap();
    db.save_paper("original", &draft(&[old])).unwrap();
    let first = db.composition_print_pair("original").unwrap();
    let new = db
        .append_revision("main", Scope::User, Some(old), &content("STEM_NEW"))
        .unwrap();
    let mut version = draft(&[new]);
    version.previous_id = Some("original".into());
    db.save_paper("version", &version).unwrap();
    assert_eq!(
        db.composition_print_pair("original").unwrap().identity,
        first.identity
    );
    assert!(
        matches!(db.prepare_composition_print("version", &first.identity),
        Err(error) if error.kind == ErrorKind::Conflict)
    );
    let paper = serde_json::to_string(&first.paper).unwrap();
    let answers = serde_json::to_string(&first.answers).unwrap();
    for text in ["STEM_OLD", "PART_PROMPT", "SECOND_PROMPT"] {
        assert!(paper.contains(text) && !answers.contains(text));
    }
    for text in ["TOP_ANSWER", "TOP_ANALYSIS", "PART_ANSWER", "PART_ANALYSIS"] {
        assert!(answers.contains(text) && !paper.contains(text));
    }
    assert!(!paper.contains("STEM_NEW"));
    assert_eq!(first.paper.manifest(), first.answers.manifest());

    // Inject a dangling reference in this disposable database, bypassing normal constraints.
    db.connection
        .pragma_update(None, "foreign_keys", false)
        .unwrap();
    db.connection
        .execute_batch(
            "DROP TRIGGER composition_item_no_update;
        UPDATE composition_item SET revision_id=99999 WHERE composition_id='original';",
        )
        .unwrap();
    assert!(matches!(db.composition_print_pair("original"),
        Err(error) if error.kind == ErrorKind::Missing && error.message.contains("99999")));
}

#[test]
fn dev006_invalid_answer_analysis_image_blocks_pair_only_at_export() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("study.sqlite3")).unwrap();
    let attachment = db
        .import_attachment(
            &super::attachments::tests::fixture(image::ImageFormat::Png),
            Some("image/png"),
        )
        .unwrap();
    let mut data = content("共用材料");
    data.attachments = vec![attachment.clone()];
    data.parts[0].analysis = Some(json!({"type":"doc","content":[{
        "type":"image","attrs":{"src":format!("attachment:{}", attachment.id)}
    }]}));
    let id = db
        .create_question_with_revision("main", "math", &data)
        .unwrap();
    db.save_paper("original", &draft(&[id])).unwrap();
    let pair = db.composition_print_pair("original").unwrap();
    assert_eq!(pair.paper.image_count(), 0);
    assert_eq!(pair.answers.image_count(), 1);
    let verified = db
        .prepare_composition_print("original", &pair.identity)
        .unwrap();
    assert_eq!(verified.images.len(), 1);
    assert_eq!(verified.warnings.len(), 1);
    let file = dir
        .path()
        .join("attachments")
        .join(&attachment.sha256[..2])
        .join(&attachment.sha256);
    std::fs::remove_file(file).unwrap();
    assert!(
        matches!(db.prepare_composition_print("original", &pair.identity),
        Err(error) if error.kind == ErrorKind::AttachmentMissing)
    );
}
