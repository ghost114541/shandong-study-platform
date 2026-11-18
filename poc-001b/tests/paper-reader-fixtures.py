
"""Generate original test-only PDF fixtures and verify an actual Schema 5 upgrade."""
import hashlib
import json
import shutil
import sqlite3
import sys
from pathlib import Path



def fixtures(output):
    import pymupdf as pdf

    output.mkdir(parents=True, exist_ok=True)
    originals = (("original", 6), ("answer", 1), ("analysis", 2),
                 ("perf20", 20), ("perf100", 100), ("too-many", 501))
    for name, count in originals:
        with pdf.open() as doc:
            for index in range(count):
                page = doc.new_page(width=595, height=842)
                page.draw_rect(pdf.Rect(50, 55, 545, 785), color=(0.7, 0.8, 0.9))
                page.insert_text((75, 92), f"KnowPaper original fixture  |  {name.upper()}",
                                 fontsize=20, color=(0.08, 0.21, 0.41))
                page.insert_text((75, 130), f"Page {index + 1} of {count}", fontsize=13)
                if index in (0, 1, 49, 99):
                    page.insert_text((75, 172), "ORBITAL  x^2 + 3x - 10 = 0", fontsize=19)
                    page.insert_text((75, 218), "Find both roots and sketch the graph.", fontsize=15)
                    shape = page.new_shape()
                    shape.draw_bezier((105, 290), (155, 445), (250, 445), (310, 290))
                    shape.finish(color=(0.05, 0.35, 0.29), width=2.5)
                    shape.commit()
                    page.draw_line((96, 355), (320, 355))
                    page.draw_line((200, 270), (200, 418))
                else:
                    page.insert_text((75, 195), "Continue the calculation on this page.", fontsize=15)
                if index == 0 and name == "original":
                    page.insert_text((75, 470), "External-link annotation (inert in reader)", fontsize=14)
                    page.insert_link({"kind": pdf.LINK_URI, "from": pdf.Rect(74, 450, 413, 475),
                                      "uri": "https://example.invalid/knowpaper-fixture"})
                if index == 1 and name == "original":
                    page.set_rotation(90)
            doc.save(output / f"{name}.pdf", deflate=True)
    with pdf.open(output / "original.pdf") as source, pdf.open() as scanned:
        for original in source:
            pixels = original.get_pixmap()
            page = scanned.new_page(width=original.rect.width, height=original.rect.height)
            page.insert_image(page.rect, pixmap=pixels)
        scanned.save(output / "scan.pdf", deflate=True)
    with pdf.open(output / "answer.pdf") as secret:
        secret.save(output / "encrypted.pdf", encryption=pdf.PDF_ENCRYPT_AES_256,
                    owner_pw="test-only-owner", user_pw="test-only-reader", permissions=0)
    (output / "damaged.pdf").write_bytes(b"%PDF-1.7\ntruncated fixture\n%%EOF\n")
    (output / "disguised.pdf").write_bytes(b"This is text with a PDF extension")
    with (output / "too-large.pdf").open("wb") as large:
        large.truncate(64 * 1024 * 1024 + 1)
    for name in ("original", "scan", "answer", "analysis", "perf20", "perf100"):
        path = output / f"{name}.pdf"
        print(f"{path.name}: {path.stat().st_size} bytes, SHA-256 {hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()}")


TABLES = ("subject", "knowledge_point", "knowledge_alias", "paper", "paper_user_metadata",
          "question", "question_part", "question_occurrence", "question_revision", "question_duplicate",
          "question_knowledge", "question_annotation", "question_tag", "verification_record",
          "revision_search_text", "attachment", "revision_attachment", "composition", "composition_item")


