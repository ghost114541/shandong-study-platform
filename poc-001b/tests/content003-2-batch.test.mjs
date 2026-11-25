import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readJson, runBatch, writeJson } from '../scripts/content003_batch.mjs'
import { controlledPath, privateDirectory, repositoryRoot } from '../scripts/content003_paths.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const region = {page_index:0,rect:[0.1,0.2,0.8,0.4]}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(),'knowpaper-integrity-'))
  t.after(() => rmSync(root,{recursive:true,force:true}))
  const manifest = join(root,'plan.json')
  const registry = join(root,'registry.json')
  const files = ['original','answer','answer','analysis'].map((role, index) => {
    const path = 'example-'+index+'.pdf'
    const sample = readFileSync(new URL('../output/pdf/paper.pdf',import.meta.url))
    const bytes = Buffer.concat([sample, Buffer.from('\n% Synthetic '+index+'\n')])
    writeFileSync(join(root,path),bytes)
    const pages = Number(/^Pages:\s+(\d+)/m.exec(execFileSync('pdfinfo',[join(root,path)],{encoding:'utf8'}))[1])
    return {path,role,pages,sha256:hash(bytes),source_url:'https://example.invalid/'+index}
  })
  const [original,answer,alternate,analysis] = files
  const paper = {key:'synthetic',title:'Synthetic exam',subject:'math',year:2026,region:'Synthetic',
    source_url:'https://example.invalid',files:[original,answer,alternate]}
  const question = {key:'linked',duplicate_of:'existing',subject:'math',paper_key:paper.key,
    source_key:'1',regions:[region],answer_sha256:answer.sha256}
  const db = {
    record:{id:'p1',title:paper.title,subject_id:'math',files:paper.files.map((spec,i) =>
      ({id:'file-'+i,paper_id:'p1',role:spec.role,sha256:spec.sha256,page_count:spec.pages}))},
    assets: Object.fromEntries(paper.files.map(spec => [spec.sha256,readFileSync(join(root,spec.path))])),
    locations:[{...region,ordinal:0,file_id:'file-0',source_key:'1',question_id:'existing'}],
    occurrences:[],
    revisions:{existing:[{id:1,base_revision_id:null}],other:[{id:2,base_revision_id:null}]}
  }
  const state = {version:2,papers:{synthetic:{paper_id:'p1',descriptor:paper,
    files:Object.fromEntries(db.record.files.map(file => [file.sha256,file]))}},
    questions:{linked:{question_id:'existing',revision_id:1,initial_revision_id:1,paper_key:paper.key,source_key:'1',
      regions:[region],original_file_id:'file-0',answer_file_id:'file-1',analysis_file_id:null}}}
  writeJson(registry,state)
  const mutationCalls = []
  const native = {
    occurrences: () => structuredClone(db.occurrences),
    call(command,args) {
      if (command === 'list_subjects') return [{id:'math'}]
      if (command === 'list_paper_records') return structuredClone([db.record])
      if (command === 'list_revisions') return structuredClone(db.revisions[args.questionId] ?? [])
      if (command === 'list_pdf_locations') return structuredClone(db.locations.filter(loc => loc.file_id === args.fileId))
      mutationCalls.push(command)
      assert.equal(command,'link_paper_regions')
      const {link,questionId} = args
      db.locations.push(...link.regions.map((item,ordinal) => ({...item,ordinal,
        file_id:link.file_id,source_key:link.source_key,question_id:questionId})))
    },
    pick(command,{input},_dialog,path) {
      mutationCalls.push(command)
      const bytes = readFileSync(path)
      const sha256 = hash(bytes)
      const spec = files.find(item => item.sha256 === sha256)
      const file = {id:'file-'+db.record.files.length,paper_id:'p1',role:input.role,
        sha256,page_count:spec.pages}
      db.record.files.push(file)
      db.assets[sha256] = bytes
      return file
    }
  }
  const run = (papers,questions,failAfter) => {
    writeJson(manifest,{version:1,papers,questions})
    return runBatch({manifest,registry,native,failAfter,log:()=>{}})
  }
  return {root,registry,paper,question,analysis,alternate,db,mutationCalls,run}
}

