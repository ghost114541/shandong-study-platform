import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, writeJson } from '../scripts/content003_batch.mjs'
import { controlledPath, privateDirectory } from '../scripts/content003_paths.mjs'

const [workspace, config, mode] = process.argv.slice(2)
const root = privateDirectory(workspace)
const identity = readJson(controlledPath(root,config))
const native = fileURLToPath(new URL('../scripts/content003_native.mjs',import.meta.url))
const database = join(identity.library,'study.sqlite3')
const destination = join(root,'fixture-backup.knowbackup')
const manifest = join(root,'fixture-plan.json')
const registry = join(root,'fixture-registry.json')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const snapshot = () => JSON.parse(execFileSync('python',['-B','-c',String.raw`
from pathlib import Path
import hashlib, json, sqlite3, sys
db = Path(sys.argv[1].removeprefix('\\\\?\\'))
with sqlite3.connect(db.as_uri()+'?mode=ro', uri=True) as conn:
    tables = [n for n, in conn.execute("select name from sqlite_schema where type='table' and name not like 'sqlite_%' order by name")]
    result = {name: sorted(map(repr, conn.execute('select * from "'+name+'"'))) for name in tables}
    for folder in ('paper-pdfs','attachments'):
        result[folder] = sorted((p.name,hashlib.sha256(p.read_bytes()).hexdigest())
                                for p in (db.parent/folder).rglob('*') if p.is_file())
    print(json.dumps(result))
`, database],{encoding:'utf8',windowsHide:true}))
const run = (operation, path, store = '', failAfter = '') => {
  try {
    return execFileSync(process.execPath,[native,operation,root,identity.executable,path,store,config,failAfter],
      {encoding:'utf8',windowsHide:true,timeout:180000})
  } catch (error) {
    // The fixture contains only synthetic content. Return a diagnostic that excludes local paths.
    if (error.stderr?.includes('INJECTED_AFTER_IPC_BEFORE_REGISTRY')) return 'interrupted'
    if (error.status === 1 && error.stdout?.includes('"status":"source_conflict"')) return 'source_conflict'
    throw error
  }
}
const pdfBytes = readFileSync(new URL('../output/pdf/paper.pdf',import.meta.url))
const path = 'fixture-paper.pdf'
const pages = Number(/^Pages:\s+(\d+)/m.exec(execFileSync('pdfinfo',[join(root,path)],{encoding:'utf8'}))[1])
const paper = {key:'test',title:'Synthetic paper',subject:'math',year:2026,region:'Fixture',
  source_url:'https://example.invalid/fixture',files:[
    {path,role:'original',pages,sha256:hash(pdfBytes),source_url:'https://example.invalid/fixture/pdf'}
  ]}
const question = {key:'fixture',subject:'math',paper_key:'test',source_key:'1',
  regions:[{page_index:0,rect:[0.1,0.2,0.8,0.4]}],kind:'short_answer',score:4,
  stem:'What is 2 + 3?',answer:'5',analysis:'Add 2 and 3.'}
const plan = questions => writeJson(manifest,{version:1,papers:[paper],questions})
const perform = n => run('import',manifest,registry,n)
if (mode !== 'conflicts-only') {
  assert.equal(snapshot().question.length,0,'Native fault injection requires a fresh dedicated library')
  writeJson(registry,{version:2,papers:{},questions:{}})
  writeFileSync(join(root,path),pdfBytes,{flag:'wx'})
  plan([question])
  assert.equal(perform('1'),'interrupted')
  assert.deepEqual(readJson(registry),{version:2,papers:{},questions:{}})
  assert.match(perform(),/"status":"created"/)
}
const alias = {key:'fixture-alias',subject:'math',paper_key:'test',source_key:'2',
  regions:[{page_index:0,rect:[0.1,0.5,0.8,0.8]}],duplicate_of:'content003-fixture'}
if (mode !== 'conflicts-only') {
  plan([alias])
  assert.equal(perform('1'),'interrupted')
  const interrupted = snapshot()
  assert.equal(interrupted.paper_file.length,1)
  assert.equal(interrupted.paper_region.length,2)
  assert.match(perform(),/"status":"deduplicated"/)
  assert.deepEqual(snapshot(),interrupted)
  console.log('FIX-T05 PASS native PDF and region IPC interruption, resume preserves exactly one file and two regions')
}
const before = snapshot()
const registryBefore = readFileSync(registry)
for (const changed of [{...alias,duplicate_of:'another-id'},
                       {...alias,source_key:'3'},
                       {...alias,regions:[{page_index:0,rect:[0.1,0.5,0.7,0.8]}]}]) {
  plan([changed])
  assert.equal(perform(),'source_conflict')
  assert.deepEqual(snapshot(),before)
  assert.deepEqual(readFileSync(registry),registryBefore)
}
console.log('FIX-T01/T02 PASS native source conflict, SQL state, resources and registry unchanged')
if (mode !== 'conflicts-only') assert.match(run('backup',destination),/"stage":"backup"/)
