import assert from 'node:assert/strict'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const exe = resolve(process.argv[2] ?? '.test-output/dev010-native/shandong-poc-001b.exe')
const identifier = process.env.POC001B_TEST_APP_IDENTIFIER
assert.match(identifier, /^org\.shandong-study\.dev010-[a-f0-9]{8}$/)
const source = process.env.KNOWPAPER_DEV010_SCHEMA8_SOURCE ?? 'org.shandong-study.dev009-c1a003a9'
const root = join(process.env.APPDATA, identifier)
const marker = join(root, 'dev010-test-ready')
const out = resolve('output/dev010')
const shots = join(out, 'screenshots')
const work = resolve('.test-output', identifier)
mkdirSync(shots, { recursive: true })
mkdirSync(work, { recursive: true })
const backup = join(work, 'original-fixture.knowbackup')
const interrupted = join(work, 'interrupted.knowbackup')
const baseline = join(process.env.APPDATA, identifier + '.source')
const port = +(process.env.POC001B_TEST_CDP_PORT ?? 19329)
const state = {}
const timings = []
let child, socket, serial = 0
const requests = new Map()
const python = (...args) => execFileSync('python', ['tests/dev010-fixtures.py', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })

async function wait(read, label, timeout = 18000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value } catch (error) { last = error }
    await delay(60)
  }
  throw new Error('Timeout: ' + label, { cause: last })
}

function cdp(method, params = {}) {
  const id = ++serial
  return new Promise((done, reject) => {
    const timer = setTimeout(() => { requests.delete(id); reject(new Error('CDP ' + method)) }, 90000)
    requests.set(id, (reply) => {
      clearTimeout(timer)
      if (reply.error) reject(new Error(reply.error.message))
      else done(reply.result)
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const value = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? JSON.stringify(value.exceptionDetails))
  return value.result.value
}
const q = JSON.stringify
const invoke = (name, args = {}) => evaluate('window.__TAURI_INTERNALS__.invoke(' + q(name) + ',' + q(args) + ')')
const text = (label, selector = 'body') => wait(() => evaluate(
  'document.querySelector(' + q(selector) + ')?.innerText.includes(' + q(label) + ')'), label)
const expression = (label, partial = false) => 'Array.from(document.querySelectorAll("button")).find(e=>e.getClientRects().length&&!e.matches(":disabled")&&e.textContent.trim().' +
  (partial ? 'startsWith(' + q(label) + ')' : 'valueOf()===' + q(label)) + ')'
async function click(label, partial) {
  const button = expression(label, partial)
  await clickElement(button, label)
}
async function clickElement(element, name) {
  const point = await wait(() => evaluate('(()=>{const e=' + element +
    ';if(!e)return null;e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()'), name)
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
}
async function shot(name) {
  const data = await cdp('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shots, name + '.png'), Buffer.from(data.data, 'base64'))
}
async function input(selector, value) {
  await wait(() => evaluate('(()=>{const e=document.querySelector(' + q(selector) +
    ');if(!e?.getClientRects().length || e.matches(":disabled"))return false;e.focus();e.select();return document.activeElement===e})()'), selector)
  await cdp('Input.insertText', { text: value })
  await wait(() => evaluate('document.querySelector(' + q(selector) + ')?.value===' + q(value)), 'updated ' + selector)
}
async function fileInput(selector, path) {
  const { root: doc } = await cdp('DOM.getDocument')
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: doc.nodeId, selector })
  assert.ok(nodeId, selector)
  await cdp('DOM.setFileInputFiles', { nodeId, files: [path] })
}
async function nativePick(title, path, name) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tests/windows-pdf-dialog.ps1',
    '-AppProcess', String(child.pid), '-Title', title, '-Filename', path]
  if (name) args.push('-Screenshot', join(shots, name + '.png'))
  const result = await exec('powershell.exe', args, { windowsHide: true, timeout: 25000 })
  console.log(result.stdout.trim(), basename(path))
}

