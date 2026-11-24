// Local runner for the dedicated CONTENT-003 Windows build.
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { readJson, runBatch, writeJson } from './content003_batch.mjs'

const execute = promisify(execFile)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [operation, workspace, executable, manifest, registry, failAfter] = process.argv.slice(2)
const privateRoot = resolve(workspace)
const app = resolve(executable)
const profile = join(process.env.APPDATA, 'org.shandong-study.content003-isolated')
const port = 19443
const journal = join(profile,'data-protection','root.json')
const strip = path => path.startsWith('\\\\?\\') ? path.slice(4) : path
function active() {
  return existsSync(journal) ? strip(readJson(journal).active) : profile
}
function assertIsolated() {
  const root = resolve(active()).toLowerCase()
  const base = resolve(profile).toLowerCase()
  assert.ok(root === base || (dirname(root) === base + '.knowpaper-libraries'
    && /^knowpaper-library-[a-z0-9]+$/i.test(basename(root))))
}
let child, ws, launchError, id = 0
const pending = new Map()
async function waitFor(fn, label, max = 23000) {
  const stop = Date.now() + max
  let error
  while (Date.now() < stop) {
    if (launchError) throw launchError
    try { const value = await fn(); if (value) return value } catch (e) { error = e }
    await delay(150)
  }
  throw new Error('Timeout: '+ label, {cause:error})
}
async function start() {
  child = spawn(app, [], {cwd: privateRoot, windowsHide:true, env: {...process.env,
    WEBVIEW2_USER_DATA_FOLDER: join(privateRoot, 'webview2'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port='+port+' --remote-debugging-address=127.0.0.1'
  }, stdio:'ignore'})
  child.once('error', error => { launchError = error })
  const target = await waitFor(async () => (await (await fetch('http://127.0.0.1:'+port+'/json/list')).json())
    .find(t => t.type === 'page' && t.url.startsWith('http')), 'WebView2 target')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail })
  ws.onmessage = ({data}) => {
    const m=JSON.parse(data); pending.get(m.id)?.(m)
  }
  await waitFor(() => ev("!!window.__TAURI_INTERNALS__ && !!document.querySelector('main')"), 'app')
  await send('Network.enable')
  await send('Network.setBlockedURLs', {urls:['https://*']})
}
function send(method, params={}) {
  const key=++id
  return new Promise((ok,fail) => {
    const timer=setTimeout(()=>{pending.delete(key); fail(new Error(method+' timeout'))}, 120000)
    pending.set(key, m=>{clearTimeout(timer); pending.delete(key); m.error ? fail(Error(m.error.message)) : ok(m.result)})
    ws.send(JSON.stringify({id:key,method,params}))
  })
}
async function ev(expression) {
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function call(command,args={}) {
  const result = await invoke(JSON.stringify(command)+','+JSON.stringify(args))
  if ('error' in result) throw Error(command+': '+result.error)
  return result.value
}
async function invoke(args) {
  return ev('window.__TAURI_INTERNALS__.invoke('+args+
    ').then(value=>({value}),error=>({error:error?.message??JSON.stringify(error)}))')
}
async function pick(command,args,dialog,path) {
  const selecting=call(command,args)
  selecting.catch(()=>{})
  await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(repo,'tests/windows-pdf-dialog.ps1'),
    '-AppProcess',String(child.pid),'-Title',dialog,'-Filename',path],{windowsHide:true,timeout:26000})
  return selecting
}
async function close() {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  await execute('powershell.exe',['-NoProfile','-Command',
    '(Get-Process -Id '+child.pid+' -ErrorAction Stop).CloseMainWindow() | Out-Null'], {windowsHide:true})
  await waitFor(()=>child.exitCode !== null, 'app close')
  ws?.close()
}

async function image(bytes) {
  const result = await invoke("'import_attachment',Uint8Array.from(atob("+
    JSON.stringify(bytes.toString('base64'))+"),c=>c.charCodeAt(0)).buffer,"+
    "{headers:{'x-image-media-type':'image/png'}}")
  if ('error' in result) throw Error(result.error)
  return result.value
}

async function click(text) {
  const matcher = '[...document.querySelectorAll("button")].find(b=>!b.disabled && b.textContent.trim().startsWith('+JSON.stringify(text)+'))'
  await waitFor(()=>ev('!!('+matcher+')'),text)
  await ev('('+matcher+').click()')
}

async function verifyVisual(subject, location, expectedImages) {
  const paper = (await call('list_paper_records')).find(record=>record.id===location.paper_id)
  const file = paper.files.find(row=>row.id===location.file_id)
  const back = await ev('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="返回试卷库")')
  await click(back ? '返回试卷库' : '试卷库')
  await click('原卷 · '+file.original_name)
  await click('已关联试题（')
  const row = '[...document.querySelectorAll("button")].find(b=>b.textContent.trim().startsWith('
    +JSON.stringify(location.source_key+' · 第 ')+'))'
  const open = row+'?.parentElement.querySelectorAll("button")[1]'
  await waitFor(()=>ev('!!('+open+') && !('+open+').disabled'),'source region')
  await ev('('+open+').click()')
  await waitFor(()=>ev('!!document.querySelector(\'[aria-label="PDF 原卷定位"] button\')'),'linked editor')
  if (expectedImages)
    await waitFor(()=>ev('[...document.querySelectorAll("img")].filter(img=>img.complete && img.naturalWidth && img.src.startsWith("data:image/")).length >= '+expectedImages),'attachment rendering')
  const screenshot = async stage => {
    const {data} = await send('Page.captureScreenshot',{format:'png'})
    writeFileSync(join(privateRoot,subject+'-'+stage+'.png'),Buffer.from(data,'base64'))
  }
  await screenshot('editor')
  await click('查看原卷 · '+paper.title)
  await waitFor(()=>ev('!!document.querySelector(\'[data-pdf-page="'+(location.page_index+1)+'"][data-pdf-ready=true] canvas\')'),'PDF.js canvas')
  await screenshot('original')
  console.log(JSON.stringify({stage:'native_original_canvas',subject,expectedImages}))
}

