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
            # Quartz may extract the simplified horn radical used by the CJK
            # font. Unicode NFKC has no mapping for U+2EC6 (⻆).
            assert re.search(r"兼容字:神。全[角⻆]:ABC123。", normalized), target
            assert re.findall(r"PART-(\d+)-([AB])", text) == [
                (f"{number:03}", part) for number in range(1, expected + 1) for part in "AB"
            ], target
            details["mathPages"] = {}
            for index in (17, 34, 51):
                begin, end = f"MATH-{index:03}", f"END-MATH-{index:03}"
                match = re.search(rf"(?<!END-){begin}(.*?){end}", text, re.S)
                assert match and "∫" in match[1], (target, begin)
                details["mathPages"][begin] = [
                    page for page, content in enumerate(page_text, 1) if begin in content
                ]
            details["literalCopy"] = {query: query in compact for query in (
                "试卷", "中文", "中⽂", "全角", "全⻆", "神", "神", "ＡＢＣ１２３", "ABC123",
            )}
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
    evidence = {}
    failures = {}
    files = [("single", results["single"], 0, False)]
    for count, pair in results["pairs"].items():
        for kind in ("paper", "answers"):
            files.append((f"{kind}-{count}", pair[kind], int(count), kind == "answers"))
    for name, source, count, answers in files:
        try:
            evidence[name] = inspect_pdf(source, output / f"{name}.pdf", count, answers)
        except (AssertionError, OSError, subprocess.CalledProcessError) as error:
            failures[name] = str(error)
    tables = results.get("tables")
    if os.environ.get("GITHUB_REF_NAME") == "dev/dev-013-rich-tables":
        assert tables, "DEV-013 CI must generate the table PDFs"
    if tables:
        for name, src in (("table-single-paper", tables["paper"]), ("table-single-answers", tables["answers"]),
                          ("table-pair-paper", tables["pair"]["paper"]), ("table-pair-answers", tables["pair"]["answers"])):
            try:
                evidence[name] = inspect_table(src, output / f"{name}.pdf")
            except (AssertionError, OSError, subprocess.CalledProcessError) as error:
                failures[name] = str(error)
    (output / "pdf-summary.json").write_text(json.dumps(evidence, indent=2) + "\n")
    pdf_root = Path(results["single"]).parent
    expected_batches = {Path(pair["paper"]).parent for pair in results["pairs"].values()}
    if tables:
        expected_batches.add(Path(tables["pair"]["paper"]).parent)
    assert set(pdf_root.glob("composition-*")) == expected_batches
    assert not list(pdf_root.glob(".composition-staging-*")), "incomplete batch left in staging"
    for batch in expected_batches:
        assert {path.name for path in batch.iterdir()} == {"paper.pdf", "answers.pdf"}
    assert not failures, failures


def inspect_table(source, target):
    summary = inspect_pdf(source, target)
    text = target.with_name(target.stem + "-text.txt").read_text(encoding="utf-8")
    font_text = target.with_name(target.stem + "-fonts.txt").read_text(encoding="utf-8")
    solutions = ("TABSOLUTION", "TABANALYSIS", "TABPARTANSWER", "TABPARTANALYSIS")
    assert "KaTeX" in font_text, target
    if target.stem.endswith("-answers"):
        assert "TABROW" not in text and "TABPART-0" not in text and "STEM-" not in text, target
        for marker in solutions:
            assert re.findall(marker + r"-(00[12])", text) == ["001", "002"], (target, marker)
        expected = "ANSWER"
    else:
        assert all(marker not in text for marker in solutions) and "ANSWER-" not in text, target
        assert re.findall(r"TABROW-(\d{3})", text) and re.findall(r"TABROW-(?!000)(\d{3})", text) == [
            f"{index:03}" for index in range(1, 61)
        ], target
        assert len([page for page in text.split("\f") if re.search(r"TABROW-(?!000)\d{3}", page)]) >= 2
        assert re.findall(r"TABPART-(00[12])", text) == ["001", "002"], target
        assert len(target.with_name(target.stem + "-images.txt").read_text(encoding="utf-8").splitlines()) > 2
        expected = "STEM"
    if "-pair-" in target.stem:
        assert re.findall(expected + r"-(\d{3})", text) == [f"{index:03}" for index in range(2, 21)], target
    summary["tableBodyRows"] = len(re.findall(r"TABROW-(?!000)\d{3}", text))
    return summary


def main():
    if sys.argv[1] == "--inspect":
        inspect_outputs(Path(sys.argv[2]), Path(sys.argv[3]))
        return
    import resource  # macOS runner. Inspection mode also runs on Windows.
    import time

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
    samples = []
    started = time.monotonic()
    with (output / "app-smoke.log").open("wb") as log:
        with subprocess.Popen([executable], env=dict(os.environ, KNOWPAPER_DEV012_SMOKE_REPORT=str(report)),
                              stdout=log, stderr=subprocess.STDOUT) as process:
            try:
                while process.poll() is None:
                    elapsed = time.monotonic() - started
                    if elapsed >= 270:
                        raise subprocess.TimeoutExpired(executable, 270)
                    rss = subprocess.run(["ps", "-o", "rss=", "-p", str(process.pid)],
                                         capture_output=True, text=True, check=False).stdout.strip()
                    if rss.isdecimal():
                        samples.append({"elapsedMs": round(elapsed * 1000), "rssKiB": int(rss)})
                    time.sleep(0.2)
            finally:
                if process.poll() is None:
                    process.kill()
    (output / "app-memory.json").write_text(json.dumps({
        "process": "knowpaper-preview RSS samples, excluding WebKit helpers",
        "peakChildrenUsageBytes": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
        "samples": samples,
    }, indent=2) + "\n")
    if report.exists():
        print(report.read_text())
    if process.returncode:
        raise subprocess.CalledProcessError(process.returncode, executable)
    inspect_outputs(report, output)


if __name__ == "__main__":
    main()
