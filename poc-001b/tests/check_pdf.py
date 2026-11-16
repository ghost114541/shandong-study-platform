"""Check the three application-generated PDFs and render pages for visual review."""
import argparse
from pathlib import Path
import re

import fitz

LABELS = ("1.1", "1.2", "1.3", "2.1", "2.2", "3.1")


def check(folder, name, render_dir):
    with fitz.open(folder / name) as pdf:
        print(f"{name}: {len(pdf)} page(s)")
        if name == "paper-long.pdf":
            assert len(pdf) >= 2
        else:
            assert len(pdf) == 1
        texts = []
        for index, page in enumerate(pdf, 1):
            print(f"  page {index}: {page.rect.width:.2f} x {page.rect.height:.2f} pt")
            assert abs(page.rect.width - 595.28) < 2
            assert abs(page.rect.height - 841.89) < 2
            assert page.get_text().strip(), f"blank page {index}"
            for line in page.get_text("blocks"):
                assert fitz.Rect(line[:4]) in page.rect, f"page {index}: text outside page"
            texts.append(page.get_text())
            if render_dir:
                page.get_pixmap(matrix=fitz.Matrix(1.3, 1.3)).save(
                    render_dir / f"{Path(name).stem}-{index}.png"
                )
        text = re.sub(r"\s+", "", "".join(texts))
        for label in LABELS:
            assert f"（{label}）" in text or f"({label})" in text, label
        assert "总分40分" in text
        for marker in ("顶点(2,-1)", "对称轴x=2", "v=at=6", "CaCl"):
            assert (marker in text) == (name == "answers.pdf"), marker
        if name == "paper-long.pdf":
            for number in range(1, 37):
                assert text.count(f"分页检查{number:02}") == 1, number


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--render", type=Path)
    args = parser.parse_args()
    if args.render:
        args.render.mkdir(parents=True, exist_ok=True)
    for name in ("paper.pdf", "answers.pdf", "paper-long.pdf"):
        check(args.folder, name, args.render)
    print("PDF text, numbering, A4 and long-pagination checks PASS")


if __name__ == "__main__":
    main()
