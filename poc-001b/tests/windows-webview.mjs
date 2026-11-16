// Run against a freshly built Windows executable, from poc-001b.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const executable = resolve(process.argv[2] ?? 'src-tauri/target/release/shandong-poc-001b.exe')
const port = 19245
const out = resolve('.test-output')
const profile = join(process.env.APPDATA, 'org.shandong-study.poc001b')
const storage = join(profile, 'questions.json')
assert.ok(!existsSync(storage), '请先关闭应用并备份现有 questions.json，再运行此测试。')
mkdirSync(out, { recursive: true })
const fixture = join(out, 'fixture.png')
writeFileSync(fixture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=', 'base64'))

let child
let socket
let serial = 0
const pending = new Map()

async function waitFor(get, description, timeout = 20000) {
  const end = Date.now() + timeout
  let error
  do {
    try {
      const result = await get()
      if (result) return result
    } catch (err) { error = err }
    await delay(150)
  } while (Date.now() < end)
  throw new Error('等待超时：' + description, { cause: error })
}

async function send(method, params = {}) {
  const id = ++serial
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error('CDP 请求超时 ' + method))
    }, 5000)
    pending.set(id, (reply) => {
      clearTimeout(timeout)
      if (reply.error) reject(new Error(reply.error.message))
      else resolve(reply.result)
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

async function start(offline = false) {
  child = spawn(executable, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        '--remote-debugging-port=' + port + ' --remote-debugging-address=127.0.0.1',
    },
    stdio: 'ignore',
  })
  child.on('error', (err) => console.error(err.message))
  const target = await waitFor(async () => {
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
    return targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
  }, 'Windows WebView2 页面')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data)
    const callback = pending.get(response.id)
    pending.delete(response.id)
    callback?.(response)
  })
  console.log('WebView2 URL:', target.url)
  if (offline) {
    await send('Network.enable')
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await send('Network.setCacheDisabled', { cacheDisabled: true })
    await send('Page.reload', { ignoreCache: true })
  }
  await waitFor(() => evaluate("document.querySelector('.tiptap')?.isContentEditable"), '编辑器可用')
  const state = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    '$p = Get-Process -Id ' + child.pid + '; if (!$p.MainWindowHandle) { exit 1 }; $p.MainWindowTitle'], { encoding: 'utf8' })
  assert.ok(state.trim())
  console.log('Native Win32 window hwnd present, process PID ' + child.pid)
}

async function close() {
  if (!child || child.exitCode !== null) return
  const exiting = new Promise((resolve) => child.once('exit', (code) => resolve({ code })))
  socket?.close()
  execFileSync('powershell.exe', ['-NoProfile', '-Command',
    'if (!(Get-Process -Id ' + child.pid + ').CloseMainWindow()) { exit 1 }'])
  const result = await Promise.race([exiting, delay(12000)])
  assert.equal(result?.code, 0, 'application must close through the native window')
  child = undefined
}

const buttons = (text) => "Array.from(document.querySelectorAll('button')).find(element => element.textContent.trim() === " + JSON.stringify(text) + ')'
async function click(text) {
  const expr = buttons(text)
  await waitFor(() => evaluate(expr + '?.disabled === false'), text)
  await evaluate(expr + '.click()')
}

async function status(text) {
  await waitFor(async () => {
    const error = await evaluate("document.querySelector('.status [role=alert]')?.textContent")
    if (error) throw new Error(error)
    const output = await evaluate("document.querySelector('.status')?.textContent")
    return output?.includes(text)
  }, text, 75000)
}

async function fillFormula(latex) {
  await waitFor(() => evaluate("document.querySelector('dialog')?.open"), 'LaTeX 编辑对话框')
  await evaluate("(() => { const box = document.querySelector('dialog textarea'); box.focus(); box.select(); return true })()")
  await send('Input.insertText', { text: latex })
  await click('应用公式')
  await waitFor(() => evaluate("document.querySelector('dialog')?.open === false"), '公式更新')
}

async function snapshot(name) {
  await send('Page.enable')
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(out, name + '.png'), Buffer.from(data, 'base64'))
}

