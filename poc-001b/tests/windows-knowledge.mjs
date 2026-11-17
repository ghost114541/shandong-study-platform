import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function knowledgeRegression(harness) {
  const { start, close, click, status, evaluate, send, waitFor, snapshot, database, out } = harness
  const probe = (command, ...args) => execFileSync('python', ['tests/sqlite-probe.py', command, database, ...args], { encoding: 'utf8' })
  const select = (selector, value) => evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  const fill = (selector, value) => evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  const nodeSelect = (id) => '[data-knowledge-id="' + id + '"]'
  const readPoints = () => evaluate("window.__TAURI_INTERNALS__.invoke('list_knowledge', { subjectId: 'math' })")
  const assertSubjects = async () => {
    const rows = await evaluate("window.__TAURI_INTERNALS__.invoke('list_subjects')")
    assert.deepEqual(rows.map(({ name }) => name), ['语文', '数学', '英语', '物理', '化学', '生物', '思想政治', '历史', '地理'])
    assert.equal(rows[1].id, 'math')
  }
  const enterEditorText = async (text) => {
    await waitFor(() => evaluate("document.querySelector('.tiptap')?.isContentEditable"), '编辑器可输入')
    await evaluate("document.querySelector('.tiptap').focus()")
    await send('Input.insertText', { text })
  }
  const create = async (title, parent = '') => {
    await fill('.knowledge-form input[required]:not([type=number])', title)
    await select('.knowledge-form select', parent)
    await click('创建知识点')
    await status('已创建用户知识点')
    const result = (await readPoints()).find((node) => node.title === title)
    assert.equal(result.parent_id, parent || null)
    assert.equal(result.origin, 'user')
    return result.id
  }
  const toggle = (label) => evaluate(`document.querySelector(${JSON.stringify('button[aria-label="' + label + '"]')}).click()`)

  await start()
  await assertSubjects()
  await click('新建试题')
  await enterEditorText('桌面检索验收：求二次函数的根。')
  await select('.panel > .select-field select', 'answer')
  await enterEditorText('验收答案。')
  await click('保存到 SQLite')
  await status('已保存 SQLite 修订')
  const questionId = await evaluate("document.querySelector('[data-question-id][aria-pressed=true]').dataset.questionId")
  const first = JSON.parse(probe('read'))
  const revision = first.revisions.find((row) => row.question_id === questionId)
  assert.ok(revision)
  await waitFor(() => evaluate("document.querySelector('.review-status').textContent.includes('无审核记录')"), '无审核状态')
  probe('expire', String(revision.id))
  await click('读取当前修订')
  await waitFor(() => evaluate("document.querySelector('.review-status').textContent.includes('已过期')"), '过期审核显示')
  probe('schedule', String(revision.id))
  await click('读取当前修订')
  await waitFor(() => evaluate("document.querySelector('.review-status').textContent.includes('已过期') && !document.querySelector('.review-status').textContent.includes('有效通过')"), '未来记录不覆盖当前状态')
  console.log('DEV003-T01 desktop PASS: unreviewed, expired and future approval not applied')

  await click('知识库')
  await waitFor(() => evaluate("document.querySelectorAll('.sidebar button').length === 9 && !!document.querySelector('.knowledge-tree')"), '九学科及数学树')
  const root = await create('桌面验收分类')
  const child = await create('用户二次函数', root)
  const leaf = await create('根的判别式', child)
  await toggle('收起 桌面验收分类')
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(nodeSelect(leaf))})`), false)
  await toggle('展开 桌面验收分类')
  await evaluate(`document.querySelector(${JSON.stringify(nodeSelect(leaf))}).click()`)
  await fill('.knowledge-detail input[required]', '判别式与根')
  await click('保存名称')
  await status('已保存知识点名称')
  await fill('.knowledge-detail form:last-child input', '判别量')
  await click('保存别名')
  await status('已添加别名')
  const point = (await readPoints()).find((node) => node.id === leaf)
  assert.equal(point.title, '判别式与根')
  assert.deepEqual(point.aliases, ['判别量'])
  await snapshot('desktop-knowledge-tree')

  await click('SQLite 题库')
  await waitFor(() => evaluate(`document.querySelector('[data-question-id][aria-pressed=true]')?.dataset.questionId === ${JSON.stringify(questionId)}`), '返回当前试题')
  for (const id of [leaf, child]) {
    await waitFor(() => evaluate(`[...document.querySelectorAll('select[aria-label="关联知识点"] option')].some((item) => item.value === ${JSON.stringify(id)})`), '关联目标可用')
    await select('select[aria-label="关联知识点"]', id)
    await click('添加关联')
    await waitFor(() => evaluate("document.querySelector('.knowledge-status')?.textContent.includes('已关联知识点')"), '关联已写入')
  }
  await evaluate("Array.from(document.querySelectorAll('.question-knowledge li button')).find((item) => !item.getAttribute('aria-label').includes('判别式与根')).click()")
  await waitFor(() => evaluate("document.querySelector('.knowledge-status')?.textContent.includes('已解除知识点关联')"), '解除关联')
  await close()

  await start()
  await assertSubjects()
  await click('试题检索')
  await waitFor(() => evaluate("document.querySelector('select[aria-label=筛选学科]')?.matches(':enabled')"), '搜索界面加载')
  await select('select[aria-label=筛选学科]', 'math')
  await waitFor(() => evaluate(`[...document.querySelectorAll('select[aria-label=筛选知识点] option')].some((item) => item.value === ${JSON.stringify(root)})`), '重启后知识点存在')
  await select('select[aria-label=筛选知识点]', root)
  await fill('input[aria-label=题干关键词]', '桌面检索验收')
  await click('搜索试题')
  const hit = '[data-search-question-id="' + questionId + '"]'
  await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(hit)}) && document.querySelectorAll('[data-search-question-id]').length === 1`), '父级含后代，联合过滤命中一次')
  await snapshot('desktop-knowledge-search')
  await evaluate("document.querySelector('.search-filters input[type=checkbox]').click()")
  await click('搜索试题')
  await status('没有匹配的试题')
  await select('select[aria-label=筛选知识点]', leaf)
  await click('搜索试题')
  await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(hit)})`), '直属关联命中')
  await evaluate(`document.querySelector(${JSON.stringify(hit)}).click()`)
  if (await evaluate("document.querySelector('.search-preview') !== null")) await click('打开完整试题')
  await waitFor(() => evaluate("document.querySelector('.tiptap')?.textContent.includes('桌面检索验收') && document.querySelector('.question-knowledge')?.textContent.includes('判别式与根')"), '搜索结果打开原题及关联')
  await evaluate("document.querySelector('.question-knowledge').scrollIntoView({ block: 'nearest' })")
  await snapshot('desktop-linked-question')
  const ids = await evaluate(`window.__TAURI_INTERNALS__.invoke('question_knowledge', {questionId: ${JSON.stringify(questionId)}})`)
  assert.deepEqual(ids, [leaf])
  const last = JSON.parse(probe('read'))
  assert.deepEqual(last.revisions, first.revisions)
  writeFileSync(join(out, 'knowledge-evidence.json'), JSON.stringify({ questionId, revisionId: revision.id, root, child, leaf, ids }, null, 2))
  await close()
  console.log('DEV003-T11 PASS: created/named/aliased tree, linked/unlinked in the editor, native restart, descendant/direct search, opened same saved question')
}

export async function upgradeRegression({ out, profile, database, start, close, click, status, evaluate }) {
  const probe = (action) => JSON.parse(execFileSync('python', ['tests/sqlite-probe.py', action, database], { encoding: 'utf8' }))
  const first = probe('read')
  const original = probe('info')
  assert.equal(original.version, 1)
  assert.equal(first.questions.length, 1)
  assert.equal(first.revisions.length, 2)
  const current = first.revisions.at(-1)
  await start()
  const upgraded = probe('info')
  assert.equal(upgraded.version, 2)
  assert.deepEqual(upgraded.migrations.slice(0, 1), original.migrations)
  assert.deepEqual(probe('read'), first)
  assert.ok(await evaluate("document.querySelector('.tiptap').textContent.includes('数据库原创试题')"))
  for (const [label, kind] of [['题卷预览', 'paper'], ['答案卷预览', 'answers']]) {
    await click(label)
    await status('正在预览 SQLite 修订 #' + current.id)
    await click('导出当前 PDF')
    const filename = 'revision-' + current.id + '-' + kind + '.pdf'
    await status(filename)
    const pdf = readFileSync(join(profile, 'pdf', filename))
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
    writeFileSync(join(out, filename), pdf)
  }
  await close()
  await start()
  assert.deepEqual(probe('info'), upgraded)
  assert.deepEqual(probe('read'), first)
  await close()
  writeFileSync(join(out, 'migration-evidence.json'), JSON.stringify({ original, upgraded, preserved: first }, null, 2))
  console.log('DEV003-T10 PASS: copy of DEV-002 desktop SQLite upgraded, raw revisions/audits unchanged, PDF re-exported by original revision ID, second start idempotent')
}
