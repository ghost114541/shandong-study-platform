
"""Operate only on isolated native DEV-009 test profiles and emit audit-ready snapshots."""
import hashlib
import json
import shutil
import sqlite3
import sys
import time
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def seed(source, target):
    assert "org.shandong-study.dev008-" in source.name
    assert target.name.startswith("org.shandong-study.dev009-") and not target.exists()
    target.mkdir()
    with sqlite3.connect((source / "study.sqlite3").as_uri() + "?mode=ro", uri=True) as old:
        assert old.execute("PRAGMA user_version").fetchone() == (7,)
        with sqlite3.connect(target / "study.sqlite3") as new:
            old.backup(new)
    for folder in ["attachments", "paper-pdfs"]:
        if (source / folder).exists():
            shutil.copytree(source / folder, target / folder)


def snapshot(root):
    path = root / "study.sqlite3"
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=2) as db:
        version = db.execute("PRAGMA user_version").fetchone()[0]
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        sql = lambda query: db.execute(query).fetchall()
        old_tables = ["subject", "knowledge_point", "knowledge_alias", "question", "question_part",
                      "question_revision", "question_duplicate", "verification_record", "composition", "composition_item",
                      "favorite_collection", "favorite_target", "favorite_member",
                      "attachment", "paper", "paper_file", "paper_region", "question_occurrence", "paper_user_metadata"]
        counts = {}
        fingerprints = {}
        for table in old_tables:
            if not sql(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'"):
                continue
            rows = sql(f"SELECT * FROM {table} ORDER BY rowid")
            counts[table] = len(rows)
            fingerprints[table] = sha(json.dumps(rows, sort_keys=True).encode())
        versions = sql("SELECT pack_id,version,archive_sha,integrity_error FROM pack_version ORDER BY id") if version >= 8 else []
        operations = sql("SELECT pack_id,version,state,pending_cleanup,error FROM pack_operation ORDER BY rowid") if version >= 8 else []
        history = sql("SELECT version,name,checksum FROM schema_migration ORDER BY version")
        users = sql("SELECT id,question_id,sha256 FROM (SELECT id,question_id,hex(content_json) sha256 FROM question_revision WHERE scope='user')")
        user_fingerprints = [[item[0], item[1], sha(bytes.fromhex(item[2]))] for item in users]
        with sqlite3.connect(":memory:") as committed:
            db.backup(committed)
            committed_sha = sha(committed.serialize())
    dirs = ["attachments", "paper-pdfs", "pack-staging"]
    files = {
        str(file.relative_to(root)).replace("\\", "/"): [file.stat().st_size, file_sha(file)]
        for dir in dirs if (root / dir).exists()
        for file in sorted((root / dir).rglob("*")) if file.is_file()
    }
    wal = root / "study.sqlite3-wal"
    return dict(schema=version, database_sha256=file_sha(path), database_wal_sha256=file_sha(wal) if wal.exists() else None,
                sqlite_backup_sha256=committed_sha, counts=counts, fingerprints=fingerprints,
                versions=versions, operations=operations, migrations=history, file_size_sha=files,
                user_revision_fingerprints=user_fingerprints, bytes_on_disk=sum(f.stat().st_size for f in root.rglob("*") if f.is_file()))


def memory(pid, marker):
    import psutil
    process = psutil.Process(pid)
    samples = []
    while not marker.is_file() and len(samples) < 18000:
        try:
            children = process.children(recursive=True)
            webview = 0
            for child in children:
                try:
                    if child.name().lower() == "msedgewebview2.exe":
                        webview += child.memory_info().rss
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            samples.append([time.monotonic(), process.memory_info().rss, webview])
        except psutil.NoSuchProcess:
            break
        time.sleep(0.025)
    print(json.dumps(samples))


if __name__ == "__main__":
    op, *args = sys.argv[1:]
    if op == "seed":
        seed(*map(Path, args))
    elif op == "snapshot":
        print(json.dumps(snapshot(Path(args[0])), ensure_ascii=True))
    elif op == "memory":
        memory(int(args[0]), Path(args[1]))
    else:
        raise ValueError(f"Unknown operation: {op}")
