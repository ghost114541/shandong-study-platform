import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { controlledCompositionPdf } from '../scripts/content003_paths.mjs'

const checker = fileURLToPath(new URL('./content004-export-pdf.py', import.meta.url))
const runCheck = (...args) => execFileSync('python', ['-B', checker, ...args], {encoding:'utf8'})
const paragraph = text => ({type:'paragraph', content:[{type:'text', text}]})
const doc = (...blocks) => ({type:'doc', content:blocks.map(block => typeof block === 'string' ? paragraph(block) : block)})
const formula = latex => ({type:'blockMath', attrs:{latex}})
const table = {type:'table',content:[['TABLEHEADER','TABLEVALUE'],['TABLEROW','TABLEEND']].map((values, i) =>
  ({type:'tableRow',content:values.map(text => ({type:i ? 'tableCell' : 'tableHeader',content:[paragraph(text)]}))}))}
const settings = {scope:'Synthetic acceptance', groups:['原创合成'], gap_mm:4, answer_space_mm:0}

export async function runExportFixtures({call, image, root, workspace}) {
  const source = join(workspace, 'source-image.png')
  runCheck('generate', source)
  const attachment = await image(readFileSync(source))
  const picture = {type:'image',attrs:{src:'attachment:'+attachment.id,alt:'Original blue-grid fixture'}}
  const revisions = []
  const originals = []
  const run = randomUUID()
  for (let i=1; i<=12; i++) {
    const extended = i === 1 || i === 3 || i === 12
    const multipart = i === 1
    const content = {
      schema_version:extended ? 2 : 1, score:6, question_type:multipart ? '解答题' : '填空题',
      stem:doc('STEM'+i+'END', ...(extended ? [formula('123=100+23'), table, picture] : [])),
      answer:doc('ANSWER'+i+'END'),
      analysis:doc('ANALYSIS'+i+'END', ...(extended ? [picture] : [])),
      attachments:extended ? [attachment] : [],
      parts:multipart ? [1,2].map(part => ({id:'part-'+part, score:3,
        prompt:doc('PROMPTPART'+part), answer:doc('ANSWERPART'+part), analysis:doc('ANALYSISPART'+part)})) : [],
    }
    revisions.push(await call('create_question',{questionId:'c004-export-'+run+'-'+i,
      subjectId:['math','physics','chemistry'][(i-1)%3],contentJson:JSON.stringify(content)}))
    originals.push(content)
  }
  const compositions = []
  for (const count of [1,3,12]) {
    const items = revisions.slice(0,count).map((revision,i) => ({revision_id:revision.id,
      points:{score:6,group:settings.groups[0],part_scores:originals[i].parts.map(part => part.score)}}))
    const {header} = await call('save_composition',{draft:{title:'Synthetic export '+count,settings,items}})
    compositions.push(header)
  }
  const changed = {...originals[0],schema_version:1,
    stem:doc('LATESTSTEMDO NOT PRINT'),answer:doc('LATESTANSWERDO NOT PRINT')}
  await call('save_user_revision',{questionId:revisions[0].question_id,expectedCurrent:revisions[0].id,
    contentJson:JSON.stringify(changed)})

  const pdfRoot = join(root,'pdf')
  const published = []
  const drafts = []
  for (const [index,count] of [1,3,12].entries()) {
    const {id} = compositions[index]
    const preview = await call('preview_composition',{id})
    const expected = revisions.slice(0,count).map(row => row.id)
    for (const arm of [preview.paper,preview.answers]) assert.deepEqual(arm.entries.map(row => row.revision_id),expected)
    assert.deepEqual(preview.paper.entries[0].main, originals[0].stem)
    assert.deepEqual(preview.answers.entries[0].analysis, originals[0].analysis)
    assert.equal(preview.paper.entries[0].parts.length,2)
    const draft = {id,identity:preview.identity,confirmed:true}
    drafts.push(draft)
    const result = await call('export_composition',draft)
    const paper = controlledCompositionPdf(root,result.paper,'paper.pdf')
    const answers = controlledCompositionPdf(root,result.answers,'answers.pdf')
    assert.equal(dirname(paper),dirname(answers))
    published.push([paper,answers])
    console.log(runCheck('check',source,String(count),paper,answers).trim())
  }

  const [paper,answers] = published[0]
  const tree = () => readdirSync(pdfRoot).sort()
  const before = tree()
  assert.ok(before.every(name => name.startsWith('composition-')))
  assert.throws(() => controlledCompositionPdf(root,source,'paper.pdf'))
  assert.throws(() => controlledCompositionPdf(root,answers,'paper.pdf'))
  assert.throws(() => controlledCompositionPdf(root,'\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1\\paper.pdf','paper.pdf'))

  const blob = join(root,'attachments',attachment.sha256.slice(0,2),attachment.sha256)
  const held = blob+'.fixture-held'
  assert.ok(!existsSync(held))
  const oldPaper = readFileSync(paper)
  const oldAnswers = readFileSync(answers)
  renameSync(blob,held)
  try {
    await assert.rejects(call('export_composition',drafts[0]), /export_composition:/)
    assert.deepEqual(tree(),before)
  } finally {
    renameSync(held,blob)
  }

  const broken = await call('create_question',{questionId:'c004-export-broken-'+run,subjectId:'math',
    contentJson:JSON.stringify({...originals[1],analysis:doc(formula('\\frac{'))})})
  const {header} = await call('save_composition',{draft:{title:'Synthetic rejected answer PDF',settings,
    items:[{revision_id:broken.id,points:{score:6,group:settings.groups[0],part_scores:[]}}]}})
  const brokenPreview = await call('preview_composition',{id:header.id})
  await assert.rejects(call('export_composition',{id:header.id,identity:brokenPreview.identity,confirmed:true}),
    /打印视图准备失败/)
  assert.deepEqual(tree(),before)

  const elsewhere = join(workspace,'fixture-junction-target-'+run)
  mkdirSync(elsewhere)
  const saved = pdfRoot+'-fixture-held'
  assert.ok(!existsSync(saved))
  renameSync(pdfRoot,saved)
  try {
    symlinkSync(elsewhere,pdfRoot,'junction')
    try {
      await assert.rejects(call('export_composition',drafts[0]), /PDF 导出目录不安全/)
      assert.throws(() => controlledCompositionPdf(root,paper,'paper.pdf'),/redirected/)
      assert.deepEqual(readdirSync(elsewhere),[])
    } finally {
      rmdirSync(pdfRoot)
    }
  } finally {
    renameSync(saved,pdfRoot)
  }
  assert.deepEqual(tree(),before)
  assert.deepEqual(readFileSync(paper),oldPaper)
  assert.deepEqual(readFileSync(answers),oldAnswers)
  console.log(JSON.stringify({missing_attachment_rejected:true,answer_render_failure_rejected:true,
    junction_rejected_before_write:true,
    original_pairs_preserved:true,staging_remnants:0}))
}