try {
  assert.ok(['restore','backup','preview','import','verify','annotate'].includes(operation))
  assertIsolated()
  await start()
  assertIsolated()
  assert.equal(await call('database_status'), 9)
  if (operation === 'restore') {
    const before = active()
    assert.ok(await pick('preview_restore',{},'选择知卷备份',resolve(manifest)))
    await call('confirm_restore')
    await close()
    await start()
    assertIsolated()
    assert.notEqual(active(),before)
    console.log(JSON.stringify({stage:'restore_restarted',papers:(await call('list_paper_records')).length}))
  } else if (operation === 'backup') {
    const target = resolve(manifest)
    assert.ok(!existsSync(target), 'Backup destination already exists')
    const result = await pick('create_backup',{},'保存知卷完整备份',target)
    assert.equal(result.schema_version,9)
    console.log(JSON.stringify({stage:'backup',files:result.file_count}))
  } else if (operation === 'annotate') {
    const state=readJson(registry)
    for (const note of readJson(manifest)) {
      const entry=state.questions[note.key]
      assert.ok(entry?.question_id.startsWith('content003-'), 'Expected a question created in this batch')
      const {revision}=await call('current_revision',{questionId:entry.question_id})
      const expected=entry.extra_revisions?.at(-1)?.revision_id ?? entry.revision_id
      const present=revision.content.answer?.content.some(block=>
        block.type==='paragraph' && block.content?.length===1 && block.content[0].text===note.text)
      if (present && revision.id===expected) continue
      assert.ok(present ? revision.base_revision_id===expected : revision.id===expected)
      const paragraph={type:'paragraph',content:[{type:'text',text:note.text}]}
      const part=revision.content.parts.find(row=>row.id===note.part_id)
      if (!present) {
        for (const content of [revision.content,part].filter(Boolean)) {
          for (const key of ['answer','analysis']) content[key]?.content.push(paragraph)
        }
      }
      const result=present ? revision : await call('save_user_revision',{questionId:entry.question_id,expectedCurrent:revision.id,
        contentJson:JSON.stringify(revision.content)})
      entry.extra_revisions=[...(entry.extra_revisions ?? []),{revision_id:result.id,
        content_check:'disputed',alternative_sources:note.alternative_sources}]
      writeJson(registry,state)
      console.log(JSON.stringify({stage:'recorded_content_conflict'}))
    }
  } else if (operation === 'verify') {
    const data = readJson(manifest)
    for (const [subject, id] of Object.entries(data.questions)) {
      const result = await call('search_questions',{query:{subject_id:subject,descendants:false,page:0,page_size:100}})
      assert.ok(result.hits.some(hit=>hit.id===id), 'Search miss: '+subject)
      const locations = await call('list_pdf_locations',{questionId:id})
      assert.ok(locations.length)
      const loc=locations[0]
      assert.equal((await call('open_region_question',{fileId:loc.file_id,sourceKey:loc.source_key,ordinal:loc.ordinal})).id,id)
      console.log(JSON.stringify({stage:'search_and_location',subject}))
      if (data.visual) await verifyVisual(subject,loc,data.visual[subject] ?? 0)
    }
    if (data.composition) {
      const ids=[]
      for (const id of data.composition_questions ?? Object.values(data.questions)) {
        const {revision}=await call('current_revision',{questionId:id})
        ids.push({revision_id:revision.id,points:{score:revision.content.score,group:'试题',
          part_scores:revision.content.parts.map(part=>part.score)}})
      }
      const header=(await call('list_compositions')).find(row=>row.title===data.composition) ??
        (await call('save_composition',{draft:{title:data.composition,
          settings:{scope:'多学科',gap_mm:4,answer_space_mm:0,groups:['试题']},items:ids}})).header
      const fixed=(await call('read_composition',{id:header.id})).items
      assert.deepEqual(fixed.map(r=>r.question.revision.id),ids.map(r=>r.revision_id))
      if (registry) {
        const state=readJson(registry)
        const snapshot={composition_id:header.id,items:fixed.map((r,i)=>({
          position:i+1,question_id:r.question.revision.question_id,revision_id:r.question.revision.id
        }))}
        state.compositions=[...(state.compositions ?? []).filter(row=>row.composition_id!==header.id),snapshot]
        writeJson(registry,state)
      }
      const preview=await call('preview_composition',{id:header.id})
      const result=await call('export_composition',{id:header.id,identity:preview.identity,confirmed:true})
      writeFileSync(join(privateRoot,'export-paths.json'),JSON.stringify(result))
      console.log(JSON.stringify({stage:'fixed_composition_export',items:ids.length}))
    }
  } else {
    process.exitCode = Number(Boolean(await runBatch({manifest,registry,
      native:{call,pick,image},preview:operation==='preview',failAfter:Number(failAfter)})))
  }
} finally {
  await close()
}
