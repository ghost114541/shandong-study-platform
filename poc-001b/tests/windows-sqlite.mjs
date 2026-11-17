import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const probe = 'tests/sqlite-probe.py'
const python = (command, file, ...args) => execFileSync('python', [probe, command, file, ...args], { encoding: 'utf8' })

export async function sqliteRegression(harness) {
  const { out, profile, database, start, close, nativeClose, snapshot, click, send, evaluate, status, waitFor, fillFormula } = harness
  const pdf = async (revision, kind) => {
    await click(kind === 'paper' ? '题卷预览' : '答案卷预览')
    await status('正在预览 SQLite 修订 #' + revision)
    assert.ok(await evaluate("document.querySelector('.paper')?.textContent.includes('知卷试题')"))
    if (kind === 'paper') await waitFor(() => evaluate("document.querySelector('.paper img')?.naturalWidth === 170"), '题卷图片完成加载')
    await snapshot(kind + '-revision-' + revision)
    await click('导出当前 PDF')
    const name = `revision-${revision}-${kind}.pdf`
    await status(name)
    const bytes = readFileSync(join(profile, 'pdf', name))
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    writeFileSync(join(out, name), bytes)
  }
  const data = () => JSON.parse(python('read', database))
  const field = async (value) => {
    await evaluate(`(() => {
      const select = document.querySelector('.panel > .select-field select');
      select.value = ${JSON.stringify(value)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await waitFor(() => evaluate("document.querySelector('.tiptap')?.isContentEditable"), value)
  }
  const edit = async (text) => {
    await evaluate(`(() => {
      const editor = document.querySelector('.tiptap')
      editor.focus(); getSelection().selectAllChildren(editor);
    })()`)
    await send('Input.insertText', { text })
    assert.ok(await evaluate(`document.querySelector('.tiptap').textContent.includes(${JSON.stringify(text)})`), text)
  }
  const input = (label, value) => evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify('input[aria-label="' + label + '"]')});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  const assertDraftAnswer = async () => {
    assert.ok(await evaluate("document.querySelector('.tiptap').textContent.includes('修订后答案乙：纵坐标是六')"))
    assert.ok(await evaluate("document.querySelector('.status').textContent.includes('有未保存的修改')"))
  }

  await start()
  assert.deepEqual(data().questions, [])
  const subjects = await evaluate("window.__TAURI_INTERNALS__.invoke('list_subjects')")
  assert.deepEqual(subjects.filter(({ id }) => id === 'math'), [{ id: 'math', name: '数学' }])
  await click('新建试题')
  await edit('数据库原创试题：观察抛物线，写出计算过程。')
  await evaluate("getSelection().collapseToEnd()")
  await click('插入行内公式')
  await fillFormula('  y=x^2+2  ')
  await click('插入独立公式')
  await fillFormula('y(2)=2^2+2')
  const fixture = join(out, 'curve.png')
  python('picture', fixture)
  await send('DOM.enable')
  const { root } = await send('DOM.getDocument')
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
  await send('DOM.setFileInputFiles', { nodeId, files: [fixture] })
  await waitFor(() => evaluate("document.querySelector('.tiptap img[alt=\"curve.png\"]')?.naturalWidth === 170"), '真实本地图片已显示')
  await waitFor(() => evaluate("document.querySelectorAll('.tiptap .katex').length === 2"), '插入图片后保留两个公式节点')
  await click('添加小问')
  await edit('第一问：写出对称轴。')
  await input('小问 1 分值', '4')
  await field('answer:0')
  await edit('原答案甲：对称轴为纵轴。')
  await click('添加小问')
  await edit('第二问：求横坐标为二时的函数值。')
  await input('小问 2 分值', '6')
  await field('answer:1')
  await edit('原答案乙：先记录待校正数值。')
  await click('保存到 SQLite')
  await status('已保存 SQLite 修订 #')
  const first = data()
  const [question] = first.questions
  const [a] = first.revisions
  assert.equal(first.questions.length, 1)
  assert.equal(first.revisions.length, 1)
  assert.equal(a.question_id, question.id)
  assert.equal(a.base_revision_id, null)
  assert.equal(a.scope, 'user')
  assert.equal(question.subject_id, 'math')
  assert.match(question.id, /^[0-9a-f-]{36}$/)
  const source = JSON.parse(a.content_json)
  assert.equal(source.score, 10)
  assert.deepEqual(source.parts.map(({ id }) => id), first.parts.map(({ id }) => id))
  assert.deepEqual(source.parts.map(({ score }) => score), [4, 6])
  const picture = source.stem.content.find(({ type }) => type === 'image')
  const bytes = readFileSync(fixture)
  if (process.argv.includes('--stage-a')) {
    assert.equal(picture.attrs.src, 'data:image/png;base64,' + bytes.toString('base64'))
  } else {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    assert.equal(picture.attrs.src, 'attachment:sha256-' + sha256)
    assert.deepEqual(readFileSync(join(profile, 'attachments', sha256.slice(0, 2), sha256)), bytes)
  }
  assert.ok(a.content_json.includes('  y=x^2+2  '))
  assert.ok(a.content_json.includes('y(2)=2^2+2'))
  console.log('DEV002-T02 PASS: first save inserted question ' + question.id + ' with revision ' + a.id + ' and two part IDs')
  python('approve', database, String(a.id))
  await close()

  await start()
  await waitFor(() => evaluate("document.querySelector('.tiptap')?.textContent.includes('数据库原创试题')"), '重启回读已保存中文')
  assert.ok(await evaluate("document.querySelector('.review-status')?.textContent.includes('通过')"))
  await waitFor(() => evaluate("document.querySelector('.tiptap img[alt=\"curve.png\"]')?.naturalWidth === 170 && document.querySelectorAll('.tiptap .katex').length === 2"), '重启后公式及图片')
  const ipc = await evaluate(`window.__TAURI_INTERNALS__.invoke('current_revision', { questionId: ${JSON.stringify(question.id)} })`)
  assert.deepEqual(ipc.revision.content, source)
  assert.equal(ipc.review.verdict, 'passed')
  await snapshot('desktop-reopened-sqlite')
  console.log('DEV002-T03/T04 PASS: native exit, new PID, persisted LaTeX, image, scores and part IDs')
  await pdf(a.id, 'answers')
  await click('编辑试题')
  await field('answer:1')
  await edit('修订后答案乙：纵坐标是六。')

  await input('题型', '')
  await click('保存到 SQLite')
  await waitFor(() => evaluate("document.querySelector('.status [role=alert]')?.textContent.includes('无效的试题修订')"), '非法内容提示')
  await assertDraftAnswer()
  assert.equal(data().revisions.length, 1)
  await input('题型', '解答题')
  const lock = spawn('python', [probe, 'lock', database], { stdio: ['pipe', 'pipe', 'inherit'] })
  const unlocked = once(lock, 'exit')
  try {
    const [ready] = await once(lock.stdout, 'data')
    assert.equal(ready.toString().trim(), 'LOCKED')
    await click('保存到 SQLite')
    await waitFor(() => evaluate("document.querySelector('.status [role=alert]')?.textContent.includes('数据库正被占用')"), 'SQLite 忙提示', 14000)
    await assertDraftAnswer()
    assert.equal(data().revisions.length, 1)
  } finally {
    lock.stdin.end('\n')
    assert.equal((await unlocked)[0], 0)
  }
  nativeClose()
  await waitFor(() => evaluate("document.querySelector('dialog[aria-labelledby=leave-title]').open"), '未保存关闭提示')
  await click('继续编辑')
  await assertDraftAnswer()
  await click('保存到 SQLite')
  await status('已保存 SQLite 修订 #')
  const after = data()
  assert.equal(after.revisions.length, 2)
  assert.deepEqual(after.revisions[0], a)
  const b = after.revisions[1]
  assert.equal(b.base_revision_id, a.id)
  assert.equal(b.scope, 'user')
  assert.equal(b.question_id, a.question_id)
  assert.deepEqual(after.parts, first.parts)
  assert.deepEqual(after.reviews, [{ revision_id: a.id, verdict: 'passed' }])
  assert.ok(await evaluate("document.querySelector('.review-status').textContent.includes('无审核记录')"))
  const conflict = await evaluate(`window.__TAURI_INTERNALS__.invoke('save_user_revision', ${JSON.stringify({
    questionId: question.id, expectedCurrent: a.id, contentJson: a.content_json,
  })}).then(() => null, (error) => error)`)
  assert.equal(conflict.kind, 'conflict')
  assert.deepEqual(data(), after)
  console.log('DEV002-T09 PASS: invalid input and real SQLITE_BUSY kept the draft; native close prompted and retry succeeded')
  await pdf(b.id, 'paper')
  await pdf(b.id, 'answers')
  await click('编辑试题')
  await evaluate(`(() => {
    const history = document.querySelector('.revision-controls select');
    history.value = '${a.id}'; history.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await waitFor(() => evaluate("document.querySelector('.original-view') && document.querySelector('.review-status').textContent.includes('通过')"), '历史修订 A 及其审核记录')
  await snapshot('desktop-history-approved')
  await close()
  await start()
  assert.ok(await evaluate(`document.querySelector('.revision-meta').textContent.includes('修订 #${b.id} · 用户版 · 基线 #${a.id}')`))
  await field('answer:1')
  assert.ok(await evaluate("document.querySelector('.tiptap').textContent.includes('修订后答案乙')"))
  await close()
  writeFileSync(join(out, 'sqlite-evidence.json'), JSON.stringify({ first, after }, null, 2))
  console.log('DEV002-T05/T07 PASS: original JSON bytes unchanged, B based on A and unreviewed, latest user revision on restart')
  console.log('DEV002-T08: WebView2 exported database paper and both answer revisions; run check-sqlite-pdf.py')
}
