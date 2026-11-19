"""Generate and inspect synthetic DEV-010 integration data. Never write to the source profile."""
import hashlib
import io
import json
import os
from pathlib import Path
import random
import re
import shutil
import sqlite3
import sys
import zipfile

APPDATA = Path(os.environ["APPDATA"])
IDENTIFIER = re.compile(r"org\.shandong-study\.dev010-[a-f0-9]{8}")
DB = "study.sqlite3"

def sha(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()

def read_database(path):
    return sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)

def seed(source_name, identifier):
    assert source_name.startswith("org.shandong-study.dev009-") and Path(source_name).name == source_name
    assert IDENTIFIER.fullmatch(identifier)
    source = APPDATA / source_name
    target = APPDATA / identifier
    assert not target.exists()
    target.mkdir()
    with read_database(source / DB) as old, sqlite3.connect(target / DB) as new:
        assert old.execute("PRAGMA user_version").fetchone() == (8,)
        old.backup(new)
        new.execute("PRAGMA foreign_keys=ON")
        new.execute("""INSERT INTO verification_record(revision_id,reviewer,checked_on,evidence,verdict)
                        VALUES(1,'DEV-010 synthetic reviewer','2026-11-19','Synthetic answer evidence','passed')""")
        new.execute("""INSERT INTO question_duplicate(duplicate_id,canonical_id,reviewer,confirmed_on,evidence)
                        VALUES ('dev008-q2','dev008-q','DEV-010 synthetic reviewer','2026-11-19','Original fixture')""")
    for folder in ("attachments", "paper-pdfs"):
        shutil.copytree(source / folder, target / folder)
    existing = source / "questions.json"
    if existing.is_file():
        shutil.copyfile(existing, target / "questions.json")
    else:
        (target / "questions.json").write_text(json.dumps({
            "schema_version": 1, "document_type": "poc001b_question_set",
            "questions": [{"id": "synthetic-legacy-question"}],
        }), encoding="utf-8")

def snapshot(root):
    root = root.resolve()
    with read_database(root / DB) as db:
        assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        tables = {}
        for (name,) in db.execute("""SELECT name FROM sqlite_schema WHERE type='table'
            AND name NOT LIKE 'sqlite_%' AND name!='backup_record' ORDER BY name"""):
            assert re.fullmatch(r"[a-z_]+", name), name
            rows = db.execute(f"SELECT * FROM {name} ORDER BY rowid").fetchall()
            tables[name] = [len(rows), hashlib.sha256(json.dumps(rows).encode()).hexdigest()]
        rows = db.execute("SELECT version,name,checksum,applied_at FROM schema_migration ORDER BY version").fetchall()
    blobs = {file.relative_to(root).as_posix(): [file.stat().st_size, sha(file)]
             for folder in ("attachments", "paper-pdfs")
             for file in sorted((root / folder).glob("*/*")) if file.is_file() and not file.name.startswith(".")}
    if (root / "questions.json").is_file():
        blobs["questions.json"] = [(root / "questions.json").stat().st_size, sha(root / "questions.json")]
    return {"tables": tables, "migrations": rows, "blobs": blobs}

