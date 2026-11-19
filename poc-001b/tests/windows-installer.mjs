import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const identifier = 'org.shandong-study.knowpaper-preview'
const profile = join(process.env.APPDATA, identifier)
const destination = join(process.env.LOCALAPPDATA, 'KnowPaper Preview')
const executable = join(destination, 'knowpaper-preview.exe')
const uninstall = join(destination, 'uninstall.exe')
const registry = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + identifier
const [aArg, bArg, outArg] = process.argv.slice(2)
assert.ok(aArg && bArg && outArg, 'Run from poc-001b: node tests/windows-installer.mjs <A.exe> <B.exe> <evidence-dir>')
const a = resolve(aArg)
const b = resolve(bArg)
const out = resolve(outArg)
const shots = join(out, 'screenshots')
const port = Number(process.env.KNOWPAPER_PREVIEW_TEST_PORT ?? 19311)
const fixture = resolve('output/dev010/original-fixture.knowbackup')
const fixturePdf = resolve('output/dev007/fixtures/original.pdf')
const fingerprintScript = resolve('tests/dev010-fixtures.py')
const backup = join(out, 'synthetic.knowbackup')
const journal = join(profile, 'data-protection', 'root.json')
const snapshots = {}
const timings = []
let target
let socket
let serial = 0
const pending = new Map()

const psString = value => "'" + value.replaceAll("'", "''") + "'"
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const ps = (command, env = process.env) => execFileSync('pwsh.exe',
  ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop"; ' + command],
  { encoding: 'utf8', env, timeout: 90000 }).trim()
const posh = args => exec('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', ...args], { encoding: 'utf8', timeout: 90000 })
const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
const installed = () => JSON.parse(ps("$key = " + psString(registry) + "; " +
  "$link = Join-Path ([Environment]::GetFolderPath('Programs')) '知卷 KnowPaper（测试版）.lnk'; " +
  "$desktop = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) '知卷 KnowPaper（测试版）.lnk'; " +
  "$entry = Get-ItemProperty $key -ErrorAction SilentlyContinue; " +
  "$exe = Get-Item -LiteralPath " + psString(executable) + " -ErrorAction SilentlyContinue; " +
  "$target = if (Test-Path -LiteralPath $link) { (New-Object -ComObject WScript.Shell).CreateShortcut($link).TargetPath }; " +
  "@{version=$entry.DisplayVersion; displayName=$entry.DisplayName; publisher=$entry.Publisher;" +
  "installLocation=$entry.InstallLocation; uninstallString=$entry.UninstallString; icon=$entry.DisplayIcon;" +
  "fileVersion=$exe.VersionInfo.ProductVersion; executable=($null -ne $exe); shortcut=$link;" +
  "linkTarget=$target; desktop=(Test-Path -LiteralPath $desktop); directory=(Test-Path -LiteralPath " +
  psString(destination) + ")} | ConvertTo-Json -Compress"))
const setup = async (label, file, options) => {
  const start = performance.now()
  const state = posh(['tests/windows-installer-dialog.ps1', '-Mode', options, '-Executable', file, '-Output', shots, '-Label', label])
  const result = JSON.parse((await state).stdout.trim())
  const system = installed()
  console.log(JSON.stringify({ label, ...result, system }))
  timings.push({ label, ms: Math.round(performance.now() - start), ...result, system })
  json(join(out, 'timings.json'), timings)
  return result.exitCode
}
function silent(label, file, args) {
  const started = performance.now()
  const result = ps('$p=Start-Process -FilePath ' + psString(file) + ' -ArgumentList ' +
    psString(args) + ' -WindowStyle Hidden -Wait -PassThru; $p.ExitCode')
  const system = installed()
  const entry = { label, exitCode: Number(result), ms: Math.round(performance.now() - started), system }
  timings.push(entry)
  json(join(out, 'timings.json'), timings)
  console.log(JSON.stringify(entry))
  return entry.exitCode
}

function assertInstalled(version) {
  const state = installed()
  assert.equal(state.version, version)
  assert.equal(state.displayName, '知卷 KnowPaper（测试版）')
  assert.equal(state.linkTarget, executable)
  assert.match(state.fileVersion, new RegExp('^' + version.replaceAll('.', '\\.') + '(\\.0)?$'))
  assert.ok(existsSync(uninstall))
  return state
}

async function wait(read, name, ms = 25000) {
  const deadline = Date.now() + ms
  let last
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value } catch (error) { last = error }
    await delay(90)
  }
  throw new Error('Timed out: ' + name, { cause: last })
}

