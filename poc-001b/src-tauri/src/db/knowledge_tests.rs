use super::*;
use std::time::Instant;

#[test]
fn dev004_t01_alias_knowledge_is_searchable_without_rewriting_sources() {
    for (a_has_k, b_has_k) in [(true, false), (false, true), (true, true), (false, false)] {
        let (_tmp, mut db) = database();
        db.create_knowledge_point("k", "math", None, "关联 K").unwrap();
        db.create_knowledge_point("m", "math", None, "关联 M").unwrap();
        db.create_question_with_revision("a", "math", &content("主逻辑题")).unwrap();
        let b = db.create_question_with_revision("b", "math", &content("原题答案")).unwrap();
        db.record_review(b, review(Verdict::Passed, "2026-11-17", None)).unwrap();
        db.save_composition("pinned", "保留原题", &[b]).unwrap();
        db.create_paper("p-a", "甲卷").unwrap();
        db.create_paper("p-b", "乙卷").unwrap();
        db.record_occurrence("p-a", "1", "a").unwrap();
        db.record_occurrence("p-b", "2", "b").unwrap();
        if a_has_k { db.set_question_knowledge("a", "k", true).unwrap(); }
        if b_has_k { db.set_question_knowledge("b", "k", true).unwrap(); }
        db.set_question_knowledge("b", "m", true).unwrap();
        assert_eq!(db.counts().unwrap().logical_questions, 2);
        let original = db.revision(b).unwrap().unwrap();
        db.confirm_duplicate("b", "a", "人工审定", "2026-11-17", "逐题核对").unwrap();
        assert_eq!(db.counts().unwrap().logical_questions, 1);
        let check = |db: &Database, id: &str, expected: bool| {
            let found = search_ids(db, Some("math"), Some(id), "", false);
            let count = db.knowledge_points("math").unwrap().into_iter().find(|p| p.id == id).unwrap().question_count;
            assert_eq!(found, if expected { vec!["a"] } else { vec![] });
            assert_eq!(count, found.len() as i64);
        };
        check(&db, "k", a_has_k || b_has_k);
        check(&db, "m", true);
        let links = db.question_knowledge_links("a").unwrap();
        assert_eq!(links.iter().any(|link| link.knowledge_id == "k" && link.original_id == "a"), a_has_k);
        assert_eq!(links.iter().any(|link| link.knowledge_id == "k" && link.original_id == "b"), b_has_k);
        assert_eq!(links, db.question_knowledge_links("b").unwrap());
        db.set_question_knowledge("b", "k", true).unwrap();
        db.set_question_knowledge("a", "k", false).unwrap();
        check(&db, "k", true);
        assert_eq!(db.question_knowledge_ids("b").unwrap(), ["k", "m"]);
        assert_eq!(db.occurrences_for("a").unwrap().iter().map(|o| o.recorded_question_id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(db.revision(b).unwrap().unwrap(), original);
        assert_eq!(db.latest_review(b).unwrap().unwrap().verdict, Verdict::Passed);
        assert_eq!(db.load_composition("pinned").unwrap().items[0].revision, original);
    }
}

#[test]
fn dev003_t02_nine_subjects_are_seeded_once() {
    let (temp, db) = database();
    let expected = [
        ("chinese", "语文"),
        ("math", "数学"),
        ("english", "英语"),
        ("physics", "物理"),
        ("chemistry", "化学"),
        ("biology", "生物"),
        ("politics", "思想政治"),
        ("history", "历史"),
        ("geography", "地理"),
    ];
    let check = |db: &Database| {
        let subjects = db.subjects().unwrap();
        assert_eq!(
            subjects
                .iter()
                .map(|s| (s.id.as_str(), s.name.as_str()))
                .collect::<Vec<_>>(),
            expected
        );
    };
    check(&db);
    let mut db = db;
    let revision = db
        .create_question_with_revision("known-math", "math", &content("答案"))
        .unwrap();
    drop(db);
    let db = Database::open(&temp.path().join(DATABASE_FILENAME)).unwrap();
    check(&db);
    assert_eq!(db.questions().unwrap()[0].subject_id, "math");
    assert_eq!(
        db.current_revision("known-math").unwrap().unwrap().id,
        revision
    );
}

#[test]
fn dev003_t03_t04_t05_tree_sort_constraints_and_aliases() {
    let (_temp, db) = database();
    db.create_user_knowledge("root", "math", None, "根节点", -2)
        .unwrap();
    db.create_user_knowledge("first", "math", Some("root"), "先显示", 1)
        .unwrap();
    db.create_user_knowledge("second", "math", Some("root"), "后显示", 2)
        .unwrap();
    db.create_knowledge_point("leaf", "math", Some("second"), "叶节点")
        .unwrap();
    let points = db.knowledge_points("math").unwrap();
    let children: Vec<_> = points
        .iter()
        .filter(|p| p.parent_id.as_deref() == Some("root"))
        .map(|p| p.id.as_str())
        .collect();
    assert_eq!(children, ["first", "second"]);
    assert_eq!(
        points
            .iter()
            .find(|p| p.id == "leaf")
            .unwrap()
            .parent_id
            .as_deref(),
        Some("second")
    );
    for parent in ["bad", "self"] {
        let id = if parent == "self" { "self" } else { "missing" };
        assert_eq!(
            db.create_knowledge_point(id, "math", Some(parent), id)
                .unwrap_err()
                .kind,
            ErrorKind::Constraint
        );
    }
    assert_eq!(
        db.create_knowledge_point("other", "physics", Some("root"), "跨学科")
            .unwrap_err()
            .kind,
        ErrorKind::Constraint
    );
    assert!(db
        .connection
        .execute(
            "UPDATE knowledge_point SET parent_id = 'leaf' WHERE id = 'root'",
            []
        )
        .is_err());
    assert!(db
        .connection
        .execute_batch(
            "INSERT INTO knowledge_point(id, subject_id, parent_id, title) VALUES
         ('loop-a', 'math', 'loop-b', 'A'), ('loop-b', 'math', 'loop-a', 'B');",
        )
        .is_err());
    db.rename_user_knowledge("leaf", "新名称").unwrap();
    db.add_knowledge_alias("leaf", "备用名").unwrap();
    db.add_knowledge_alias("leaf", "备用名").unwrap();
    let standard = "dev003-demo-functions";
    assert_eq!(
        db.rename_user_knowledge(standard, "篡改").unwrap_err().kind,
        ErrorKind::Constraint
    );
    for sql in [
        "UPDATE knowledge_point SET title='篡改' WHERE id='dev003-demo-functions'",
        "DELETE FROM knowledge_point WHERE id='dev003-demo-functions'",
        "INSERT OR REPLACE INTO knowledge_point(id, subject_id, title) VALUES ('dev003-demo-functions', 'math', '替换')",
    ] {
        assert!(db.connection.execute(sql, []).is_err(), "{sql}");
    }
    db.add_knowledge_alias(standard, "本地别名").unwrap();
    let points = db.knowledge_points("math").unwrap();
    let leaf = points.iter().find(|p| p.id == "leaf").unwrap();
    assert_eq!(leaf.title, "新名称");
    assert_eq!(leaf.aliases, ["备用名"]);
    let public = points.iter().find(|p| p.id == standard).unwrap();
    assert_eq!(public.title, "演示 · 函数");
    assert_eq!(public.aliases, ["本地别名"]);
    assert_eq!(public.origin, "standard");
}

fn search_ids(
    db: &Database,
    subject: Option<&str>,
    point: Option<&str>,
    keyword: &str,
    descendants: bool,
) -> Vec<String> {
    db.search_questions(&SearchQuery {
        subject_id: subject.map(str::to_owned),
        knowledge_id: point.map(str::to_owned),
        keyword: Some(keyword.into()),
        descendants,
        page: 0,
        page_size: 20,
    })
    .unwrap()
    .hits
    .into_iter()
    .map(|hit| hit.id)
    .collect()
}

#[test]
fn dev003_t06_t07_t08_link_and_search_current_without_duplicates() {
    let (_temp, mut db) = database();
    db.create_knowledge_point("root", "math", None, "根")
        .unwrap();
    db.create_knowledge_point("leaf", "math", Some("root"), "叶")
        .unwrap();
    db.create_knowledge_point("physics", "physics", None, "物理点")
        .unwrap();
    let mut public = content("检索不应显露的答案");
    public.stem = text("旧版标注");
    db.create_question("q1", "math").unwrap();
    let public_id = db
        .append_revision("q1", Scope::Public, None, &public)
        .unwrap();
    db.save_composition("pinned", "固定版", &[public_id])
        .unwrap();
    let mut user = public.clone();
    user.stem = json!({"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"公因","marks":[{"type":"bold"}]},
        {"type":"text","text":"式演示 50%_X '单引号'"}
    ]}]});
    db.create_question_with_revision("q2", "math", &user)
        .unwrap();
    db.create_question_with_revision("q3", "physics", &user)
        .unwrap();
    db.create_question_with_revision("q4-alias", "math", &user)
        .unwrap();
    db.confirm_duplicate("q4-alias", "q1", "测试员", "2026-11-17", "合成重复题")
        .unwrap();
    db.create_paper("p1", "卷一").unwrap();
    db.create_paper("p2", "卷二").unwrap();
    db.record_occurrence("p1", "1", "q1").unwrap();
    db.record_occurrence("p2", "2", "q1").unwrap();
    db.set_question_knowledge("q1", "root", true).unwrap();
    db.set_question_knowledge("q1", "leaf", true).unwrap();
    db.set_question_knowledge("q1", "leaf", true).unwrap();
    db.set_question_knowledge("q2", "leaf", true).unwrap();
    db.set_question_knowledge("q4-alias", "leaf", true).unwrap();
    assert!(db.set_question_knowledge("q1", "physics", true).is_err());
    assert_eq!(db.question_knowledge_ids("q1").unwrap(), ["leaf", "root"]);
    assert_eq!(
        db.knowledge_points("math")
            .unwrap()
            .iter()
            .find(|p| p.id == "leaf")
            .unwrap()
            .question_count,
        2
    );
    assert_eq!(
        search_ids(&db, Some("math"), Some("root"), "", false),
        ["q1"]
    );
    assert_eq!(
        search_ids(&db, Some("math"), Some("root"), "", true),
        ["q1", "q2"]
    );
    assert_eq!(
        search_ids(&db, Some("math"), Some("root"), "公因式", true),
        ["q2"]
    );
    db.append_user_revision("q1", Some(public_id), &user)
        .unwrap();
    let mut public_update = public.clone();
    public_update.stem = text("另一公共修订");
    db.append_revision("q1", Scope::Public, Some(public_id), &public_update)
        .unwrap();
    assert_eq!(
        search_ids(&db, Some("math"), Some("root"), "公因式", true),
        ["q1", "q2"]
    );
    assert_eq!(
        search_ids(&db, Some("math"), Some("root"), "50%_x '单引号'", true),
        ["q1", "q2"]
    );
    assert!(search_ids(&db, Some("physics"), Some("root"), "公因式", true).is_empty());
    for term in ["旧版标注", "另一公共修订", "检索不应显露的答案", "51%"] {
        assert!(search_ids(&db, None, None, term, true).is_empty());
    }
    assert!(db
        .search_questions(&SearchQuery {
            keyword: Some("长".repeat(121)),
            page_size: 10,
            ..Default::default()
        })
        .is_err());
    assert!(db
        .search_questions(&SearchQuery {
            page: u32::MAX,
            page_size: u32::MAX,
            ..Default::default()
        })
        .is_err());
    assert_eq!(db.question_knowledge_ids("q1").unwrap(), ["leaf", "root"]);
    db.rename_user_knowledge("leaf", "更名不改 ID").unwrap();
    db.set_question_knowledge("q1", "root", false).unwrap();
    assert!(search_ids(&db, None, Some("root"), "", false).is_empty());
    assert_eq!(search_ids(&db, None, Some("root"), "", true), ["q1", "q2"]);
    assert_eq!(db.public_original("q1").unwrap().unwrap().content, public);
    assert_eq!(
        db.load_composition("pinned").unwrap().items[0].revision.id,
        public_id
    );
    assert_eq!(db.counts().unwrap().logical_questions, 3);
    assert_eq!(db.counts().unwrap().occurrences, 2);
}

