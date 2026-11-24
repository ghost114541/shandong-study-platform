"""Extract page text and render explicitly selected normalised PDF rectangles."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
from xml.etree import ElementTree as ET

from PIL import Image

from content003_collect import write_json
from content002_trace_audit import controlled_file, digest


def anchors(pdf):
    """Return text lines with PDF coordinates for human selection."""
    with tempfile.TemporaryDirectory() as temp:
        out = Path(temp) / 'boxes.html'
        subprocess.run(['pdftotext', '-bbox-layout', '-enc', 'UTF-8', str(pdf), str(out)],
                       check=True, timeout=60)
        pages = ET.parse(out).findall('.//{*}page')
    return [
        [dict(text=' '.join(word.text or '' for word in line.findall('{*}word')),
              y0=float(line.get('yMin')) / float(page.get('height')),
              y1=float(line.get('yMax')) / float(page.get('height')))
         for line in page.findall('.//{*}line')]
        for page in pages
    ]


def extract(root, pdf, key, regions, resolution=144):
    results = []
    for ordinal, region in enumerate(regions):
        page = region['page_index'] + 1
        x0, y0, x1, y1 = region['rect']
        if not (page > 0 and 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
            raise ValueError('invalid crop')
        with tempfile.TemporaryDirectory() as temp:
            prefix = str(Path(temp) / 'page')
            subprocess.run(['pdftoppm', '-f', str(page), '-l', str(page), '-r', str(resolution),
                            '-singlefile', '-png', str(pdf), prefix], check=True, timeout=60)
            with Image.open(prefix + '.png') as image:
                width, height = image.size
                crop = image.crop(tuple(round(a*b) for a,b in zip(
                    (x0,y0,x1,y1),(width,height,width,height))))
                name = f'{key}-{ordinal}.png'
                output = root / name
                crop.save(output, optimize=True)
            results.append(dict(path=name, sha256=digest(output), alt=f'原卷第 {page} 页选区 {ordinal + 1}'))
    return results


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('root', type=Path)
    p.add_argument('pdf')
    p.add_argument('output', type=Path)
    p.add_argument('--selection', type=Path, help='JSON list of {key, regions} records')
    args = p.parse_args()
    root = args.root.resolve(strict=True)
    pdf = controlled_file(root, args.pdf)
    if args.selection:
        plan = json.loads(args.selection.read_text(encoding='utf-8-sig'))
        for row in plan:
            if not row['key'] or Path(row['key']).name != row['key']:
                raise ValueError('invalid selection key')
            row['images'] = extract(root, pdf, row['key'], row['regions'])
        write_json(args.output, plan)
    else:
        write_json(args.output, anchors(pdf))
