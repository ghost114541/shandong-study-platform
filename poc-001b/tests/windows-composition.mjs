import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const probe = (command, path, ...args) => execFileSync('python', ['tests/sqlite-probe.py', command, path, ...args], { encoding: 'utf8' })
async function ipc(evaluate, command, args = {}) {
  const result = await evaluate('window.__TAURI_INTERNALS__.invoke(' + JSON.stringify(command) + ',' + JSON.stringify(args)
    + ').then(value=>({value}),error=>({error:error?.message??String(error)}))')
  if ('error' in result) throw new Error(result.error)
  return result.value
}
const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks.map((block) => typeof block === 'string' ? p(block) : block) })
const formula = (latex) => ({ type: 'blockMath', attrs: { latex } })
const stemText = (revision) => JSON.stringify(revision.content.stem)

export async function schemaFourUpgrade({ database, out, start, close, evaluate, click, waitFor, snapshot }) {
  const info = () => JSON.parse(probe('info', database))
  const data = () => JSON.parse(probe('snapshot-v4', database))
  const original = info()
  const before = data()
  assert.equal(original.version, 4)
  assert.ok(before.attachment.length && before.revision_attachment.length)
  assert.ok(before.question_revision.length && before.verification_record.length && before.knowledge_point.length)
  const oldItem = before.composition_item.find((item) => item.composition_id === 'dev006-legacy-pin')
  assert.ok(oldItem)
  await start()
  const migrated = info()
  assert.equal(migrated.version, 5)
  assert.deepEqual(migrated.migrations.slice(0, 4), original.migrations)
  assert.deepEqual(data(), before)
  await click('自定义组卷')
  await waitFor(() => evaluate("document.querySelector('[data-composition-id=dev006-legacy-pin]')?.matches(':enabled')"), '历史组卷列表')
  await evaluate("document.querySelector('[data-composition-id=dev006-legacy-pin]').click()")
  await waitFor(() => evaluate("!!document.querySelector('.composition-items [data-revision-id]')"), '历史固定修订')
  const paper = await ipc(evaluate, 'read_composition', { id: 'dev006-legacy-pin' })
  assert.equal(paper.header.legacy, true)
  assert.equal(paper.items[0].question.revision.id, oldItem.revision_id)
  assert.equal(paper.items[0].points.score, paper.items[0].question.revision.content.score)
  await snapshot('desktop-migrated-composition')
  await close()
  await start()
  assert.deepEqual(info(), migrated)
  assert.deepEqual(data(), before)
  await close()
  writeFileSync(join(out, 'schema-four-upgrade.json'), JSON.stringify({
    original, migrated, preserved: Object.fromEntries(Object.entries(before).map(([table, rows]) => [table, rows.length])),
  }, null, 2))
  console.log('DEV006-T05/T13 PASS: actual Schema 4 backup, SQLite legacy pin and attachment relations preserved on both starts')
}

async function pauseSecondPrintTarget(port) {
  const { webSocketDebuggerUrl } = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json()
  const browser = new WebSocket(webSocketDebuggerUrl)
  const attached = []
  let serial = 0
  const pending = new Map()
  const send = (method, params, sessionId) => {
    const id = ++serial
    browser.send(JSON.stringify({ id, method, params, sessionId }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP ' + method + ' timeout')) }, 5000)
      pending.set(id, (response) => {
        clearTimeout(timer)
        if (response.error) reject(new Error(response.error.message))
        else resolve(response.result)
      })
    })
  }
  browser.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Target.attachedToTarget' && message.params.waitingForDebugger) {
      attached.push(message.params.sessionId)
      if (attached.length === 1) void send('Runtime.runIfWaitingForDebugger', {}, attached[0]).catch(() => {})
    }
    const callback = pending.get(message.id)
    pending.delete(message.id)
    callback?.(message)
  })
  await new Promise((resolve, reject) => {
    browser.addEventListener('open', resolve, { once: true })
    browser.addEventListener('error', reject, { once: true })
  })
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
    filter: [{ type: 'page', exclude: false }, { exclude: true }] })
  return { attached, close: () => browser.close() }
}

