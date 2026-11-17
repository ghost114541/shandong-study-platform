import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ipc = (invoke, command, args) =>
  invoke(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`)
const dataProbe = (path, command, ...args) =>
  execFileSync('python', ['tests/sqlite-probe.py', command, path, ...args], { encoding: 'utf8' })

export async function schemaTwoUpgrade({ database, out, start, close, evaluate }) {
  const probe = (command) => JSON.parse(dataProbe(database, command))
  const original = probe('info')
  assert.equal(original.version, 2)
  const before = probe('snapshot-v2')
  assert.ok(before.question_revision.length && before.verification_record.length && before.question_knowledge.length)
  await start()
  const upgraded = probe('info')
  assert.equal(upgraded.version, 3)
  assert.deepEqual(upgraded.migrations.slice(0, 2), original.migrations)
  assert.deepEqual(probe('snapshot-v2'), before)
  const sample = before.question[0].id
  const meta = await ipc(evaluate, 'question_metadata', { questionId: sample })
  assert.equal(meta.difficulty, null)
  assert.deepEqual(meta.tags, [])
  await close()
  await start()
  assert.deepEqual(probe('info'), upgraded)
  assert.deepEqual(probe('snapshot-v2'), before)
  await close()
  writeFileSync(join(out, 'schema-two-upgrade.json'), JSON.stringify({
    original, upgraded, preserved_row_counts: Object.fromEntries(Object.entries(before).map(([key, rows]) => [key, rows.length])),
  }, null, 2))
  console.log('DEV004-T02 PASS: copied actual DEV-003 schema 2 database; old tables and revision projections match on two native launches')
}

export async function advancedRegression({ database, out, start, close, click, evaluate, status, snapshot, waitFor }) {
  const before = JSON.parse(dataProbe(database, 'read'))
  const rich = before.revisions.findLast((row) => row.content_json.includes('数据库原创试题'))
  assert.ok(rich, 'run the DEV-002 SQLite regression before this suite')
  const id = rich.question_id
  const point = 'dev003-demo-quadratic'
  const hit = (id) => `[data-search-question-id="${id}"]`
  const query = (selector, value) => `document.querySelector(${JSON.stringify(selector)})${value}`
  const pick = (selector) => evaluate(query(selector, '.click()'))
  const set = (selector, value) => evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  })()`)
  const enabled = (selector) => waitFor(() => evaluate(query(selector, "?.matches(':enabled')")), selector)
  const metaStatus = (text) => waitFor(() => evaluate(query('.metadata-status', `?.textContent.includes(${JSON.stringify(text)})`)), text)

  await start()
  await pick(`[data-question-id="${id}"]`)
  await waitFor(() => evaluate("document.querySelector('.tiptap')?.textContent.includes('数据库原创试题')"), '丰富原题打开')
  await pick('.question-metadata summary')
  await enabled('select[aria-label=编辑难度]')
  await set('select[aria-label=编辑难度]', '4')
  await set('textarea[aria-label=自定义标签]', '桌面标签\n多来源用例')
  await click('保存难度与标签')
  await metaStatus('已保存难度与标签')
  for (const [title, year, region, source, pos] of [
    ['验收原卷甲', '2022', '山东', '省卷', '7'], ['验收原卷乙', '2024', '北京', '模拟', '3'],
  ]) {
    await set('.add-origin [name=title]', title)
    await set('.add-origin [name=position]', pos)
    await click('添加出处')
    await metaStatus('已添加原卷出处')
    const locate = (part) => `(() => [...document.querySelectorAll('.origin-form')].find(form => form.querySelector('h4').textContent.includes(${JSON.stringify(title)}))${part})()`
    for (const [name, val] of [['year', year], ['region', region], ['source', source]]) {
      await evaluate(locate(`.querySelector('[name=${name}]').value = ${JSON.stringify(val)}`))
    }
    await evaluate(locate(".querySelector('button').click()"))
    await metaStatus('已保存原卷本地标注')
  }
  const existing = (await ipc(evaluate, 'question_metadata', { questionId: id })).origins.find((origin) => origin.position === '7')
  await set('.add-origin [name=paper]', existing.paper_id)
  await set('.add-origin [name=position]', '8')
  await click('添加出处')
  await metaStatus('已添加原卷出处')
  const samePaper = '.origin-form[data-paper-id="' + existing.paper_id + '"]'
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(samePaper)}).length`), 1)
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(samePaper)}).querySelectorAll('li').length`), 2)
  const expected = { year: existing.year, region: existing.region, source: existing.source }
  await set(samePaper + ' [name=source]', '未保存草稿')
  await ipc(evaluate, 'save_paper_metadata', { paperId: existing.paper_id, expected, metadata: { ...expected, source: '外部更新' } })
  await pick(samePaper + ' [type=submit]')
  await waitFor(() => evaluate(query(samePaper + ' [role=alert]', "?.textContent.includes('已在别处更新')")), '原卷表单冲突')
  assert.equal(await evaluate(query(samePaper + ' [name=source]', '.value')), '未保存草稿')
  await pick(samePaper + ' [type=button]')
  await waitFor(() => evaluate(query(samePaper + ' [name=source]', "?.value === '外部更新'")), '明确重新读取')
  await set(samePaper + ' [name=source]', '省卷')
  await pick(samePaper + ' [type=submit]')
  await waitFor(async () => (await ipc(evaluate, 'question_metadata', { questionId: id })).origins.filter(
    (origin) => origin.paper_id === existing.paper_id && origin.source === '省卷').length === 2, '同卷两题位同步')
  console.log('DEV005-T01 PASS: one React paper form, two positions, stale save rejected and draft retained')
  await enabled('select[aria-label=关联知识点]')
  await set('select[aria-label=关联知识点]', point)
  await click('添加关联')
  await waitFor(() => evaluate("document.querySelector('.knowledge-status')?.textContent.includes('已关联知识点')"), '关联已保存')
  await evaluate("document.querySelector('.question-metadata').scrollIntoView({ block: 'start' })")
  await snapshot('desktop-metadata')
  await close()

  dataProbe(database, 'seed-ui')
  await start()
  const saved = await ipc(evaluate, 'question_metadata', { questionId: id })
  assert.equal(saved.difficulty, 4)
  assert.ok(saved.tags.includes('桌面标签'))
  assert.deepEqual(saved.origins.map(({ year, region, source }) => [year, region, source]), [[2024, '北京', '模拟'], [2022, '山东', '省卷'], [2022, '山东', '省卷']])
  const attachmentId = 'dev004-unresolved'
  await ipc(evaluate, 'create_question', { questionId: attachmentId, subjectId: 'math', contentJson: JSON.stringify({
    schema_version: 1, question_type: '解答题', score: 0, parts: [],
    attachments: [{ id: 'missing', media_type: 'image/png', byte_size: 68, sha256: 'de'.repeat(32) }],
    stem: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '外部附件占位验收' }] },
      { type: 'image', attrs: { src: 'attachment:missing' } },
    ] },
  }) })
  console.log('DEV004-T03 PASS: native editor saved difficulty, tags and two paper origins; re-opened values verified')
  await click('试题检索')
  await enabled('select[aria-label=筛选学科]')
  await set('select[aria-label=筛选学科]', 'math')
  await waitFor(() => evaluate("document.querySelector('select[aria-label=筛选知识点]')?.options.length > 1"), '知识点筛选就绪')
  await set('select[aria-label=筛选知识点]', point)
  await set('input[aria-label=题干关键词]', '数据库原创试题')
  await pick('.advanced-filters summary')
  for (const [label, value] of [
    ['起始年份', '2024'], ['截止年份', '2024'], ['地区', '北京'], ['来源', '模拟'], ['题型', '解答题'], ['标签', '桌面标签'],
  ]) await set(`input[aria-label=${label}]`, value)
  await set('select[aria-label=筛选难度]', '4')
  await set('select[aria-label=审核状态]', 'unreviewed')
  await click('搜索试题')
  await waitFor(() => evaluate(`document.querySelectorAll('[data-search-question-id]').length === 1 && !!${query(hit(id), '')}`), '高级组合仅命中目标题')
  const firstLoadMs = await evaluate(`new Promise((resolve, reject) => {
    const start = performance.now();
    const observer = new MutationObserver(() => {
      const stem = document.querySelector('.preview-stem');
      if (!stem) return;
      observer.disconnect();
      Promise.all([...stem.querySelectorAll('img')].map(img => img.decode())).then(() => resolve(performance.now() - start), reject);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    ${query(hit(id), '.click()')};
  })`)
  assert.ok(await evaluate("document.querySelector('.preview-stem').textContent.includes('数据库原创试题')"))
  assert.equal(await evaluate("document.querySelectorAll('.preview-stem .katex').length"), 2)
  assert.equal(await evaluate("document.querySelector('.preview-stem img').naturalWidth"), 170)
  assert.equal(await evaluate("document.querySelectorAll('.preview-stem section').length"), 2)
  assert.ok(await evaluate("document.querySelector('.search-preview').textContent.includes('演示 · 二次函数')"))
  assert.ok(await evaluate("document.querySelector('.search-preview').textContent.includes('无审核记录')"))
  assert.ok(await evaluate("document.querySelector('.search-results').textContent.includes('2024 · 北京')"))
  assert.equal(await evaluate("!!document.querySelector('#search-preview-answer')"), false)
  await evaluate("document.querySelector('.search-layout').scrollIntoView({ block: 'nearest' })")
  await snapshot('desktop-advanced-preview')
  await click('展开答案')
  await waitFor(() => evaluate("document.querySelector('#search-preview-answer')?.textContent.includes('修订后答案乙')"), '展开当前修订答案')
  await evaluate("document.querySelector('#search-preview-answer').scrollIntoView({ block: 'end' })")
  await snapshot('desktop-preview-answer')
  await click('关闭预览')
  assert.ok(await evaluate("document.querySelector('.applied-filters').textContent.includes('2024')"))
  console.log('DEV004-T08/T09 PASS: real native side panel, formulas, decoded PNG, two parts, knowledge, audit, explicit current answer reveal')

  const queryTimes = await evaluate(`(async () => {
    const measurements = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      await window.__TAURI_INTERNALS__.invoke('search_questions', { query: { page: 0, page_size: 25, descendants: true, keyword: '分页样本' } });
      measurements.push(performance.now() - start);
    }
    return measurements.sort((a,b) => a-b);
  })()`)
  console.log(`DEV004-T11 Windows small fixture: first preview through image decode ${firstLoadMs.toFixed(2)} ms; IPC n=30 p50=${((queryTimes[14]+queryTimes[15])/2).toFixed(2)} ms p95=${queryTimes[28].toFixed(2)} ms`)

  await click('清空条件')
  await enabled('input[aria-label=题干关键词]')
  await set('input[aria-label=题干关键词]', '分页样本')
  await click('搜索试题')
  await waitFor(() => evaluate("document.querySelectorAll('[data-search-question-id]').length === 25"), '第一页 25 道')
  await click('下一页')
  const slow = 'dev004-ui-page-025'
  const fast = 'dev004-ui-page-026'
  await waitFor(() => evaluate(`!!${query(hit(slow), '')} && document.querySelectorAll('[data-search-question-id]').length === 5`), '末页 5 道')
  const selectedA = await ipc(evaluate, 'current_revision', { questionId: slow })
  const revised = structuredClone(selectedA.revision.content)
  revised.stem.content[0].content[0].text = '分页样本外部产生的新修订'
  await ipc(evaluate, 'save_user_revision', {
    questionId: slow, expectedCurrent: selectedA.revision.id, contentJson: JSON.stringify(revised),
  })
  await pick(hit(slow))
  await waitFor(() => evaluate(`document.querySelector('.search-preview')?.textContent.includes('修订 #${selectedA.revision.id}')`), '预览固定到 A')
  await click('展开答案')
  assert.ok(await evaluate("document.querySelector('#search-preview-answer').textContent.includes('分页样本答案 25')"))

  console.log('DEV005-T02 PASS: SQLite advanced to B while the search preview displayed A')

  await evaluate(`(() => {
    const callbacks = window.__TAURI_INTERNALS__.callbacks;
    const existing = new Set(callbacks.keys());
    ${query(hit(slow), '.click()')};
    const key = [...callbacks.keys()].find(id => !existing.has(id));
    const original = callbacks.get(key);
    if (!original) throw new Error('cannot observe the current_revision native callback');
    callbacks.set(key, result => setTimeout(() => {
      original(result);
      window.dev004DelayedCompleted = true;
    }, 650));
    ${query(hit(fast), '.click()')};
  })()`)
  await waitFor(() => evaluate("window.dev004DelayedCompleted && document.querySelector('.preview-stem')?.textContent.includes('分页样本 26')"), '旧 IPC 响应晚于当前选择')
  assert.equal(await evaluate("!!document.querySelector('#search-preview-answer')"), false)
  await evaluate(`(() => {
    const callbacks = window.__TAURI_INTERNALS__.callbacks;
    const existing = new Set(callbacks.keys());
    ${query(hit(slow), '.click()')};
    const key = [...callbacks.keys()].find(id => !existing.has(id));
    const original = callbacks.get(key);
    if (!original) throw new Error('cannot simulate an absent revision');
    callbacks.set(key, () => original(null));
  })()`)
  await waitFor(() => evaluate("document.querySelector('.search-preview [role=alert]')?.textContent.includes('找不到搜索结果指定的修订')"), '侧边预览读取错误')
  assert.equal(await evaluate("document.querySelectorAll('[data-search-question-id]').length"), 5)
  assert.ok(await evaluate("document.querySelector('.applied-filters').textContent.includes('分页样本')"))
  await pick(hit(fast))
  await click('打开完整试题')
  await waitFor(() => evaluate("document.querySelector('.tiptap')?.textContent.includes('分页样本 26')"), '打开第 2 页试题')
  await click('试题检索')
  await waitFor(() => evaluate("document.querySelector('.search-layout')?.textContent.includes('第 2 页') && document.querySelectorAll('[data-search-question-id]').length === 5 && document.querySelector('input[aria-label=题干关键词]').value === '分页样本'"), '返回保留原分页和关键词')
  await set('input[aria-label=题干关键词]', '外部附件占位验收')
  await click('搜索试题')
  await waitFor(() => evaluate(`!!${query(hit(attachmentId), '')}`), '附件预览结果')
  await pick(hit(attachmentId))
  await waitFor(() => evaluate("document.querySelector('.preview-stem .attachment-notice')?.textContent.includes('missing') && !document.querySelector('.preview-stem img')"), '未解析附件显示提示')
  await close()
  writeFileSync(join(out, 'advanced-evidence.json'), JSON.stringify({ questionId: id, revisionId: rich.id, metadata: saved, firstLoadMs, queryTimes }, null, 2))
  console.log('DEV004-T10 PASS: page 2 preserved after full editor return; delayed native response could not replace the selected question')
}
