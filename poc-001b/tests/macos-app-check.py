"""Run the feature-gated application in an isolated macOS profile and inspect PDF output."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
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
    for name, data in (("info", info), ("text", text), ("fonts", fonts), ("images", images)):
        base.with_name(base.name + "-" + name + ".txt").write_text(data, encoding="utf-8")
    subprocess.run(["pdftoppm", "-r", "85", "-png", target, base], check=True)
    pages = int(re.search(r"^Pages:\s+(\d+)", info, re.M).group(1))
    boxes = re.findall(r"^Page\s+\d+\s+MediaBox:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)", info, re.M)
    assert pages >= 1 and len(boxes) == pages, info
    for left, bottom, right, top in (tuple(map(float, box)) for box in boxes):
        assert abs(right - left - 595.28) < 2 and abs(top - bottom - 841.89) < 2, info
    assert all(page.strip() for page in text.rstrip("\f").split("\f")), target
    assert not any(label in text for label in (
        "试卷库", "数据管理", "导出当前 PDF", "存在可恢复草稿", "查看可恢复草稿",
    )), target
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
    return {"pages": pages, "bytes": target.stat().st_size,
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
