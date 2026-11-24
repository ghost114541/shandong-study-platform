import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { openSync, closeSync, fsyncSync, readFileSync, realpathSync, renameSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const rich = text => ({type:'doc',content:text.split(/\r?\n/).map(line => ({
  type:'paragraph',content:line ? [{type:'text',text:line}] : []
}))})

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}

export function writeJson(path, value) {
  const temp = path + '.tmp'
  const file = openSync(temp, 'w')
  try {
    writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
    fsyncSync(file)
  } finally {
    closeSync(file)
  }
  renameSync(temp, path)
}

function inputFile(root, relative, checksum) {
  assert.equal(basename(relative), relative)
  const path = realpathSync(resolve(root, relative))
  assert.equal(dirname(path), root, 'Private file escapes the manifest directory')
  const bytes = readFileSync(path)
  assert.match(checksum, /^[0-9a-f]{64}$/)
  assert.equal(sha(bytes), checksum, 'Private file checksum differs')
  return {path, bytes}
}

function duplicateSignature(question) {
  const clean = text => typeof text === 'string' ? text.normalize('NFC').replace(/\s+/g,' ').trim() : text
  const images = question.images?.map(row => row.sha256)
  const stem = question.content ? [question.content.stem, question.content.parts.map(part => part.prompt)]
    : clean(question.stem)
  return sha(JSON.stringify([question.subject,images?.length ? images : stem], (_, value) => clean(value)))
}

function fileArgs(paper, file, id) {
  return {input:{title:paper.title,subject_id:paper.subject,year:paper.year,
    region:paper.region,source:paper.application_source ?? paper.source_url,role:file.role,paper_id:id}}
}

export function referenceFile(paper, role, checksum) {
  const candidates = paper.files.filter(file => file.role === role && (!checksum || file.sha256 === checksum))
  assert.ok(candidates.length <= 1, 'Specify the exact '+role+' PDF SHA-256')
  assert.ok(!checksum || candidates.length === 1, 'Referenced PDF SHA-256 is absent')
  return candidates[0]
}

function registeredVersions(record) {
  return Object.fromEntries(record.descriptor.files.map(spec => {
    const file = record.files[spec.sha256] ?? record.files[spec.role]
    assert.equal(file?.sha256, spec.sha256, 'Legacy journal file mapping is ambiguous or incomplete')
    assert.equal(file.role, spec.role)
    return [spec.sha256, {file, spec}]
  }))
}

