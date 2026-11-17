use super::*;
use std::time::Instant;

fn query() -> SearchQuery {
    SearchQuery {
        page_size: 25,
        ..Default::default()
    }
}
fn exact(value: &str) -> Option<TextFilter> {
    Some(TextFilter::Exact(value.into()))
}
fn ids(db: &Database, query: &SearchQuery) -> Vec<String> {
    db.search_questions(query)
        .unwrap()
        .hits
        .into_iter()
        .map(|hit| hit.id)
        .collect()
}
fn paper(year: Option<i32>, region: Option<&str>, source: Option<&str>) -> PaperMetadata {
    PaperMetadata {
        year,
        region: region.map(str::to_owned),
        source: source.map(str::to_owned),
    }
}

#[test]
fn dev004_t03_t04_t05_metadata_persists_and_origin_predicates_share_one_occurrence() {
    let (temp, mut db) = database();
    let a = db
        .create_question_with_revision("a", "math", &content("答案"))
        .unwrap();
    db.create_question_with_revision("b", "math", &content("答案"))
        .unwrap();
    db.create_question_with_revision("unmarked", "physics", &content("答案"))
        .unwrap();
    db.create_knowledge_point("point", "math", None, "关联点")
        .unwrap();
    db.set_question_knowledge("b", "point", true).unwrap();
    db.save_question_metadata("a", Some(4), &["组合".into(), "归并".into(), "组合".into()])
        .unwrap();
    db.save_question_metadata("b", Some(1), &["原别名".into()])
        .unwrap();
    db.add_paper_occurrence("a", "p1", Some("山东原卷"), "7")
        .unwrap();
    db.add_paper_occurrence("b", "p2", Some("北京原卷"), "2")
        .unwrap();
    db.add_paper_occurrence("a", "p1", None, "12").unwrap();
    db.save_paper_metadata("p1", &paper(Some(2022), Some("山东"), Some("省卷")))
        .unwrap();
    db.save_paper_metadata("p2", &paper(Some(2024), Some("北京"), Some("模拟")))
        .unwrap();
    db.confirm_duplicate("b", "a", "核对员", "2026-11-17", "人工证据")
        .unwrap();
    db.save_composition("pin", "固定原卷", &[a]).unwrap();
    let original = db.revision(a).unwrap().unwrap();
    assert!(db
        .add_paper_occurrence("absent", "rollback", Some("不得留下"), "1")
        .is_err());
    assert_eq!(
        db.connection
            .query_row("SELECT count(*) FROM paper WHERE id='rollback'", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
        0
    );
    drop(db);
    let mut db = Database::open(&temp.path().join(DATABASE_FILENAME)).unwrap();
    let metadata = db.question_metadata("a").unwrap();
    assert_eq!(metadata.difficulty, Some(4));
    assert_eq!(metadata.tags.len(), 2);
    assert_eq!(metadata.inherited_tags, ["原别名"]);
    assert_eq!(metadata.origins.len(), 3);
    assert_eq!(metadata.origins[0].original_id, "b");
    assert_eq!(metadata.origins[0].metadata.year, Some(2024));
    assert_eq!(
        db.load_composition("pin").unwrap().items[0].revision,
        original
    );
    assert_eq!(
        ids(
            &db,
            &SearchQuery {
                year_from: Some(2024),
                region: exact("北京"),
                source: exact("模拟"),
                ..query()
            }
        ),
        ["a"]
    );
    assert!(ids(
        &db,
        &SearchQuery {
            year_from: Some(2024),
            region: exact("山东"),
            source: exact("模拟"),
            ..query()
        }
    )
    .is_empty());
    assert_eq!(
        ids(
            &db,
            &SearchQuery {
                subject_id: Some("math".into()),
                knowledge_id: Some("point".into()),
                keyword: Some("推导".into()),
                difficulty: Some(4),
                question_type: exact("解答题"),
                year_from: Some(2022),
                year_to: Some(2022),
                region: exact("山东"),
                source: exact("省卷"),
                tag: exact("组合"),
                ..query()
            }
        ),
        ["a"]
    );
    assert_eq!(
        ids(
            &db,
            &SearchQuery {
                tag: exact("原别名"),
                ..query()
            }
        ),
        ["a"]
    );
    assert_eq!(
        ids(
            &db,
            &SearchQuery {
                difficulty: Some(0),
                tag: Some(TextFilter::Missing),
                year_unknown: true,
                region: Some(TextFilter::Missing),
                source: Some(TextFilter::Missing),
                ..query()
            }
        ),
        ["unmarked"]
    );
    let mut changed = content("更新");
    changed.question_type = "选择题".into();
    db.append_user_revision("a", Some(a), &changed).unwrap();
    assert_eq!(
        ids(
            &db,
            &SearchQuery {
                question_type: exact("选择题"),
                tag: exact("组合"),
                ..query()
            }
        ),
        ["a"]
    );
    assert!(!ids(
        &db,
        &SearchQuery {
            question_type: exact("解答题"),
            ..query()
        }
    )
    .contains(&"a".to_owned()));
}

#[test]
fn dev004_t06_search_audit_matches_effective_current_revision_state() {
    let (_temp, mut db) = database();
    let date = |offset: i32| {
        db.connection
            .query_row("SELECT date('now', ?1 || ' days')", [offset], |r| {
                r.get::<_, String>(0)
            })
            .unwrap()
    };
    let (old, yesterday, today, tomorrow) = (date(-3), date(-1), date(0), date(1));
    let cases = [
        (
            "approved",
            Verdict::Passed,
            &yesterday,
            Some(today.as_str()),
            ReviewStatus::Passed,
        ),
        (
            "expired",
            Verdict::Passed,
            &old,
            Some(yesterday.as_str()),
            ReviewStatus::Expired,
        ),
        (
            "scheduled",
            Verdict::Passed,
            &tomorrow,
            None,
            ReviewStatus::Scheduled,
        ),
        (
            "disputed",
            Verdict::Disputed,
            &today,
            None,
            ReviewStatus::Disputed,
        ),
        (
            "failed",
            Verdict::Failed,
            &today,
            None,
            ReviewStatus::Failed,
        ),
    ];
    for (id, verdict, checked, expires, state) in cases {
        let revision = db
            .create_question_with_revision(id, "math", &content("答案"))
            .unwrap();
        let mut input = review(verdict, checked, None);
        input.expires_on = expires;
        let recorded = db.record_review(revision, input).unwrap();
        if state == ReviewStatus::Expired {
            db.record_review(revision, review(Verdict::Passed, &tomorrow, Some(recorded)))
                .unwrap();
        }
        assert_eq!(db.review_today(revision).unwrap().0, state);
    }
    let baseline = db
        .create_question_with_revision("changed", "math", &content("旧答案"))
        .unwrap();
    db.record_review(baseline, review(Verdict::Passed, &yesterday, None))
        .unwrap();
    db.append_user_revision("changed", Some(baseline), &content("不同答案"))
        .unwrap();
    for (id, _, _, _, state) in cases {
        assert_eq!(
            ids(
                &db,
                &SearchQuery {
                    review_status: Some(state),
                    ..query()
                }
            ),
            [id]
        );
    }
    assert_eq!(
        ids(
            &db,
            &SearchQuery {
                review_status: Some(ReviewStatus::Unreviewed),
                ..query()
            }
        ),
        ["changed"]
    );
}

#[test]
fn dev004_t07_year_and_difficulty_sort_stable_with_ties_and_missing_values() {
    let (_temp, mut db) = database();
    for (id, year, difficulty) in [
        ("a", 2024, 2),
        ("b", 2024, 2),
        ("c", 2022, 4),
        ("d", 0, 0),
        ("e", 2020, 1),
    ] {
        db.create_question_with_revision(id, "math", &content("答案"))
            .unwrap();
        if year != 0 {
            db.add_paper_occurrence(id, id, Some("原卷"), "1").unwrap();
            db.save_paper_metadata(id, &paper(Some(year), None, None))
                .unwrap();
            db.save_question_metadata(id, Some(difficulty), &[])
                .unwrap();
        }
    }
    for (sort, descending, expected) in [
        (SearchSort::Year, false, ["e", "c", "a", "b", "d"]),
        (SearchSort::Year, true, ["a", "b", "c", "e", "d"]),
        (SearchSort::Difficulty, false, ["e", "a", "b", "c", "d"]),
        (SearchSort::Difficulty, true, ["c", "a", "b", "e", "d"]),
    ] {
        let mut filters = SearchQuery {
            sort,
            descending,
            page_size: 2,
            ..query()
        };
        let mut collected = Vec::new();
        for n in 0..3 {
            filters.page = n;
            let page = db.search_questions(&filters).unwrap();
            assert_eq!(page.has_next, n < 2);
            collected.extend(page.hits.into_iter().map(|h| h.id));
        }
        assert_eq!(collected, expected);
    }
}

#[test]
fn dev004_t11_metadata_query_benchmark() {
    let count: i64 = std::env::var("DEV004_SYNTHETIC_COUNT")
        .map(|value| value.parse().unwrap())
        .unwrap_or(10_000);
    assert!(matches!(count, 10_000 | 50_000));
    let (temp, mut db) = database();
    db.create_knowledge_point("root", "math", None, "合成知识点")
        .unwrap();
    db.create_knowledge_point("child", "math", Some("root"), "合成下级")
        .unwrap();
    let body = content("合成答案").to_json().unwrap();
    for (id, year, region, source) in [
        ("a", Some(2024), "山东", "模拟"),
        ("b", Some(2022), "山东", "省卷"),
        ("c", Some(2024), "北京", "省卷"),
        ("d", None, "北京", "模拟"),
    ] {
        db.create_paper(id, "验收合成卷").unwrap();
        db.save_paper_metadata(id, &paper(year, Some(region), Some(source)))
            .unwrap();
    }
    let tx = db.connection.transaction().unwrap();
    tx.execute(
        "WITH RECURSIVE nums(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM nums WHERE n<?1)
        INSERT INTO question(id, subject_id) SELECT printf('synthetic-%06d', n), 'math' FROM nums",
        [count],
    )
    .unwrap();
    tx.execute("INSERT INTO question_revision(question_id, scope, content_version, content_json)
        SELECT id, 'user', 1, json_set(?1, '$.stem.content[0].content[0].text', '合成试题 ' || id) FROM question", [body]).unwrap();
    tx.execute_batch("INSERT INTO question_annotation SELECT id, CAST(substr(id,11) AS INTEGER) % 5 + 1 FROM question;
        INSERT INTO question_tag SELECT id, '验收标签' FROM question WHERE CAST(substr(id,11) AS INTEGER) % 3 = 0;
        INSERT INTO question_tag SELECT id, '合成' FROM question;
        INSERT INTO question_knowledge SELECT id, 'root', 'math' FROM question;
        INSERT INTO question_knowledge SELECT id, 'child', 'math' FROM question WHERE CAST(substr(id,11) AS INTEGER) % 2 = 0;
        INSERT INTO question_occurrence SELECT CASE WHEN CAST(substr(id,11) AS INTEGER) % 2 = 0 THEN 'a' ELSE 'b' END, id, id FROM question;
        INSERT INTO question_occurrence SELECT CASE WHEN CAST(substr(id,11) AS INTEGER) % 5 = 0 THEN 'c' ELSE 'd' END, id, id FROM question;").unwrap();
    tx.commit().unwrap();
    db.connection
        .execute_batch("ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    let path = temp.path().join(DATABASE_FILENAME);
    println!(
        "DEV004-T11 synthetic={count} database_bytes={} sources={} tags={} links={}",
        fs::metadata(&path).unwrap().len(),
        table_count(&db, "question_occurrence"),
        table_count(&db, "question_tag"),
        table_count(&db, "question_knowledge")
    );
    let mut filters = SearchQuery {
        subject_id: Some("math".into()),
        knowledge_id: Some("root".into()),
        descendants: true,
        keyword: Some("合成试题".into()),
        year_from: Some(2024),
        region: exact("山东"),
        source: exact("模拟"),
        difficulty: Some(3),
        question_type: exact("解答题"),
        tag: exact("验收标签"),
        sort: SearchSort::Year,
        ..query()
    };
    let (sql, bindings) = crate::db::search::search_plan(&filters).unwrap();
    let mut statement = db
        .connection
        .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
        .unwrap();
    let rows = statement
        .query_map(rusqlite::params_from_iter(bindings), |r| {
            r.get::<_, String>(3)
        })
        .unwrap();
    for row in rows {
        println!("PLAN {}", row.unwrap());
    }
    let mut actual = Vec::new();
    loop {
        let page = db.search_questions(&filters).unwrap();
        actual.extend(page.hits.into_iter().map(|hit| hit.id));
        if !page.has_next {
            break;
        }
        filters.page += 1;
    }
    let expected = (1..=count)
        .filter(|n| n % 6 == 0 && n % 5 == 2)
        .map(|n| format!("synthetic-{n:06}"))
        .collect::<Vec<_>>();
    assert_eq!(actual, expected);
    println!(
        "pagination results={} pages={} last_page={}",
        actual.len(),
        filters.page + 1,
        (actual.len() - 1) % 25 + 1
    );
    for (label, page) in [("combined-first", 0), ("combined-page-6", 5)] {
        filters.page = page;
        let mut times: Vec<_> = (0..30)
            .map(|_| {
                let start = Instant::now();
                assert_eq!(db.search_questions(&filters).unwrap().hits.len(), 25);
                start.elapsed().as_secs_f64() * 1000.0
            })
            .collect();
        times.sort_by(f64::total_cmp);
        println!(
            "{label}: p50_ms={:.3} p95_ms={:.3}",
            (times[14] + times[15]) / 2.0,
            times[28]
        );
    }
}

fn table_count(db: &Database, table: &str) -> i64 {
    db.connection
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
