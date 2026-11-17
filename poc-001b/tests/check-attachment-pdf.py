"""Verify native WebView2 attachment PDFs against the actual PNG chosen in Windows."""
import argparse
import re
from pathlib import Path

import pymupdf


def verify(path, png, required, excluded, parts, render):
    with pymupdf.open(path) as pdf:
        assert len(pdf) == 1, path.name
        page = pdf[0]
        assert abs(page.rect.width - 595.28) < 2 and abs(page.rect.height - 841.89) < 2, page.rect
        text = re.sub(r"\s+", "", page.get_text())
        assert all(token in text for token in required), (path.name, text)
        assert all(token not in text for token in excluded), (path.name, text)
        assert all(token in text for token in parts), (path.name, text)
        assert any("KaTeX" in font[3] for font in page.get_fonts()), (path.name, page.get_fonts())
        matching = [
            info for info in page.get_image_info(xrefs=True)
            if (info["width"], info["height"]) == (png.width, png.height)
        ]
        assert len(matching) == 1, matching
        image = matching[0]
        rect = pymupdf.Rect(image["bbox"])
        assert rect in page.rect and rect.width >= 100 and rect.height >= 50, rect
        extracted = pymupdf.Pixmap(pdf, image["xref"])
        assert extracted.samples == png.samples, (path.name, "printed image pixels differ from selected PNG")
        page.get_pixmap(matrix=pymupdf.Matrix(1.3, 1.3)).save(render / (path.stem + ".png"))
        print(f"{path.name}: A4 {page.rect.width:.2f} x {page.rect.height:.2f} pt, matched all {png.width * png.height} PNG pixels")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--render", type=Path, required=True)
    args = parser.parse_args()
    args.render.mkdir(parents=True, exist_ok=True)
    fixture = pymupdf.Pixmap(args.folder / "curve-dev005.png")
    stem = ("附件题干验证", "第一问", "第二问")
    answer = ("独立答案验证", "小问答案甲", "小问答案乙")
    parts = ("总分10分", "（1.1）4分", "（1.2）6分")
    verify(args.folder / "attachment-paper.pdf", fixture, ("题卷", *stem, "Cl"), answer, parts, args.render)
    verify(args.folder / "attachment-answers.pdf", fixture, ("答案卷", *answer), stem, parts, args.render)
    print("DEV005-T11 PASS: A4, independent answers, Chinese, subquestions, KaTeX and selected attachment pixels")


if __name__ == "__main__":
    main()
