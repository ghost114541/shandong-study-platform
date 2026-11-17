import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const probe = (command, path) => execFileSync('python', ['tests/sqlite-probe.py', command, path], { encoding: 'utf8' })
const ipc = (evaluate, command, args) => evaluate(
  `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`)

export async function schemaThreeUpgrade({ database, out, start, close, evaluate, click, waitFor, snapshot: capture }) {
  const info = () => JSON.parse(probe('info', database))
  const snapshot = () => JSON.parse(probe('snapshot-v3', database))
  const original = info()
  const before = snapshot()
  assert.equal(original.version, 3)
  const legacy = before.question_revision.findLast((row) => row.content_json.includes('data:image/png;base64,'))
  assert.ok(legacy, 'expect a real DEV-004 test database with a legacy Base64 image')
  await start()
  const migrated = info()
  assert.equal(migrated.version, 4)
  assert.deepEqual(migrated.migrations.slice(0, 3), original.migrations)
  assert.deepEqual(snapshot(), before)
  const row = await ipc(evaluate, 'read_revision', { revisionId: legacy.id })
  assert.ok(row.revision.content.stem.content.some((node) => node.attrs?.src?.startsWith('data:image/png;base64,')))
  await close()
  await start()
  assert.deepEqual(info(), migrated)
  assert.deepEqual(snapshot(), before)
  await click('试题检索')
  await evaluate(`(() => {
    const box = document.querySelector('input[aria-label="题干关键词"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, '数据库原创试题');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await click('搜索试题')
  const selector = JSON.stringify(`[data-search-question-id="${legacy.question_id}"]`)
  await waitFor(() => evaluate(`document.querySelector(${selector})?.matches(':enabled') && document.querySelector('.applied-filters')?.textContent.includes('数据库原创试题')`), '检索到 DEV-004 原题')
  await evaluate(`document.querySelector(${selector}).click()`)
  await waitFor(() => evaluate("document.querySelector('.preview-stem img')?.naturalWidth === 170"), '旧内嵌 PNG 侧边预览')
  await click('打开完整试题')
  await waitFor(() => evaluate("document.querySelector('.tiptap img[alt=\"curve.png\"]')?.naturalWidth === 170"), '旧内嵌 PNG 解码')
  await capture('desktop-migrated-base64')
  await click('题卷预览')
  await waitFor(() => evaluate("document.querySelector('.paper img')?.naturalWidth === 170"), '旧内嵌 PNG 题卷')
  await click('导出当前 PDF')
  await waitFor(() => evaluate("document.querySelector('.status')?.textContent.includes('PDF 已保存')"), '旧 SQLite PDF')
  await close()
  writeFileSync(join(out, 'schema-three-upgrade.json'), JSON.stringify({
    original, migrated, preserved: Object.fromEntries(Object.entries(before).map(([name, rows]) => [name, rows.length])),
  }, null, 2))
  console.log('DEV005-T13/T14 PASS: actual Schema 3 backup migrated and reopened, old rows identical, legacy SQLite PNG previewed and printed')
}

export async function attachmentRegression({ out, profile, database, start, close, evaluate, send, click, status, waitFor, snapshot, fillFormula }) {
  const fixture = join(out, 'curve-dev005.png')
  probe('attachment-picture', fixture)
  const bytes = readFileSync(fixture)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const id = 'sha256-' + sha256
  const file = join(profile, 'attachments', sha256.slice(0, 2), sha256)
  const pick = async (selector) => {
    const element = `document.querySelector(${JSON.stringify(selector)})`
    await waitFor(() => evaluate(`!!${element} && !${element}.disabled`), selector)
    await evaluate(`${element}.click()`)
  }
  const edit = async (text) => {
    await evaluate("document.querySelector('.tiptap').focus()")
    await send('Input.insertText', { text })
  }
  const chooseFile = async () => {
    await send('DOM.enable')
    const { root } = await send('DOM.getDocument')
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
    await send('DOM.setFileInputFiles', { nodeId, files: [fixture] })
  }
  const field = async (value) => {
    await evaluate(`(() => {
      const control = document.querySelector('.panel > .select-field select');
      control.value = ${JSON.stringify(value)};
      control.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await waitFor(() => evaluate("document.querySelector('.tiptap')?.isContentEditable"), value)
  }
  const score = (index, value) => evaluate(`(() => {
    const control = document.querySelector('input[aria-label="小问 ${index} 分值"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(control, ${JSON.stringify(value)});
    control.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  const addImage = async () => {
    await chooseFile()
    await waitFor(() => evaluate("document.querySelector('.tiptap img[alt=\"curve-dev005.png\"]')?.naturalWidth === 170"), '文件选择并解码 PNG')
  }
  const holdNextImage = () => evaluate(`(() => {
    const callbacks = window.__TAURI_INTERNALS__.callbacks;
    const original = callbacks.set;
    callbacks.set = function(key, callback) {
      return original.call(this, key, (payload) => {
        if (typeof payload === 'string' && payload.startsWith('data:image/png;base64,')) {
          callbacks.set = original;
          window.releaseDev005Image = () => {
            window.releaseDev005Image = null;
            callback(payload);
          };
          return;
        }
        callback(payload);
      });
    };
  })()`)
  const waitMountedPaper = (mode) => waitFor(() => evaluate(
    `document.querySelector('.paper')?.getAttribute('aria-label') === ${JSON.stringify(mode)}`), mode)
  const waitPaperImage = () => waitFor(() => evaluate("document.querySelector('.paper img')?.naturalWidth === 170"), '纸面 PNG 已解码')
  const blocked = async (reason, destination) => {
    await click('导出当前 PDF')
    await waitFor(() => evaluate(`document.querySelector('.status [role=alert]')?.textContent.includes(${JSON.stringify(reason)})`), reason)
    assert.equal(existsSync(destination), false)
  }

  await start()
  const before = JSON.parse(probe('read', database))
  await click('新建试题')
  await edit('附件题干验证：观察曲线。')
  await click('插入行内公式')
  await fillFormula('y=x^2')
  await click('插入独立公式')
  await fillFormula(String.raw`\ce{H2 + Cl2 -> 2HCl}`)
  // A directory at the reserved staging name makes the real file operation fail.
  const staging = join(profile, 'attachments', sha256.slice(0, 2), '.' + sha256 + '.tmp')
  mkdirSync(staging, { recursive: true })
  await chooseFile()
  await waitFor(() => evaluate("document.querySelector('.status [role=alert]')?.textContent.includes('无法安全访问附件')"), '真实暂存路径写入失败')
  assert.equal(existsSync(file), false)
  assert.ok(await evaluate("document.querySelector('.tiptap')?.textContent.includes('附件题干验证')"))
  assert.equal(await evaluate("document.querySelectorAll('.tiptap .katex').length"), 2)
  rmdirSync(staging)
  await addImage()
  await click('添加小问')
  await edit('第一问：写出对称轴。')
  await score(1, '4')
  await field('answer:0')
  await edit('小问答案甲：对称轴是纵轴。')
  await click('添加小问')
  await edit('第二问：写出化学方程式。')
  await score(2, '6')
  await field('answer:1')
  await edit('小问答案乙：氢气与氯气生成氯化氢。')
  await field('answer')
  await edit('独立答案验证：查看配图。')
  await click('插入独立公式')
  await fillFormula('x=0')
  await addImage()
  await click('保存到 SQLite')
  await status('已保存 SQLite 修订 #')
  const { questions, revisions } = JSON.parse(probe('read', database))
  const question = questions.find((row) => before.questions.every((previous) => previous.id !== row.id))
  const a = revisions.find((row) => row.question_id === question.id)
  const content = JSON.parse(a.content_json)
  assert.equal(a.content_json.includes('data:image/'), false)
  assert.equal(content.stem.content.find((node) => node.type === 'image').attrs.src, 'attachment:' + id)
  assert.equal(content.answer.content.find((node) => node.type === 'image').attrs.src, 'attachment:' + id)
  assert.deepEqual(content.attachments, [{ id, media_type: 'image/png', byte_size: bytes.length, sha256 }])
  assert.deepEqual(readFileSync(file), bytes)
  const usage = await ipc(evaluate, 'check_attachment', { attachmentId: id })
  assert.equal(usage.revision_count, 1)
  assert.equal(usage.error, null)
  await close()

  await start()
  await pick(`[data-question-id="${question.id}"]`)
  await waitFor(() => evaluate("document.querySelector('.tiptap img[alt=\"curve-dev005.png\"]')?.naturalWidth === 170"), '关闭重启后回读真实 PNG')
  await snapshot('desktop-reopened-attachment')
  console.log('DEV005-T07 PASS: Windows process completely exited, reopened SQLite and decoded the same attachment id')
  const paperPath = join(profile, 'pdf', `revision-${a.id}-paper.pdf`)
  const answerPath = join(profile, 'pdf', `revision-${a.id}-answers.pdf`)
  await holdNextImage()
  await click('题卷预览')
  await waitMountedPaper('题卷')
  await waitFor(() => evaluate("!!window.releaseDev005Image && !!document.querySelector('.paper .attachment-notice')"), '真实图片 IPC 回包被暂留')
  await blocked('正在加载图片附件', paperPath)
  await evaluate('window.releaseDev005Image()')
  await waitPaperImage()
  // The DOM holds a verified copy. The backend still detects later disk corruption.
  writeFileSync(file, Buffer.alloc(bytes.length))
  await blocked('SHA-256 不匹配', paperPath)
  await click('答案卷预览')
  await waitMountedPaper('答案卷')
  await waitFor(() => evaluate("document.querySelector('.paper [role=alert]')?.textContent.includes('SHA-256 不匹配')"), '损坏附件有明确 React 提示')
  await blocked('SHA-256 不匹配', answerPath)
  unlinkSync(file)
  await click('编辑试题')
  await click('题卷预览')
  await waitFor(() => evaluate("document.querySelector('.paper [role=alert]')?.textContent.includes('文件缺失')"), '丢失附件有明确 React 提示')
  await blocked('文件缺失', paperPath)
  await snapshot('desktop-missing-attachment')
  writeFileSync(file, bytes)
  console.log('DEV005-T10/T12 PASS: pending actual IPC, corrupted bytes after DOM decode, corrupted preview, and missing file all blocked final PDF')

  for (const [mode, destination, name] of [
    ['题卷', paperPath, 'attachment-paper.pdf'], ['答案卷', answerPath, 'attachment-answers.pdf'],
  ]) {
    await click('编辑试题')
    await click(mode + '预览')
    await waitMountedPaper(mode)
    await waitPaperImage()
    await click('导出当前 PDF')
    await status('PDF 已保存')
    const pdf = readFileSync(destination)
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
    writeFileSync(join(out, name), pdf)
  }
  console.log('DEV005-T11 native exports: WebView2 saved separate paper and answer PDFs')

  await click('试题检索')
  const row = `[data-search-question-id="${question.id}"]`
  await holdNextImage()
  await pick(row)
  await waitFor(() => evaluate("!!window.releaseDev005Image && !!document.querySelector('.preview-stem .attachment-notice')"), '侧栏发起当前题图片 IPC')
  const following = await evaluate("Array.from(document.querySelectorAll('[data-search-question-id]')).find(el => el.dataset.searchQuestionId.startsWith('dev004-ui-page-'))?.dataset.searchQuestionId")
  assert.ok(following)
  await pick(`[data-search-question-id="${following}"]`)
  await waitFor(() => evaluate("document.querySelector('.preview-stem')?.textContent.includes('分页样本')"), '快速切换到另一题')
  await evaluate('window.releaseDev005Image()')
  assert.equal(await evaluate("!!document.querySelector('.preview-stem img, .preview-stem .attachment-notice')"), false)
  await pick(row)
  await waitFor(() => evaluate("document.querySelector('.preview-stem img')?.naturalWidth === 170"), '侧栏显示外部图片')
  assert.equal(await evaluate("document.querySelectorAll('.preview-stem .katex').length"), 2)
  assert.equal(await evaluate("document.querySelectorAll('.preview-stem section').length"), 2)
  assert.equal(await evaluate("!!document.querySelector('#search-preview-answer')"), false)
  await evaluate("document.querySelector('.search-layout').scrollIntoView({ block: 'start' })")
  await snapshot('desktop-attachment-preview')
  await click('展开答案')
  await waitFor(() => evaluate("document.querySelector('#search-preview-answer img')?.naturalWidth === 170"), '侧栏答案附件按需加载')
  await close()
  writeFileSync(join(out, 'attachment-evidence.json'), JSON.stringify({ questionId: question.id, revisionId: a.id, registration: usage }, null, 2))
  console.log('DEV005-T09 PASS: native advanced search rendered two formulas, two parts, and lazy answer image; late image IPC could not replace the selected question')
}