export async function runBatch({manifest, registry, native, preview, failAfter, log = console.log}) {
  const root = realpathSync(dirname(resolve(manifest)))
  const plan = readJson(manifest)
  assert.equal(plan.version, 1)
  const subjects = new Set((await native.call('list_subjects')).map(row => row.id))
  const issues = []
  const keys = new Set()
  const paperKeys = new Set()
  for (const paper of plan.papers) {
    assert.ok(!paperKeys.has(paper.key), 'Duplicate paper key')
    paperKeys.add(paper.key)
    try {
      assert.ok(subjects.has(paper.subject), 'Unknown subject')
      assert.ok(paper.title && paper.source_url && Number.isInteger(paper.year))
      assert.ok(paper.files.some(file => file.role === 'original'))
      assert.equal(new Set(paper.files.map(file => file.sha256)).size, paper.files.length)
      for (const file of paper.files) {
        const {bytes,path} = inputFile(root, file.path, file.sha256)
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
        assert.ok(Number.isInteger(file.pages) && file.pages > 0)
        const pages = /^Pages:\s+(\d+)\s*$/m.exec(execFileSync('pdfinfo',[path],{encoding:'utf8',timeout:30000}))
        assert.equal(Number(pages?.[1]),file.pages,'PDF preflight page count differs')
      }
    } catch (error) {
      issues.push({paper:paper.key, error:error.code ?? error.name})
    }
  }
  for (const question of plan.questions) {
    assert.ok(!keys.has(question.key), 'Duplicate question key')
    keys.add(question.key)
    try {
      assert.match(question.key, /^[a-z0-9-]+$/)
      assert.ok(subjects.has(question.subject))
      assert.ok(question.duplicate_of || question.answer || question.content)
      if (question.paper_key) {
        const paper = plan.papers.find(row => row.key === question.paper_key)
        const pages = referenceFile(paper, 'original', question.original_sha256).pages
        const answer = question.analysis_sha256 && !question.answer_sha256 ? null :
          referenceFile(paper, 'answer', question.answer_sha256)
        if (question.analysis_sha256 || !answer) referenceFile(paper, 'analysis', question.analysis_sha256)
        assert.equal(paper.subject, question.subject)
        assert.ok(question.source_key && question.regions?.length)
        for (const {page_index, rect} of question.regions) {
          assert.ok(Number.isInteger(page_index) && page_index >= 0 && page_index < pages)
          assert.ok(rect.length === 4 && rect.every(value => Number.isFinite(value) && value >= 0 && value <= 1))
          assert.ok(rect[0] < rect[2] && rect[1] < rect[3])
        }
      } else {
        assert.ok(!question.duplicate_of && question.source?.url)
        inputFile(root, question.source.path, question.source.sha256)
      }
      for (const image of [...(question.images ?? []), ...(question.analysis_images ?? [])]) {
        const {bytes} = inputFile(root, image.path, image.sha256)
        assert.ok(bytes.length <= 5 * 1024 * 1024)
        assert.equal(bytes.subarray(0,8).toString('hex'), '89504e470d0a1a0a')
      }
    } catch (error) {
      issues.push({question:question.key, error:error.code ?? error.name})
    }
  }
  log(JSON.stringify({stage:'preflight', papers:plan.papers.length, questions:plan.questions.length, issues}))
  if (preview) return issues.length
  const blockedPapers = new Set(issues.flatMap(issue => issue.paper ? [issue.paper] : []))
  const blockedQuestions = new Set(issues.flatMap(issue => issue.question ? [issue.question] : []))
  const ready = {
    papers: plan.papers.filter(paper => !blockedPapers.has(paper.key)),
    questions: plan.questions.filter(question => !blockedQuestions.has(question.key)),
  }
  const lock = registry + '.lock'
  const file = openSync(lock, 'wx')
  try {
    return issues.length + await applyPlan(ready, root, registry, native, failAfter, log)
  } finally {
    closeSync(file)
    unlinkSync(lock)
  }
}

export function migrateRegistry(state) {
  assert.ok([1,2].includes(state.version), 'Unsupported import journal version')
  state = structuredClone(state)
  // Resolve legacy references against their original descriptor before merging new versions.
  for (const [key, record] of Object.entries(state.papers)) {
    const versions = registeredVersions(record)
    state.papers[key].files = Object.fromEntries(Object.entries(versions).map(([sha,row]) => [sha,row.file]))
  }
  for (const entry of Object.values(state.questions)) {
    const record = state.papers[entry.paper_key]
    if (!record || entry.original_file_id) continue
    const fileId = role => {
      const spec = referenceFile(record.descriptor, role)
      return spec ? record.files[spec.sha256].id : null
    }
    entry.original_file_id = fileId('original')
    entry.answer_file_id = fileId('answer')
    entry.analysis_file_id = entry.answer_file_id ? null : fileId('analysis')
  }
  state.version = 2
  return state
}

