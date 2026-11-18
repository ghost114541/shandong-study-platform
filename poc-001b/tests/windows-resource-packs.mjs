
import assert from 'node:assert/strict'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const executable = resolve(process.argv[2] ?? 'src-tauri/target/debug/shandong-poc-001b.exe')
const identifier = process.env.POC001B_TEST_APP_IDENTIFIER
assert.match(identifier ?? '', /^org\.shandong-study\.dev009-[a-f0-9]{8}$/)
const profile = join(process.env.APPDATA, identifier)
const source = process.env.KNOWPAPER_DEV009_SCHEMA7_SOURCE
const port = +(process.env.POC001B_TEST_CDP_PORT ?? 19309)
const out = resolve('output/dev009')
const shots = join(out, 'screenshots')
const fixture = resolve('.test-output/dev009-fixtures')
const marker = join(profile, 'dev009-test-ready')
mkdirSync(shots, { recursive: true })
const python = (...args) => execFileSync('python', ['tests/dev009-profile.py', ...args], { encoding: 'utf8' })
if (source) python('seed', source, profile)
assert.ok(existsSync(join(profile, 'study.sqlite3')), 'Seed a genuine isolated DEV-008 Schema 7 profile')
const snapshots = {}
const perf = []
const inventory = JSON.parse(readFileSync(join(fixture, 'fixture-inventory.json'), 'utf8'))
const measure = process.env.KNOWPAPER_DEV009_PERF === '1'
let stdout = ''
let child, socket, phase, serial = 0, pending = new Map()

function snapshot(label) {
  const value = JSON.parse(python('snapshot', profile))
  snapshots[label] = value
  console.log(label, JSON.stringify({
    schema: value.schema, sha256: value.database_sha256, counts: value.counts,
    versions: value.versions.map((item) => item.slice(0, 2)),
    operations: value.operations.map((item) => [item[1], item[2], item[3]]),
    stageFiles: Object.keys(value.file_size_sha).filter((key) => key.startsWith('pack-staging/')).length,
  }))
  return value
}

async function waitFor(read, description, timeout = 15000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { const answer = await read(); if (answer) return answer } catch (error) { last = error }
    await delay(75)
  }
  throw new Error('Timeout: ' + description, { cause: last })
}

async function cdp(method, params = {}) {
  const id = ++serial
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout ' + method)) }, 90000)
    pending.set(id, (value) => {
      clearTimeout(timer)
      if (value.error) reject(new Error(value.error.message))
      else accept(value.result)
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || JSON.stringify(response.exceptionDetails))
  return response.result.value
}

const quote = JSON.stringify
const invoke = (command, args = {}) => evaluate('window.__TAURI_INTERNALS__.invoke(' + quote(command) + ',' + quote(args) + ')')
const text = (label, selector = 'body') => waitFor(
  () => evaluate('document.querySelector(' + quote(selector) + ')?.innerText.includes(' + quote(label) + ')'), label,
)
const button = (label, partial = false) => 'Array.from(document.querySelectorAll("button")).find(e => e.getClientRects().length && !e.disabled && e.textContent.trim().'
  + (partial ? 'includes(' + quote(label) + ')' : 'valueOf() === ' + quote(label)) + (partial ? ')' : ')')

async function clickExpr(expression, name = expression) {
  const point = await waitFor(() => evaluate('(() => {const e = ' + expression
    + '; if(!e) return null; e.scrollIntoView({block:"center"}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()'), name)
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
}
const click = (label, partial = false) => clickExpr(button(label, partial), label)

async function shot(name, full = false) {
  let clip
  if (full) {
    const { cssContentSize: size } = await cdp('Page.getLayoutMetrics')
    clip = { x: 0, y: 0, width: size.width, height: Math.min(size.height, 2300), scale: 1 }
  }
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(clip && { clip }) })
  writeFileSync(join(shots, name + '.png'), Buffer.from(data, 'base64'))
}

