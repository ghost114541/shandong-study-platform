#!/usr/bin/env python3
"""Verified non-Tauri PoC acceptance checks; requirements: pymupdf. Run after export_pdf.py."""
import json, re, subprocess
from pathlib import Path
import fitz
ROOT=Path(__file__).resolve().parents[1]

def main():
    data=json.loads((ROOT/'samples/questions.json').read_text(encoding='utf-8'))
    assert data['schema_version']==1
    assert len(data['questions'])==3
    assert len({q['id'] for q in data['questions']})==3
    assert sum(len(q['parts']) for q in data['questions'])==6
    assert sum(q['score'] for q in data['questions'])==40
    assert all(sum(p['score'] for p in q['parts'])==q['score'] for q in data['questions'])
    svg_cache=json.loads((ROOT/'assets/math_svg_cache.json').read_text(encoding='utf-8'))
    assert len(svg_cache)>=7 and all('<svg' in s and '</svg>' in s for s in svg_cache.values())
    paper=fitz.open(ROOT/'output/paper.pdf'); answer=fitz.open(ROOT/'output/answers.pdf')
    assert len(paper)==1,("paper page count",len(paper))
    assert len(answer)==1,("answer page count",len(answer))
    assert all(abs(d[0].rect.width-595.276)<1 and abs(d[0].rect.height-841.89)<1 for d in (paper,answer))
    ptext='\n'.join(p.get_text() for p in paper)
    atext='\n'.join(p.get_text() for p in answer)
    for s in ['数学','物理','化学','求末速度','填写化学方程式']:
        assert s in ptext,('missing paper',s)
    for s in ['顶点','对称轴','参考答案','物理','化学']:
        assert s in atext,('missing answer',s)
    assert '参考答案与解析' not in ptext
    assert '求末速度' not in atext
    assert len(paper[0].get_drawings()) >= 15
    assert len(answer[0].get_drawings()) >= 15
    assert not any(url in (ROOT/'index.html').read_text(encoding='utf-8') for url in ('https://','http://'))
    for name in ('app.js','scripts/tex_to_svg.cjs'):
        subprocess.run(['node','--check',str(ROOT/name)],check=True,capture_output=True)
    print('PASS 12 checks: unique IDs, subpart count, scores, SVG cache, A4 PDFs, one-page outputs, independent contents, vector drawings, offline resources, JS syntax.')
    print(f'PDF pages: paper={len(paper)}, answers={len(answer)}; SVG formulas={len(svg_cache)}')

if __name__=='__main__':main()
