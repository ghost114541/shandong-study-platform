/** Compile LaTeX to self-contained MathJax SVG. This is a build/test tool, not a Tauri integration. */
const {mathjax}=require('mathjax-full/js/mathjax.js');
const {TeX}=require('mathjax-full/js/input/tex.js');
const {SVG}=require('mathjax-full/js/output/svg.js');
const {liteAdaptor}=require('mathjax-full/js/adaptors/liteAdaptor.js');
const {RegisterHTMLHandler}=require('mathjax-full/js/handlers/html.js');
const adapt=liteAdaptor(); RegisterHTMLHandler(adapt);
const doc=mathjax.document('',{InputJax:new TeX({packages:['base','ams']}),OutputJax:new SVG({fontCache:'local'})});
let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',t=>input+=t);
process.stdin.on('end',()=>{
 const expressions=JSON.parse(input);const output={};
 for(const latex of expressions){let markup=adapt.outerHTML(doc.convert(latex,{display:false}));let match=markup.match(/<svg\b[\s\S]*<\/svg>/);
 if(!match)throw Error('MathJax did not emit SVG: '+latex);
 let svg=match[0].replace(/style="[^"]*"(?=[^>]*xmlns)/,'');
 output[latex]=svg;
 }
 process.stdout.write(JSON.stringify(output));
});