async function start(pause, offline = false) {
  phase = pause ?? 'normal'
  if (existsSync(marker)) unlinkSync(marker)
  child = spawn(executable, [], {
    env: { ...process.env, KNOWPAPER_DEV009_PAUSE: pause ?? '', KNOWPAPER_DEV009_FIXTURES: fixture,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port + ' --remote-debugging-address=127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (bytes) => { stdout += bytes.toString(); process.stdout.write(bytes) })
  child.stderr.on('data', (bytes) => process.stderr.write(bytes))
  const target = await waitFor(async () => {
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
    return targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
  }, 'native WebView2 debugging channel', 25000)
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((accept, reject) => {
    socket.addEventListener('open', accept, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data)
    const resolve = pending.get(response.id)
    pending.delete(response.id)
    resolve?.(response)
  })
  await text('资源管理')
  if (offline) {
    await cdp('Network.enable')
    await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await cdp('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp('Page.reload', { ignoreCache: true })
    await text('资源管理')
    assert.equal(await evaluate('navigator.onLine'), false)
  }
  assert.equal(await invoke('database_status'), 8)
  const caption = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    '$p=Get-Process -Id ' + child.pid + '; if (!$p.MainWindowHandle) { exit 1 }; $p.MainWindowTitle'], { encoding: 'utf8' })
  assert.ok(caption.trim())
  console.log('Native Tauri Win32 window PID=%d phase=%s offline=%s origin=%s', child.pid, phase, offline, await evaluate('location.href'))
}

async function stop(force = false) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const pid = child.pid
  socket?.close()
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  if (force) assert.ok(child.kill())
  else execFileSync('powershell.exe', ['-NoProfile', '-Command',
    'if (!(Get-Process -Id ' + pid + ').CloseMainWindow()) { exit 1 }'])
  const result = await Promise.race([exited, delay(12000, null, { ref: false })])
  assert.ok(result, 'process did not close')
  if (force) assert.ok(result.code !== 0)
  console.log('Native process stopped PID=%d forced=%s result=%s', pid, force, JSON.stringify(result))
}

async function select(name, nativeShot = false) {
  await click('选择本地资源包')
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tests/windows-pdf-dialog.ps1',
    '-AppProcess', String(child.pid), '-Title', '选择本地知卷资源包', '-Filename', join(fixture, name + '.studyzip')]
  if (nativeShot) args.push('-Screenshot', join(shots, '02-native-file-picker.png'))
  const { stdout } = await exec('powershell.exe', args, { windowsHide: true, timeout: 25000 })
  console.log(name + ': ' + stdout.trim())
}

async function checkPreview() {
  await text('SHA-256 校验通过', '.resource-workspace')
  await text('安装差异', '.resource-workspace')
}

async function submit(confirmShot = false) {
  await click('安装此资源包')
  await text('确认安装资源包', 'dialog[open]')
  if (confirmShot) await shot('06-confirm')
  await click('确认并安装')
}

async function crash(name, checkpoint, screenshot) {
  await start(checkpoint)
  await click('资源管理')
  await select(name)
  await checkPreview()
  await submit()
  await waitFor(() => existsSync(marker) && readFileSync(marker, 'utf8') === checkpoint, checkpoint)
  if (screenshot) await shot(screenshot)
  if (checkpoint === 'before_commit') {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      '[void](Get-Process -Id ' + child.pid + ').CloseMainWindow()'])
    await delay(350)
    assert.equal(child.exitCode, null, 'native close guard prevents closing during commit')
  }
  await stop(true)
  return snapshot('after-kill-' + checkpoint)
}

function contentString(revision) {
  return JSON.stringify(revision.content)
}

const question = 'kp009-q-0000'
const mathTitle = 'DEV-009 原生固定组卷'
const current = () => invoke('current_revision', { questionId: question }).then((entry) => entry.revision)
const favoriteTarget = { kind: 'question', id: question }
const favoriteStatus = () => invoke('favorite_status', { targets: [favoriteTarget] }).then(([status]) => status)
const paperId = 'kp009-paper-000'