for (const [label, modify] of [
  ['FIX-T01 registered key points to a different logical question', f => { f.question.duplicate_of = 'other' }],
  ['FIX-T02 registered source points to different regions', f => {
    f.question.regions = [{page_index:0,rect:[0.1,0.2,0.9,0.5]}]
  }],
  ['FIX-T03 registered question points to a different answer version', f => { f.question.answer_sha256 = f.alternate.sha256 }],
  ['FIX-T04 valid new file mixed with same-hash provenance conflict', f => {
    f.paper.files = [f.analysis, {...f.paper.files[0],download_url:'https://example.invalid/other'},...f.paper.files.slice(1)]
  }],
  ['FIX-T13 a different question already owns the source occurrence', f => {
    f.question.key = 'new-key'
    f.question.duplicate_of = 'other'
  }],
  ['FIX-T13 an occurrence without a region is owned by a different question', f => {
    f.question.key = 'new-key'
    f.question.source_key = '2'
    f.db.occurrences.push({paper_id:'p1',source_key:'2',question_id:'other'})
  }],
  ['FIX-T13 registered source key is replaced', f => { f.question.source_key = 'different' }],
]) {
  test(label, async t => {
    const f = fixture(t)
    modify(f)
    const before = JSON.stringify(f.db)
    const register = readFileSync(f.registry)
    assert.equal(await f.run([f.paper],[f.question]),1)
    assert.deepEqual(f.mutationCalls,[])
    assert.equal(JSON.stringify(f.db),before)
    assert.deepEqual(readFileSync(f.registry),register)
  })
}

test('FIX-T05 interrupted link resumes exactly once and rejects a changed manifest', async t => {
  const f = fixture(t)
  const original = readFileSync(f.registry)
  const newLink = {...f.question,key:'second',source_key:'2'}
  await assert.rejects(f.run([f.paper],[newLink],1),/RETRY_REQUIRED_AFTER_IPC/)
  // The paper checkpoint is idempotent. Only the link reached the fixture database.
  assert.deepEqual(readJson(f.registry),JSON.parse(original))
  assert.equal(f.db.locations.length,2)
  await assert.rejects(f.run([f.paper],[{...newLink,source_key:'3'}]),/resume the same manifest/)
  assert.equal(await f.run([f.paper],[newLink]),0)
  assert.equal(await f.run([f.paper],[newLink]),0)
  assert.deepEqual(f.mutationCalls,['link_paper_regions'])
  assert.equal(f.db.locations.length,2)
  assert.equal(readJson(f.registry).questions.second.initial_revision_id,1)
})

test('FIX-T14 parents, sibling prefixes, and repository output are rejected', t => {
  const f = fixture(t)
  for (const path of [join(f.root,'..','output.json'),f.root+'-other/out.json',join(repositoryRoot,'output.json')])
    assert.throws(() => controlledPath(f.root,path,{missing:true}),/escapes/)
  assert.throws(() => privateDirectory(repositoryRoot),/outside the repository/)
  assert.throws(() => writeJson(join(repositoryRoot,'output.json'),{}),/outside the repository/)
  const copy = join(f.root,'copy.json')
  cpSync(f.registry,copy)
  assert.equal(controlledPath(f.root,copy),copy)
})

test('FIX-T15 Windows directory junction cannot redirect pending output or workspace',
  {skip:process.platform !== 'win32'}, t => {
    const f = fixture(t)
    const redirect = join(f.root,'redirect')
    execFileSync('cmd.exe',['/d','/c','mklink','/J',redirect,repositoryRoot],{windowsHide:true})
    t.after(() => {
      try { rmSync(redirect,{force:true}) } catch (error) { if (error.code !== 'ENOENT') throw error }
    })
    assert.throws(() => controlledPath(f.root,join(redirect,'output.json'),{missing:true}),/redirected/)
    assert.throws(() => privateDirectory(redirect),/redirected/)
  })
