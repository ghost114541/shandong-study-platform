#!/usr/bin/env python3
"""POC-001 only: render a structured test set to separate PDF paper/answers using WeasyPrint.
Dependencies: weasyprint. For new equations, also Node and mathjax-full (or cached SVGs).
No network access. No user data upload. Not the final Tauri PDF engine.
"""
import argparse, base64, hashlib, html, json, os, re, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
FONT_FAMILY='"Noto Serif CJK SC","Microsoft YaHei","PingFang SC",serif'

def load_json(path):
    data=json.loads(path.read_text(encoding='utf-8'))
    if data.get('schema_version') != 1 or data.get('document_type') != 'poc001_question_set':
        raise ValueError('expected POC-001 structured questions JSON schema_version=1')
    if not isinstance(data.get('questions'),list) or not data['questions']:
        raise ValueError('missing questions')
    return data

def math_expressions(data):
    result=set()
    def visit(blocks):
        for b in blocks:
            for child in b.get('children',[]):
                if child.get('type')=='math':result.add(child['latex'])
    for q in data['questions']:
        visit(q['stem'])
        for p in q['parts']:
            visit(p['prompt']);visit(p['answer'])
    return sorted(result)

def svg_cache(data):
    cache_file=ROOT/'assets'/'math_svg_cache.json'
    current=json.loads(cache_file.read_text(encoding='utf-8')) if cache_file.exists() else {}
    missing=[x for x in math_expressions(data) if x not in current]
    if missing:
        env=os.environ.copy()
        try:
            proc=subprocess.run(['node',str(ROOT/'scripts'/'tex_to_svg.cjs')],input=json.dumps(missing),capture_output=True,text=True,check=True,env=env)
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            raise RuntimeError('Missing MathJax equation SVGs. Install `mathjax-full` for Node or use bundled sample questions. '+str(e)) from e
        current.update(json.loads(proc.stdout))
        cache_file.write_text(json.dumps(current,ensure_ascii=False,indent=2),encoding='utf-8')
    return current

def render_inline(nodes,cache):
    parts=[]
    for node in nodes:
        if node['type']=='math':
            svg=cache.get(node['latex'])
            if not svg:raise ValueError('Missing equation SVG')
            parts.append('<span class="formula">'+svg+'</span>')
        elif node['type']=='text':
            text=html.escape(node.get('text',''))
            for mark in reversed(node.get('marks',[])):
                if mark=='bold':text=f'<strong>{text}</strong>'
                if mark=='italic':text=f'<em>{text}</em>'
            parts.append(text)
    return ''.join(parts)

def safe_image(src):
    if re.fullmatch(r'assets/[A-Za-z0-9_.-]+\.(?:svg|png|jpg|jpeg|webp)',src or ''):
        p=ROOT/src
        if not p.is_file():return ''
        mime='image/svg+xml' if p.suffix.lower()=='.svg' else ('image/png' if p.suffix.lower()=='.png' else 'image/jpeg')
        return 'data:'+mime+';base64,'+base64.b64encode(p.read_bytes()).decode('ascii')
    if src.startswith(('data:image/png;base64,','data:image/jpeg;base64,','data:image/webp;base64,')) and len(src) <= 3_000_000:
        return src
    return ''

def render_blocks(blocks,cache):
    out=[]
    for b in blocks:
        if b['type']=='paragraph':out.append('<p>'+render_inline(b.get('children',[]),cache)+'</p>')
        elif b['type']=='image':
            src=safe_image(b.get('src',''))
            if src:out.append(f'<div class="image-wrap"><img src="{src}" alt="{html.escape(b.get("alt",""),quote=True)}"/></div>')
    return '\n'.join(out)

CSS=r'''@page{size:A4;margin:19mm 18mm 18mm 18mm;@bottom-center{content:"POC-001 · 原创测试题 · 非正式题库";font-size:8pt;color:#8794a8;}}body{font-family:"Noto Serif CJK SC","Noto Sans CJK SC",serif;color:#1b2533;font-size:11pt;line-height:1.65;}h1{text-align:center;font-size:17pt;margin:0 0 3mm;}p{margin:1.5mm 0 2mm;}header{font-size:9pt;text-align:center;color:#54637b;border-bottom:1px solid #506179;margin-bottom:10mm;padding-bottom:4mm;}section.question{margin-bottom:10mm;}h2{font-size:11.5pt;margin:0 0 2mm;font-weight:700;}.part{margin-left:8mm;break-inside:avoid-page;}.prompt,.answer{margin:1.5mm 0 3mm;}.part-label{font-size:9pt;color:#53657a;} .formula{display:inline;white-space:nowrap;vertical-align:middle}.formula svg{vertical-align:middle;max-width:100%;} .image-wrap{text-align:center;margin:2mm auto 3mm;break-inside:avoid-page}.image-wrap img{max-height:55mm;max-width:115mm;} section.question{break-inside:avoid-page;} footer{color:#8794a8;font-size:9pt;text-align:center;margin-top:12mm;} .answer{border-left:2px solid #d5dce7;padding-left:4mm;}'''

def build_html(data,cache,answers=False):
    total=sum(float(q.get('score',0)) for q in data['questions'])
    title='参考答案与解析' if answers else data.get('title','试卷')
    items=[]
    for idx,q in enumerate(data['questions'],1):
        parts=[f'<section class="question"><h2>{idx}. 【{html.escape(q.get("subject",""))}】{html.escape(q.get("type",""))}（{q.get("score",0)}分）</h2>']
        if not answers:parts.append(render_blocks(q['stem'],cache))
        for num,p in enumerate(q['parts'],1):
            role='answer' if answers else 'prompt'
            parts.append(f'<div class="part"><div class="part-label">（{num}）{p.get("score",0)}分</div><div class="{role}">{render_blocks(p["answer" if answers else "prompt"],cache)}</div></div>')
        parts.append('</section>')
        items.append(''.join(parts))
    sub='答案卷 · 编号与试卷一致' if answers else f'考试时间 {data.get("duration_minutes",60)} 分钟 · 总分 {total:g} 分'
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>'+html.escape(title)+'</title><style>'+CSS+'</style></head><body><h1>'+html.escape(title)+'</h1><header>'+sub+'</header>\n'+''.join(items)+'</body></html>'

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--input',type=Path,default=ROOT/'samples/questions.json')
    ap.add_argument('--out',type=Path,default=ROOT/'output')
    args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    data=load_json(args.input)
    cache=svg_cache(data)
    from weasyprint import HTML
    for is_answer,name in [(False,'paper'),(True,'answers')]:
        markup=build_html(data,cache,is_answer)
        (args.out/f'{name}.html').write_text(markup,encoding='utf-8')
        path=args.out/f'{name}.pdf'
        HTML(string=markup,base_url=str(ROOT)).write_pdf(str(path))
        print(f'{name}.pdf: {path.stat().st_size} bytes, sha256={hashlib.sha256(path.read_bytes()).hexdigest()[:16]}')

if __name__=='__main__':main()
