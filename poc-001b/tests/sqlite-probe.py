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
    assert profile.startswith("org.shandong-study.dev002-"), profile
    assert Path(path).name == "study.sqlite3"
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
        elif command == "approve":
            db.execute(
                """INSERT INTO verification_record (revision_id, reviewer, checked_on, evidence, verdict)
                   VALUES (?, '桌面用例审核', '2026-11-16', '隔离验收测试，核对两小问答案', 'passed')""",
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