function cdp(method, params = {}) {
  const id = ++serial
  return new Promise((done, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('WebView2: ' + method)) }, 40000)
    pending.set(id, response => {
      clearTimeout(timer)
      if (response.error) reject(new Error(response.error.message))
      else done(response.result)
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ??
      JSON.stringify(result.exceptionDetails.exception?.value ?? result.exceptionDetails))
  }
  return result.result.value
}

const q = JSON.stringify
const invoke = (name, args = {}) => evaluate('window.__TAURI_INTERNALS__.invoke(' + q(name) + ',' + q(args) + ')')
const text = label => wait(() => evaluate('document.body.innerText.includes(' + q(label) + ')'), label)
const button = (label, partial) => 'Array.from(document.querySelectorAll("button")).find(e => e.getClientRects().length && !e.disabled && e.textContent.trim().' +
  (partial ? 'startsWith(' + q(label) + ')' : 'valueOf()===' + q(label)) + ')'
async function click(label, partial = false) {
  const point = await wait(() => evaluate('(()=>{const b=' + button(label, partial) + ';if(!b)return; b.scrollIntoView({block:"center"}); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()'), label)
  await cdp('Input.dispatchMouseEvent', { ...point, type: 'mousePressed', button: 'left', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { ...point, type: 'mouseReleased', button: 'left', clickCount: 1 })
}
async function shot(name) {
  const image = await cdp('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shots, name + '.png'), Buffer.from(image.data, 'base64'))
}

async function start(label, { offline = false, expectedSchema = 9 } = {}) {
  assert.equal(target, undefined)
  const state = installed()
  const flags = '--remote-debugging-port=' + port + ' --remote-debugging-address=127.0.0.1' +
    (offline ? ' --proxy-server=http://127.0.0.1:1' : '')
  const began = performance.now()
  ps('Start-Process -FilePath ' + psString(state.shortcut) + ' -WindowStyle Normal', {
    ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: flags,
  })
  target = await wait(() => Number(ps('$p=Get-Process knowpaper-preview -ErrorAction SilentlyContinue | Where-Object Path -eq ' +
    psString(executable) + '; if ($p) { $p.Id }')), 'installed EXE process')
  const page = await wait(async () => (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json())
    .find(entry => entry.type === 'page' && entry.webSocketDebuggerUrl), 'installed WebView2')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  await text('SQLite 题库')
  if (offline) {
    await cdp('Network.enable')
    await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await cdp('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp('Page.reload', { ignoreCache: true })
    await text('SQLite 题库')
    assert.equal(await evaluate('navigator.onLine'), false)
  }
  if (expectedSchema === 9) assert.equal(await invoke('database_status'), 9)
  else await assert.rejects(invoke('database_status'), /版本|schema|Schema/i)
  const elapsed = Math.round(performance.now() - began)
  const memory = JSON.parse(ps('$p=Get-Process -Id ' + target + '; $all=Get-CimInstance Win32_Process; ' +
    '$ids=@($p.Id); do { $n=$ids.Count; $ids+=@($all|Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids }|ForEach-Object ProcessId) } while ($n -ne $ids.Count); ' +
    '$wv=($all|Where-Object { $_.ProcessId -in $ids -and $_.Name -eq "msedgewebview2.exe" } | Measure-Object WorkingSetSize -Sum).Sum; ' +
    '@{mainBytes=$p.WorkingSet64; webViewBytes=$wv; mainTitle=$p.MainWindowTitle} | ConvertTo-Json -Compress'))
  const entry = { label, pid: target, ms: elapsed, offlineEmulation: offline, memory }
  timings.push(entry)
  json(join(out, 'timings.json'), timings)
  console.log(JSON.stringify(entry))
}
async function stop() {
  if (!target) return
  const pid = target
  ps('if (!(Get-Process -Id ' + pid + ').CloseMainWindow()) { throw "Cannot close installed app" }')
  await wait(() => ps('if (!(Get-Process -Id ' + pid + ' -ErrorAction SilentlyContinue)) { "closed" }') === 'closed', 'normal desktop exit')
  socket?.close()
  socket = undefined
  target = undefined
  await wait(async () => {
    try { await fetch('http://127.0.0.1:' + port + '/json/list'); return false } catch { return true }
  }, 'WebView2 debugging endpoint closed')
}
async function pick(title, path) {
  const result = await posh(['tests/windows-pdf-dialog.ps1', '-AppProcess', String(target), '-Title', title, '-Filename', path])
  console.log(result.stdout.trim())
}

function snapshot(label, roots) {
  const data = roots.map(root => JSON.parse(execFileSync('python', [fingerprintScript, 'snapshot', root],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })))
  for (const [i, root] of roots.entries()) {
    data[i].backupHistory = JSON.parse(execFileSync('python', ['-c',
      'import sqlite3,sys,json,pathlib; print(json.dumps(sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True).execute("SELECT * FROM backup_record ORDER BY rowid").fetchall()))',
      join(root, 'study.sqlite3')], { encoding: 'utf8' }))
  }
  const state = { journalHash: sha(journal), journal: readJson(journal), library: data, userBackup: sha(backup) }
  snapshots[label] = state
  json(join(out, 'data-fingerprints.json'), snapshots)
  console.log('Fingerprints', label, 'roots:', roots.length, 'questions:', data[0].tables.question[0])
  return state
}

const question = 'dev011-original-question'
const title = 'DEV-011 原创验收组卷'
const collection = 'DEV-011 原创收藏'
let revision, paper, composition

async function createLearningData() {
  const importPdf = invoke('import_paper_pdf', { input: { title: 'DEV-011 原创测试原卷', subject_id: 'math',
    role: 'original', year: 2026, region: '测试', source: 'DEV-007 原创验收夹具' } })
  await pick('导入试卷 PDF', fixturePdf)
  paper = await importPdf
  assert.equal(paper.sha256, sha(fixturePdf))
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS2sAAAAASUVORK5CYII=', 'base64')
  const imagePath = join(out, '原创图形.png')
  writeFileSync(imagePath, image)
  const attachment = await evaluate('window.__TAURI_INTERNALS__.invoke("import_attachment",new Uint8Array(' +
    q([...image]) + ').buffer,{headers:{"x-image-media-type":"image/png"}})')
  assert.equal(attachment.sha256, sha(imagePath))
  const contract = readJson(resolve('tests/revision-contract.json'))
  const content = structuredClone(contract[1].content)
  content.stem.content[0].content[0].text = 'DEV-011 原创试题：求二次函数的零点。'
  content.stem.content.push({type:'image',attrs:{src:'attachment:' + attachment.id, alt:'原创样本图'}})
  content.attachments = [attachment]
  const first = await invoke('create_question', { questionId: question, subjectId: 'math', contentJson: q(content),
    source: { file_id: paper.id, source_key: 'preview-01', regions: [{ page_index: 0, rect: [0.1, 0.1, 0.5, 0.2] }] } })
  content.stem.content[0].content[0].text += ' 第二版。'
  revision = await invoke('save_user_revision', { questionId: question, expectedCurrent: first.id, contentJson: q(content) })
  assert.notEqual(first.id, revision.id)
  await invoke('change_favorite_collection', { command: { action: 'create', name: collection } })
  const folder = (await invoke('favorite_collections')).find(item => item.name === collection)
  await invoke('change_favorites', { command: { action: 'add', collection: folder.id, targets: [{ kind: 'question', id: question }] } })
  const draft = { title, settings: { scope: '合成测试', duration_minutes: 10, gap_mm: 4, answer_space_mm: 0, groups: ['试题'] },
    items: [{ revision_id: first.id, points: { group: '试题', score: 8, part_scores: [] } }] }
  composition = await invoke('save_composition', { draft })
  await invoke('put_draft', { draft: { token: { id: 'dev011-automatic-draft', sequence: 1 },
    object_type: 'question', object_id: question, base_revision: revision.id, payload: { dev011: '合成草稿' },
    attachments: [attachment.id] } })
}

async function verifyLearningData() {
  const subjects = await invoke('list_subjects')
  assert.equal(subjects.length, 9)
  for (const subject of subjects) assert.ok(Array.isArray(await invoke('list_knowledge', { subjectId: subject.id })))
  assert.equal((await invoke('current_revision', { questionId: question })).revision.id, revision.id)
  assert.equal((await invoke('read_composition', { id: composition.header.id })).items[0].question.revision.id,
    composition.items[0].question.revision.id)
  assert.ok((await invoke('favorite_collections')).some(item => item.name === collection))
  assert.ok((await invoke('list_drafts')).some(item => item.id === 'dev011-automatic-draft'))
  const location = (await invoke('list_pdf_locations', { questionId: question })).find(item => item.file_id === paper.id)
  assert.ok(location)
  assert.equal((await invoke('open_region_question', { fileId: paper.id, sourceKey: location.source_key, ordinal: location.ordinal })).id, question)
}

async function restoreFixture() {
  await click('数据管理')
  await click('选择备份恢复')
  await pick('选择知卷备份', fixture)
  await text('恢复预览')
  await click('确认替换资源库')
  await text('确认完整替换当前资源库')
  await click('确认操作')
  await text('已准备好切换')
}
function verifyManifest(binary, wanted) {
  const manifest = readJson(join(resolve(binary, '..'), 'manifest.json'))
  assert.equal(manifest.version, wanted)
  assert.equal(manifest.identifier, identifier)
  assert.equal(sha(binary), manifest.sha256)
}

try {
  verifyManifest(a, '0.2.0')
  verifyManifest(b, '0.2.1')
  assert.ok(!existsSync(profile) && !existsSync(destination) && !installed().version, 'Use a fresh Preview namespace')
  mkdirSync(shots, { recursive: true })
  assert.equal(await setup('install-A', a, 'Install'), 0)
  assertInstalled('0.2.0')
  await start('A-first-start')
  assert.equal((await invoke('list_questions')).length, 0)
  await shot('A-clean-installed-desktop')
  await restoreFixture()
  await stop()
  await start('A-after-restoring-synthetic-history')
  await createLearningData()
  await click('试题检索')
  await text('加入组卷')
  await shot('A-study-data')
  await click('数据管理')
  await click('创建完整备份')
  await pick('保存知卷完整备份', backup)
  await text('完整备份已创建并验证')
  const { directory, previous } = await invoke('protection_status')
  assert.ok(previous)
  const roots = [directory, previous]
  await verifyLearningData()
  assert.equal(await setup('upgrade-blocked-by-running-A', b, 'Blocked'), 10)
  assertInstalled('0.2.0')
  await stop()
  const pristine = snapshot('A-before-upgrade', roots)

  // File corruption is checked against the manifest and against NSIS itself.
  const truncated = join(out, 'test-truncated-setup.exe')
  writeFileSync(truncated, readFileSync(b).subarray(0, 2 * 1024 * 1024))
  assert.notEqual(sha(truncated), sha(b))
  assert.notEqual(await setup('truncated-bundle', truncated, 'Blocked'), 0)
  assertInstalled('0.2.0')
  assert.deepEqual(snapshot('A-after-truncation', roots), pristine)

  assert.equal(await setup('upgrade-A-to-B', b, 'Install'), 0)
  assertInstalled('0.2.1')
  assert.deepEqual(snapshot('B-before-start', roots), pristine)
  await start('B-first-start')
  await verifyLearningData()
  await click('试题检索')
  await text('加入组卷')
  await shot('B-preserved-study-data')
  await stop()
  assert.deepEqual(snapshot('B-after-first-start', roots), pristine)
  assert.equal(silent('B-to-A-refused', a, '/S'), 11)
  assertInstalled('0.2.1')
  assert.equal(silent('B-repeat-install', b, '/S'), 0)
  assertInstalled('0.2.1')
  assert.deepEqual(snapshot('B-after-repeat-and-downgrade', roots), pristine)

  const uninstallerCopy = join(out, 'test-uninstaller.exe')
  copyFileSync(uninstall, uninstallerCopy)
  assert.equal(await setup('uninstall-B', uninstallerCopy, 'Uninstall'), 0)
  const removed = installed()
  assert.equal(removed.version, null)
  assert.equal(removed.executable, false)
  assert.equal(removed.linkTarget, null)
  assert.equal(removed.desktop, false)
  assert.equal(removed.directory, false)
  assert.deepEqual(snapshot('after-uninstall', roots), pristine)
  assert.equal(silent('reinstall-B', b, '/S'), 0)
  assertInstalled('0.2.1')
  await start('B-reinstalled-offline', { offline: true })
  await verifyLearningData()
  await click('试题检索')
  await text('加入组卷')
  await shot('offline-search')
  await click('我的收藏')
  await text(collection)
  await shot('reinstalled-favorites')
  await click('自定义组卷')
  await text(title)
  await click(title, true)
  await click('生成双卷预览')
  await text('导出双 PDF')
  await shot('offline-composition')
  await click('导出双 PDF')
  await click('确认并导出')
  await text('答案解析卷：')
  await shot('offline-pdf-export')
  await stop()
  assert.deepEqual(snapshot('after-reinstall-start-and-export', roots), pristine)
  console.log('Completed installed Preview lifecycle.')
} finally {
  if (target) await stop()
}
