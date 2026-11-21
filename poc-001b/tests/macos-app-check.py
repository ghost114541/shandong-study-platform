"""Run the feature-gated application in an isolated macOS profile and inspect PDF output."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

IDENTIFIER = "org.shandong-study.dev012-74d09001"


def inspect_pdf(source, target, expected=0, answers=False):
    shutil.copyfile(source, target)
    base = target.with_suffix("")
    info = subprocess.check_output(
        ["pdfinfo", "-f", "1", "-l", "500", "-box", target], encoding="utf-8", errors="replace"
    )
    text = subprocess.check_output(["pdftotext", "-enc", "UTF-8", "-layout", target, "-"], encoding="utf-8")
    fonts = subprocess.check_output(["pdffonts", target], encoding="utf-8", errors="replace")
    images = subprocess.check_output(["pdfimages", "-list", target], encoding="utf-8", errors="replace")
    bbox = subprocess.check_output(["pdftotext", "-bbox", target, "-"], encoding="utf-8")
    for name, data in (("info", info), ("text", text), ("fonts", fonts), ("images", images)):
        base.with_name(base.name + "-" + name + ".txt").write_text(data, encoding="utf-8")
    subprocess.run(["pdftoppm", "-r", "85", "-png", target, base], check=True)
    base.with_name(base.name + "-bbox.html").write_text(bbox, encoding="utf-8")
    pages = int(re.search(r"^Pages:\s+(\d+)", info, re.M).group(1))
    boxes = re.findall(r"^Page\s+\d+\s+MediaBox:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)", info, re.M)
    assert pages >= 1 and len(boxes) == pages, info
    for left, bottom, right, top in (tuple(map(float, box)) for box in boxes):
        assert abs(right - left - 595.28) < 2 and abs(top - bottom - 841.89) < 2, info
    page_text = text.rstrip("\f").split("\f")
    assert len(page_text) == pages and all(page.strip() for page in page_text), target
    page_boxes = ET.fromstring(bbox).findall(".//{*}page")
    assert len(page_boxes) == pages, target
    for page in page_boxes:
        width, height = float(page.attrib["width"]), float(page.attrib["height"])
        for word in page.findall("{*}word"):
            left, top, right, bottom = (float(word.attrib[key]) for key in ("xMin", "yMin", "xMax", "yMax"))
            assert -1 <= left <= right <= width + 1 and -1 <= top <= bottom <= height + 1, (target, word.text, word.attrib)
    assert not any(label in text for label in (
        "试卷库", "数据管理", "导出当前 PDF", "存在可恢复草稿", "查看可恢复草稿",
    )), target
    details = {}
    if expected:
        assert "合成试题" in text and f"总分 {expected * 4}" in text
        marker = "ANSWER" if answers else "STEM"
        forbidden = "STEM" if answers else "ANSWER"
        assert forbidden + "-" not in text
        assert re.findall(marker + r"-(\d+)", text) == [f"{n:03d}" for n in range(1, expected + 1)], target
        if answers:
            assert "原创答案" in text
        else:
            assert re.findall(r"READ-(\d+)", text) == [f"{n:03d}" for n in range(1, 56)], target
            assert "KaTeX" in fonts and len(images.splitlines()) > 2, target
            compact = re.sub(r"\s+", "", text)
            normalized = unicodedata.normalize("NFKC", compact)
            assert "简体中文检索:试卷、选择、观察、复习。" in normalized, target
            assert "兼容字:神。全角:ABC123。" in normalized, target
            assert re.findall(r"PART-(\d+)-([AB])", text) == [
                (f"{number:03}", part) for number in range(1, expected + 1) for part in "AB"
            ], target
            details["mathPages"] = {}
            for index in (17, 34, 51):
                begin, end = f"MATH-{index:03}", f"END-MATH-{index:03}"
                match = re.search(rf"(?<!END-){begin}(.*?){end}", text, re.S)
                assert match and "∫" in match[1] and "ln" in match[1], (target, begin)
                details["mathPages"][begin] = [
                    page for page, content in enumerate(page_text, 1) if begin in content
                ]
            details["literalCopy"] = {query: query in compact for query in ("试卷", "神", "神", "ＡＢＣ１２３", "ABC123")}
            details["orphanPartHeadingPages"] = [
                number for number, page in enumerate(page_text, 1)
                if re.search(r"[（(][12][）)]\s*2\s*分\s*$", page)
            ]
    return {"pages": pages, "bytes": target.stat().st_size, **details,
            "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}


def inspect_outputs(report, output):
    output.mkdir(parents=True, exist_ok=True)
    results = json.loads(report.read_text(encoding="utf-8"))
    assert results["ok"] and results["originalPages"] == 100
    evidence = {"single": inspect_pdf(results["single"], output / "single.pdf")}
    for count, pair in results["pairs"].items():
        for kind in ("paper", "answers"):
            name = f"{kind}-{count}"
            evidence[name] = inspect_pdf(pair[kind], output / f"{name}.pdf", int(count), kind == "answers")
    if results.get("faults"):
        pdf_root = Path(results["single"]).parent
        expected_batches = {Path(pair["paper"]).parent for pair in results["pairs"].values()}
        assert set(pdf_root.glob("composition-*")) == expected_batches
        assert not list(pdf_root.glob(".composition-staging-*")), "incomplete batch left in staging"
        for batch in expected_batches:
            assert {path.name for path in batch.iterdir()} == {"paper.pdf", "answers.pdf"}
    (output / "pdf-summary.json").write_text(json.dumps(evidence, indent=2) + "\n")


def main():
    if sys.argv[1] == "--inspect":
        inspect_outputs(Path(sys.argv[2]), Path(sys.argv[3]))
        return
    output = Path(sys.argv[1]).resolve()
    archive = Path(sys.argv[2]).resolve()
    executable = Path(sys.argv[3]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    profile = Path.home() / "Library" / "Application Support" / IDENTIFIER
    profile.mkdir(parents=True, exist_ok=False)
    fingerprint = output.parent / "backup" / "cross-platform-fingerprints.json"
    checked = json.loads(fingerprint.read_text())["windows"]
    approved = checked["business"]["resourceFiles"]
    assert checked["sha256"] == hashlib.sha256(archive.read_bytes()).hexdigest()
    with zipfile.ZipFile(archive) as backup:
        for member in ["study.sqlite3", *approved]:
            if member != "questions.json":
                backup.extract(member, profile)
    report = output / "app-smoke.json"
    with (output / "app-smoke.log").open("wb") as log:
        process = subprocess.run([executable], env=dict(os.environ, KNOWPAPER_DEV012_SMOKE_REPORT=str(report)),
                                 stdout=log, stderr=subprocess.STDOUT, timeout=270)
    if report.exists():
        print(report.read_text())
    process.check_returncode()
    inspect_outputs(report, output)


if __name__ == "__main__":
    main()
