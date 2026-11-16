'use strict';
/* POC only: small, auditable native-browser editor. NOT Tiptap/React/Tauri. */
const state = { data: structuredClone(window.POC_DATA), selected: 0, field: 'stem', tab: 'edit', changed: false };
const $ = id => document.getElementById(id);
function message(t, error=false){$('message').textContent=t; $('message').style.color=error?'#b42318':'#386a51';}
function el(tag, className, text){const a=document.createElement(tag);if(className)a.className=className;if(text!==undefined)a.textContent=text;return a;}
function safeImage(src){return typeof src==='string' && (/^assets\/[a-zA-Z0-9_.-]+\.(?:svg|png|jpg|jpeg|webp)$/i.test(src)||/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(src)) ? src : '';}
function current(){return state.data.questions[state.selected];}
function fieldArray(){const q=current();if(state.field==='stem')return q.stem;const [_,i,k]=state.field.split(':');return q.parts[Number(i)][k];}
function setField(value){const q=current();if(state.field==='stem')q.stem=value;else{const [_,i,k]=state.field.split(':');q.parts[Number(i)][k]=value;}}
function makeMath(tex){const s=el('span','math-atom');s.contentEditable='false';s.dataset.latex=tex;s.title='双击可编辑公式';return s;}
async function typeset(root=document){await MathJax.startup.promise;for(const s of root.querySelectorAll('.math-atom, .math-preview')){const tex=s.dataset.latex||'';s.replaceChildren();try{const svg=await MathJax.tex2svgPromise(tex,{display:false});s.appendChild(svg.querySelector('svg').cloneNode(true));}catch(e){s.textContent='[公式有误: '+tex+']';s.dataset.mathError='true';}}}
function inlineDom(children){const frag=document.createDocumentFragment();for(const node of children||[]){if(node.type==='math'){frag.appendChild(makeMath(node.latex||''));continue;}if(node.type!=='text')continue;let child=document.createTextNode(node.text||'');for(const mark of (node.marks||[]).slice().reverse()){const w=el(mark==='bold'?'strong':mark==='italic'?'em':'span');w.appendChild(child);child=w;}frag.appendChild(child);}return frag;}
function makeDoc(doc){const box=el('div','doc');for(const b of doc||[]){if(b.type==='image'){const src=safeImage(b.src);if(src){const img=el('img');img.src=src;img.alt=b.alt||'配图';box.appendChild(img);}continue;}if(b.type==='paragraph'){const p=el('p');p.appendChild(inlineDom(b.children));box.appendChild(p);}}if(!box.childNodes.length){box.appendChild(el('p','', ''));}return box;}
function serializeInline(element,marks=[]){const out=[];for(const n of element.childNodes){if(n.nodeType===3){if(n.textContent)out.push({type:'text',text:n.textContent,...(marks.length?{marks} : {})});continue;}if(n.nodeType!==1)continue;const tag=n.tagName.toLowerCase();if(n.classList.contains('math-atom')){out.push({type:'math',latex:n.dataset.latex||''});continue;}const next=tag==='strong'||tag==='b'?[...marks,'bold']:tag==='em'||tag==='i'?[...marks,'italic']:marks;out.push(...serializeInline(n,next));}return out;}
function editorToDoc(){
 const result=[];let inline=[];
 function flush(){if(inline.length){result.push({type:'paragraph',children:inline});inline=[];}}
 function pushImage(n){const src=safeImage(n.getAttribute('src'));if(src)result.push({type:'image',src,alt:n.alt||'配图'});}
 function visitBlock(n){
  if(n.nodeType===3){if(n.textContent)inline.push({type:'text',text:n.textContent});return;}
  if(n.nodeType!==1)return;
  if(n.tagName==='IMG'){flush();pushImage(n);return;}
  if(n.tagName==='P'||n.tagName==='DIV'){
   flush();let paragraph=[];
   const addParagraph=()=>{if(paragraph.length){result.push({type:'paragraph',children:paragraph});paragraph=[];}};
   for(const c of n.childNodes){
    if(c.nodeType===1&&c.tagName==='IMG'){addParagraph();pushImage(c);}
    else paragraph.push(...serializeInline({childNodes:[c]}));
   }
   addParagraph();return;
  }
  inline.push(...serializeInline({childNodes:[n]}));
 }
 for(const n of $('rich-editor').childNodes)visitBlock(n);
 flush();return result.length?result:[{type:'paragraph',children:[]}];
}
function saveField(){setField(editorToDoc());state.changed=false;message('当前字段已保存到内存；点击“下载结构化 JSON”才能保存到文件。');}
function showEditor(){const q=current();$('editing-heading').textContent=`编辑：${q.subject} · ${q.id}`;$('subject-label').textContent=q.subject;
 const select=$('field-select');select.replaceChildren();select.add(new Option('整题题干 / 共用材料','stem'));for(let i=0;i<q.parts.length;i++){select.add(new Option(`第${i+1}小问题干` ,`part:${i}:prompt`));select.add(new Option(`第${i+1}小问答案` ,`part:${i}:answer`));}
 if(!Array.from(select.options).some(o=>o.value===state.field))state.field='stem';select.value=state.field;$('rich-editor').replaceChildren(...makeDoc(fieldArray()).childNodes);typeset($('rich-editor'));}
