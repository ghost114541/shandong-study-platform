#!/bin/bash
set -euo pipefail

output="$(pwd)/preview-artifacts/pdf"
fixture="$(mktemp -d)"
trap 'rm -r "$fixture"' EXIT
mkdir -p "$output"
node tests/macos-pdf-fixture.mjs "$fixture"
xcrun clang -fobjc-arc -Werror -framework AppKit -framework WebKit -framework PDFKit \
  tests/macos-pdf-probe.m src-tauri/native/macos_print.m -o "$fixture/probe"
# A process-level watchdog also covers a WebKit or AppKit call that stalls the main thread.
python3 - "$fixture" "$output" <<'PY'
import pathlib
import resource
import subprocess
import sys
fixture, output = map(pathlib.Path, sys.argv[1:])
resource.setrlimit(resource.RLIMIT_FSIZE, (32 * 1024 * 1024, 32 * 1024 * 1024))
for name in ("fixture", "repeat"):
    subprocess.run([fixture / "probe", fixture / "fixture.html", output / f"{name}.pdf"],
                   check=True, timeout=90)
PY
for pdf in "$output"/*.pdf; do
  base="${pdf%.pdf}"
  pdfinfo -f 1 -l 500 -box "$pdf" > "$base-info.txt"
  pdffonts "$pdf" > "$base-fonts.txt"
  pdfimages -list "$pdf" > "$base-images.txt"
  pdftotext -layout "$pdf" "$base-text.txt"
  pdftoppm -r 65 -png "$pdf" "$base-page"
done
python3 - "$output" <<'PY'
import pathlib
import re
import sys
output = pathlib.Path(sys.argv[1])
texts = []
for name in ("fixture", "repeat"):
    text = (output / f"{name}-text.txt").read_text()
    info = (output / f"{name}-info.txt").read_text()
    pages = int(re.search(r"^Pages:\s+(\d+)", info, re.M).group(1))
    boxes = re.findall(r"^Page\s+\d+\s+MediaBox:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)", info, re.M)
    assert pages > 1 and len(boxes) == pages, info
    for x1, y1, x2, y2 in (tuple(map(float, box)) for box in boxes):
        assert abs(x2 - x1 - 595.28) < 2 and abs(y2 - y1 - 841.89) < 2, info
    assert all(page.strip() for page in text.rstrip("\f").split("\f")), "blank page"
    assert re.findall(r"ROW-(\d+)", text) == [f"{i:03d}" for i in range(1, 151)], text
    for required in ("BEGIN-FIXTURE", "END-FIXTURE", "阅读材料", "答案与解析", "物理示意图"):
        assert required in text, required
    assert "EXCLUDE-NAVIGATION" not in text
    assert "KaTeX" in (output / f"{name}-fonts.txt").read_text(), "missing math fonts"
    assert len((output / f"{name}-images.txt").read_text().splitlines()) > 2, "missing image"
    texts.append(text)
assert texts[0] == texts[1], "repeat changed extracted content"
PY
(cd "$output" && shasum -a 256 *.pdf > SHA256SUMS)
