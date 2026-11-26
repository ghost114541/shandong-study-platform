"""Verify native composition outputs using Poppler and original pixel fixtures."""

import json
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory

from PIL import Image, ImageChops, ImageDraw


def poppler(command, *arguments):
    return subprocess.check_output([command, *map(str, arguments)], timeout=45)


def generate(path):
    picture = Image.new("RGB", (900, 740), "#1d29d8")
    draw = ImageDraw.Draw(picture)
    for x in range(30, 880, 60):
        draw.line((x, 24, x, 715), fill="#ffffff", width=3)
    for y in range(24, 716, 54):
        draw.line((30, y, 879, y), fill="#ffffff", width=3)
    picture.save(path)


def verify_arm(path, source, count, paper):
    text = poppler("pdftotext", "-layout", "-enc", "UTF-8", path, "-").decode()
    for i in range(1, count + 1):
        expected = [f"STEM{i}END"] if paper else [f"ANSWER{i}END", f"ANALYSIS{i}END"]
        assert all(text.count(marker) == 1 for marker in expected), (count, paper, i, expected)
    forbidden = ("ANSWER", "ANALYSIS", "LATEST") if paper else ("STEM", "PROMPTPART", "LATEST", "TABLEHEADER")
    assert all(marker not in text for marker in forbidden), forbidden
    for part in (1, 2):
        markers = [f"PROMPTPART{part}"] if paper else [f"ANSWERPART{part}", f"ANALYSISPART{part}"]
        assert all(text.count(marker) == 1 for marker in markers), markers
    expected_images = sum(i <= count for i in (1, 3, 12))
    if paper:
        assert all(text.count(marker) == expected_images for marker in ("TABLEHEADER", "TABLEROW", "TABLEEND"))
        assert re.search(r"123\s*=\s*100\s*\+\s*23", text), "Missing standalone formula"
    with TemporaryDirectory() as scratch:
        scratch = Path(scratch)
        poppler("pdfimages", "-png", path, scratch / "asset")
        matches = 0
        for embedded in scratch.glob("asset-*.png"):
            with Image.open(embedded) as candidate:
                candidate = candidate.convert("RGB")
                matches += candidate.size == source.size and not ImageChops.difference(candidate, source).getbbox()
        assert matches == expected_images, (count, paper, matches, expected_images)
        poppler("pdftoppm", "-r", 72, "-png", path, scratch / "page")
        pages = sorted(scratch.glob("page-*.png"))
        assert len(pages) > 1 if count == 12 else pages
        blue_pixels = 0
        for page in pages:
            with Image.open(page) as rendered:
                blue_pixels += sum(b > 155 and r < 100 and g < 100 for r, g, b in rendered.convert("RGB").getdata())
        assert blue_pixels > 40000 * expected_images, (count, paper, blue_pixels)
        return {"pages": len(pages), "images": matches, "blue_pixels": blue_pixels}


def main():
    if sys.argv[1] == "generate":
        generate(Path(sys.argv[2]))
    else:
        assert sys.argv[1] == "check"
        _, _, source, count, paper, answers = sys.argv
        count = int(count)
        with Image.open(source) as picture:
            print(json.dumps({"items": count,
                              "paper": verify_arm(paper, picture, count, True),
                              "answers": verify_arm(answers, picture, count, False)}))


if __name__ == "__main__":
    main()