function questionList(){const root=$('question-list');root.replaceChildren();state.data.questions.forEach((q,i)=>{const b=el('button','question-tab'+(i===state.selected?' selected':''),`${i+1}. ${q.subject} · ${q.type}`);b.onclick=()=>{if(state.tab==='edit'&&state.changed)saveField();state.selected=i;state.field='stem';questionList();showEditor();};root.appendChild(b);});}
function makePreview(answer=false){const r=$('printable');r.replaceChildren();r.appendChild(el('h2','',answer?'参考答案与解析':state.data.title));r.appendChild(el('div','paper-subtitle',answer?'独立答案卷 · 与题目序号对应':`考试时间 ${state.data.duration_minutes||60} 分钟 · 总分 ${state.data.questions.reduce((s,q)=>s+Number(q.score||0),0)} 分`));
 state.data.questions.forEach((q,i)=>{const block=el('section','qblock');block.appendChild(el('div','qtitle',`${i+1}. 【${q.subject}】${q.type}（${q.score}分）`));if(!answer){const stem=makeDoc(q.stem);block.append(...stem.childNodes);}q.parts.forEach((p,j)=>{const part=el('div','qpart');part.appendChild(el('div','meta',`（${j+1}）${p.score}分`));const doc=makeDoc(answer?p.answer:p.prompt);if(answer)doc.classList.add('part-answer');part.append(...doc.childNodes);block.appendChild(part);});r.appendChild(block);});typeset(r).then(()=>{document.documentElement.dataset.mathReady='yes';});}
function switchTab(tab){if(state.tab==='edit'&&state.changed)saveField();state.tab=tab;for(const t of ['edit','paper','answer'])$('tab-'+t).classList.toggle('selected',tab===t);$('editor-view').hidden=tab!=='edit';$('preview-view').hidden=tab==='edit';if(tab==='edit')showEditor();else{$('preview-heading').textContent=tab==='paper'?'试卷预览':'答案预览';document.documentElement.dataset.mathReady='no';makePreview(tab==='answer');}}
function insertNode(node){const editor=$('rich-editor');editor.focus();const selection=window.getSelection();let range=selection.rangeCount?selection.getRangeAt(0):null;if(!range||!editor.contains(range.commonAncestorContainer)){range=document.createRange();range.selectNodeContents(editor);range.collapse(false);}range.deleteContents();range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);state.changed=true;}
function downloadJson(){if(state.tab==='edit')saveField();const blob=new Blob([JSON.stringify(state.data,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=el('a');a.href=url;a.download='poc001_questions_edited.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);message('已下载当前结构化题目 JSON。');}
function validateImport(d){if(!d||d.schema_version!==1||d.document_type!=='poc001_question_set'||!Array.isArray(d.questions)||d.questions.length<1||d.questions.length>100)throw Error('文件结构或版本不符合 PoC 格式');for(const q of d.questions){if(!q.id||!Array.isArray(q.stem)||!Array.isArray(q.parts))throw Error('存在缺少字段的题目');for(const p of q.parts){if(!Array.isArray(p.prompt)||!Array.isArray(p.answer))throw Error('存在不完整的小问');}}return d;}
async function main(){for(const tab of ['edit','paper','answer'])$('tab-'+tab).onclick=()=>switchTab(tab);$('field-select').onchange=e=>{if(state.changed)saveField();state.field=e.target.value;showEditor();};$('rich-editor').addEventListener('input',()=>state.changed=true);
 $('rich-editor').addEventListener('paste',e=>{e.preventDefault();const text=e.clipboardData.getData('text/plain');document.execCommand('insertText',false,text);});
 $('rich-editor').addEventListener('dblclick',e=>{const node=e.target.closest('.math-atom');if(!node)return;const latex=prompt('修改 LaTeX 公式（仅输入公式主体）：',node.dataset.latex);if(latex!==null){node.dataset.latex=latex;typeset(node.parentNode);state.changed=true;}});
 $('btn-bold').onclick=()=>document.execCommand('bold',false);$('btn-italic').onclick=()=>document.execCommand('italic',false);
 $('btn-math').onclick=()=>{const latex=prompt('输入 LaTeX 公式，例如：\\frac{a}{b}',String.raw`\frac{x^2}{2}`);if(latex){const n=makeMath(latex);insertNode(n);typeset(n.parentNode);}};
 $('btn-img').onclick=()=>$('file-image').click();$('file-image').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>2_000_000){message('图片超过 2 MB，本原型拒绝插入。',true);return;}const b64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f);});const src=safeImage(b64);if(!src){message('图片类型不支持。',true);return;}const img=el('img');img.src=src;img.alt=f.name;insertNode(img);e.target.value='';};
 $('btn-save-field').onclick=saveField;$('btn-download-json').onclick=downloadJson;$('btn-load-json').onclick=()=>$('file-json').click();$('file-json').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{const d=validateImport(JSON.parse(await f.text()));state.data=d;state.selected=0;state.field='stem';state.changed=false;questionList();showEditor();message('已从本地 JSON 导入题目数据。');}catch(err){message('导入失败：'+err.message,true);}e.target.value='';};$('btn-print').onclick=()=>window.print();
 questionList();showEditor();message('已载入 3 道原创测试题。');}
main().catch(e=>message('初始化失败：'+e.message,true));