function timedSample(name) {
  const memStop = join(out, '.memory-stop-' + name)
  if (existsSync(memStop)) unlinkSync(memStop)
  const watcher = exec('python', ['tests/dev009-profile.py', 'memory', String(child.pid), memStop], { maxBuffer: 10_000_000 })
  return async (summary) => {
    writeFileSync(memStop, '')
    const { stdout } = await watcher
    unlinkSync(memStop)
    if (!summary) return
    const samples = JSON.parse(stdout)
    assert.ok(samples.length > 0)
    const peak = (index) => Math.max(...samples.map((sample) => sample[index]))
    perf.push({
      ...inventory.find((item) => item.name === name), ...summary,
      sampledApplicationPeakRss: peak(1), sampledWebView2AggregatePeakRss: peak(2), samples,
    })
    console.log('Performance', JSON.stringify({ name, ...summary, appRss: peak(1), webviewRss: peak(2), samples: samples.length }))
  }
}

let finishSample
try {
  const before = snapshot('before-schema8')
  assert.equal(before.schema, 7)
  await start()
  const after = snapshot('after-schema8')
  assert.deepEqual(after.fingerprints, before.fingerprints)
  assert.deepEqual(after.migrations.slice(0, 7), before.migrations)
  assert.deepEqual(after.file_size_sha, before.file_size_sha)
  await click('资源管理')
  await text('尚未安装资源包。')
  await shot('01-resource-home')

  if (measure) finishSample = timedSample('small')
  const selectSmall = performance.now()
  await select('small', true)
  await checkPreview()
  const selectSmallMs = performance.now() - selectSmall
  await shot('03-manifest-and-integrity')
  await clickExpr('document.querySelector(".resource-panel details summary")', '许可详情')
  await shot('04-source-and-validation', true)
  await shot('05-install-diff', true)
  const installSmall = performance.now()
  await submit(true)
  await text('资源包安装完成。')
  const installSmallMs = performance.now() - installSmall
  await shot('08-installed')
  await shot('09-installed-and-history', true)
  const querySmall = performance.now()
  const original = await current()
  const querySmallMs = performance.now() - querySmall
  assert.equal(original.scope, 'public')
  assert.ok(contentString(original).includes('首版'))
  const one = snapshot('installed-small')
  if (finishSample) {
    const line = await waitFor(() => stdout.split(/\r?\n/).find((row) => row.startsWith('DEV009_INSTALL_METRICS ')), 'small pack instrumentation')
    const metrics = JSON.parse(line.slice('DEV009_INSTALL_METRICS '.length))
    await finishSample({ selectAndPreviewMs: selectSmallMs, installMs: installSmallMs, queryMs: querySmallMs,
      timings: metrics.timings, profileChangeBytes: one.bytes_on_disk - after.bytes_on_disk })
    finishSample = undefined
  }
  assert.deepEqual(one.versions.map((item) => item.slice(0, 2)), [['knowpaper.fixture', '1.0.0']])
  await select('small')
  await text('此资源包的相同版本已经安装。')
  assert.equal((await invoke('resource_pack_history')).operations.length, 1)
  await shot('10-duplicate')

  await click('知识库')
  await text('资源包演示知识点 math')
  await click('SQLite 题库')
  await clickExpr('document.querySelector(' + quote('button[data-question-id="' + question + '"]') + ')', 'imported question button')
  await text('资源包首版检索题 0000')
  await waitFor(() => evaluate('Array.from(document.querySelectorAll(".tiptap img")).some(e => e.complete && e.naturalWidth === 8)'), 'validated original image loads')
  const contentField = (value) => evaluate('(() => {const e=[...document.querySelectorAll("select")].find(s=>[...s.options].some(o=>o.text==="整题题干")); e.value='
    + quote(value) + ';e.dispatchEvent(new Event("change",{bubbles:true}));})()')
  await contentField('answer')
  await text('答案 2 和 -5', '.tiptap')
  await contentField('stem')
  await text('资源包首版检索题 0000', '.tiptap')
  await clickExpr('document.querySelector(".tiptap[contenteditable=true] p")', 'edit imported stem')
  await cdp('Input.insertText', { text: '个人修订保留见证 ' })
  await click('保存到 SQLite')
  await text('已保存 SQLite 修订')
  const personal = await current()
  assert.equal(personal.scope, 'user')
  assert.ok(contentString(personal).includes('个人修订保留见证'))
  await click('收藏试题')
  await click('收藏到此处')
  await waitFor(async () => (await favoriteStatus()).collections.length, 'favorite appears')
  await invoke('change_favorites', { command: { action: 'mark', target: favoriteTarget, important: true } })
  const savedFavorite = await favoriteStatus()
  const saved = await invoke('save_composition', { draft: {
    title: mathTitle, previous_id: null,
    settings: { scope: '数学', duration_minutes: null, gap_mm: 4, answer_space_mm: 0, groups: ['试题'] },
    items: [{ revision_id: original.id, points: { group: '试题', score: 4, part_scores: [4] } }],
  } })
  await click('试卷库')
  await click('合成original-1.pdf', true)
  await waitFor(() => evaluate('Array.from(document.querySelectorAll("canvas")).some(c=>c.width>300 && c.height>100)'), 'WebView2 PDF canvas')
  const paper = (await invoke('list_paper_records')).find((record) => record.id === paperId)
  const oldPdf = paper.files.find((item) => item.role === 'original')
  const places = await invoke('list_pdf_locations', { fileId: oldPdf.id, questionId: null })
  assert.equal(places[0].question_id, question)
  await shot('16-native-original-pdf')
  await stop()

  const partiallyWritten = await crash('upgrade', 'writing')
  assert.equal(partiallyWritten.versions.length, 1)
  assert.equal(partiallyWritten.operations.at(-1)[2], 'validated')
  assert.ok(Object.entries(partiallyWritten.file_size_sha).some(([path, info]) =>
    path.startsWith('pack-staging/') && info[0] > 0), 'actual partial stage exists')
  const beforeCommit = await crash('upgrade', 'before_commit', '07-commit-progress')
  assert.equal(beforeCommit.versions.length, 1)
  assert.deepEqual(beforeCommit.user_revision_fingerprints, partiallyWritten.user_revision_fingerprints)
  assert.equal(beforeCommit.operations.at(-2)[2], 'interrupted')
  assert.equal(beforeCommit.operations.at(-1)[2], 'committing')
  assert.ok(Object.keys(beforeCommit.file_size_sha).length > Object.keys(partiallyWritten.file_size_sha).length)

  await start('committed')
  await click('资源管理')
  await text('已恢复的中断')
  await shot('14-interruption-recovered', true)
  const afterRecovery = snapshot('before-successful-retry')
  assert.equal(afterRecovery.versions.length, 1)
  assert.deepEqual(afterRecovery.user_revision_fingerprints, beforeCommit.user_revision_fingerprints)
  assert.equal(Object.keys(afterRecovery.file_size_sha).filter((key) => key.startsWith('pack-staging/')).length, 0)
  await select('upgrade')
  await checkPreview()
  await text('1.1.0', '.resource-workspace')
  await shot('11-public-upgrade-diff', true)
  await submit()
  await waitFor(() => existsSync(marker) && readFileSync(marker, 'utf8') === 'committed', 'after commit')
  await stop(true)
  const committed = snapshot('after-kill-committed')
  assert.equal(committed.versions.length, 2)
  assert.deepEqual(committed.operations.at(-1).slice(2, 4), ['installed', 1])

  await start(undefined, true)
  await click('资源管理')
  await text('当前版本')
  await shot('15-offline-restart-history', true)
  const afterCommitCleanup = snapshot('after-offline-restart')
  assert.deepEqual(afterCommitCleanup.user_revision_fingerprints, committed.user_revision_fingerprints)
  assert.deepEqual(afterCommitCleanup.operations.at(-1).slice(2, 4), ['installed', 0])
  assert.equal(Object.keys(afterCommitCleanup.file_size_sha).filter((key) => key.startsWith('pack-staging/')).length, 0)
  assert.equal((await current()).id, personal.id)
  assert.deepEqual(await favoriteStatus(), savedFavorite)
  assert.deepEqual(await invoke('read_composition', { id: saved.header.id }), saved)
  const history = await invoke('list_revisions', { questionId: question })
  assert.equal(history.filter((item) => item.scope === 'public').length, 2)
  assert.equal((await invoke('public_original', { questionId: question })).revision.id, original.id)
  assert.ok(contentString((await invoke('read_revision', { revisionId: history[0].id })).revision).includes('新版'))
  assert.equal((await invoke('open_region_question', { fileId: oldPdf.id, sourceKey: '1', ordinal: 0 })).current_revision_id, personal.id)
  await click('SQLite 题库')
  await clickExpr('document.querySelector(' + quote('button[data-question-id="' + question + '"]') + ')', 'open preserved revision')
  await text('个人修订保留见证')
  await shot('12-personal-revision-preserved', true)
  await click('查看公共原版')
  await text('资源包首版检索题 0000')
  await click('我的收藏')
  await text('个人修订保留见证')
  await click('自定义组卷')
  await click(mathTitle, true)
  await text('固定修订 #' + original.id, '[aria-label="组卷题目"]')
  await click('资源管理')
  await select('upgrade')
  await text('此资源包的相同版本已经安装。')
  await select('small')
  await text('无法降级')
  await select('case-corrupt')
  await text('SHA-256 不匹配', '.resource-workspace')
  await shot('13-damaged-pack-rejected')
  assert.equal((await current()).id, personal.id)
  const done = snapshot('e2e-completed')
  assert.deepEqual(done.versions, afterCommitCleanup.versions)
  assert.deepEqual(done.user_revision_fingerprints, afterCommitCleanup.user_revision_fingerprints)
  console.log('E2E-006 succeeded using native dialogs, actual process termination, Win32/WebView2, SQLite and checked files.')

  if (measure) {
    for (const name of ['medium', 'large']) {
      finishSample = timedSample(name)
        const initial = snapshot('performance-before-' + name)
        const t0 = performance.now()
        await select(name)
        await checkPreview()
        const selectAndPreviewMs = performance.now() - t0
        const sample = inventory.find((item) => item.name === name)
        const t1 = performance.now()
        const details = await invoke('install_resource_pack', { archiveSha: sample.sha256 })
        const installMs = performance.now() - t1
        const startQuery = performance.now()
        const keyword = '资源包首版检索题 ' + (name === 'medium' ? '0499' : '1999')
        const hits = await invoke('search_questions', { query: { keyword, page: 0, page_size: 50, descendants: false } })
        const queryMs = performance.now() - startQuery
        assert.ok(hits.hits.some((hit) => hit.id.startsWith(name === 'medium' ? 'kp009m-' : 'kp009l-')))
        const final = snapshot('performance-after-' + name)
        await finishSample({
          selectAndPreviewMs, installMs, queryMs,
          timings: details.timings, profileChangeBytes: final.bytes_on_disk - initial.bytes_on_disk,
        })
        finishSample = undefined
    }
  }
  await stop()
} catch (error) {
  if (child && child.exitCode === null && child.signalCode === null) {
    await shot('diagnostic-error').catch(() => {})
    await stop(true).catch(() => {})
  }
  throw error
} finally {
  if (finishSample) await finishSample().catch((error) => console.error('sampling cleanup:', error.message))
  writeFileSync(join(out, 'windows-state-snapshots.json'), JSON.stringify(snapshots, null, 2) + '\n')
  writeFileSync(join(out, 'performance.json'), JSON.stringify(perf, null, 2) + '\n')
  console.log('TEST EXE SHA-256', createHash('sha256').update(readFileSync(executable)).digest('hex'))
}
