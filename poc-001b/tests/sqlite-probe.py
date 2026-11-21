"""Inspect, lock and seed review evidence in the isolated Windows test profile."""
import json
import re
import shutil
import sqlite3
import struct
import sys
import zlib
from pathlib import Path


def picture(path, variant=False):
    width, height = 170, 100
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = []
    for y in range(height):
        pixels = bytearray([0])
        for x in range(width):
            curve = 74 - (x - 85) ** 2 / 103
            if abs(y - curve) < 2:
                pixels.extend((155, 64, 56) if variant else (18, 110, 104))
            elif x in (12, 85) or y == 90:
                pixels.extend((58, 79, 94))
            else:
                pixels.extend((236, 246, 247))
        rows.append(pixels)
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
                           + chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b""))


def main():
    command, path, *args = sys.argv[1:]
    if command in ("picture", "attachment-picture"):
        picture(path, variant=command == "attachment-picture")
        return
    profile = Path(path).parent.name
    dev009 = re.fullmatch(r"org\.shandong-study\.dev009-[a-f0-9]{8}", profile) is not None
    dev010 = re.fullmatch(r"org\.shandong-study\.dev010-[a-f0-9]{8}", profile) is not None
    assert dev009 or dev010 or profile.startswith(tuple(f"org.shandong-study.dev{number:03d}-" for number in range(2, 9))), profile
    assert Path(path).name == "study.sqlite3"
    if command in ("copy-schema-one", "copy-schema-two", "copy-schema-three", "copy-schema-four"):
        source = Path(path)
        target = Path(args[0])
        version = {"copy-schema-one": 1, "copy-schema-two": 2, "copy-schema-three": 3, "copy-schema-four": 4}[command]
        assert source.parent.name.startswith(f"org.shandong-study.dev{version + 1:03d}-")
        assert target.parent.name.startswith(f"org.shandong-study.dev{version + 2:03d}-")
        assert target.name == "study.sqlite3" and not target.exists()
        target.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as old:
            assert old.execute("PRAGMA user_version").fetchone()[0] == version
            with sqlite3.connect(target) as new:
                old.backup(new)
        if version == 4 and (source.parent / "attachments").is_dir():
            shutil.copytree(source.parent / "attachments", target.parent / "attachments")
        print(f"Copied Schema {version} test database using SQLite backup")
        return
    with sqlite3.connect(Path(path).as_uri() + "?mode=rw", uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        if command == "read":
            sql = {
                "questions": "SELECT id, subject_id FROM question",
                "parts": "SELECT question_id, id FROM question_part ORDER BY rowid",
                "revisions": "SELECT id, question_id, base_revision_id, scope, content_json FROM question_revision ORDER BY id",
                "reviews": "SELECT revision_id, verdict FROM verification_record ORDER BY id",
            }
            print(json.dumps({k: [dict(row) for row in db.execute(query)] for k, query in sql.items()}))
        elif command == "snapshot-v2":
            tables = ("subject", "question", "question_part", "question_revision", "question_duplicate",
                      "verification_record", "knowledge_point", "knowledge_alias", "question_knowledge",
                      "paper", "question_occurrence", "composition", "composition_item")
            data = {table: [dict(row) for row in db.execute(f"SELECT * FROM {table} ORDER BY 1, 2")] for table in tables}
            data["revision_search_text"] = [
                dict(row) for row in db.execute("SELECT revision_id, text FROM revision_search_text ORDER BY 1")
            ]
            print(json.dumps(data, sort_keys=True))
        elif command in ("snapshot-v3", "snapshot-v4"):
            tables = ("subject", "question", "question_part", "question_revision", "question_duplicate",
                      "verification_record", "knowledge_point", "knowledge_alias", "question_knowledge",
                      "paper", "question_occurrence", "composition", "composition_item",
                      "question_annotation", "question_tag", "paper_user_metadata", "revision_search_text")
            if command == "snapshot-v4":
                tables += ("attachment", "revision_attachment")
            data = {table: [dict(row) for row in db.execute(f"SELECT * FROM {table} ORDER BY rowid")] for table in tables}
            if command == "snapshot-v4":
                for table in ("composition", "composition_item"):
                    for row in data[table]:
                        for column in ("settings_json", "previous_id", "item_count"):
                            assert row.pop(column, None) is None
            print(json.dumps(data, sort_keys=True))
        elif command == "compose-alias":
            assert dev009 or profile == "org.shandong-study.dev010-1200ab72" or profile.startswith((
                "org.shandong-study.dev006-", "org.shandong-study.dev007-", "org.shandong-study.dev008-",
            ))
            db.execute(
                """INSERT INTO question_duplicate(duplicate_id, canonical_id, reviewer, confirmed_on, evidence)
                   VALUES (?, ?, '验收复核员', date('now'), '原始测试题已逐项核对')""", args,
            )
        elif command == "seed-history-composition":
            assert profile.startswith("org.shandong-study.dev006-")
            assert db.execute("PRAGMA user_version").fetchone()[0] == 4
            db.execute("INSERT INTO composition(id,title) VALUES ('dev006-legacy-pin','迁移前历史组卷')")
            db.execute("""INSERT INTO composition_item(composition_id,position,question_id,revision_id)
                          SELECT 'dev006-legacy-pin', 1, question_id, id FROM question_revision
                          ORDER BY id LIMIT 1""")
        elif command == "seed-legacy-attachment":
            key = args[0]
            payload = {
                "schema_version": 1, "question_type": "解答题", "score": 0, "parts": [],
                "attachments": [{"id": "missing", "media_type": "image/png", "byte_size": 68, "sha256": "de" * 32}],
                "stem": {"type": "doc", "content": [
                    {"type": "paragraph", "content": [{"type": "text", "text": "外部附件占位验收"}]},
                    {"type": "image", "attrs": {"src": "attachment:missing"}},
                ]},
            }
            db.execute("INSERT INTO question VALUES (?, 'math')", [key])
            db.execute("INSERT INTO question_revision(question_id,scope,content_version,content_json) VALUES (?,'user',1,?)",
                       [key, json.dumps(payload, ensure_ascii=False)])
        elif command == "seed-ui":
            assert dev009 or profile == "org.shandong-study.dev010-1200ab72" or profile.startswith((
                "org.shandong-study.dev004-", "org.shandong-study.dev005-", "org.shandong-study.dev006-",
                "org.shandong-study.dev007-", "org.shandong-study.dev008-",
            ))
            db.execute("PRAGMA recursive_triggers=ON")
            def doc(text):
                return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}
            count = int(args[0]) if args and profile == "org.shandong-study.dev010-1200ab72" else 30
            assert 1 <= count <= 30
            for index in range(count):
                key = f"dev004-ui-page-{index:03d}"
                payload = {"schema_version": 1, "question_type": "解答题", "score": 5, "parts": [],
                           "stem": doc(f"分页样本 {index}"), "answer": doc(f"分页样本答案 {index}")}
                db.execute("INSERT INTO question VALUES (?, 'math')", [key])
                db.execute("INSERT INTO question_revision(question_id,scope,content_version,content_json) VALUES (?,'user',1,?)",
                           [key, json.dumps(payload, ensure_ascii=False)])
            print(f"Seeded {count} synthetic rows for pagination")
        elif command == "info":
            print(json.dumps({"version": db.execute("PRAGMA user_version").fetchone()[0],
                              "migrations": [dict(row) for row in db.execute("SELECT * FROM schema_migration ORDER BY version")]}))
        elif command == "approve":
            db.execute(
                """INSERT INTO verification_record (revision_id, reviewer, checked_on, evidence, verdict)
                   VALUES (?, '桌面用例审核', date('now', '-1 day'), '隔离验收测试，核对两小问答案', 'passed')""",
                [int(args[0])],
            )
        elif command == "expire":
            db.execute(
                """INSERT INTO verification_record (revision_id, reviewer, checked_on, evidence, verdict, expires_on)
                   VALUES (?, '桌面用例审核', date('now', '-3 day'), '隔离到期测试', 'passed', date('now', '-1 day'))""",
                [int(args[0])],
            )
        elif command == "schedule":
            db.execute(
                """INSERT INTO verification_record (revision_id, reviewer, checked_on, evidence, verdict, review_of)
                   SELECT revision_id, '桌面用例复核', date('now', '+1 day'), '隔离未来日期测试', 'passed', id
                   FROM verification_record WHERE revision_id = ? ORDER BY id DESC LIMIT 1""",
                [int(args[0])],
            )
        elif command == "lock":
            db.execute("BEGIN IMMEDIATE")
            print("LOCKED", flush=True)
            sys.stdin.readline()
            db.rollback()
        else:
            raise ValueError(command)


if __name__ == "__main__":
    main()
