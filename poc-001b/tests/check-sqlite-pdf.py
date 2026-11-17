"""Inspect actual DEV-002 WebView2 output, and render each PDF for visual review."""
import argparse
import json
import re
from pathlib import Path

import fitz


def check(path, expected, omitted, render_dir, paper=False):
    with fitz.open(path) as pdf:
        assert len(pdf) == 1, path.name
        page = pdf[0]
        assert abs(page.rect.width - 595.28) < 2 and abs(page.rect.height - 841.89) < 2
        text = re.sub(r"\s+", "", page.get_text())
        for token in ("知卷试题", "总分10分", "第1题", "数学", "（1.1）4分", "（1.2）6分", *expected):
            assert token in text, (path.name, token, text)
        for token in omitted:
            assert token not in text, (path.name, token)
        for block in page.get_text("blocks"):
            assert fitz.Rect(block[:4]) in page.rect, (path.name, block)
        images = [(img[2], img[3]) for img in page.get_images()]
        fonts = [font[3] for font in page.get_fonts()]
        assert ((170, 100) in images) == paper, (path.name, images)
        if paper:
            assert any("KaTeX" in name for name in fonts), fonts
        print(f"{path.name}: A4 {page.rect.width:.2f} x {page.rect.height:.2f} pt, images={images}, fonts={fonts}")
        if render_dir:
            page.get_pixmap(matrix=fitz.Matrix(1.3, 1.3)).save(render_dir / (path.stem + ".png"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--render", type=Path)
    args = parser.parse_args()
    if args.render:
        args.render.mkdir(parents=True, exist_ok=True)
    evidence = json.loads((args.folder / "sqlite-evidence.json").read_text(encoding="utf8"))
    a, b = [item["id"] for item in evidence["after"]["revisions"]]
    stem = ("数据库原创试题", "观察抛物线", "第一问", "第二问")
    old_answer = "原答案乙"
    new_answer = "修订后答案乙"
    check(args.folder / f"revision-{b}-paper.pdf", ("题卷", *stem), (old_answer, new_answer, "原答案甲"), args.render, paper=True)
    check(args.folder / f"revision-{a}-answers.pdf", ("答案卷", "原答案甲", old_answer), (*stem, new_answer), args.render)
    check(args.folder / f"revision-{b}-answers.pdf", ("答案卷", "原答案甲", new_answer, "纵坐标是六"), (*stem, old_answer), args.render)
    print("DEV002-T08 PASS: database revision PDFs, A4, Chinese, KaTeX fonts, embedded image, numbering, points and answer separation")


if __name__ == "__main__":
    main()
