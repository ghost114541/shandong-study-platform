import assert from 'node:assert/strict'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const python = process.env.KP_DEV008_PYTHON ?? 'python'
const invokeExpression = (command, args) =>
  `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args ?? {})})`
const target = (kind, id) => ({ kind, id })

function nativeControls({ evaluate, send, waitFor }) {
  const invoke = (command, args) => evaluate(invokeExpression(command, args))
  const visible = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => e.getClientRects().length)`
  async function mouse(expression, description) {
    const position = await waitFor(() => evaluate(`(() => {
      const field = ${expression}
      if (!field || !field.getClientRects().length || field.matches(':disabled')) return null
      field.scrollIntoView({block:'nearest'})
      const r = field.getBoundingClientRect()
      return {x:r.x + r.width / 2, y:r.y + r.height / 2}
    })()`), description)
    const { x, y } = position
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  const click = (label, selector = 'button') => mouse(
    visible(selector) + `.find(e => e.textContent.trim() === ${JSON.stringify(label)})`, label,
  )
  const choose = (selector) => mouse(visible(selector) + '[0]', selector)
  const present = (selector) => waitFor(() => evaluate(visible(selector) + '.length > 0'), selector)
  const gone = (selector) => waitFor(() => evaluate(visible(selector) + '.length === 0'), '关闭 ' + selector)
  const contains = (text, selector = 'main') => waitFor(() => evaluate(
    visible(selector) + `.some(e => e.innerText.includes(${JSON.stringify(text)}))`), text)
  async function fill(selector, value) {
    await present(selector)
    await waitFor(() => evaluate(`(() => {
      const field = ${visible(selector)}[0]
      return field && !field.disabled && (field.tagName !== 'SELECT'
        || Array.from(field.options).some((option) => option.value === ${JSON.stringify(value)}))
    })()`), 'input enabled with expected option: ' + selector)
    await evaluate(`(() => {
      const field = ${visible(selector)}[0]
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set.call(field, ${JSON.stringify(value)})
      field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
      return true
    })()`)
  }
  return { invoke, click, choose, present, gone, contains, fill }
}

export async function favoritesRegression(h) {
  const { evaluate, waitFor, start, close, snapshot, nativeClose, database } = h
  const { invoke, click, choose, present, gone, contains, fill } = nativeControls(h)
  const modal = '.favorite-modal[open]'
  const modalButtons = modal + ' button'
  const sourceSelect = modal + ' label:has(select) select'
  const destinations = modal + ' label:first-child select'
  const stem = (text) => ({
    schema_version: 1, question_type: '解答题', score: 4, parts: [],
    stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  })
  const query = async (filters = {}) => invoke('favorite_page', { query: filters })
  const status = async (ref) => (await invoke('favorite_status', { targets: [ref] }))[0]
  const favor = async (label, folder, scope = 'button') => {
    await click(label, scope)
    await present(modal)
    assert.equal(await evaluate(`!!document.activeElement.closest('${modal}')`), true, 'dialog traps initial focus')
    await waitFor(() => evaluate(`!!document.querySelector('${destinations}:enabled')`), '选择收藏夹可用')
    if (folder) await fill(destinations, folder)
    await click('收藏到此处', modalButtons)
    await gone(modal)
  }
  const folders = () => invoke('favorite_collections')
  const openFolder = (id) => choose(`[data-favorite-collection="${id}"]`)
  const favoriteCard = (kind, id) => `[data-favorite-kind="${kind}"][data-favorite-id="${id}"]`
  const openFavorites = async () => {
    await click('我的收藏', 'nav button')
    await present('main.favorites-workspace')
  }

  await start()
  await openFavorites()
  await openFolder('default')
  await contains('当前条件下没有收藏。')
  await snapshot('02-default')
  await click('新建收藏夹')
  await present(modal)
  assert.equal(await evaluate('document.activeElement.tagName'), 'INPUT')
  await fill(modal + ' input', '默认收藏夹')
  await click('保存收藏夹', modalButtons)
  await contains('已有同名收藏夹。', modal)
  await fill(modal + ' input', '数学重点题')
  await snapshot('03-create')
  await click('保存收藏夹', modalButtons)
  await gone(modal)
  await click('新建收藏夹')
  await fill(modal + ' input', '期末复习')
  await click('保存收藏夹', modalButtons)
  await gone(modal)
  const groups = await folders()
  const math = groups.find((entry) => entry.name === '数学重点题').id
  const review = groups.find((entry) => entry.name === '期末复习').id
  await openFolder(review)
  await click('上移')
  await contains('已更新收藏夹顺序。')
  assert.deepEqual((await folders()).map((x) => x.id), ['default', review, math])
  await click('重命名')
  await fill(modal + ' input', '期末练习')
  await click('保存收藏夹', modalButtons)
  await gone(modal)
  assert.equal((await folders()).find((entry) => entry.id === review).name, '期末练习')
  console.log('DEV008-T02/T03/T04: native folder form, keyboard focus, duplicate name error, reorder and rename')

  const question = 'dev008-q'
  const second = 'dev008-q2'
  const firstRevision = await invoke('create_question', { questionId: question, subjectId: 'math', contentJson: JSON.stringify(stem('收藏验收函数定义域甲')) })
  await invoke('create_question', { questionId: second, subjectId: 'math', contentJson: JSON.stringify(stem('收藏验收函数定义域乙')) })
  await click('试题检索', 'nav button')
  const firstResult = `[data-search-question-id="${question}"]`
  const secondResult = `[data-search-question-id="${second}"]`
  await present(firstResult)
  await favor('收藏试题', math, `li:has(${firstResult}) button`)
  await snapshot('04-question')
  await choose(secondResult)
  await favor('收藏试题', 'default', '.search-preview button')
  await choose(`li:has(${firstResult}) input[type=checkbox]`)
  await choose(`li:has(${secondResult}) input[type=checkbox]`)
  await click('批量收藏已选试题（2）')
  await fill(destinations, review)
  await click('收藏到此处', modalButtons)
  await gone(modal)
  await contains('已保存所选试题的收藏。')
  assert.deepEqual((await query({ collection: review })).items.map((x) => x.id).sort(), [question, second].sort())
  console.log('DEV008-T05/T11: native search result, preview, checked rows and bulk favorite')

  await click('知识库', 'nav button')
  const point = 'dev003-demo-functions'
  await choose(`[data-knowledge-id="${point}"]`)
  await favor('收藏知识点', math)
  await click('标为重点', '.knowledge-detail button')
  await contains('已标为重点。', '.knowledge-detail')
  await snapshot('06-knowledge')

  await click('试卷库', 'nav button')
  await click('导入 PDF')
  await fill('[name=title]', '原创收藏验收数学卷')
  await fill('[name=subject]', 'math')
  await fill('[name=year]', '2026')
  await fill('[name=region]', '山东')
  await click('选择本地 PDF')
  const selected = await exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    'tests/windows-pdf-dialog.ps1', '-AppProcess', String(h.pid()), '-Title', '导入试卷 PDF',
    '-Filename', resolve('output/dev007/fixtures/original.pdf')])
  console.log(selected.stdout.trim())
  const pdfReady = '[data-pdf-page="1"][data-pdf-ready=true]'
  await present(pdfReady)
  const paper = (await invoke('list_paper_records')).find((x) => x.title === '原创收藏验收数学卷')
  assert.ok(paper?.files.length === 1)
  await click('返回试卷库')
  await favor('收藏试卷', math, '.paper-library-list button')
  await snapshot('05-paper')
  console.log('DEV008-T06: standard knowledge and real Windows PDF import favorites use original resource IDs')

  await openFavorites()
  await click('全部收藏' + (await invoke('favorite_counts')).targets, '.favorite-sidebar button')
  await present(favoriteCard('paper', paper.id))
  await snapshot('01-home')
  await openFolder(math)
  const questionCard = favoriteCard('question', question)
  await present(questionCard)
  await click('标为重点', questionCard + ' button')
  await contains('已标为重点。', '.favorites-workspace')
  await snapshot('07-important')
  await fill('.favorite-filters select:first-of-type', 'paper')
  await present(favoriteCard('paper', paper.id))
  assert.equal(await evaluate("document.querySelectorAll('.favorite-item').length"), 1)
  await snapshot('08-type')
  await click('打开试卷', '.favorite-item button')
  await present(pdfReady)
  assert.equal(await evaluate("document.querySelector('[aria-label=\"PDF 版本\"]').value"), paper.files[0].id)
  await snapshot('11-open-paper')
  await openFavorites()
  assert.equal(await evaluate("document.querySelector('.favorite-filters select').value"), 'paper')
  await fill('.favorite-filters select:first-of-type', 'knowledge')
  await click('打开知识点', '.favorite-item button')
  await present(`[data-knowledge-id="${point}"][aria-pressed=true]`)
  await openFavorites()
  await fill('.favorite-filters select:first-of-type', 'question')
  await click('打开题目', questionCard + ' button')
  await contains('收藏验收函数定义域甲', '.tiptap')
  await snapshot('10-open-question')
  await openFavorites()
  await click('加入组卷', questionCard + ' button')
  await contains('已加入组卷篮 · 修订 #' + firstRevision.id, '.favorites-workspace')
  await click('自定义组卷', 'nav button')
  await click('保存组卷')
  await contains('组卷已保存。', '.composition-workspace')
  const pinned = await invoke('list_compositions')
  assert.equal(pinned.length, 1)
  const saved = await invoke('read_composition', { id: pinned[0].id })
  assert.equal(saved.items.length, 1)
  assert.equal(saved.items[0].question.revision.id, firstRevision.id)
  console.log('DEV008-T12/T13: native question editor, knowledge tree and selected PDF reopened; saved composition pins revision', firstRevision.id)

  await openFavorites()
  await click('管理此收藏', questionCard + ' button')
  await present(modal)
  await fill(destinations, 'default')
  assert.equal(await evaluate(`document.querySelectorAll('${sourceSelect}')[1].value`), math)
  await snapshot('09-transfer')
  await click('复制到目标', modalButtons)
  await gone(modal)
  assert.equal((await status(target('question', question))).collections.length, 3)
  await click('管理此收藏', questionCard + ' button')
  await present(modal)
  await fill(destinations, review)
  await click('移动到目标', modalButtons)
  await gone(modal)
  const postMove = await status(target('question', question))
  assert.deepEqual(postMove.collections.map((x) => x.id), ['default', review])
  assert.equal(postMove.important, true)
  await openFolder('default')
  await click('管理此收藏', questionCard + ' button')
  await click('取消此收藏夹中的收藏', modalButtons)
  await contains('其他收藏夹和原资源会保留。', modal)
  await click('确认取消收藏', modalButtons)
  await gone(modal)
  assert.deepEqual((await status(target('question', question))).collections.map((x) => x.id), [review])

  await openFolder(math)
  await fill('.favorite-filters select:first-of-type', '')
  await click('删除收藏夹')
  await contains('原资源及其他收藏夹会保留。', modal)
  await click('确认删除收藏夹', modalButtons)
  await gone(modal)
  assert.ok(await invoke('current_revision', { questionId: question }))
  assert.ok((await invoke('list_knowledge', { subjectId: 'math' })).some((x) => x.id === point))
  assert.equal((await invoke('list_paper_records')).find((x) => x.id === paper.id).files[0].sha256, paper.files[0].sha256)
  console.log('DEV008-T07/T09/T16: copy, move, scoped cancellation, cross-folder mark and safe folder deletion verified')

  await openFolder(review)
  await present(questionCard)
  await fill('.favorite-filters input[type=search]', '定义域乙')
  await click('搜索收藏')
  await contains('收藏验收函数定义域乙', '.favorite-item')
  await gone(questionCard)
  await fill('.favorite-filters input[type=search]', '')
  await click('搜索收藏')
  await present(questionCard)
  await evaluate(`(() => {
    const original = window.fetch
    let release
    window.fetch = async (url, request) => {
      const response = await original(url, request)
      if (String(url).endsWith('/favorite_page') && JSON.parse(request.body).query.collection === 'default') {
        await new Promise(resolve => {
          release = () => { window.fetch = original; resolve() }
        })
      }
      return response
    }
    window.dev008DelayedRead = () => !!release
    window.dev008ReleaseRead = () => release()
    return true
  })()`)
  await openFolder('default')
  await waitFor(() => evaluate('window.dev008DelayedRead()'), '默认收藏夹的响应已挂起')
  await openFolder(review)
  await present(questionCard)
  await evaluate('window.dev008ReleaseRead()')
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
  assert.equal(await evaluate(`!!document.querySelector('${questionCard}')`), true, 'late default result left current folder intact')
  console.log('DEV008-T10/T17: keyword filtering worked; an actual older IPC result released out of order did not replace the selected folder')

  const locked = spawn(python, ['tests/favorites-probe.py', 'lock', database], { stdio: ['pipe', 'pipe', 'inherit'] })
  try {
    const [ready] = await once(locked.stdout, 'data')
    assert.equal(String(ready).trim(), 'locked')
    await click('取消重点', questionCard + ' button')
    await contains('正在保存…', '.favorites-workspace')
    nativeClose()
    await present('.favorites-workspace')
    locked.stdin.end('release\n')
    await contains('已取消重点。', '.favorites-workspace')
    assert.equal((await status(target('question', question))).important, false)
  } finally {
    if (locked.exitCode === null) locked.stdin.end()
  }
  await click('标为重点', questionCard + ' button')
  await contains('已标为重点。', '.favorites-workspace')
  console.log('DEV008-T17: native WM_CLOSE while SQLite write locked; app stayed open and persisted the released write once')

  await close()
  const inspected = JSON.parse(execFileSync(python, ['tests/favorites-probe.py', 'state', database], { encoding: 'utf8' }))
  const identifier = process.env.POC001B_TEST_APP_IDENTIFIER
  const schema = identifier === 'org.shandong-study.dev010-1200ab72' ? 9
    : identifier.startsWith('org.shandong-study.dev009-') ? 8 : 7
  assert.equal(inspected.version, schema)
  assert.equal(inspected.names[1], '期末练习')
  assert.ok(inspected.relations.some((row) => row[0] === review && row[1] === question && row[2] === 1))
  await start(true)
  await openFavorites()
  await openFolder(review)
  await present(questionCard)
  await choose('.favorite-filters input[type=checkbox]')
  await present(`${questionCard} button[aria-pressed=true]`)
  assert.equal(await evaluate('navigator.onLine'), false)
  await snapshot('12-restarted')
  await close()
  console.log('DEV008-T18: clean process exit, direct SQLite verification and native offline WebView2 restart confirmed')
}

export async function favoritesPerformance(h) {
  const { evaluate, waitFor, database, start, close, pid, out } = h
  const { invoke, click, choose, present, fill } = nativeControls(h)
  const measurements = []
  for (const size of [1000, 5000]) {
    await start()
    const ids = JSON.parse(execFileSync(python, ['tests/favorites-probe.py', 'seed', database, String(size)], { encoding: 'utf8' }))
    const names = [`性能-${size}-甲`, `性能-${size}-乙`]
    for (const name of names) await invoke('change_favorite_collection', { command: { action: 'create', name } })
    const collections = (await invoke('favorite_collections')).filter((entry) => names.includes(entry.name))
    const allBefore = await invoke('favorite_counts')
    const timed = async (action) => {
      const begin = performance.now()
      await action()
      return Number((performance.now() - begin).toFixed(2))
    }
    const batch_ms = await timed(async () => {
      for (let index = 0; index < size; index += 250) {
        await invoke('change_favorites', { command: { action: 'add', collection: collections[(index / 250) % 2].id, targets: ids.slice(index, index + 250) } })
      }
    })
    execFileSync(python, ['tests/favorites-probe.py', 'merge', database, String(size)])
    const counts = await invoke('favorite_counts')
    assert.equal(counts.relations - allBefore.relations, size)
    assert.equal(counts.targets - allBefore.targets, size - 1)
    const ipc_page_ms = await timed(() => invoke('favorite_page', { query: { collection: collections[0].id } }))
    const first_paint_ms = await timed(async () => {
      await click('我的收藏', 'nav button')
      await present('.favorite-item')
    })
    const folder_ms = await timed(async () => {
      await choose(`[data-favorite-collection="${collections[0].id}"]`)
      await waitFor(() => evaluate(`document.querySelector('.favorite-list-heading h2').textContent === ${JSON.stringify(collections[0].name)}
        && document.querySelectorAll('.favorite-item').length === 20`), '收藏夹首屏')
    })
    const filter_ms = await timed(async () => {
      await fill('.favorite-filters select:first-of-type', 'question')
      await waitFor(() => evaluate("document.querySelectorAll('.favorite-item[data-favorite-kind=question]').length === 20"), '试题筛选')
    })
    const page_ms = await timed(async () => {
      const original = await evaluate("document.querySelector('.favorite-item').dataset.favoriteId")
      await click('下一页', '.favorites-workspace button')
      await waitFor(() => evaluate(`document.querySelector('.favorite-item')?.dataset.favoriteId !== ${JSON.stringify(original)}
        && document.querySelectorAll('.favorite-item').length === 20`), '下一页')
    })
    const mark_ms = await timed(async () => {
      await click('标为重点', '.favorite-item:first-child button')
      await present('.favorite-item:first-child button[aria-pressed=true]')
    })
    const memory = JSON.parse(execFileSync(python, ['tests/favorites-probe.py', 'memory', database, String(pid())], { encoding: 'utf8' }))
    const record = { schema: 7, size, batch_ms, ipc_page_ms, first_paint_ms, folder_ms, filter_ms, page_ms, mark_ms, ...memory }
    measurements.push(record)
    console.log(JSON.stringify(record))
    await click('SQLite 题库', 'nav button')
    for (const entry of collections) await invoke('change_favorite_collection', { command: { action: 'delete', id: entry.id } })
    await close()
  }
  writeFileSync(join(out, 'performance.json'), JSON.stringify(measurements, null, 2) + '\n')
}