try {
  await start()
  assert.equal(await evaluate("document.querySelector('.tiptap img').naturalWidth > 0"), true)
  await snapshot('desktop-editor')
  await click('题卷预览')
  await click('导出当前 PDF')
  await status('paper.pdf')
  await click('答案卷预览')
  await snapshot('desktop-answers')
  await click('导出当前 PDF')
  await status('answers.pdf')
  await click('题卷预览')
  await evaluate("document.querySelector('.mode-bar input[type=checkbox]').click()")
  await click('导出当前 PDF')
  await status('paper-long.pdf')
  for (const name of ['paper.pdf', 'answers.pdf', 'paper-long.pdf']) {
    const pdf = readFileSync(join(profile, 'pdf', name))
    assert.ok(pdf.subarray(0, 5).equals(Buffer.from('%PDF-')))
    writeFileSync(join(out, name), pdf)
  }
  console.log('Three real WebView2 PrintToPdf exports')
  await click('编辑试题')
  await evaluate("document.querySelector('.tiptap p').click(); document.querySelector('.tiptap [data-type=\"inline-math\"]').click()")
  await fillFormula('f(x)=x^2-8x+12')
  await evaluate("const p = document.querySelector('.tiptap p'); p.focus(); getSelection().collapse(p, 0); true")
  await click('粗体')
  await click('斜体')
  await send('Input.insertText', { text: '回读回归 ABC 123 ' })
  await click('插入独立公式')
  await fillFormula('\\sqrt{313}')
  await send('DOM.enable')
  const { root } = await send('DOM.getDocument')
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
  await send('DOM.setFileInputFiles', { nodeId, files: [fixture] })
  await waitFor(() => evaluate("Array.from(document.querySelectorAll('.tiptap img')).some(img => img.alt === 'fixture.png' && img.naturalWidth > 0)"), '本地图片显示')
  await click('保存本地 JSON')
  await status('已保存到')
  const saved = JSON.parse(readFileSync(storage, 'utf8'))
  const stem = JSON.stringify(saved.questions[0].stem)
  for (const token of ['f(x)=x^2-8x+12', 'sqrt{313}', 'data:image/png;base64,', 'poc001:parabola', '回读回归 ABC 123', '"bold"', '"italic"']) {
    assert.ok(stem.includes(token), token)
  }
  assert.equal(saved.questions[0].id, 'poc-math-001')
  assert.equal(saved.questions[0].parts[0].id, 'p1')
  await close()

  await start(true)
  await status('已读取本地编辑版')
  assert.equal(await evaluate("document.querySelector('.tiptap').textContent.includes('回读回归 ABC 123')"), true)
  await waitFor(() => evaluate("document.fonts.ready.then(() => document.fonts.check('14px KaTeX_Main') && Array.from(document.querySelectorAll('.tiptap img')).every(img => img.naturalWidth > 0))"), '离线字体和图片加载')
  assert.equal(await evaluate("document.querySelectorAll('.tiptap .katex').length"), 2)
  const requests = await evaluate("performance.getEntriesByType('resource').map(value => value.name)")
  assert.ok(requests.some((value) => /KaTeX.*woff/i.test(value)), 'KaTeX must actually load a local font asset')
  assert.ok(requests.every((value) => !/^https?:\/\//.test(value) || /^https?:\/\/(?:tauri\.localhost|ipc\.localhost)\//.test(value)), JSON.stringify(requests))
  await evaluate("document.querySelector('.tiptap [data-type=\"block-math\"]').click()")
  await fillFormula('\\frac{21}{7}')
  await click('保存本地 JSON')
  await status('已保存到')
  const second = JSON.parse(readFileSync(storage, 'utf8'))
  assert.ok(JSON.stringify(second.questions[0].stem).includes('frac{21}{7}'))
  assert.deepEqual(second.questions[0].parts, saved.questions[0].parts)
  assert.deepEqual(
    second.questions[0].stem.content.filter((node) => node.type === 'image'),
    saved.questions[0].stem.content.filter((node) => node.type === 'image'),
  )
  await snapshot('desktop-reopened-offline')
  await close()
  console.log('Native close/restart, network-disabled resource reload, formula and attachment round trip PASS')
} finally {
  await close()
}