async function start(phase = '', offline = false, connect = true) {
  if (existsSync(marker)) unlinkSync(marker)
  const startTime = performance.now()
  child = spawn(exe, [], { env: {
    ...process.env, KNOWPAPER_DEV010_PAUSE: phase,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port + ' --remote-debugging-address=127.0.0.1',
  }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(process.stdout, { end: false })
  child.stderr.pipe(process.stderr, { end: false })
  if (!connect) return
  const target = await wait(async () => {
    const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
    return list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
  }, 'Win32/WebView2 target', 30000)
  const local = new WebSocket(target.webSocketDebuggerUrl)
  socket = local
  await new Promise((done, fail) => {
    local.addEventListener('open', done, { once: true })
    local.addEventListener('error', fail, { once: true })
  })
  local.addEventListener('message', ({ data }) => {
    const reply = JSON.parse(data)
    requests.get(reply.id)?.(reply)
    requests.delete(reply.id)
  })
  await text('数据管理')
  if (offline) {
    await cdp('Network.enable')
    await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await cdp('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp('Page.reload', { ignoreCache: true })
    await text('数据管理')
    assert.equal(await evaluate('navigator.onLine'), false)
  }
  assert.equal(await invoke('database_status'), 9)
  timings.push({ phase: 'startup', ms: performance.now() - startTime, offline })
  console.log('Started Windows Tauri PID=%d phase=%s origin=%s offline=%s', child.pid, phase || 'normal', await evaluate('location.href'), offline)
}

async function stop(force = true) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exit = once(child, 'exit')
  socket?.close()
  socket = undefined
  if (force) {
    assert.ok(child.kill())
  } else {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'if (!(Get-Process -Id ' + child.pid + ').CloseMainWindow()) { exit 1 }'])
  }
  const status = await Promise.race([exit, delay(12000, null, { ref: false })])
  assert.ok(status, 'process did not stop')
  if (force) assert.notEqual(status[0], 0)
  console.log('Stopped Windows Tauri PID=%d forced=%s result=%j', child.pid, force, status)
  await wait(async () => {
    try { await fetch('http://127.0.0.1:' + port + '/json/list'); return false }
    catch { return true }
  }, 'WebView2 endpoint closed')
}

async function phase(name) {
  await wait(() => existsSync(marker) && readFileSync(marker, 'utf8') === name, 'checkpoint ' + name)
  console.log('Reached checkpoint=%s, forcing Windows PID=%d to stop', name, child.pid)
}
async function ctrl(key) {
  const code = 'Key' + key.toUpperCase()
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key, code, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) })
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key, code, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) })
}

function snap(label, directory = root) {
  const value = JSON.parse(python('snapshot', directory))
  state[label] = value
  console.log(label, JSON.stringify({ files: Object.keys(value.blobs).length, questions: value.tables.question[0], schema: value.migrations.at(-1)[0] }))
  return value
}

async function pickBackup(path, screenshot) {
  await click('选择备份恢复')
  await nativePick('选择知卷备份', path, screenshot)
}
async function queueRestore(screenshot) {
  await click('确认替换资源库')
  await text('确认完整替换当前资源库', 'dialog[open]')
  if (screenshot) await shot(screenshot)
  await click('确认操作')
}

