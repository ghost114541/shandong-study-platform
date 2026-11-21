"""Inspect isolated DEV-008 Windows profiles and generate original benchmark records."""
import hashlib
import json
import re
import shutil
import sqlite3
import sys
from pathlib import Path

HISTORY_TABLES = (
    "subject", "question", "question_part", "question_revision", "question_duplicate",
    "verification_record", "knowledge_point", "knowledge_alias", "question_knowledge",
    "paper", "paper_file", "paper_region", "question_occurrence", "composition", "composition_item",
    "attachment", "revision_attachment", "question_annotation", "question_tag",
    "paper_user_metadata", "revision_search_text",
)
RESOURCES = ("attachments", "paper-pdfs")


def connect(path, mode):
    return sqlite3.connect(path.as_uri() + "?mode=" + mode, uri=True)


def snapshot(db, directory, version):
    assert db.execute("PRAGMA user_version").fetchone() == (version,)
    assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    tables = {}
    for table in HISTORY_TABLES:
        rows = db.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
        data = json.dumps(rows, ensure_ascii=False).encode("utf-8")
        tables[table] = {"rows": len(rows), "sha256": hashlib.sha256(data).hexdigest()}
    files = {}
    for family in RESOURCES:
        for path in sorted((directory / family).rglob("*")):
            if path.is_file():
                with path.open("rb") as handle:
                    files[path.relative_to(directory).as_posix()] = hashlib.file_digest(handle, "sha256").hexdigest()
    history = db.execute(
        "SELECT * FROM schema_migration WHERE version <= 6 ORDER BY version"
    ).fetchall()
    return {"tables": tables, "files": files, "migration_history": history}


def seed(db, size):
    result = []
    document = json.dumps({
        "schema_version": 1, "question_type": "解答题", "score": 1, "parts": [],
        "stem": {"type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": "合成性能测试函数练习"}
        ]}]},
    }, ensure_ascii=False)
    for index in range(size):
        key = f"dev008-perf-{size}-{index:04d}"
        if index % 3 == 0:
            kind = "question"
            db.execute("INSERT INTO question(id,subject_id) VALUES (?,'math')", (key,))
            db.execute("INSERT INTO question_revision(question_id,scope,content_version,content_json) "
                       "VALUES (?,'user',1,?)", (key, document))
        elif index % 3 == 1:
            kind = "paper"
            db.execute("INSERT INTO paper(id,title,subject_id) VALUES (?,?,'math')", (key, key))
        else:
            kind = "knowledge"
            db.execute("INSERT INTO knowledge_point(id,title,subject_id) VALUES (?,?,'math')", (key, key))
        result.append({"kind": kind, "id": key})
    return result


def main():
    action, raw_path, *args = sys.argv[1:]
    path = Path(raw_path).resolve()
    assert path.name == "study.sqlite3"
    dev009 = re.fullmatch(r"org\.shandong-study\.dev009-[a-f0-9]{8}", path.parent.name) is not None
    assert dev009 or path.parent.name == "org.shandong-study.dev010-1200ab72" or path.parent.name.startswith(
        "org.shandong-study.dev008-"
    )
    if action == "backup":
        assert not dev009
        source = Path(args[0]).resolve()
        assert source.name == path.name and source.parent.name.startswith("org.shandong-study.dev007-")
        assert not path.exists()
        path.parent.mkdir(parents=True, exist_ok=True)
        with connect(source, "ro") as old, sqlite3.connect(path) as new:
            old.backup(new)
        for family in RESOURCES:
            if (source.parent / family).exists():
                shutil.copytree(source.parent / family, path.parent / family)
        with connect(path, "ro") as db:
            before = snapshot(db, path.parent, 6)
        assert before["tables"]["question_revision"]["rows"] > 0
        assert before["tables"]["paper_file"]["rows"] > 0
        Path(args[1]).write_text(json.dumps(before, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Schema 6 SQLite backup includes {len(before['files'])} hashed resource files.")
        return
    if action == "verify-upgrade":
        assert not dev009
        before = json.loads(Path(args[0]).read_text(encoding="utf-8"))
        with connect(path, "ro") as db:
            after = snapshot(db, path.parent, 7)
            assert json.loads(json.dumps(after)) == before
            assert db.execute("SELECT id,name,is_default FROM favorite_collection").fetchall() == [
                ("default", "默认收藏夹", 1)
            ]
            assert db.execute("SELECT count(*) FROM favorite_member").fetchone() == (0,)
        print(f"Schema 6 → 7: {len(after['tables'])} table hashes/counts, all six history rows and "
              f"{len(after['files'])} file hashes preserved; one default; integrity/FK checks passed.")
        return
    if action == "memory":
        import runpy
        existing = Path(__file__).with_name("paper-reader-fixtures.py")
        runpy.run_path(str(existing))["memory"](int(args[0]))
        return
    with connect(path, "rw") as db:
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("PRAGMA recursive_triggers = ON")
        version = db.execute("PRAGMA user_version").fetchone()[0]
        assert version == (8 if dev009 else 7)
        if action == "lock":
            db.execute("BEGIN IMMEDIATE")
            print("locked", flush=True)
            sys.stdin.readline()
        elif action == "seed":
            print(json.dumps(seed(db, int(args[0]))))
        elif action == "merge":
            size = int(args[0])
            db.execute("INSERT INTO question_duplicate(duplicate_id,canonical_id,reviewer,confirmed_on,evidence) "
                       "VALUES (?,?,'测试员',date('now'),'人工核对合成样本')",
                       (f"dev008-perf-{size}-0003", f"dev008-perf-{size}-0000"))
        elif action == "state":
            assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []
            print(json.dumps({
                "version": version,
                "names": [name for name, in db.execute("SELECT name FROM favorite_collection ORDER BY sort_order,id")],
                "relations": db.execute("SELECT m.collection_id, f.original_id, f.important "
                                        "FROM favorite_member m JOIN favorite_identity f ON f.id = m.target_id").fetchall(),
            }))
        else:
            raise ValueError(action)


if __name__ == "__main__":
    main()
