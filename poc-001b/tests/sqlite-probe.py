"""Inspect, lock and seed review evidence in the isolated Windows test profile."""
import json
import sqlite3
import struct
import sys
import zlib
from pathlib import Path


def picture(path):
    width, height = 170, 100
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = []
    for y in range(height):
        pixels = bytearray([0])
        for x in range(width):
            curve = 74 - (x - 85) ** 2 / 103
            if abs(y - curve) < 2:
                pixels.extend((18, 110, 104))
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
    if command == "picture":
        picture(path)
        return
    profile = Path(path).parent.name
    assert profile.startswith(("org.shandong-study.dev002-", "org.shandong-study.dev003-")), profile
    assert Path(path).name == "study.sqlite3"
    if command == "copy-schema-one":
        source = Path(path)
        target = Path(args[0])
        assert source.parent.name.startswith("org.shandong-study.dev002-")
        assert target.parent.name.startswith("org.shandong-study.dev003-")
        assert target.name == "study.sqlite3" and not target.exists()
        target.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as old:
            assert old.execute("PRAGMA user_version").fetchone()[0] == 1
            with sqlite3.connect(target) as new:
                old.backup(new)
        print("Copied DEV-002 test database using SQLite backup")
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