export async function compositionRegression(h) {
  const { database, out, profile, evaluate, start, close, click, waitFor, snapshot, nativeClose, port, pid } = h
  const call = (command, args) => ipc(evaluate, command, args)
  const query = (selector) => 'document.querySelector(' + JSON.stringify(selector) + ')'
  const matchingButton = (selector, text) => '[...' + query(selector) + '.querySelectorAll("button")].find(b=>b.textContent.trim()===' + JSON.stringify(text) + ')'
  const pick = async (selector, text) => {
    const element = text ? matchingButton(selector, text) : query(selector)
    await waitFor(() => evaluate(element + '?.matches(":enabled")'), selector + ' ' + (text ?? ''))
    await evaluate(element + '.click()')
  }
  const field = async (selector, value) => evaluate(
    '(() => { const box = ' + query(selector) + '; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(box, '
      + JSON.stringify(String(value)) + '); box.dispatchEvent(new Event("input", { bubbles:true })); })()',
  )
  const text = (selector) => evaluate(query(selector) + '?.innerText')
  const readyText = (selector, fragment, timeout) =>
    waitFor(async () => (await text(selector))?.includes(fragment), fragment, timeout)
  const ids = () => evaluate("[...document.querySelectorAll('.composition-items > li')].map(e=>Number(e.dataset.revisionId))")
  const savedList = () => call('list_compositions')
  const searchHit = (id) => '[data-search-question-id="' + id + '"]'
  const addFromList = (id) => pick('.search-results li:has(' + searchHit(id) + ')', '加入组卷')
  const read = (id) => call('read_composition', { id })
  const preview = (id) => call('preview_composition', { id })
  const pdfRoot = join(profile, 'pdf')
  const batches = () => existsSync(pdfRoot) ? readdirSync(pdfRoot).filter((name) => name.startsWith('composition-')).sort() : []
  const originalTitle = '知卷原创跨学科练习'
  const create = (questionId, subjectId, content) => call('create_question', {
    questionId, subjectId, contentJson: JSON.stringify(content),
  })
  const settings = { scope: '数学、物理、化学', duration_minutes: 45, gap_mm: 4, answer_space_mm: 12, groups: ['合成测试'] }
  const makeDraft = (title, revisions) => ({
    title, previous_id: null, settings,
    items: revisions.map((revision) => ({ revision_id: revision.id, points: {
      group: '合成测试', score: revision.content.score, part_scores: revision.content.parts.map(({ score }) => score),
    } })),
  })

  await start()
  const fixture = join(out, 'shared-original.png')
  probe('attachment-picture', fixture)
  const encoded = [...readFileSync(fixture)]
  const image = await evaluate('window.__TAURI_INTERNALS__.invoke("import_attachment",new Uint8Array('
    + JSON.stringify(encoded) + ').buffer,{headers:{"x-image-media-type":"image/png"}})')
  assert.match(image.id, /^sha256-/)
  const img = { type: 'image', attrs: { src: 'attachment:' + image.id, alt: '原创函数图' } }
  const blob = join(profile, 'attachments', image.sha256.slice(0, 2), image.sha256)
  const base = { schema_version: 1, parts: [], attachments: [] }
  const mathData = { ...base, question_type: '选择题', score: 4, attachments: [image],
    stem: doc('数学原题固定题干：观察函数图像，下列哪个选项正确？', formula('f(x)=x^2-2x+1'), img, '甲．顶点为原点。　乙．顶点横坐标等于一。'),
    answer: doc('数学固定答案乙'), analysis: doc('数学固定解析：配方后读取横坐标。'),
  }
  const physicalParagraphs = Array.from({ length: 34 }, (_, index) =>
    '物理记录第' + (index + 1) + '行：小车在水平实验台上运动。连续记录位置与时间，在忽略摩擦的理想模型中讨论图像。')
  const physicsData = { ...base, question_type: '解答题', score: 10, attachments: [image],
    stem: doc('物理共享材料仅此一次：小车运动实验。', img, formula('v=v_0+at'), ...physicalParagraphs),
    parts: [
      { id: 'motion-a', score: 4, prompt: doc('建立速度与时间关系。'), answer: doc('物理小问甲答案'), analysis: doc('物理小问甲解析。') },
      { id: 'motion-b', score: 6, prompt: doc('说明测量误差的来源。'), answer: doc('物理小问乙答案'),
        analysis: doc('物理小问乙解析。', ...Array.from({ length: 36 }, (_, index) =>
          '连续解析段落第' + (index + 1) + '行：比较平行测量的离散程度，并记录仪器误差。')) },
    ],
  }
  const chemistryData = { ...base, question_type: '填空题', score: 6,
    stem: doc('化学原题：填写酸碱反应中的离子产物。', formula('\\ce{HCl + NaOH -> NaCl + H2O}')),
    analysis: doc('化学解析保留：反应物中氢离子与氢氧根离子结合。'),
  }
  const math = await create('dev006-math', 'math', mathData)
  const physics = await create('dev006-physics', 'physics', physicsData)
  const chemistry = await create('dev006-chemistry', 'chemistry', chemistryData)
  const alias = await create('dev006-alias', 'math', { ...mathData, stem: doc('同一数学原题的别名。'), attachments: [] })
  const spare = await create('dev006-spare', 'math', { ...mathData, stem: doc('临时排序测试题。'), attachments: [] })
  await call('add_paper_occurrence', { questionId: chemistry.question_id, paperId: 'dev006-original-source',
    title: '原创化学练习原卷', position: '3' })

  await click('试题检索')
  await addFromList('dev006-alias')
  await readyText('.draft-indicator', '1 题')
  probe('compose-alias', database, alias.question_id, math.question_id)
  await addFromList('dev006-math')
  await readyText('.search-container [role=alert]', '逻辑题已在组卷篮中')
  assert.match(await text('.draft-indicator'), /1 题/)
  await click('自定义组卷')
  await pick('.composition-items li', '移除')
  assert.deepEqual(await ids(), [])
  await click('试题检索')
  await addFromList('dev006-math')
  await readyText('.draft-indicator', '1 题')
  await pick(searchHit('dev006-physics'))
  await readyText('.search-preview', '物理共享材料仅此一次')
  await pick('.search-preview', '加入组卷')
  await readyText('.draft-indicator', '2 题')
  await addFromList('dev006-chemistry')
  await readyText('.draft-indicator', '3 题 · 20 分')
  await snapshot('desktop-search-basket')
  await addFromList('dev006-spare')
  await readyText('.draft-indicator', '4 题 · 24 分')

  await click('自定义组卷')
  assert.deepEqual(await ids(), [math.id, spare.id, physics.id, chemistry.id])
  await pick('.composition-items li:nth-child(2)', '上移')
  assert.deepEqual(await ids(), [spare.id, math.id, physics.id, chemistry.id])
  await pick('.composition-items li:nth-child(1)', '下移')
  assert.deepEqual(await ids(), [math.id, spare.id, physics.id, chemistry.id])
  await pick('.composition-items li:nth-child(2)', '移除')
  const mathIntermediate = await call('save_user_revision', {
    questionId: math.question_id, expectedCurrent: math.id,
    contentJson: JSON.stringify({ ...mathData, stem: doc('数学新版题干不应进入原卷'), answer: doc('数学新版答案不应进入原卷') }),
  })
  assert.deepEqual(await ids(), [math.id, physics.id, chemistry.id])
  await pick('.composition-groups li:nth-child(2)', '上移分组')
  assert.deepEqual(await ids(), [physics.id, math.id, chemistry.id])
  assert.match(await text('.composition-items li:nth-child(3)'), /来源 原创化学练习原卷 · 3/)
  await field('.composition-fields label:nth-child(1) input', originalTitle)
  await field('.composition-fields label:nth-child(2) input', '数学、物理、化学')
  await field('.composition-fields label:nth-child(3) input', 45)
  await field('.composition-items li:nth-child(1) input[type=number]', 7)
  await field('.composition-items li:nth-child(2) input[type=number]', 5)
  await readyText('.composition-workspace', '总分 24 分')
  await evaluate("document.querySelector('.composition-items li:first-child summary').click()")
  await readyText('.composition-items li:first-child details', '物理共享材料仅此一次')
  await evaluate("document.querySelector('.composition-items li:first-child summary').click()")
  await click('试题检索')
  nativeClose()
  await waitFor(() => evaluate('/保留草稿|会丢弃/.test(document.querySelector("dialog[open]")?.textContent ?? "")'), '关闭时确认未保存组卷')
  await click('继续编辑')
  await click('自定义组卷')
  assert.deepEqual(await ids(), [physics.id, math.id, chemistry.id])
  await snapshot('desktop-composition-draft')
  await evaluate("document.querySelector('.composition-items').scrollIntoView({block:'start'})")
  await snapshot('desktop-composition-items')
  await click('保存组卷')
  await readyText('.composition-status', '组卷已保存')
  const saved = (await savedList()).find((paper) => paper.title === originalTitle)
  assert.ok(saved)
  const original = await read(saved.id)
  assert.deepEqual(original.items.map((item) => item.points.score), [13, 5, 6])
  assert.deepEqual(original.items[0].points.part_scores, [7, 6])
  assert.equal((await call('read_revision', { revisionId: physics.id })).revision.content.score, 10)
  assert.equal((await call('read_revision', { revisionId: physics.id })).revision.content.parts[0].score, 4)
  assert.equal(readdirSync(join(profile, 'attachments', image.sha256.slice(0, 2))).length, 1)
  await close()
  await start()
  await click('自定义组卷')
  await pick('[data-composition-id="' + saved.id + '"]')
  await readyText('.composition-workspace', '总分 24 分')
  assert.deepEqual(await read(saved.id), original)
  assert.deepEqual(await ids(), [physics.id, math.id, chemistry.id])
  await snapshot('desktop-reopened-composition')

  await click('生成双卷预览')
  await readyText('.composition-paper', '数学原题固定题干')
  await waitFor(() => evaluate("[...document.querySelectorAll('.composition-paper img')].length === 2"), '共享图片预览')
  assert.doesNotMatch(await text('.composition-paper'), /固定答案|物理小问甲解析|新版/)
  await evaluate("document.querySelector('.composition-paper').scrollIntoView({block:'start'})")
  await snapshot('desktop-paper-preview')
  await pick('.composition-workspace > section:last-child .actions', '答案解析预览')
  await readyText('.composition-paper', '数学固定答案乙')
  assert.doesNotMatch(await text('.composition-paper'), /物理共享材料|数学原题固定题干|新版/)
  await evaluate("document.querySelector('.composition-paper').scrollIntoView({block:'start'})")
  await snapshot('desktop-answers-preview')
  await click('导出双 PDF')
  await readyText('.image-warnings', '170 × 100')
  assert.equal(batches().length, 0)
  await click('确认并导出')
  await readyText('.composition-status', '双 PDF 导出成功', 50000)
  const firstBatch = batches()
  assert.equal(firstBatch.length, 1)
  for (const name of ['paper', 'answers']) {
    const bytes = readFileSync(join(pdfRoot, firstBatch[0], name + '.pdf'))
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    writeFileSync(join(out, 'composition-' + name + '.pdf'), bytes)
  }
  await evaluate("document.querySelector('.composition-status').scrollIntoView({block:'start'})")
  await snapshot('desktop-dual-export')

  const mathNew = await call('save_user_revision', {
    questionId: math.question_id, expectedCurrent: mathIntermediate.id,
    contentJson: JSON.stringify({ ...mathData, stem: doc('数学新版题干不应进入原卷'), answer: doc('数学新版答案不应进入原卷') }),
  })
  assert.deepEqual(await read(saved.id), original)
  await click('编辑为新版本')
  await pick('.composition-items li:nth-child(2)', '刷新到最新修订')
  await readyText('.composition-status', '已改用修订 #' + mathNew.id)
  assert.deepEqual(await ids(), [physics.id, mathNew.id, chemistry.id])
  await field('.composition-fields label:nth-child(1) input', originalTitle + '新版')
  await click('保存为新版本')
  await readyText('.composition-status', '组卷已保存')
  const next = (await savedList()).find((paper) => paper.previous_id === saved.id)
  assert.ok(next && next.id !== saved.id)
  assert.deepEqual(await read(saved.id), original)
  await click('复制为新组卷')
  await field('.composition-fields label:nth-child(1) input', originalTitle + '副本')
  await click('保存组卷')
  await readyText('.composition-status', '组卷已保存')
  const copy = (await savedList()).find((paper) => paper.title.endsWith('副本'))
  assert.ok(copy && !copy.previous_id && copy.id !== next.id)

  const oldPreview = await preview(saved.id)
  const other = await preview(next.id)
  assert.notEqual(oldPreview.identity, other.identity)
  assert.equal((await preview(saved.id)).identity, oldPreview.identity)
  await evaluate(`(() => {
    const callbacks = window.__TAURI_INTERNALS__.callbacks;
    const original = callbacks.set;
    callbacks.set = function(key, callback) {
      return original.call(this, key, (data) => {
        if (data?.paper?.id === ${JSON.stringify(copy.id)}) {
          callbacks.set = original;
          setTimeout(() => callback(${JSON.stringify(oldPreview)}), 200);
        } else callback(data);
      });
    };
  })()`)
  await click('生成双卷预览')
  await readyText('.composition-workspace [role=alert]', '预览响应与当前组卷不一致')
  assert.equal(await evaluate("!!document.querySelector('.composition-paper')"), false)
  await assert.rejects(call('export_composition', { id: next.id, identity: oldPreview.identity, confirmed: true }), /预览不一致/)
  await assert.rejects(call('composition_print_payload', { token: 'wrong-window' }), /打印快照只能/)
  await assert.rejects(call('composition_print_ready', { token: 'wrong-window', identity: oldPreview.paper.identity, failure: null }), /错误的窗口/)
  renameSync(blob, blob + '.backup')
  try {
    await assert.rejects(call('export_composition', { id: saved.id, identity: oldPreview.identity, confirmed: true }), /缺失|不存在|找不到/)
    const corrupt = Buffer.from(readFileSync(blob + '.backup'))
    corrupt[corrupt.length - 1] ^= 0xff
    writeFileSync(blob, corrupt)
    await assert.rejects(call('export_composition', { id: saved.id, identity: oldPreview.identity, confirmed: true }), /SHA-256/)
  } finally {
    if (existsSync(blob)) unlinkSync(blob)
    renameSync(blob + '.backup', blob)
  }
  assert.deepEqual(batches(), firstBatch)
  const again = await call('export_composition', { id: saved.id, identity: oldPreview.identity, confirmed: true })
  assert.ok(existsSync(again.paper) && existsSync(again.answers) && batches().length === 2)
  assert.equal(stemText((await read(saved.id)).items[1].question.revision), stemText(math))
  const existing = batches()
  const debug = await pauseSecondPrintTarget(port)
  try {
    const exportAttempt = assert.rejects(
      call('export_composition', { id: saved.id, identity: oldPreview.identity, confirmed: true }),
      /打印视图未就绪/,
    )
    await Promise.all([
      waitFor(() => debug.attached.length === 2, '暂停第二个原生打印视图'),
      exportAttempt,
    ])
  } finally {
    debug.close()
  }
  assert.deepEqual(batches(), existing)
  assert.ok(!readdirSync(pdfRoot).some((name) => name.startsWith('.composition-staging-')))
  renameSync(pdfRoot, pdfRoot + '.test-backup')
  try {
    writeFileSync(pdfRoot, 'Synthetic output access failure.')
    await assert.rejects(call('export_composition', { id: saved.id, identity: oldPreview.identity, confirmed: true }), /无法创建 PDF 导出目录/)
  } finally {
    if (existsSync(pdfRoot)) unlinkSync(pdfRoot)
    renameSync(pdfRoot + '.test-backup', pdfRoot)
  }
  assert.deepEqual(batches(), existing)
  console.log('DEV006-T12 PASS: stale response, wrong window, suspended second view and output access failure produced no partial batch')
  console.log('DEV006-T01-T04/T06-T09/T11: native basket, duplicate, pins, points, restart, versions, dual PDFs, and blocked damaged images exercised')

  const rows = []
  for (let i = 0; i < 50; i++) {
    rows.push(await create('dev006-perf-' + i, ['math', 'physics', 'chemistry'][i % 3], {
      ...base, question_type: '解答题', score: 5, attachments: [image],
      stem: doc('合成性能题目' + (i + 1), formula(i % 3 === 2 ? '\\ce{HCl + NaOH -> NaCl + H2O}' : '\\frac{a^2+b^2}{2}'), img,
        ...physicalParagraphs.slice(0, 8)), answer: doc('合成答案' + (i + 1)), analysis: doc(...physicalParagraphs.slice(0, 4)),
    }))
  }
  const metrics = []
  for (const size of [10, 30, 50]) {
    const stored = await call('save_composition', { draft: makeDraft('性能组卷' + size, rows.slice(0, size)) })
    const elapsed = async (task) => {
      const before = performance.now()
      const value = await task()
      return [Math.round(performance.now() - before), value]
    }
    await pick('[data-composition-id="' + copy.id + '"]')
    // A fresh list load makes directly seeded performance compositions visible.
    await click('试题检索')
    await click('自定义组卷')
    const [loadMs] = await elapsed(async () => {
      await pick('[data-composition-id="' + stored.header.id + '"]')
      await waitFor(async () => (await ids()).length === size, '性能组卷加载 ' + size)
    })
    const [previewMs] = await elapsed(async () => {
      await click('生成双卷预览')
      await waitFor(() => evaluate('[...document.querySelectorAll(".composition-paper img")].filter(i=>i.complete && i.naturalWidth).length === ' + size), '性能预览 ' + size, 30000)
    })
    const identity = (await preview(stored.header.id)).identity
    const [exportMs, output] = await elapsed(() => call('export_composition', { id: stored.header.id, identity, confirmed: true }))
    const memory = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
      '$taskPid=' + pid() + '; $children=@(Get-CimInstance Win32_Process); $ids=@($taskPid); for($i=0;$i -lt $ids.Count;$i++){ $ids+=@($children | Where-Object ParentProcessId -eq $ids[$i] | Select-Object -ExpandProperty ProcessId) }; $p=Get-Process -Id $ids -ErrorAction SilentlyContinue; @{ appMiB=[Math]::Round(($p | Where-Object Id -eq $taskPid).WorkingSet64 / 1MB,1); familyMiB=[Math]::Round(($p | Measure-Object WorkingSet64 -Sum).Sum / 1MB,1)} | ConvertTo-Json -Compress'],
    { encoding: 'utf8' }))
    assert.ok(existsSync(output.paper) && existsSync(output.answers))
    metrics.push({ size, loadMs, previewMs, exportMs, ...memory })
  }
  writeFileSync(join(out, 'performance.json'), JSON.stringify(metrics, null, 2))
  console.log('DEV006-T14 native debug build observations', JSON.stringify(metrics))
  await close()
}
