import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { openSync, closeSync, fsyncSync, readFileSync, renameSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'
import { controlledPath, privateDirectory } from './content003_paths.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const rich = text => ({type:'doc',content:text.split(/\r?\n/).map(line => ({
  type:'paragraph',content:line ? [{type:'text',text:line}] : []
}))})

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}

export function writeJson(path, value) {
  const root = privateDirectory(dirname(resolve(path)))
  path = controlledPath(root, path, {missing:true})
  const temp = controlledPath(root, path + '.' + randomUUID() + '.tmp', {missing:true})
  const file = openSync(temp, 'wx')
  try {
    try {
      controlledPath(root, temp)
      writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
      fsyncSync(file)
    } finally {
      closeSync(file)
    }
    controlledPath(root, path, {missing:true})
    renameSync(temp, path)
    controlledPath(root, path)
  } finally {
    if (existsSync(temp)) unlinkSync(controlledPath(root, temp))
  }
}

function inputFile(root, relative, checksum) {
  assert.equal(basename(relative), relative)
  const path = controlledPath(root, resolve(root, relative))
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

export async function runBatch({manifest, registry, native, preview, failAfter, workspace = dirname(resolve(manifest)), log = console.log}) {
  const privateRoot = privateDirectory(workspace)
  manifest = controlledPath(privateRoot, manifest)
  if (!preview || registry) registry = controlledPath(privateRoot, registry)
  const root = dirname(manifest)
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
    questions: plan.questions.filter(question => !blockedQuestions.has(question.key) && !blockedPapers.has(question.paper_key)),
  }
  const lock = controlledPath(privateRoot, registry + '.lock', {missing:true})
  const intent = controlledPath(privateRoot, registry + '.pending', {missing:true})
  const file = openSync(lock, 'wx')
  try {
    controlledPath(privateRoot, lock)
    return issues.length + await applyPlan(ready, root, registry, intent, native, failAfter, log)
  } finally {
    closeSync(file)
    unlinkSync(controlledPath(privateRoot, lock))
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

function sameFields(actual, expected, fields, label) {
  for (const field of fields) assert.deepEqual(actual[field], expected[field], label + ': ' + field)
}

function checkRegions(locations, link, id) {
  assert.equal(locations.length, link.regions.length, 'Existing region count differs')
  for (const [ordinal, region] of link.regions.entries()) {
    const actual = locations.find(loc => loc.ordinal === ordinal)
    assert.ok(actual && actual.question_id === id && actual.page_index === region.page_index &&
      isDeepStrictEqual(actual.rect, region.rect), 'Existing source owner or regions differ')
  }
}

function prepareContent(q, root) {
  const content = structuredClone(q.content ?? {schema_version:1,parts:[],attachments:[],
    question_type:q.kind,score:q.score,stem:rich(q.stem ?? ''),
    answer:rich(q.answer ?? ''),analysis:rich(q.analysis ?? '')})
  if (q.images?.length && !q.include_text_in_stem) content.stem = {type:'doc',content:[]}
  if (q.analysis_images?.length && (!content.analysis || (!q.content && !q.analysis)))
    content.analysis = {type:'doc',content:[]}
  const images = []
  for (const [field, items] of [['stem',q.images],['analysis',q.analysis_images]]) {
    for (const image of items ?? []) {
      const {bytes} = inputFile(root, image.path, image.sha256)
      // The native attachment contract derives this descriptor from the PNG bytes.
      const attachment = {id:'sha256-'+image.sha256, sha256:image.sha256,
        byte_size:bytes.length, media_type:'image/png'}
      if (!content.attachments.some(row => row.id === attachment.id)) content.attachments.push(attachment)
      content[field].content.push({type:'image',attrs:{src:'attachment:'+attachment.id,alt:image.alt}})
      images.push({attachment, bytes})
    }
  }
  return {content, images}
}

async function preflightWrites(plan, root, state, native, log) {
  const papers = new Map()
  const questions = []
  const signatures = new Map(Object.entries(state.questions).flatMap(([key,q]) =>
    q.signature ? [[q.signature,key]] : []))
  const all = plan.papers.length ? await native.call('list_paper_records') : []
  const occurrenceOwners = new Map()
  if (plan.questions.some(question => question.paper_key) && native.occurrences) {
    for (const {paper_id,source_key,question_id} of await native.occurrences())
      occurrenceOwners.set(JSON.stringify([paper_id,source_key]),question_id)
  }
  const files = all.flatMap(row => row.files.map(item => ({row, item})))
  const history = new Map()
  for (const [key, record] of Object.entries(state.papers)) {
    for (const [hash, entry] of Object.entries(registeredVersions(record))) {
      assert.ok(!history.has(hash), 'Multiple registered papers claim a PDF hash')
      history.set(hash, {key, ...entry})
    }
  }
  const plannedHashes = new Map()
  const paperIdentities = new Set()
  const slots = new Map()
  const regionPlans = new Map()
  const knowledgePlans = new Map()
  const locationsByFile = new Map()
  let conflicts = 0
  function conflict(error, kind, key) {
    if (error.targetIdentityRejected || error.code !== 'ERR_ASSERTION') throw error
    conflicts++
    log(JSON.stringify({stage:kind,key,status:'source_conflict',error:error.message}))
  }
  for (const paper of plan.papers) {
    try {
      const prior = state.papers[paper.key]
      const versions = prior ? registeredVersions(prior) : {}
      if (prior) sameFields(prior.descriptor, paper,
        ['title','subject','year','region','source_url','application_source'], 'Stable paper provenance differs')
      const ordered = [...paper.files].sort((a,b) => Number(b.role === 'original') - Number(a.role === 'original'))
      let id = prior?.paper_id
      const titleKey = JSON.stringify([paper.subject,paper.title])
      assert.ok(!paperIdentities.has(titleKey), 'Two plans address the same paper')
      paperIdentities.add(titleKey)
      for (const spec of ordered) {
        const checksum = spec.sha256
        assert.ok(!plannedHashes.has(checksum), 'PDF hash claimed by two paper plans')
        plannedHashes.set(checksum, paper.key)
        const historical = history.get(checksum)
        if (historical) {
          assert.equal(historical.key, paper.key, 'PDF hash belongs to a different registered paper')
          sameFields(historical.spec, spec, ['role','pages','source_url','download_url'], 'Registered file provenance differs')
        }
        const matches = files.filter(({item}) => item.sha256 === checksum)
        assert.ok(matches.length <= 1, 'Multiple PDF candidates')
        if (!matches.length) {
          assert.ok(!historical, 'Registered file missing from the application')
          continue
        }
        const [{row,item}] = matches
        assert.equal(item.role,spec.role,'PDF already assigned a different role')
        assert.equal(item.page_count,spec.pages,'Stored PDF page count differs')
        if ('source' in item) assert.equal(item.source,paper.application_source ?? paper.source_url,
          'Stored PDF source differs')
        assert.equal(row.title,paper.title,'PDF already belongs to another title')
        assert.equal(row.subject_id,paper.subject)
        if (id) assert.equal(item.paper_id,id,'PDF already belongs to another paper')
        if (historical) assert.equal(item.id,historical.file.id,'Registered file ID differs')
        id = item.paper_id
        versions[checksum] = historical ?? {file:item,spec}
      }
      const stored = all.find(row => row.id === id)
      if (id) {
        assert.ok(stored && stored.title === paper.title && stored.subject_id === paper.subject,
          'Registered paper is missing or changed')
        for (const field of ['year','region','source'])
          if (field in stored) assert.equal(stored[field], fileArgs(paper, ordered[0], id).input[field],
            'Stored paper provenance differs: '+field)
      } else {
        assert.ok(!all.some(row => row.title === paper.title && row.subject_id === paper.subject),
          'Same paper title with different PDF needs a registered paper identity')
      }
      papers.set(paper.key, {paper,files:paper.files,ordered,versions,id,stored})
    } catch (error) {
      conflict(error, 'paper', paper.key)
    }
  }

  for (const q of plan.questions) {
    try {
      const paper = papers.get(q.paper_key)
      if (q.paper_key && !paper) continue
      const original = paper && referenceFile(paper, 'original', q.original_sha256)
      const answer = paper && !(q.analysis_sha256 && !q.answer_sha256) && referenceFile(paper, 'answer', q.answer_sha256)
      const analysis = paper && (q.analysis_sha256 || !answer ? referenceFile(paper, 'analysis', q.analysis_sha256) : undefined)
      const fileId = spec => spec && paper.versions[spec.sha256]?.file.id
      const id = q.duplicate_of ?? 'content003-' + q.key
      const signature = q.duplicate_of ? undefined : duplicateSignature(q)
      assert.ok(!signature || !signatures.has(signature) || signatures.get(signature) === q.key,
        'Exact question candidate: use explicit duplicate_of after confirmation')
      if (signature) signatures.set(signature,q.key)
      const registered = state.questions[q.key]
      const entry = {question_id:id,paper_key:q.paper_key,source_key:q.source_key,
        regions:q.regions,source:q.source,signature,original_file_id:fileId(original),
        answer_file_id:paper ? answer ? fileId(answer) : null : undefined,
        analysis_file_id:paper ? analysis ? fileId(analysis) : null : undefined}
      if (registered) {
        sameFields(entry, registered, Object.keys(entry).filter(field => field !== 'signature' ||
          registered.signature !== undefined), 'Registered question provenance differs')
      }
      const revisions = await native.call('list_revisions', {questionId:id})
      const initial = revisions.find(rev => rev.base_revision_id == null)
      if (registered) {
        assert.ok(initial && revisions.some(rev => rev.id === registered.revision_id), 'Registered revision is missing')
        assert.equal(initial.id, registered.initial_revision_id ?? (q.duplicate_of ? initial.id : registered.revision_id),
          'Registered initial revision differs')
      }
      if (q.duplicate_of) assert.ok(initial && original, 'Confirmed duplicate requires an existing question and original PDF')
      let hasRegions = false
      if (original) {
        const slot = JSON.stringify([paper.id ?? q.paper_key,q.source_key])
        const existingOwner = occurrenceOwners.get(slot)
        assert.ok(!existingOwner || existingOwner === id, 'Stored occurrence belongs to another question')
        const other = slots.get(slot)
        assert.ok(!other || other === id, 'Source key claimed by different questions in this batch')
        slots.set(slot,id)
        const regionKey = JSON.stringify([slot, original.sha256])
        if (regionPlans.has(regionKey)) assert.deepEqual(q.regions, regionPlans.get(regionKey),
          'Source key claimed for different regions in this batch')
        regionPlans.set(regionKey, q.regions)
        for (const file of paper.stored?.files ?? []) {
          if (file.role !== 'original') continue
          if (!locationsByFile.has(file.id))
            locationsByFile.set(file.id, await native.call('list_pdf_locations',{fileId:file.id}))
          const locations = locationsByFile.get(file.id).filter(loc => loc.source_key === q.source_key)
          assert.ok(locations.every(loc => loc.question_id === id), 'Existing occurrence belongs to another question')
          if (file.id === entry.original_file_id && locations.length) {
            checkRegions(locations, {regions:q.regions}, id)
            hasRegions = true
          }
        }
        assert.ok(!initial || q.duplicate_of && !registered || hasRegions, 'Existing original PDF association is missing')
      }
      const payload = q.duplicate_of ? null : prepareContent(q, root)
      if (payload && revisions.length) {
        assert.ok(initial, 'Existing ID lacks an initial revision')
        const stored = (await native.call('read_revision',{revisionId:initial.id})).revision
        for (const [field,value] of Object.entries(payload.content))
          assert.ok(isDeepStrictEqual(stored.content[field],value), 'Existing ID differs in '+field)
      }
      let createKnowledge = false
      if (q.knowledge_id && !registered) {
        const nodes = await native.call('list_knowledge',{subjectId:q.subject})
        createKnowledge = !nodes.some(node => node.id === q.knowledge_id)
        assert.ok(!createKnowledge || q.knowledge_title, 'Unknown knowledge node')
        if (createKnowledge) {
          const node = [q.subject, q.knowledge_title]
          if (knowledgePlans.has(q.knowledge_id)) assert.deepEqual(node, knowledgePlans.get(q.knowledge_id),
            'Knowledge node claimed with different metadata')
          knowledgePlans.set(q.knowledge_id, node)
        }
      }
      questions.push({q,paper,original,answer,analysis,entry,registered,initial,hasRegions,payload,createKnowledge})
    } catch (error) {
      conflict(error, 'question', q.key)
    }
  }
  return {papers,questions,conflicts}
}

async function applyPlan(plan, root, registry, intent, native, failAfter, log) {
  const fingerprint = sha(JSON.stringify(plan))
  if (existsSync(intent)) assert.equal(readJson(intent).fingerprint, fingerprint,
    'RETRY_REQUIRED_AFTER_IPC: resume the same manifest before applying a different plan')
  const rawState = readJson(registry)
  const state = migrateRegistry(rawState)
  const {papers,questions,conflicts} = await preflightWrites(plan, root, state, native, log)
  if (conflicts) return conflicts
  let writes = 0
  let mayHaveWritten = false
  async function mutate(operation) {
    if (!mayHaveWritten && !existsSync(intent)) writeJson(intent, {fingerprint})
    mayHaveWritten = true
    const result = await operation()
    if (++writes === failAfter) throw Error('INJECTED_AFTER_IPC_BEFORE_REGISTRY')
    return result
  }
  try {
    for (const [key, planned] of papers) {
      const {paper,ordered,versions} = planned
      let id = planned.id
      for (const spec of ordered) {
        if (versions[spec.sha256]) continue
        const {path} = inputFile(root, spec.path, spec.sha256)
        const file = await mutate(() => native.pick('import_paper_pdf',fileArgs(paper,spec,id),'瀵煎叆璇曞嵎 PDF',path))
        assert.equal(file.sha256,spec.sha256)
        assert.equal(file.page_count,spec.pages)
        assert.equal(file.role,spec.role)
        if (id) assert.equal(file.paper_id,id)
        id = file.paper_id
        versions[spec.sha256] = {file,spec}
      }
      const next = {paper_id:id,
        files:Object.fromEntries(Object.entries(versions).map(([hash,row]) => [hash,row.file])),
        descriptor:{...paper,files:Object.values(versions).map(row => row.spec)}}
      if (rawState.version !== state.version || !isDeepStrictEqual(state.papers[key], next)) {
        state.papers[key] = next
        writeJson(registry, state)
      }
      log(JSON.stringify({stage:'paper',key,status:'ok'}))
    }

    const completedRegions = new Set()
    for (const {q,paper,original,answer,analysis,entry,registered,initial,hasRegions,payload,createKnowledge} of questions) {
      const id = entry.question_id
      const link = original && {file_id:paper.versions[original.sha256].file.id,source_key:q.source_key,regions:q.regions}
      let revisionId = initial?.id
      const regionKey = link && JSON.stringify([link.file_id, link.source_key])
      if (q.duplicate_of && !hasRegions && !completedRegions.has(regionKey)) {
        await mutate(() => native.call('link_paper_regions',{questionId:id,link,correct:false}))
      } else if (!initial) {
        for (const {bytes,attachment} of payload.images)
          assert.deepEqual(await mutate(() => native.image(bytes)),attachment)
        revisionId = (await mutate(() => native.call('create_question',{questionId:id,subjectId:q.subject,
          contentJson:JSON.stringify(payload.content),source:link}))).id
      }
      if (link) {
        const locations = await native.call('list_pdf_locations',{fileId:link.file_id})
        checkRegions(locations.filter(loc => loc.source_key === link.source_key),link,id)
        completedRegions.add(regionKey)
      }
      if (q.knowledge_id && !registered) {
        if (createKnowledge && !(await native.call('list_knowledge',{subjectId:q.subject})).some(node => node.id === q.knowledge_id))
          await mutate(() => native.call('create_knowledge',{id:q.knowledge_id,subjectId:q.subject,
            title:q.knowledge_title,sortOrder:0}))
        if (!(await native.call('question_knowledge',{questionId:id})).includes(q.knowledge_id))
          await mutate(() => native.call('set_question_knowledge',{questionId:id,id:q.knowledge_id,linked:true}))
      }
      if (!registered) {
        state.questions[q.key] = {...entry,revision_id:revisionId,initial_revision_id:revisionId,
          original_file_id:link?.file_id, answer_file_id:paper ? answer ? paper.versions[answer.sha256].file.id : null : undefined,
          analysis_file_id:paper ? analysis ? paper.versions[analysis.sha256].file.id : null : undefined,
          analysis_checked:q.analysis_checked === true, ...(q.answer_checked === true ? {answer_checked:true} : {})}
        writeJson(registry,state)
      }
      log(JSON.stringify({stage:'question',key:q.key,status:q.duplicate_of?'deduplicated':initial?'recovered':'created'}))
    }
    if (existsSync(intent)) unlinkSync(controlledPath(dirname(registry), intent))
    return 0
  } catch (error) {
    if (!mayHaveWritten || error.targetIdentityRejected) throw error
    throw new Error('RETRY_REQUIRED_AFTER_IPC: '+error.message, {cause:error})
  }
}


if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [flag, before, after] = process.argv.slice(2)
  assert.ok(flag === '--migrate-registry' && before && after && !existsSync(after),
    'Usage: content003_batch.mjs --migrate-registry <old.json> <new.json>')
  writeJson(after, migrateRegistry(readJson(controlledPath(privateDirectory(dirname(resolve(before))), before))))
}