const extended = process.argv.includes('--extended')
async function runExtended() {
  await start()
  const active = (await invoke('protection_status')).directory
  await click('我的收藏')
  const personalCard = '[data-favorite-id=dev008-q]'
  await clickElement('Array.from(document.querySelectorAll(' + q(personalCard + ' button') +
    ')).find(e=>e.getClientRects().length&&e.textContent.trim()==="打开题目")', 'kept personal favorite')
  await text('修订 #1')
  const editor = 'document.querySelector(".tiptap")'
  await clickElement(editor, 'existing question editor')
  await cdp('Input.insertText', { text: 'DEV-010 回收站恢复后的个人题' })
  await click('插入行内公式')
  await input('dialog[open] textarea', 'x^2-17x+4')
  await click('应用公式')
  await fileInput('input[aria-label=添加图片]', join(work, 'fixture.png'))
  await wait(() => evaluate('Boolean(document.querySelector(\'.tiptap img[alt="fixture.png"]\')?.naturalWidth)'), 'personal attachment')
  const lockReady = join(work, 'sqlite-lock.ready')
  const lockRelease = join(work, 'sqlite-lock.release')
  for (const file of [lockReady, lockRelease]) if (existsSync(file)) unlinkSync(file)
  const holder = spawn('python', ['tests/dev010-fixtures.py', 'hold-lock', active, lockReady, lockRelease], { stdio: 'inherit' })
  const exited = once(holder, 'exit')
  try {
    await wait(() => existsSync(lockReady), 'independent SQLite writer lock')
    await clickElement(editor, 'add protected edit')
    await cdp('Input.insertText', { text: ' SQLITE-BUSY 探针' })
    await text('草稿保存失败', '.status')
    assert.ok((await invoke('current_revision', { questionId: 'dev008-q' })).revision.id === 1)
    await shot('19-draft-write-failure')
    console.log('Native draft reported failure while an independent SQLite writer held BEGIN IMMEDIATE.')
  } finally {
    writeFileSync(lockRelease, 'release')
    assert.equal((await exited)[0], 0)
  }
  await click('数据管理')
  await text('可保存草稿后离开', 'dialog[open]')
  await click('保留草稿并离开')
  await text('备份历史')
  const ownDraft = (await invoke('list_drafts')).find(({ object_id }) => object_id === 'dev008-q')
  assert.equal(ownDraft.base_revision, 1)
  await stop()
  await start()
  await click('查看可恢复草稿')
  await clickElement('Array.from(document.querySelectorAll(".protection-list li")).find(e=>e.innerText.includes("dev008-q"))?.querySelector("button")', 'recover same personal question')
  await text('已恢复试题草稿')
  await wait(() => evaluate('Boolean(document.querySelector(".tiptap .katex") && document.querySelector(\'.tiptap img[alt="fixture.png"]\')?.naturalWidth)'), 'same personal question formula and image')
  await click('保存到 SQLite')
  await text('已保存 SQLite 修订')
  const revised = (await invoke('current_revision', { questionId: 'dev008-q' })).revision
  assert.equal(revised.base_revision_id, 1)
  assert.equal((await invoke('revision_review', { revisionId: revised.id })).review_status, 'unreviewed')
  console.log('Restored and formally saved an unreviewed revision of the same recovered personal question after a forced exit.')

  await click('试卷库')
  const records = await invoke('list_paper_records')
  const original = records.find(({ id }) => id === 'kp009-paper-000').files.find(({ role }) => role === 'original')
  await clickElement('Array.from(document.querySelectorAll(".paper-library-list button")).find(e=>e.title==="SHA-256 ' +
    original.sha256 + '"&&e.textContent.includes("原卷"))', 'open original PDF')
  await text('截取题目')
  await click('截取题目')
  const box = await wait(() => evaluate('(()=>{const e=document.querySelector(".pdf-pick-layer");if(!e)return null;e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()'), 'PDF selection overlay')
  const from = { x: box.x + box.w * 0.17, y: box.y + box.h * 0.19 }
  const to = { x: box.x + box.w * 0.58, y: box.y + box.h * 0.46 }
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...from })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, ...to })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...to })
  await text('已选 1 个区域')
  await click('继续处理选区')
  await input('[aria-label="原题号或位置"]', 'DEV010 进程终止截图')
  await click('截图并新建试题')
  await wait(() => evaluate('document.querySelector(".tiptap img")?.naturalWidth > 0'), 'PDF screenshot image')
  await text('草稿已安全保存')
  const before = (await invoke('list_drafts')).find((record) => record.object_type === 'question')
  const saved = await invoke('load_draft', { id: before.id })
  assert.equal(saved.screenshot.link.source_key, 'DEV010 进程终止截图')
  assert.equal(saved.screenshot.link.file_id, original.id)
  assert.equal(await invoke('current_revision', { questionId: before.object_id }), null)
  await stop()
  await start()
  await click('查看可恢复草稿')
  await clickElement('Array.from(document.querySelectorAll(".protection-list li")).find(e=>e.innerText.includes(' + q(before.object_id) +
    '))?.querySelector("button")', 'restore new PDF screenshot draft')
  await text('已恢复试题草稿')
  await wait(() => evaluate('document.querySelector(".tiptap img")?.naturalWidth > 0'), 'restored screenshot')
  await shot('20-restored-screenshot-draft')
  await click('保存到 SQLite')
  await text('已保存 SQLite 修订')
  const qLocations = await invoke('list_pdf_locations', { questionId: before.object_id })
  assert.equal(qLocations[0].file_id, original.id)
  const pLocations = await invoke('list_pdf_locations', { fileId: original.id })
  assert.ok(pLocations.some((row) => row.question_id === before.object_id))
  console.log('Original PDF crop, new UUID draft, forced exit, restored image and both location directions passed.')
  await stop(false)
}

