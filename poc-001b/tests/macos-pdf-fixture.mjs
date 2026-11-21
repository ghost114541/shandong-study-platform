import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import katex from 'katex';

const output = process.argv[2];
mkdirSync(output, { recursive: true });
cpSync('node_modules/katex/dist', join(output, 'katex'), { recursive: true });
cpSync('src-tauri/icons/icon.png', join(output, 'figure.png'));

const math = (source, displayMode = false) => katex.renderToString(source, { displayMode, throwOnError: true });
const rows = Array.from({ length: 150 }, (_, index) =>
  `<p>ROW-${String(index + 1).padStart(3, '0')}　阅读材料：观测者沿山间小路记录温度与风向，比较上午与傍晚的变化。请解释记录之间的关系。</p>`
).join('');
writeFileSync(join(output, 'fixture.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<link rel="stylesheet" href="katex/katex.min.css">
<style>
body { margin: 0; font: 16px "PingFang SC", sans-serif; }
img { width: 70px; height: 70px; }
table { border-collapse: collapse; }
td { border: 1px solid; padding: 8px; }
@media print { nav { display: none; } p { break-inside: avoid; } }
</style>
<nav>EXCLUDE-NAVIGATION</nav><article>
<h1>知卷 · 原创打印试卷</h1>
<p>BEGIN-FIXTURE 行内公式 ${math('x^2+y^2=z^2')}，化学式 ${math('2\\mathrm{H_2}+\\mathrm{O_2}\\to2\\mathrm{H_2O')}</p>
${math('\\int_0^1 x^2\\,dx=\\frac13', true)}
<figure><img src="figure.png" alt="原创图示"><figcaption>物理示意图</figcaption></figure>
<table><tr><td>记录</td><td>温度</td></tr><tr><td>上午</td><td>15 ℃</td></tr></table>
<h2>材料题</h2><p>（一）概括观测过程。 （二）分析记录的意义。</p>
${rows}<p>END-FIXTURE 答案与解析</p></article></html>`);
