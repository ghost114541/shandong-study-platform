import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, writeJson } from '../scripts/content003_batch.mjs'
import { controlledPath, privateDirectory } from '../scripts/content003_paths.mjs'

const [workspace, identityPath] = process.argv.slice(2)
const root = privateDirectory(workspace)
const identity = readJson(controlledPath(root,identityPath))
assert.equal(identity.identifier,'org.shandong-study.content003-2-patch-isolated')
const database = join(identity.library,'study.sqlite3')
const script = fileURLToPath(new URL('../scripts/content003_native.mjs',import.meta.url))
const fixture = fileURLToPath(new URL('./content003-2-patch-fixture.py',import.meta.url))
const manifest = join(root,'patch-plan.json')
const registry = join(root,'patch-registry.json')
const backup = join(root,'patch-synthetic.knowbackup')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const python = args => execFileSync('python',['-B',...args],{encoding:'utf8',windowsHide:true})

function native(operation, path='', register='', failAfter='') {
  try {
    return {status:0, output:execFileSync(process.execPath,
      [script,operation,root,identity.executable,path,register,identityPath,failAfter],
      {encoding:'utf8',windowsHide:true,timeout:180000,stdio:'pipe'})}
  } catch (error) {
    if (error.status === 1 && (error.stderr?.includes('INJECTED_AFTER_IPC_BEFORE_REGISTRY') ||
        error.stdout?.includes('"status":"source_conflict"'))) {
      return {status:1,output:error.stdout,error:error.stderr}
    }
    throw error
  }
}
const snapshot = () => JSON.parse(python(['-c',String.raw`
from pathlib import Path
import hashlib,json,sqlite3,sys
db=Path(sys.argv[1])
with sqlite3.connect(db.as_uri()+'?mode=ro',uri=True) as conn:
    tables = ('question','question_revision','current_question_revision','verification_record',
              'composition_item','paper','question_occurrence','paper_region')
    result = {name: sorted(map(repr,conn.execute('SELECT * FROM '+name))) for name in tables}
    result['pdf'] = [dict(zip(('id','sha256','pages'),row)) for row in
                    conn.execute('SELECT id,sha256,page_count FROM paper_file ORDER BY sha256')]
    result['files'] = sorted((p.name,hashlib.sha256(p.read_bytes()).hexdigest())
                             for p in (db.parent/'paper-pdfs').rglob('*') if p.is_file())
    print(json.dumps(result))
`,database]))

function pdf(text) {
  const stream = 'BT /F1 16 Tf 72 720 Td ('+text+') Tj ET\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream',
  ]
  let raw = '%PDF-1.4\n'
  const offsets = objects.map((body,index) => {
    const offset = raw.length
    raw += (index+1)+' 0 obj\n'+body+'\nendobj\n'
    return offset.toString().padStart(10,'0')+' 00000 n \n'
  })
  const xref = raw.length
  raw += 'xref\n0 6\n0000000000 65535 f \n'+offsets.join('')+
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n'
  return Buffer.from(raw,'ascii')
}
const makePaper = (key, title) => {
  const path = key+'.pdf'
  const bytes = pdf(title)
  writeFileSync(join(root,path),bytes,{flag:'wx'})
  return {key,title,subject:'math',year:2026,region:'Synthetic',
    source_url:'https://example.invalid/'+key,files:[
      {path,pages:1,role:'original',sha256:hash(bytes),source_url:'https://example.invalid/'+path}
    ]}
}
if (existsSync(database)) {
  const empty = snapshot()
  for (const key of ['question','question_revision','paper','pdf','files'])
    assert.equal(empty[key].length,0,'Use an empty patch test profile')
}
const original = makePaper('patch-a','Synthetic paper A')
const duplicate = makePaper('patch-b','Synthetic paper B')
const qid = 'content003-patch-question'
const prior = {key:'patch-question',subject:'math',paper_key:original.key,source_key:'1',
  regions:[{page_index:0,rect:[0.1,0.2,0.8,0.4]}],kind:'short_answer',score:4,
  stem:'What is 2 + 3?',answer:'5',analysis:'Add 2 and 3.',answer_checked:true,analysis_checked:true}