try {
  if (extended) {
    await runExtended()
  } else {
  assert.ok(!existsSync(root) && !existsSync(baseline) && !existsSync(backup), 'use a new isolated profile and work directory')
  python('seed', source, identifier)
  const before = snap('schema8')
  const stageStart = performance.now()
  await start()
  const migrated = snap('schema9')
  assert.deepEqual(migrated.migrations.slice(0, 8), before.migrations)
  for (const table of Object.keys(before.tables).filter((table) => table !== 'schema_migration')) {
    assert.deepEqual(migrated.tables[table], before.tables[table], table)
  }
  assert.deepEqual(migrated.blobs, before.blobs)
  console.log('Schema 8 to 9 preserves all old table fingerprints and blobs in %d ms including startup', Math.round(performance.now() - stageStart))

  await click('数据管理')
  await text('备份历史')
  await shot('01-data-management')
  await click('运行完整性检查')
  await text('SQLite、外键和登记文件校验通过')
  await shot('17-diagnostics')
  await stop(false)

  await start('archive-mid')
  await click('数据管理')
  await click('创建完整备份')
  await nativePick('保存知卷完整备份', interrupted)
  await phase('archive-mid')
  await shot('03-backup-in-progress')
  await stop()
  assert.ok(!existsSync(interrupted))
  assert.deepEqual(snap('after-interrupted-backup').tables, migrated.tables)

  await start()
  await click('数据管理')
  const began = performance.now()
  await click('创建完整备份')
  await nativePick('保存知卷完整备份', backup, '02-native-save-dialog')
  await text('完整备份已创建并验证')
  const memory = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    '$p=Get-Process -Id ' + child.pid + '; $all=Get-CimInstance Win32_Process; ' +
    '$children=@($p.Id); do { $last=$children.Count; $children=@($children + @($all|Where-Object { $_.ParentProcessId -in $children -and $_.ProcessId -notin $children }|ForEach-Object ProcessId)) } while ($last -ne $children.Count); ' +
    '$web=@(Get-Process -Id $children -ErrorAction SilentlyContinue | Where-Object ProcessName -eq msedgewebview2); ' +
    '@{tauri=$p.WorkingSet64;webview2=($web|Measure-Object WorkingSet64 -Sum).Sum}|ConvertTo-Json -Compress'], { encoding: 'utf8' })
  timings.push({ phase: 'backup-total-with-dialog', ms: performance.now() - began, bytes: statSync(backup).size, sampledWorkingSet: JSON.parse(memory) })
  await shot('04-backup-complete')
  await text('已完整验证')
  await shot('05-backup-history')
  python('variants', backup, work)
  for (const bad of ['manifest', 'future-version', 'future-schema', 'traversal', 'missing-image', 'bad-pdf', 'bad-db']) {
    await pickBackup(join(work, bad + '.knowbackup'))
    const error = await wait(() => evaluate('document.querySelector(".protection-feedback [role=alert]")?.innerText'), bad)
    assert.ok(!await evaluate('document.querySelector("[aria-label=恢复预览]")'))
    console.log('Rejected', bad, error)
  }
  assert.deepEqual(snap('after-invalid-restores').tables, migrated.tables)
  await stop(false)

  // A separate native launch with no database, no attachment and no PDF in the active profile.
  renameSync(root, baseline)
  await start()
  const fresh = snap('fresh-install')
  assert.equal(fresh.tables.question[0], 0)
  await stop(false)

  for (const checkpoint of ['unpack-mid', 'unpacked', 'validated']) {
    await start(checkpoint)
    await click('数据管理')
    await pickBackup(backup)
    await phase(checkpoint)
    await stop()
    await start()
    assert.equal(snap('after-' + checkpoint).tables.question[0], 0)
    await stop(false)
  }

  await start()
  await click('数据管理')
  const restoring = performance.now()
  await pickBackup(backup, '06-native-open-dialog')
  await text('恢复预览', '.data-management')
  timings.push({ phase: 'restore-precheck-with-dialog', ms: performance.now() - restoring })
  await shot('07-restore-preview')
  await queueRestore('08-restore-confirmation')
  await text('已准备好切换')
  await stop(false)
  for (const checkpoint of ['before-open', 'first-open', 'before-pointer', 'after-pointer']) {
    await start(checkpoint, false, false)
    await phase(checkpoint)
    await stop()
  }
  await start('', true)
  const restoredRoot = (await invoke('protection_status')).directory
  const restored = snap('restored', restoredRoot)
  assert.deepEqual(restored.tables, migrated.tables)
  assert.deepEqual(restored.blobs, migrated.blobs)
  assert.equal(snap('safety-copy').tables.question[0], 0)
  await click('试题检索')
  await text('加入组卷')
  await shot('09-restored-question-library')
  await click('我的收藏')
  await text('重点')
  const starred = await invoke('favorite_counts')
  assert.ok(starred.important > 0)
  const sampleId = Object.keys(restored.blobs).find((path) => path.startsWith('attachments/')).split('/').at(-1)
  const image = await invoke('read_attachment', { attachmentId: 'sha256-' + sampleId })
  assert.match(image, /^data:image\//)
  await click('试卷库')
  await text('DEV-009 合成试卷')
  const records = await invoke('list_paper_records')
  const publicPdf = records.find((record) => record.id === 'kp009-paper-000').files.find((file) => file.role === 'original')
  const open = await invoke('open_paper_pdf', { fileId: publicPdf.id })
  assert.ok(open.file.byte_size > 0)
  const links = await invoke('list_pdf_locations', { questionId: 'kp009-q-0000' })
  assert.ok(links.length > 0)
  const fixed = await invoke('list_compositions')
  const pinned = await invoke('read_composition', { id: fixed.find(({ id }) => id === 'a20f08a5a9c2567171f58ca111448f05').id })
  assert.equal(pinned.items[0].question.revision.id, 1)
  await shot('18-offline-restored-resources')
  await stop(false)

  await start()
  await click('SQLite 题库')
  const personal = await invoke('current_revision', { questionId: 'dev008-q' })
  const sidebar = 'document.querySelector("[data-question-id=dev008-q]")'
  if (await evaluate(sidebar + '!==null')) await clickElement(sidebar, 'personal question')
  else {
    // A migrated collection keeps this logical ID as a direct route to the editor.
    await click('我的收藏')
    await clickElement('Array.from(document.querySelectorAll("[data-favorite-id=dev008-q] button")).find(e=>e.getClientRects().length&&e.textContent.trim()==="打开题目")', 'favorite editor route')
  }
  await text('修订 #' + personal.revision.id)
  await click('移入回收站')
  await text('确认移入回收站', 'dialog[open]')
  await shot('12-trash-confirmation')
  await click('确认移入回收站')
  await text('选择一道试题，或新建试题。')
  await click('数据管理')
  await click('回收站（', true)
  await text('dev008-q')
  await shot('11-trash-list')
  await click('清空回收站')
  await click('确认操作')
  await text('清空操作已阻止')
  await click('恢复资源')
  await text('资源已恢复。')
  await shot('13-trash-restored')
  const afterTrash = snap('after-trash-restore', restoredRoot)
  for (const table of ['question', 'question_duplicate', 'question_revision', 'verification_record', 'favorite_target', 'favorite_member', 'composition_item']) {
    assert.deepEqual(restored.tables[table], afterTrash.tables[table], table)
  }

  const previousRevision = (await invoke('current_revision', { questionId: 'dev008-q' })).revision.id
  await invoke('change_favorite_collection', { command: { action: 'create', name: 'DEV-010 临时收藏夹' } })
  const folderId = (await invoke('favorite_collections')).find(({ name }) => name === 'DEV-010 临时收藏夹').id
  await invoke('change_favorites', { command: { action: 'add', collection: folderId, targets: [{ kind: 'question', id: 'dev008-q' }] } })
  await click('我的收藏')
  await text('DEV-010 临时收藏夹')
  await clickElement('document.querySelector(' + q('[data-favorite-collection="' + folderId + '"]') + ')', 'synthetic collection')
  await click('删除收藏夹')
  await click('确认删除收藏夹')
  await wait(async () => !(await invoke('favorite_collections')).some(({ id }) => id === folderId), 'favorite collection deleted')
  assert.equal((await invoke('current_revision', { questionId: 'dev008-q' })).revision.id, previousRevision)
  await click('SQLite 题库')
  await click('新建试题')
  await clickElement('document.querySelector(".tiptap")', 'Tiptap')
  await cdp('Input.insertText', { text: 'DEV-010 草稿公式与图片' })
  await delay(650)
  await click('插入行内公式')
  await input('dialog[open] textarea', 'x^2+3x-10=0')
  await click('应用公式')
  const math = 'Boolean(document.querySelector(".tiptap .katex"))'
  await wait(() => evaluate(math), 'rendered formula')
  await evaluate('document.querySelector(".tiptap").focus()')
  await ctrl('z')
  await wait(async () => !await evaluate(math), 'formula undo')
  await ctrl('y')
  await wait(() => evaluate(math), 'formula redo')
  await text('新试题')
  const importSource = join(work, 'fixture.png')
  python('editor-image', importSource)
  await fileInput('input[aria-label=添加图片]', importSource)
  await wait(() => evaluate('Boolean(document.querySelector(\'.tiptap img[alt="fixture.png"]\')?.naturalWidth)'), 'inserted image')

  await click('添加小问')
  await wait(() => evaluate('Boolean(document.querySelector(\'input[aria-label="小问 1 分值"]\'))'), 'added small question')
  const autosaveStarted = performance.now()
  await text('草稿已安全保存')
  timings.push({ phase: 'question-autosave-after-edit', ms: performance.now() - autosaveStarted })
  await shot('14-question-autosave')
  await stop()
  await start()
  await text('存在可恢复草稿。')
  await shot('15-crash-draft-prompt')
  await click('查看可恢复草稿')
  const recover = performance.now()
  await click('恢复草稿')
  await text('已恢复试题草稿。')
  timings.push({ phase: 'question-draft-recovery', ms: performance.now() - recover })
  assert.ok(await evaluate('Boolean(document.querySelector(".select-field select"))'))
  await wait(() => evaluate('Boolean(document.querySelector(\'input[aria-label="小问 1 分值"]\'))'), 'small question recovered')
  await evaluate('(()=>{const field=Array.from(document.querySelectorAll("select")).find(s=>Array.from(s.options).some(o=>o.value==="stem")); field.value="stem"; field.dispatchEvent(new Event("change",{bubbles:true})); return true})()')
  await wait(() => evaluate('Boolean(document.querySelector(".tiptap .katex") && document.querySelector(\'.tiptap img[alt="fixture.png"]\')?.naturalWidth)'), 'restored image and formula')
  await click('保存到 SQLite')
  await text('已保存 SQLite 修订 #')
  assert.equal((await invoke('list_drafts')).length, 0)

  await click('试题检索')
  await click('加入组卷')
  await click('自定义组卷')
  await input('input[maxlength="160"]', 'DEV-010 未保存组卷')
  await text('草稿已安全保存')
  await stop()
  await start()
  await click('查看可恢复草稿')
  await click('恢复草稿')
  await text('已恢复组卷草稿。')
  assert.equal(await evaluate('document.querySelector(\'input[maxlength="160"]\').value'), 'DEV-010 未保存组卷')
  await shot('16-composition-draft')
  await click('数据管理')
  await click('更改存储位置')
  await text('可用空间', 'dialog[open]')
  await shot('10-storage-relocation')
  const folder = process.env.KNOWPAPER_DEV010_STORAGE_TEST_PARENT ?? join(work, 'storage-target')
  mkdirSync(folder)
  await click('确认操作')
  await nativePick('选择资源库的新存储位置', folder)
  await text('已准备好切换')
  const beforeMove = snap('before-storage-migration', restoredRoot)
  await stop(false)
  await start()
  const movedTo = await invoke('protection_status')
  assert.equal(movedTo.previous.toLowerCase(), restoredRoot.toLowerCase())
  assert.ok(movedTo.directory.toLowerCase().startsWith(folder.toLowerCase()))
  assert.deepEqual(snap('after-storage-migration', movedTo.directory), beforeMove)
  assert.deepEqual(snap('after-storage-migration-old', restoredRoot), beforeMove)
  await stop(false)
  console.log('DEV-010 Windows round trip and process-level fault tests completed.')
  }
} finally {
  await stop().catch((error) => console.error(error))
  if (!extended) writeFileSync(join(out, 'windows-state-snapshots.json'), JSON.stringify(state, null, 2))
  writeFileSync(join(out, extended ? 'windows-extended-timings.json' : 'windows-timings.json'), JSON.stringify(timings, null, 2))
}