def archive_variants(archive, destination):
    with zipfile.ZipFile(archive) as source:
        manifest = json.loads(source.read("manifest.json"))
        (destination / "manifest-sample.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        (destination / "backup-sha256.txt").write_text(sha(archive) + "\n", encoding="ascii")
        first_pdf = next(m["path"] for m in manifest["files"] if m["kind"] == "pdf")
        first_image = next(m["path"] for m in manifest["files"] if m["kind"] == "image")
        for variant in ("manifest", "future-version", "future-schema", "traversal", "missing-image", "bad-pdf", "bad-db"):
            target = destination / f"{variant}.knowbackup"
            changed = json.loads(json.dumps(manifest))
            if variant == "future-version":
                changed["version"] = 2
            if variant == "future-schema":
                changed["schema_version"] = 10
            if variant == "traversal":
                next(m for m in changed["files"] if m["kind"] == "legacy")["path"] = "../questions.json"
            with zipfile.ZipFile(target, "w", zipfile.ZIP_STORED) as output:
                for entry in changed["files"]:
                    name = entry["path"]
                    if variant == "traversal" and name == "../questions.json":
                        output.writestr(name, source.read("questions.json"))
                        continue
                    if variant == "missing-image" and name == first_image:
                        continue
                    data = source.read(name)
                    if variant == "bad-pdf" and name == first_pdf or variant == "bad-db" and name == DB:
                        data = bytes([data[0] ^ 0xFF]) + data[1:]
                    if variant == "bad-db" and name == DB:
                        entry["sha256"] = hashlib.sha256(data).hexdigest()
                        changed["database_sha256"] = entry["sha256"]
                    output.writestr(name, data)
                output.writestr("manifest.json", "{" if variant == "manifest" else json.dumps(changed))

def perf_assets(root):
    """Rasterized worksheets with scan-like tonal variation, plus formula image assets."""
    from PIL import Image, ImageDraw, ImageFont
    root.mkdir(parents=True, exist_ok=True)
    rng = random.Random(10329)
    font = ImageFont.truetype("arial.ttf", 34)
    for index in range(6):
        pages = []
        for page in range(22):
            pixels = bytes.maketrans(bytes(range(256)), bytes(222 + (i % 32) for i in range(256)))
            width, height = 1240, 1754
            image = Image.frombytes("L", (width, height), rng.randbytes(width * height).translate(pixels))
            draw = ImageDraw.Draw(image)
            draw.rectangle((85, 75, 1150, 1670), outline=75, width=2)
            draw.text((145, 120), f"KnowPaper original scan {index + 1:02}   /   Page {page + 1:02}", font=font, fill=30)
            for item in range(8):
                y = 245 + item * 168
                draw.text((145, y), f"{item+1}. Sketch y = x² + {page+index+item}x - 12.", font=font, fill=30)
                draw.line((145, y + 104, 1030, y + 104), fill=135, width=2)
            pages.append(image)
        destination = root / f"scan-{index:02}.pdf"
        pages[0].save(destination, save_all=True, append_images=pages[1:], resolution=150, quality=76)
        print(f"{destination.name} {destination.stat().st_size} {sha(destination)}")
    for index in range(46):
        image = Image.new("RGB", (680, 220), "white")
        draw = ImageDraw.Draw(image)
        draw.text((48, 72), f"y = x² + {index}x - 12", font=font, fill="#183e59")
        path = root / f"formula-{index:02}.png"
        image.save(path)

def editor_image(path):
    from PIL import Image, ImageDraw, ImageFont
    image = Image.new("RGB", (580, 150), "white")
    draw = ImageDraw.Draw(image)
    draw.text((26, 44), "y = x² + 3x - 10",
              fill="#18536b", font=ImageFont.truetype("arial.ttf", 42))
    image.save(path)

def copy_sqlite(source, destination):
    assert not destination.exists()
    with read_database(source) as original, sqlite3.connect(destination) as copy:
        original.backup(copy)

def oversized_manifest(source, destination):
    with zipfile.ZipFile(source) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    database = next(member for member in manifest["files"] if member["kind"] == "database")
    database["bytes"] = 1 << 60
    manifest["total_bytes"] = sum(member["bytes"] for member in manifest["files"])
    with zipfile.ZipFile(destination, "x") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))

def hold_database_lock(root, ready, release):
    import time
    with sqlite3.connect(root / DB, timeout=5) as db:
        db.execute("BEGIN IMMEDIATE")
        ready.write_text("locked", encoding="utf-8")
        stop = time.monotonic() + 60
        while not release.exists() and time.monotonic() < stop:
            time.sleep(0.05)
        db.rollback()

if __name__ == "__main__":
    args = sys.argv[2:]
    sys.stdout.reconfigure(encoding="utf-8")
    match sys.argv[1]:
        case "seed": seed(*args)
        case "snapshot": print(json.dumps(snapshot(Path(args[0]))))
        case "variants": archive_variants(*map(Path, args))
        case "perf-assets": perf_assets(Path(args[0]))
        case "editor-image": editor_image(Path(args[0]))
        case "hold-lock": hold_database_lock(*map(Path, args))
        case "copy-sqlite": copy_sqlite(*map(Path, args))
        case "oversized-manifest": oversized_manifest(*map(Path, args))
        case other: raise ValueError(other)