const alias = {key:'patch-duplicate',subject:'math',paper_key:duplicate.key,source_key:'1',
  regions:[{page_index:0,rect:[0.1,0.2,0.8,0.4]}],duplicate_of:qid}
const plan = (paper, question) => writeJson(manifest,{version:1,papers:[paper],questions:[question]})
const perform = n => native('import',manifest,registry,n)
const picker = /"stage":"native_dialog_selected","command":"import_paper_pdf"/
const confirmPdf = (state, spec) => {
  assert.ok(state.pdf.some(row => row.sha256 === spec.sha256 && row.pages === spec.pages))
  assert.ok(state.files.some(([name,sha]) => name === spec.sha256 && sha === spec.sha256))
}
writeJson(registry,{version:2,papers:{},questions:{}})
plan(original,prior)
const first = perform()
assert.equal(first.status,0)
assert.match(first.output,picker)
const imported = snapshot()
assert.equal(imported.pdf.length,1)
confirmPdf(imported,original.files[0])
console.log(JSON.stringify({stage:'PATCH-T03',native_picker_matched:true,pages:1,sha256:original.files[0].sha256}))

const seed = JSON.parse(python([fixture,'seed',database,root]))
const journal = readJson(registry)
journal.questions[prior.key].extra_revisions = seed.extra_revisions
journal.compositions = [seed.pin]
writeJson(registry,journal)
const before = snapshot()
plan(duplicate,alias)
const interruption = perform('1')
assert.equal(interruption.status,1)
assert.match(interruption.output,picker)
assert.match(interruption.error,/INJECTED_AFTER_IPC_BEFORE_REGISTRY/)
assert.deepEqual(readJson(registry),journal)
const interrupted = snapshot()
assert.equal(interrupted.pdf.length,2)
confirmPdf(interrupted,duplicate.files[0])
assert.ok(interrupted.pdf.some(row => JSON.stringify(row) === JSON.stringify(before.pdf[0])))
const resumed = perform()
assert.equal(resumed.status,0)
assert.doesNotMatch(resumed.output,picker)
assert.match(resumed.output,/"status":"deduplicated"/)
const after = snapshot()
assert.deepEqual(after.pdf,interrupted.pdf)
assert.deepEqual(after.files,interrupted.files)
const checkpoint = readFileSync(registry)
const replay = perform()
assert.equal(replay.status,0)
assert.doesNotMatch(replay.output,picker)
assert.deepEqual(snapshot(),after)
assert.deepEqual(readFileSync(registry),checkpoint)
console.log(JSON.stringify({stage:'PATCH-T04',native_picker_matched:true,interruption_after_pdf_ipc:true,
  pages:1,sha256:duplicate.files[0].sha256,files_after_replay:2,registry_preserved:true}))
for (const key of ['question','question_revision','current_question_revision','composition_item','verification_record'])
  assert.deepEqual(after[key],before[key],key)
assert.equal(after.question_occurrence.length,2)
assert.equal(after.paper_region.length,2)
const entry = readJson(registry).questions[alias.key]
assert.equal(entry.occurrence_only,true)
assert.ok(!('revision_id' in entry))
console.log(python([fixture,'check',database,root]).trim())
plan(duplicate,{...alias,regions:[{page_index:0,rect:[0.1,0.2,0.9,0.4]}]})
const conflict = perform()
assert.equal(conflict.status,1)
assert.match(conflict.output,/"status":"source_conflict"/)
assert.deepEqual(snapshot(),after)
assert.deepEqual(readFileSync(registry),checkpoint)
console.log(JSON.stringify({stage:'occurrence_conflict',business_and_resources_unchanged:true}))
assert.match(native('backup',backup).output,/"stage":"backup"/)
assert.match(native('restore',backup).output,/"stage":"restore_restarted"/)
