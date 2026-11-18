
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const fixture = (name) => resolve('.test-output/dev007-fixtures', name + '.pdf')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const ps = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'

export async function readerRegression(h) {
  const { click, evaluate, waitFor, snapshot, send, start, close } = h
  const invoke = (command, args = {}) => evaluate(
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`)
  const press = (expression) => evaluate(`(() => { const item = ${expression}; item.click(); return true })()`)
  const searchButton = (text, scope = 'document') => `Array.from(${scope}.querySelectorAll('button')).find(b => b.textContent.trim().startsWith(${JSON.stringify(text)}))`
  const status = (fragment) => waitFor(() => evaluate(`document.querySelector('main')?.innerText.includes(${JSON.stringify(fragment)})`), fragment)
  const rendered = (page) => evaluate(`new Promise((resolve, reject) => {
    const selector = '[data-pdf-page="${page}"][data-pdf-ready=true]'
    const watch = new MutationObserver(check)
    const timeout = setTimeout(() => {
      watch.disconnect()
      reject(new Error('Page ${page} unavailable: ' + (document.querySelector('.pdf-load-error, .pdf-page-error')?.textContent ?? 'timeout')))
    }, 30000)
    function check() {
      if (document.querySelector(selector)) { watch.disconnect(); clearTimeout(timeout); resolve(true) }
    }
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-pdf-ready'] })
    check()
  })`)
  const native = (title, path) => execute(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    'tests/windows-pdf-dialog.ps1', '-AppProcess', String(h.pid()), '-Title', title, '-Filename', path])
  async function change(selector, value) {
    return evaluate(`(() => {
      const field = document.querySelector(${JSON.stringify(selector)})
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set.call(field, ${JSON.stringify(value)})
      field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
      return true
    })()`)
  }
  async function importFile(name, title, { paperTitle, role = 'original', invalid } = {}) {
    if (paperTitle) {
      await press(`[...document.querySelectorAll('.paper-library-list article')].find(node =>
        node.querySelector('h2').textContent === ${JSON.stringify(paperTitle)}).querySelector('button:last-child:is(article > button)')`)
    } else {
      await click('导入 PDF')
      await change('[name=title]', title)
      await change('[name=subject]', 'math')
      await change('[name=year]', '2026')
      await change('[name=region]', '山东')
    }
    await change('[name=role]', role)
    await change('[name=source]', '原创验收样本')
    if (name === 'original' && !paperTitle) await snapshot('02-import')
    const begin = performance.now()
    await click('选择本地 PDF')
    const chosen = await native('导入试卷 PDF', fixture(name))
    console.log(chosen.stdout.trim())
    if (invalid) {
      await status(invalid)
      await click('取消导入')
      return
    }
    await rendered(1)
    const records = await invoke('list_paper_records')
    const record = records.find((entry) => entry.title === (paperTitle ?? title))
    assert.ok(record)
    const file = record.files.find((file) => file.original_name === name + '.pdf' && file.role === role)
    assert.ok(file)
    assert.equal(file.sha256, hash(readFileSync(fixture(name))))
    console.log(`Imported and rendered ${name}.pdf (${file.page_count} pages, ${file.byte_size} bytes, including native selection ${(performance.now() - begin).toFixed(1)}ms)`)
    return file
  }
  async function choose(file) {
    await change('[aria-label="PDF 版本"]', file.id)
    await rendered(1)
  }
  async function jump(page) {
    await change('[aria-label="跳转页码"]', String(page))
    await click('跳转')
    await rendered(page)
  }
  async function query(keyword, message) {
    await change('[aria-label="PDF 搜索关键词"]', keyword)
    await click('搜索 PDF')
    await status(message)
  }
  async function selectArea(x0, y0, x1, y1) {
    const box = await evaluate(`(() => {
      const node = document.querySelector('.pdf-pick-layer')
      node.scrollIntoView({ block: 'nearest' })
      const r = node.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })()`)
    const start = { x: box.x + x0 * box.w, y: box.y + y0 * box.h }
    const end = { x: box.x + x1 * box.w, y: box.y + y1 * box.h }
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...start })
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, ...end })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...end })
  }
  async function fillEditor(selector, text) {
    await evaluate(`(() => {
      const p = document.querySelector(${JSON.stringify(selector)})
      p.focus(); getSelection().collapse(p, 0); return true
    })()`)
    await send('Input.insertText', { text })
  }

  await start()
  await click('试卷库')
  await waitFor(() => evaluate("document.querySelector('.paper-library-heading h1')?.textContent === '试卷库'"), 'paper library')
  if (process.argv.includes('--paper-print')) {
    await waitFor(() => evaluate(searchButton('原卷 · original.pdf') + ' !== undefined'), 'print fixture')
    await press(searchButton('原卷 · original.pdf'))
    await rendered(1)
    await click('打印原卷')
    await change('[aria-label="结束页"]', '1')
    await click('准备打印页面')
    await click('打开系统打印')
    const output = join(h.out, 'system-printed-original-' + h.pid() + '.pdf')
    console.log('Print one original page with Microsoft Print to PDF and save to:', output)
    const printTimeout = Number(process.env.KNOWPAPER_TEST_PRINT_TIMEOUT_MS ?? 600000)
    await waitFor(() => existsSync(output) && readFileSync(output).subarray(0, 5).toString() === '%PDF-', 'spooled system PDF', printTimeout)
    copyFileSync(output, join(h.out, 'system-printed-original.pdf'))
    console.log('Microsoft Print to PDF spool produced a PDF file')
    await snapshot('11-print')
    await click('关闭打印')
    await close()
    return
  }
  const original = await importFile('original', '原创合卷甲')
  await snapshot('03-reader')
  await waitFor(() => evaluate("Array.from(document.querySelectorAll('.pdf-thumbnails canvas')).every(c => c.width > 0)"), 'thumbnail canvases')
  await snapshot('04-thumbnails')
  await click('下一页'); await rendered(2)
  await click('上一页'); await rendered(1)
  await press("document.querySelector('[aria-label=\"缩略图第 3 页\"]')")
  await rendered(3)
  await jump(1)
  await change('[aria-label="页面缩放"]', 'fit-width')
  await rendered(1)
  await change('[aria-label="页面缩放"]', 'fit-page')
  await rendered(1)
  await query('ORBITAL', '2 页包含关键词')
  await waitFor(() => evaluate("document.querySelectorAll('.pdf-text-hit').length > 0"), 'visible-text highlight')
  await snapshot('05-search')
  assert.equal(await evaluate("document.querySelectorAll('.pdf-sheet a, .pdf-sheet iframe, .pdf-sheet object').length"), 0)
  console.log('T06/T07: paging, zoom, thumbnail, jump, actual search and inert external annotation PASS')

  await click('返回试卷库')
  const answer = await importFile('answer', '', { paperTitle: '原创合卷甲', role: 'answer' })
  await click('返回试卷库')
  const analysis = await importFile('analysis', '', { paperTitle: '原创合卷甲', role: 'analysis' })
  await choose(answer)
  await choose(original)
  await choose(analysis)
  await choose(original)
  console.log('T08: all three PDF roles read from the same paper PASS')

  const savePath = join(h.out, 'saved-original-' + h.pid() + '.pdf')
  await click('保存原始 PDF')
  await native('保存原始 PDF', savePath)
  await status('原始 PDF 已保存')
  assert.equal(hash(readFileSync(savePath)), original.sha256)
  console.log('Native Save As: exact source bytes and SHA-256 PASS')
  await click('打印原卷')
  await change('[aria-label="结束页"]', '1')
  await click('准备打印页面')
  await waitFor(() => evaluate(searchButton('打开系统打印') + '?.disabled === false'), 'prepared print')
  await click('关闭打印')

  await click('截取题目')
  await selectArea(0.11, 0.15, 0.65, 0.51)
  await status('已选 1 个区域')
  const before = await evaluate("document.querySelector('.pdf-selection').getAttribute('style')")
  await change('[aria-label="页面缩放"]', 'fit-width'); await rendered(1)
  assert.equal(await evaluate("document.querySelector('.pdf-selection').getAttribute('style')"), before)
  await change('[aria-label="页面缩放"]', 'fit-page'); await rendered(1)
  for (let index = 0; index < 4; index++) await click('旋转')
  await rendered(1)
  assert.equal(await evaluate("document.querySelector('.pdf-selection').getAttribute('style')"), before)
  await snapshot('06-selection')
  await jump(2)
  await selectArea(0.28, 0.19, 0.82, 0.65)
  await status('已选 2 个区域')
  await click('继续处理选区')
  await change('[aria-label="原题号或位置"]', '跨页第1题')
  const captureStarted = performance.now()
  await click('截图并新建试题')
  await waitFor(() => evaluate("[...document.querySelectorAll('.tiptap img')].filter(i => i.naturalWidth > 0).length === 2"), 'two real attachments', 35000)
  const captureMs = Number((performance.now() - captureStarted).toFixed(1))
  console.log('Capture + attachment save + editor load milliseconds:', captureMs)
  await fillEditor('.tiptap p', 'ORBITALCAPTURE 原创截图题')
  await change('[aria-label="整题分值"]', '5')
  const field = '.panel .select-field select'
  const editorField = await evaluate(`[...document.querySelectorAll(${JSON.stringify(field)})]
    .find(node => [...node.options].some(option => option.textContent === '整题答案')).outerHTML`)
  assert.ok(editorField)
  await evaluate(`(() => { const select = [...document.querySelectorAll(${JSON.stringify(field)})]
    .find(node => [...node.options].some(option => option.textContent === '整题答案'));
    select.value = 'answer'; select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await fillEditor('.tiptap p', '根为 2 和 -5。')
  await click('保存到 SQLite'); await h.status('已保存 SQLite 修订')
  const editorSelect = `[...document.querySelectorAll(${JSON.stringify(field)})]
    .find(node => [...node.options].some(option => option.textContent === '整题答案'))`
  await evaluate(`(() => { const select = ${editorSelect}; select.value = 'stem';
    select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await waitFor(() => evaluate("[...document.querySelectorAll('.tiptap img')].every(i => i.naturalWidth > 0) && document.querySelectorAll('.tiptap img').length === 2"), 'saved screenshots reopen')
  await snapshot('07-created-question')
  const questionId = await evaluate("document.querySelector('[data-question-id][aria-pressed=true]').dataset.questionId")
  const revision = await invoke('current_revision', { questionId })
  const capturedAttachments = revision.revision.content.attachments
  assert.equal(capturedAttachments.length, 2)
  for (const [index, item] of capturedAttachments.entries()) {
    const image = readFileSync(join(h.profile, 'attachments', item.sha256.slice(0, 2), item.sha256))
    assert.equal(item.sha256, hash(image))
    assert.equal(image.subarray(1, 4).toString(), 'PNG')
    writeFileSync(join(h.out, `capture-${index + 1}.png`), image)
    console.log(`Screenshot ${index + 1} ${image.length} bytes SHA-256 ${item.sha256}`)
  }
  assert.equal(revision.review_status, 'unreviewed')
  const origins = await invoke('list_pdf_locations', { questionId })
  assert.deepEqual(origins.map((item) => [item.file_id, item.page_index]), [[original.id, 0], [original.id, 1]])
  await waitFor(() => evaluate(searchButton('查看原卷') + ' !== undefined'), 'question sources')
  await press(searchButton('查看原卷'))
  await rendered(1)
  await waitFor(() => evaluate("document.querySelector('.pdf-region-marker[data-current=true]') !== null"), 'active location')
  await snapshot('08-question-to-pdf')
  await press("document.querySelector('.pdf-region-marker[data-current=true]')")
  await waitFor(() => evaluate("document.querySelector('[data-question-id][aria-pressed=true]')?.dataset.questionId") , 'region question')
  assert.equal(await evaluate("document.querySelector('[data-question-id][aria-pressed=true]').dataset.questionId"), questionId)
  await snapshot('09-pdf-to-question')
  await click('返回原卷定位')
  await rendered(1)
  console.log('T09/T10/T11/T13 and E2E-003: rotated and zoomed multi-page crop, stored attachments, atomic draft source, bidirectional navigation PASS')

  await click('返回试卷库')
  const duplicate = await importFile('original', '同字节试卷乙')
  assert.notEqual(duplicate.paper_id, original.paper_id)
  assert.notEqual(duplicate.id, original.id)
  assert.equal(duplicate.sha256, original.sha256)
  assert.equal(readdirSync(join(h.profile, 'paper-pdfs', original.sha256.slice(0, 2))).filter(name => name === original.sha256).length, 1)
  await click('截取题目')
  await selectArea(0.13, 0.17, 0.61, 0.49)
  await click('继续处理选区')
  await change('[aria-label="原题号或位置"]', '重印第1题')
  await change('[aria-label="查找已有试题"]', 'ORBITALCAPTURE')
  await click('查找已有试题')
  await waitFor(() => evaluate("document.querySelector('.pdf-question-options input:enabled')?.closest('label')?.textContent.includes('ORBITALCAPTURE')"), 'question lookup')
  await press("document.querySelector('.pdf-question-options input:enabled')")
  await click('关联所选试题')
  await status('原卷区域已关联')
  assert.equal((await invoke('list_pdf_locations', { questionId })).length, 3)
  console.log('T03/T12: byte dedup without paper merge and existing question linked to a second source PASS')

  await click('返回试卷库')
  await importFile('scan', '纯图片扫描样本')
  await query('ORBITAL', '扫描件暂不支持 OCR')
  assert.equal(await evaluate("document.querySelectorAll('.pdf-text-hit').length"), 0)
  await click('返回试卷库')
  for (const [name, expected] of [['damaged', '无法解析 PDF'], ['disguised', '有效的 PDF'],
    ['encrypted', '加密或密码'], ['too-large', '64 MiB'], ['too-many', '1–500 页']]) {
    await importFile(name, '不得登记的测试文件', { invalid: expected })
  }
  assert.ok((await invoke('list_paper_records')).every((record) => record.title !== '不得登记的测试文件'))
  const denied = await evaluate("window.__TAURI_INTERNALS__.invoke('open_paper_pdf', {fileId:'../study.sqlite3'}).catch(error => error.message)")
  assert.match(denied, /未登记/)
  console.log('T02/T04: scan, malformed, disguised, encrypted, 64 MiB, 500-page and unregistered boundary PASS')

  const measurements = [{ name: 'two screenshot attachments and editor', ms: captureMs }]
  function sample() {
    return JSON.parse(execFileSync('python', ['tests/paper-reader-fixtures.py', 'memory', String(h.pid())], { encoding: 'utf8' }))
  }
  async function timed(name, action) {
    const begin = performance.now()
    await action()
    measurements.push({ name, ms: Number((performance.now() - begin).toFixed(1)), ...sample() })
  }
  for (const [name, title, pages] of [['perf20', '性能20页', [20]], ['perf100', '性能100页', [50, 100]]]) {
    await importFile(name, title)
    await click('返回试卷库')
    const open = () => press(searchButton('原卷 · ' + name + '.pdf'))
    await timed(name + ' first open after import', async () => { await open(); await rendered(1) })
    await click('缩略图')
    await timed(name + ' five thumbnails', async () => {
      await click('缩略图')
      await waitFor(() => evaluate("document.querySelectorAll('[data-pdf-thumb-ready=true]').length === 5"), 'thumbnails')
    })
    for (const page of pages) await timed(name + ' jump ' + page, () => jump(page))
    await timed(name + ' search', () => query('ORBITAL', '页包含关键词'))
    await click('返回试卷库')
    await timed(name + ' reopen', async () => { await open(); await rendered(1) })
    await click('返回试卷库')
  }
  writeFileSync(join(h.out, 'performance.json'), JSON.stringify(measurements, null, 2) + '\n')
  console.log('T17 samples:', JSON.stringify(measurements))
  await snapshot('01-library')

  // Force an earlier native response to arrive after a newer PDF is displayed.
  await evaluate(`(() => {
    const fetchOriginal = window.fetch
    window.readerTestFetch = fetchOriginal
    window.fetch = async (url, request) => {
      const value = await fetchOriginal(url, request)
      if (String(url).endsWith('/open_paper_pdf') && JSON.parse(request.body).fileId === ${JSON.stringify(original.id)}) {
        window.readerDelayedToken = (await value.clone().json()).token
        await new Promise(resolve => setTimeout(resolve, 1800))
        window.readerDelayedOpenDelivered = true
      }
      if (String(url).endsWith('/close_paper_pdf')) (window.readerClosed ??= []).push(JSON.parse(request.body).token)
      return value
    }
  })()`)
  await press(searchButton('原卷 · original.pdf', "document.querySelector('.paper-library-list')"))
  await waitFor(() => evaluate('Number.isInteger(window.readerDelayedToken)'), 'deferred request pending')
  await choose(answer)
  await waitFor(() => evaluate('window.readerDelayedOpenDelivered && window.readerClosed?.includes(window.readerDelayedToken)'), 'late session discarded')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"PDF 版本\"]').value"), answer.id)
  await evaluate('window.fetch = window.readerTestFetch')
  console.log('T16: late PDF open response discarded and native session closed PASS')
  await click('返回试卷库')

  await click('试题检索')
  await change('[aria-label="题干关键词"]', 'ORBITALCAPTURE')
  await click('搜索试题')
  const hit = `[data-search-question-id="${questionId}"]`
  const addButton = searchButton('加入组卷', `document.querySelector(${JSON.stringify(hit)}).closest('li')`)
  await waitFor(() => evaluate(`document.querySelector('.applied-filters')?.textContent.includes('ORBITALCAPTURE') &&
    document.querySelector(${JSON.stringify(hit)}) && ${addButton}?.disabled === false`), 'captured question found in SQLite search')
  await press(addButton)
  await waitFor(() => evaluate("document.querySelector('.draft-indicator')?.textContent.includes('1 题')"), 'captured question in basket')
  await click('自定义组卷')
  await change('.composition-fields label:nth-child(1) input', '原卷截题端到端验收')
  await click('保存组卷')
  await status('组卷已保存')
  await click('生成双卷预览')
  await waitFor(() => evaluate("document.querySelector('.composition-paper')?.innerText.includes('ORBITALCAPTURE')"), 'captured question print preview')
  await click('导出双 PDF')
  const confirm = await waitFor(() => evaluate(`(${searchButton('确认并导出')})?.disabled === false ? 'confirm'
    : document.querySelector('.composition-status')?.innerText.includes('双 PDF 导出成功') ? 'success' : ''`),
  'dual PDF generation or confirmation', 75000)
  if (confirm === 'confirm') await click('确认并导出')
  await waitFor(() => evaluate("document.querySelector('.composition-status')?.innerText.includes('双 PDF 导出成功')"), 'dual PDF success', 75000)
  const batch = readdirSync(join(h.profile, 'pdf')).find((name) => name.startsWith('composition-'))
  for (const name of ['paper', 'answers']) {
    const source = join(h.profile, 'pdf', batch, name + '.pdf')
    assert.equal(readFileSync(source).subarray(0, 5).toString(), '%PDF-')
    copyFileSync(source, join(h.out, `capture-composition-${name}.pdf`))
  }
  console.log('E2E-001: imported original → cropped and edited PNG → SQLite → search → pinned composition → two actual WebView2 PDFs PASS')

  await close()
  await start(true)
  const after = await invoke('list_pdf_locations', { questionId })
  assert.equal(after.length, 3)
  await click('试卷库')
  await waitFor(() => evaluate(searchButton('原卷 · original.pdf') + ' !== undefined'), 'offline paper list')
  await press(searchButton('原卷 · original.pdf'))
  await rendered(1)
  await waitFor(() => evaluate("document.querySelector('.pdf-region-marker') !== null"), 'restarted markers')
  await snapshot('10-restarted')
  console.log('T01/T15: native close/restart with network disabled, PDF and persisted location replayed PASS')
  await close()
}