def database_snapshot(path, expected):
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
        assert db.execute("PRAGMA user_version").fetchone() == (expected,)
        assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        names = set(row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'"))
        records = {}
        for table in TABLES:
            if table not in names:
                continue
            columns = "id, title" if table == "paper" else "*"
            rows = db.execute(f"SELECT {columns} FROM {table} ORDER BY rowid").fetchall()
            records[table] = {"count": len(rows), "sha256": hashlib.sha256(
                json.dumps(rows, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")).hexdigest()}
        migrations = db.execute(
            "SELECT version, name, checksum, applied_at FROM schema_migration WHERE version <= 5 ORDER BY version"
        ).fetchall()
        return {"data": records, "history": migrations}


def upgrade(old, isolated, snapshot, action):
    assert old.parent.name.startswith("org.shandong-study.dev006-")
    assert isolated.parent.name.startswith("org.shandong-study.dev007-")
    assert old.name == isolated.name == "study.sqlite3"
    if action == "backup":
        assert not isolated.exists()
        isolated.parent.mkdir(parents=True, exist_ok=True)
        baseline = database_snapshot(old, 5)
        assert baseline["data"]["question_revision"]["count"] > 0
        assert baseline["data"]["composition"]["count"] > 0
        with sqlite3.connect(old.as_uri() + "?mode=ro", uri=True) as source, sqlite3.connect(isolated) as target:
            source.backup(target)
        if (old.parent / "attachments").is_dir():
            shutil.copytree(old.parent / "attachments", isolated.parent / "attachments")
        assert database_snapshot(isolated, 5) == baseline
        snapshot.write_text(json.dumps(baseline, indent=2), encoding="utf-8")
        print("SQLite backup from actual DEV-006 test profile verified at Schema 5")
    else:
        before = json.loads(snapshot.read_text(encoding="utf-8"))
        after = database_snapshot(isolated, 6)
        assert json.loads(json.dumps(after)) == before
        print("Schema 6: identical record hashes and counts for historical tables; same migrations 1 to 5; integrity_check and foreign_key_check PASS")
        for name, record in after["data"].items():
            print(f"{name}: rows={record['count']} sha256={record['sha256']}")


def memory(pid):
    import psutil

    app = psutil.Process(pid)
    info = app.memory_info()
    descendants = [child for child in app.children(recursive=True) if child.name().lower() == "msedgewebview2.exe"]
    print(json.dumps({
        "appWorkingSet": info.rss,
        "appLifetimePeakWorkingSet": info.peak_wset,
        "webviewTreeWorkingSetSample": sum(child.memory_info().rss for child in descendants),
        "webviewTreeProcessCount": len(descendants),
    }))


def verify_outputs(folder):
    import pymupdf as pdf

    crops = [pdf.Pixmap(folder / f"capture-{index}.png") for index in (1, 2)]
    for index, crop in enumerate(crops, 1):
        print(f"capture-{index}.png: {crop.width} x {crop.height} pixels")
    with pdf.open(folder / "capture-composition-paper.pdf") as paper:
        stem = "".join(page.get_text() for page in paper)
        assert "ORBITALCAPTURE" in stem and "根为" not in stem
        embedded = [pdf.Pixmap(paper, image["xref"]) for page in paper
                    for image in page.get_image_info(xrefs=True)]
        assert len(embedded) == len(crops)
        for image, crop in zip(embedded, crops):
            assert (image.width, image.height) == (crop.width, crop.height)
            assert (pdf.Pixmap(image, 0) if image.alpha else image).samples == (
                pdf.Pixmap(crop, 0) if crop.alpha else crop).samples
        print(f"E2E-001 question PDF: {len(paper)} pages, both original PNGs match pixel for pixel")
    with pdf.open(folder / "capture-composition-answers.pdf") as answers:
        text = "".join("".join(page.get_text().split()) for page in answers)
        assert "根为2和-5" in text and "ORBITALCAPTURE" not in text
        assert all(not page.get_image_info() for page in answers)
        print(f"E2E-001 answer PDF: {len(answers)} pages, expected answer and no screenshot images")
    native_print = folder / "system-printed-original.pdf"
    if native_print.exists():
        with pdf.open(native_print) as printed:
            assert len(printed) == 1
            bitmap = printed[0].get_pixmap()
            assert min(bitmap.samples) < 30 and max(bitmap.samples) > 220
            bitmap.save(folder / "system-print-page.png")
        print("Microsoft Print to PDF created a one-page document with visible page content")


if __name__ == "__main__":
    mode, *args = sys.argv[1:]
    if mode == "fixtures":
        fixtures(Path(args[0]))
    elif mode == "memory":
        memory(int(args[0]))
    elif mode == "verify":
        verify_outputs(Path(args[0]))
    else:
        upgrade(*(Path(value).resolve() for value in args), mode)