#[test]
fn dev003_t09_synthetic_ten_thousand_query_benchmark() {
    let count: i64 = std::env::var("DEV003_SYNTHETIC_COUNT")
        .map(|value| value.parse().expect("synthetic count must be an integer"))
        .unwrap_or(10_000);
    assert!((10_000..=100_000).contains(&count));
    let (temp, mut db) = database();
    db.create_knowledge_point("bench-root", "math", None, "合成根")
        .unwrap();
    db.create_knowledge_point("bench-child", "math", Some("bench-root"), "合成分支")
        .unwrap();
    let body = content("测试答案").to_json().unwrap();
    let tx = db.connection.transaction().unwrap();
    tx.execute(
        "WITH RECURSIVE nums(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM nums WHERE n<?1)
         INSERT INTO question(id, subject_id) SELECT printf('synthetic-%06d', n),
         CASE WHEN n % 7 = 0 THEN 'physics' ELSE 'math' END FROM nums;",
        [count],
    )
    .unwrap();
    tx.execute(
        "INSERT INTO question_revision(question_id, scope, content_version, content_json)
         SELECT id, 'user', 1,
                json_set(?1, '$.stem.content[0].content[0].text',
                    CASE WHEN CAST(substr(id, 11) AS INTEGER) % 5 = 0 THEN '合成特征 ' ELSE '普通合成 ' END || id)
         FROM question",
        [&body],
    ).unwrap();
    tx.execute_batch(
        "INSERT INTO question_knowledge(question_id, knowledge_id, subject_id)
         SELECT id, 'bench-child', subject_id FROM question
         WHERE subject_id = 'math' AND CAST(substr(id, 11) AS INTEGER) % 2 = 0;",
    )
    .unwrap();
    tx.commit().unwrap();
    assert_eq!(db.counts().unwrap().logical_questions, count);
    db.connection
        .execute_batch("ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    let path = temp.path().join(DATABASE_FILENAME);
    let version: String = db
        .connection
        .query_row("SELECT sqlite_version()", [], |r| r.get(0))
        .unwrap();
    println!(
        "DEV003-T09 synthetic={count} SQLite={version} main_bytes={} wal_bytes={}",
        std::fs::metadata(&path).unwrap().len(),
        std::fs::metadata(temp.path().join("study.sqlite3-wal"))
            .unwrap()
            .len()
    );

    let mut query = SearchQuery {
        subject_id: Some("math".into()),
        knowledge_id: Some("bench-root".into()),
        keyword: Some("合成特征".into()),
        descendants: true,
        page: 0,
        page_size: 25,
    };
    let plan = format!(
        "EXPLAIN QUERY PLAN {}",
        crate::db::search::search_sql(true, true, true)
    );
    let mut statement = db.connection.prepare(&plan).unwrap();
    let rows = statement
        .query_map(
            params!["math", "bench-root", true, "合成特征", 26, 0],
            |r| r.get::<_, String>(3),
        )
        .unwrap();
    for row in rows {
        println!("QUERY PLAN {}", row.unwrap());
    }
    let expected = (1..=count)
        .filter(|n| n % 10 == 0 && n % 7 != 0)
        .map(|n| format!("synthetic-{n:06}"))
        .collect::<Vec<_>>();
    let mut actual = Vec::new();
    loop {
        let page = db.search_questions(&query).unwrap();
        actual.extend(page.hits.into_iter().map(|hit| hit.id));
        if !page.has_next {
            break;
        }
        query.page += 1;
    }
    assert_eq!(actual, expected);
    println!(
        "pagination verified: {} distinct matches, {} pages, last page {}",
        actual.len(),
        query.page + 1,
        (actual.len() - 1) % 25 + 1
    );
    for (label, page) in [("combined-first", 0), ("combined-late", 30)] {
        query.page = page;
        time_queries(&db, label, &query);
    }
    query.subject_id = None;
    query.knowledge_id = None;
    query.page = 60;
    time_queries(&db, "global-keyword-late", &query);
}

fn time_queries(db: &Database, label: &str, query: &SearchQuery) {
    let samples = 30;
    let mut durations: Vec<_> = (0..samples)
        .map(|_| {
            let start = Instant::now();
            assert_eq!(
                db.search_questions(query).unwrap().hits.len(),
                query.page_size as usize
            );
            start.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    durations.sort_by(f64::total_cmp);
    println!(
        "{label}: iterations={samples} min_ms={:.3} p50_ms={:.3} p95_ms={:.3} max_ms={:.3}",
        durations[0],
        (durations[14] + durations[15]) / 2.0,
        durations[28],
        durations[29]
    );
}