async function applyPlan(plan, root, registry, native, failAfter, log) {
  const state = migrateRegistry(readJson(registry))
  const papers = new Map()
  const signatures = new Map(Object.entries(state.questions).flatMap(([key,question]) =>
    question.signature ? [[question.signature,key]] : []))
  let failures = 0
  let writes = 0
  function wrote() {
    if (++writes === failAfter) throw Error('INJECTED_AFTER_IPC_BEFORE_REGISTRY')
  }
  for (const paper of plan.papers) {
    const started = performance.now()
    try {
      const records = await native.call('list_paper_records')
      const ordered = [...paper.files].sort((a,b) => Number(b.role === 'original') - Number(a.role === 'original'))
      const prior = state.papers[paper.key]
      const versions = prior ? registeredVersions(prior) : {}
      if (prior) {
        for (const key of ['title','subject','year','region'])
          assert.equal(prior.descriptor[key], paper[key], 'Stable paper identity changed: '+key)
      }
      const all = records.flatMap(row => row.files.map(item => ({row, item})))
      let paperId = prior?.paper_id
      for (const file of ordered) {
        const matches = all.filter(({item}) => item.sha256 === file.sha256)
        assert.ok(matches.length <= 1, 'Multiple PDF candidates')
        if (!matches.length) continue
        const [{row,item}] = matches
        assert.equal(item.role,file.role,'PDF already assigned a different role')
        assert.equal(row.title,paper.title,'PDF already belongs to another title')
        assert.equal(row.subject_id,paper.subject)
        if (paperId) assert.equal(item.paper_id,paperId)
        paperId = item.paper_id
      }
      assert.ok(!paperId || records.some(row => row.id === paperId &&
        row.title === paper.title && row.subject_id === paper.subject), 'Registered paper is missing or changed')
      assert.ok(paperId || !records.some(row => row.title === paper.title && row.subject_id === paper.subject),
        'Same paper title with different PDF needs a registered paper identity')
      for (const file of ordered) {
        const entry = versions[file.sha256]
        if (entry) {
          for (const field of ['role','pages','source_url','download_url'])
            assert.equal(entry.spec[field],file[field],'Registered file provenance differs: '+field)
        }
        let stored = all.find(({item}) => item.sha256 === file.sha256)?.item
        if (!stored) {
          assert.ok(!entry, 'Registered file missing from the application')
          const {path} = inputFile(root, file.path, file.sha256)
          stored = await native.pick('import_paper_pdf',fileArgs(paper,file,paperId),'导入试卷 PDF',path)
          wrote()
        }
        assert.equal(stored.sha256,file.sha256)
        assert.equal(stored.page_count,file.pages)
        if (entry) assert.equal(entry.file.id, stored.id, 'Registered file ID differs')
        paperId = stored.paper_id
        versions[file.sha256] = entry ?? {file:stored,spec:file}
      }
      const next = {paper_id:paperId,
        files:Object.fromEntries(Object.entries(versions).map(([sha,row]) => [sha,row.file])),
        descriptor:{...paper,files:Object.values(versions).map(row => row.spec)}}
      writeJson(registry, {...state, papers:{...state.papers,[paper.key]:next}})
      state.papers[paper.key] = next
      papers.set(paper.key, {record:next, files:paper.files})
      log(JSON.stringify({stage:'paper', key:paper.key, status:'ok', ms:Math.round(performance.now()-started)}))
    } catch (error) {
      if (error.targetIdentityRejected || error.message === 'INJECTED_AFTER_IPC_BEFORE_REGISTRY') throw error
      failures++
      log(JSON.stringify({stage:'paper', key:paper.key, status:'failed', error:error.message}))
    }
  }

  for (const q of plan.questions) {
    const started = performance.now()
    try {
      const paper = papers.get(q.paper_key)
      assert.ok(!q.paper_key || paper, 'Linked paper was not imported')
      const original = paper && referenceFile(paper, 'original', q.original_sha256)
      const answer = paper && !(q.analysis_sha256 && !q.answer_sha256) && referenceFile(paper, 'answer', q.answer_sha256)
      const analysis = paper && (q.analysis_sha256 || !answer ? referenceFile(paper, 'analysis', q.analysis_sha256) : undefined)
      const link = paper && {file_id:paper.record.files[original.sha256].id, source_key:q.source_key, regions:q.regions}
      const id = q.duplicate_of ?? 'content003-' + q.key
      const signature = q.duplicate_of ? undefined : duplicateSignature(q)
      assert.ok(!signature || !signatures.has(signature) || signatures.get(signature) === q.key,
        'Exact question candidate: use explicit duplicate_of after confirmation')
      const prior = await native.call('list_revisions', {questionId:id})
      const initial = prior.find(rev => rev.base_revision_id == null)
      let revisionId
      if (q.duplicate_of) {
        assert.ok(initial && link, 'Confirmed duplicate requires an existing question and original PDF')
        const locations = await native.call('list_pdf_locations', {questionId:id})
        if (!locations.some(loc => loc.file_id === link.file_id && loc.source_key === link.source_key)) {
          await native.call('link_paper_regions', {questionId:id,link,correct:false})
          wrote()
        }
        revisionId = state.questions[q.key]?.revision_id ?? (await native.call('current_revision',{questionId:id})).revision.id
      } else {
        let content = q.content ?? {schema_version:1,parts:[],attachments:[],
          question_type:q.kind,score:q.score,stem:rich(q.stem ?? ''),
          answer:rich(q.answer ?? ''),analysis:rich(q.analysis ?? '')}
        if (q.images?.length || q.analysis_images?.length) {
          content = structuredClone(content)
          if (q.images?.length && !q.include_text_in_stem) content.stem = {type:'doc',content:[]}
          if (q.analysis_images?.length && (!content.analysis || (!q.content && !q.analysis)))
            content.analysis = {type:'doc',content:[]}
          for (const [field, images] of [['stem',q.images],['analysis',q.analysis_images]]) {
            for (const image of images ?? []) {
              const {bytes} = inputFile(root,image.path,image.sha256)
              const attachment = await native.image(bytes)
              if (!content.attachments.some(row => row.id === attachment.id)) content.attachments.push(attachment)
              content[field].content.push({type:'image',attrs:{src:'attachment:'+attachment.id,alt:image.alt}})
            }
          }
        }
        if (prior.length) {
          assert.ok(initial, 'Existing ID lacks an initial revision')
          const original = (await native.call('read_revision',{revisionId:initial.id})).revision
          // The normal content parser supplies optional defaults. Compare the submitted fields.
          for (const [field,value] of Object.entries(content))
            assert.ok(isDeepStrictEqual(original.content[field],value), 'Existing ID differs in '+field)
          revisionId = initial.id
        } else {
          revisionId = (await native.call('create_question',{questionId:id,subjectId:q.subject,
            contentJson:JSON.stringify(content),source:link})).id
          wrote()
        }
      }
      if (link) {
        const locations = (await native.call('list_pdf_locations',{questionId:id}))
          .filter(loc => loc.file_id === link.file_id && loc.source_key === link.source_key)
        assert.equal(locations.length, link.regions.length)
        for (const [ordinal,region] of link.regions.entries()) {
          const actual = locations.find(loc => loc.ordinal === ordinal)
          assert.ok(actual && actual.page_index === region.page_index && isDeepStrictEqual(actual.rect,region.rect),
            'Existing source regions differ')
        }
      }
      if (q.knowledge_id && !state.questions[q.key]) {
        const nodes = await native.call('list_knowledge',{subjectId:q.subject})
        if (!nodes.some(node => node.id === q.knowledge_id)) {
          assert.ok(q.knowledge_title, 'Unknown knowledge node')
          await native.call('create_knowledge',{id:q.knowledge_id,subjectId:q.subject,
            title:q.knowledge_title,sortOrder:0})
        }
        if (!(await native.call('question_knowledge',{questionId:id})).includes(q.knowledge_id))
          await native.call('set_question_knowledge',{questionId:id,id:q.knowledge_id,linked:true})
      }
      const entry = {...state.questions[q.key],question_id:id,revision_id:revisionId,paper_key:q.paper_key,source_key:q.source_key,
        regions:q.regions,source:q.source,signature,analysis_checked:q.analysis_checked === true,
        ...(q.answer_checked === true ? {answer_checked:true} : {}),
        original_file_id:link?.file_id, answer_file_id:paper ? (answer ? paper.record.files[answer.sha256].id : null) : undefined,
        analysis_file_id:paper ? (analysis ? paper.record.files[analysis.sha256].id : null) : undefined}
      const registered = state.questions[q.key]
      if (registered) {
        for (const [field, value] of Object.entries(entry)) {
          if (registered[field] !== undefined)
            assert.deepEqual(value, registered[field], 'Registered question provenance differs: '+field)
        }
      }
      writeJson(registry,{...state,questions:{...state.questions,[q.key]:entry}})
      state.questions[q.key] = entry
      if (signature) signatures.set(signature,q.key)
      log(JSON.stringify({stage:'question',key:q.key,status:q.duplicate_of?'deduplicated':prior.length?'recovered':'created',
        ms:Math.round(performance.now()-started)}))
    } catch (error) {
      if (error.targetIdentityRejected || error.message === 'INJECTED_AFTER_IPC_BEFORE_REGISTRY') throw error
      failures++
      log(JSON.stringify({stage:'question',key:q.key,status:'failed',error:error.message}))
    }
  }
  return failures
}


if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [flag, before, after] = process.argv.slice(2)
  assert.ok(flag === '--migrate-registry' && before && after && !existsSync(after),
    'Usage: content003_batch.mjs --migrate-registry <old.json> <new.json>')
  writeJson(after, migrateRegistry(readJson(before)))
}
