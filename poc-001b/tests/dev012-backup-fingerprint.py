"""Validate DEV-012 archives and compare business data across source platforms."""
import hashlib
import json
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

REQUIRED_TABLES = (
    "subject", "question", "question_revision", "verification_record",
    "question_duplicate", "question_occurrence", "knowledge_alias",
    "favorite_member", "favorite_target", "composition_item", "paper_file",
    "attachment", "paper_region", "pack_version", "trash_item", "edit_draft",
)


def checksum(data):
    return hashlib.sha256(data).hexdigest()


def business_fingerprint(archive_path):
    with tempfile.TemporaryDirectory() as temp, zipfile.ZipFile(archive_path) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert (manifest["format"], manifest["version"], manifest["schema_version"]) == (
            "knowpaper-backup", 1, 9
        )
        members = {}
        for member in manifest["files"]:
            path = member["path"]
            parts = PurePosixPath(path).parts
            assert path not in members and "." not in parts and ".." not in parts
            assert not any(char in path for char in ("\\", ":"))
            assert path in ("study.sqlite3", "questions.json") or (
                len(parts) == 3 and parts[0] in ("attachments", "paper-pdfs")
                and parts[1] == member["sha256"][:2] and parts[2] == member["sha256"]
            ), path
            data = archive.read(path)
            assert len(data) == member["bytes"] and checksum(data) == member["sha256"], path
            if path != "study.sqlite3":
                members[path] = member["sha256"]
        assert len(archive.namelist()) == manifest["file_count"] + 1
        assert set(archive.namelist()) == {*members, "study.sqlite3", "manifest.json"}
        db_file = Path(temp, "study.sqlite3")
        db_file.write_bytes(archive.read("study.sqlite3"))
        assert checksum(db_file.read_bytes()) == manifest["database_sha256"]
        with sqlite3.connect(db_file.as_uri() + "?mode=ro", uri=True) as db:
            assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
            assert not db.execute("PRAGMA foreign_key_check").fetchall()
            assert db.execute("PRAGMA user_version").fetchone() == (9,)
            tables = {}
            for (name,) in db.execute(
                "SELECT name FROM sqlite_schema WHERE type='table'"
                " AND name NOT IN ('backup_record', 'sqlite_sequence') ORDER BY name"
            ):
                identifier = '"' + name.replace('"', '""') + '"'
                rows = db.execute(f"SELECT * FROM {identifier}").fetchall()
                encoded = sorted(json.dumps(row, default=lambda value: {"bytes": value.hex()}) for row in rows)
                tables[name] = {"count": len(rows), "sha256": checksum("\n".join(encoded).encode())}
            assert tables["subject"]["count"] == 9
            for name in REQUIRED_TABLES:
                assert tables[name]["count"] > 0, name
            roles = [row[0] for row in db.execute("SELECT DISTINCT role FROM paper_file ORDER BY role")]
            assert roles == ["analysis", "answer", "original"]
            pins = db.execute(
                "SELECT composition_id, revision_id FROM composition_item ORDER BY composition_id, revision_id"
            ).fetchall()
        db.close()
    return {
        "sha256": checksum(archive_path.read_bytes()),
        "manifest": manifest,
        "business": {"tables": tables, "resourceFiles": members, "fixedRevisions": pins},
    }


if __name__ == "__main__":
    windows = business_fingerprint(Path(sys.argv[1]))
    assert windows["manifest"]["platform"] == "windows"
    evidence = {"windows": windows}
    if len(sys.argv) >= 3:
        macos = business_fingerprint(Path(sys.argv[2]))
        assert macos["manifest"]["platform"] == "macos"
        assert windows["business"] == macos["business"]
        evidence["macos"] = macos
    if len(sys.argv) == 4:
        roundtrip = business_fingerprint(Path(sys.argv[3]))
        assert roundtrip["manifest"]["platform"] == "windows"
        assert windows["business"] == roundtrip["business"]
        evidence["windowsRoundtrip"] = roundtrip
    print(json.dumps(evidence, ensure_ascii=True, indent=2))
