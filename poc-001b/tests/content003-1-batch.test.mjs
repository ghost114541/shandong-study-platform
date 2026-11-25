import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { readJson, runBatch, writeJson } from '../scripts/content003_batch.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

test('file version append after legacy replay, with interruption before registry checkpoint', async t => {
  const root = mkdtempSync(join(tmpdir(), 'knowpaper-content003-batch-'))
  t.after(() => rmSync(root, {recursive:true,force:true}))
  const db = []
  let writes = 0
  const native = {
    call(command) {
      if (command === 'list_subjects') return [{id:'math'}]
      assert.equal(command, 'list_paper_records')
      return structuredClone(db)
    },
    pick(command, {input}, dialog, path) {
      assert.equal(dialog,'导入试卷 PDF')
      assert.equal(command, 'import_paper_pdf')
      writes++
      let row = db.find(row => row.id === input.paper_id)
      if (!row) {
        assert.equal(input.paper_id, undefined)
        row = {id:'p'+db.length, title:input.title, subject_id:input.subject_id, files:[]}
        db.push(row)
      }
      const item = {id:'f'+writes, paper_id:row.id, role:input.role,
        sha256:sha(readFileSync(path)), page_count:Number(/^Pages:\s+(\d+)/m.exec(
          execFileSync('pdfinfo',[path],{encoding:'utf8'}))[1])}
      row.files.push(item)
      return item
    }
  }
  const examples = ['paper.pdf','paper-long.pdf','answers.pdf']
  const files = ['original','answer','analysis','original','answer','analysis'].map((role, i) => {
    const base = readFileSync(resolve(here,'../output/pdf',examples[i%3]))
    const bytes = Buffer.concat([base, Buffer.from('\n% synthetic '+i+'\n')])
    const path = 'fixture-'+i+'.pdf'
    writeFileSync(join(root,path), bytes)
    const pages = Number(/^Pages:\s+(\d+)/m.exec(execFileSync('pdfinfo',[join(root,path)],{encoding:'utf8'}))[1])
    return {path, pages, role, sha256:sha(bytes), source_url:'https://example.invalid/'+i}
  })
  const manifest = join(root,'plan.json')
  const registry = join(root,'registry.json')
  const prepare = selected => writeJson(manifest,{version:1, papers:[{key:'paper',title:'Fixture',subject:'math',
    year:2026,region:'fixture',source_url:'https://example.invalid',complete:true,files:selected}],questions:[]})
  const run = failAfter => runBatch({manifest,registry,native,failAfter,log:()=>{}})
  writeJson(registry,{version:1,papers:{},questions:{}})
  prepare(files.slice(0,3))
  assert.equal(await run(),0)
  const v1 = readJson(registry)
  v1.version = 1
  v1.papers.paper.files = Object.fromEntries(Object.values(v1.papers.paper.files).map(row => [row.role,row]))
  writeJson(registry, v1)
  prepare(files.slice(3))
  await assert.rejects(run(1), /INJECTED_AFTER_IPC_BEFORE_REGISTRY/)
  assert.deepEqual(readJson(registry),v1)
  assert.equal(await run(),0)
  const combined = readJson(registry)
  assert.equal(combined.version,2)
  assert.deepEqual(combined.papers.paper.descriptor.files,files)
  assert.equal(Object.keys(combined.papers.paper.files).length,6)
  assert.equal(db.length,1)
  assert.equal(writes,6)
  prepare(files.slice(0,3))
  assert.equal(await run(),0)
  assert.deepEqual(readJson(registry),combined)
  assert.equal(writes,6)
  prepare([{...files[0],source_url:'https://example.invalid/conflicting-source'}])
  assert.equal(await run(),1)
  assert.deepEqual(readJson(registry),combined)
  assert.equal(writes,6)
})

test('identity rejection is fatal rather than a recoverable item failure', async t => {
  const root = mkdtempSync(join(tmpdir(), 'knowpaper-content003-rejection-'))
  t.after(() => rmSync(root,{recursive:true,force:true}))
  const manifest = join(root,'plan.json')
  const registry = join(root,'registry.json')
  writeJson(manifest,{version:1,papers:[],questions:[{key:'fixture',subject:'math',answer:'Fixture',
    source:{url:'https://example.invalid/fixture',path:'source.txt',sha256:sha('Fixture')}}]})
  writeFileSync(join(root,'source.txt'),'Fixture')
  writeJson(registry,{version:1,papers:{},questions:{}})
  const rejection = Object.assign(Error('TARGET_IDENTITY_REJECTED'),{targetIdentityRejected:true})
  const commands = []
  const native = {call(command) {
    commands.push(command)
    if (command === 'list_subjects') return [{id:'math'}]
    throw rejection
  }}
  await assert.rejects(runBatch({manifest,registry,native,log:()=>{}}), rejection)
  assert.deepEqual(commands,['list_subjects','list_revisions'])
  assert.deepEqual(readJson(registry),{version:1,papers:{},questions:{}})
})
