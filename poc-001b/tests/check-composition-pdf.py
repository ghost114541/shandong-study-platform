"""Verify the original Windows composition PDFs and render PNGs for visual review."""
import argparse
import re
import unicodedata
from pathlib import Path

import pymupdf


def compact(text):
    return re.sub(r"[\s\u200b]+", "", unicodedata.normalize("NFKC", text))


def read_pdf(path, render, fixture=None):
    with pymupdf.open(path) as pdf:
        assert len(pdf) == 2, (path, len(pdf))
        texts = []
        image_total = 0
        for index, page in enumerate(pdf, 1):
            assert abs(page.rect.width - 595.28) < 2 and abs(page.rect.height - 841.89) < 2, page.rect
            texts.append(compact(page.get_text()))
            for info in page.get_image_info(xrefs=True):
                assert fixture is not None, "unexpected answer image"
                assert (info["width"], info["height"]) == (fixture.width, fixture.height), info
                rect = pymupdf.Rect(info["bbox"])
                assert rect in page.rect and 100 < rect.width <= 130 and 65 < rect.height <= 77, rect
                extracted = pymupdf.Pixmap(pdf, info["xref"])
                assert extracted.samples == fixture.samples, "printed PNG differs from its original pixels"
                image_total += 1
            page.get_pixmap(matrix=pymupdf.Matrix(1.25, 1.25)).save(render / f"{path.stem}-{index}.png")
        if fixture is not None:
            assert image_total == 2, image_total
            assert all(any("KaTeX" in font[3] for font in page.get_fonts()) for page in pdf)
        print(f"{path.name}: two A4 pages, {image_total} raster occurrences")
        return texts


def ordered(text, *tokens):
    start = 0
    for token in tokens:
        index = text.find(compact(token), start)
        assert index >= 0, (token, text[start:start + 450])
        start = index + len(compact(token))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--render", type=Path, required=True)
    args = parser.parse_args()
    args.render.mkdir(parents=True, exist_ok=True)
    png = pymupdf.Pixmap(args.folder / "shared-original.png")
    questions = read_pdf(args.folder / "composition-paper.pdf", args.render, png)
    answers = read_pdf(args.folder / "composition-answers.pdf", args.render)
    question_text, answer_text = "".join(questions), "".join(answers)
    shared = ("总分24分", "45分钟", "数学、物理、化学", "解答题", "第1题·物理（13分）",
              "（1）7分", "（2）6分", "选择题", "第2题·数学（5分）", "填空题", "第3题·化学（6分）")
    for text in (question_text, answer_text):
        ordered(text, *shared)
        assert "新版" not in text
    ordered(question_text, "物理共享材料仅此一次", "物理记录第1行", "物理记录第34行", "建立速度与时间关系",
            "说明测量误差的来源", "数学原题固定题干", "顶点横坐标等于一", "化学原题", "NaOH", "NaCl")
    assert question_text.count("物理共享材料仅此一次") == 1
    assert "物理记录第1行" in questions[0] and "物理记录第34行" in questions[1]
    assert "连续解析段落第1行" in answers[0] and "连续解析段落第36行" in answers[1]
    ordered(answer_text, "物理小问甲答案", "物理小问甲解析", "物理小问乙答案", "物理小问乙解析",
            "连续解析段落第36行", "数学固定答案乙", "数学固定解析", "暂无答案", "化学解析保留")
    assert all(token not in question_text for token in ("数学固定答案", "化学解析保留", "物理小问甲答案", "连续解析段落"))
    assert all(token not in answer_text for token in ("数学原题固定题干", "物理共享材料", "化学原题"))
    print("DEV006-T08/T09/T10/T11 PASS: groups, scores, numbering, fixed revisions, separation, page breaks, chemistry and pixel match")


if __name__ == "__main__":
    main()
