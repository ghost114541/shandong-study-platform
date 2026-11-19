import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative } from 'node:path'

function normalized(path) {
  return realpathSync.native(path).replace(/^\\\\\?\\/, '')
}

function contains(parent, child) {
  const relation = relative(normalized(parent), normalized(child))
  return !relation || (!isAbsolute(relation) && relation !== '..' && !relation.startsWith('..\\'))
}

function independent(a, b) {
  assert.ok(!contains(a, b) && !contains(b, a), 'directory trees must be independent')
}

export async function libraryRootSafety(h) {
  const { root, work, source, identifier, backup } = h
  const journalFile = join(root, 'data-protection', 'root.json')
  const originalControl = join(root, 'data-protection')
  const journal = () => JSON.parse(readFileSync(journalFile, 'utf8'))
  const snapshot = (label, path = root) => h.snap(label, normalized(path))
  const committed = async (label) => {
    const status = await h.invoke('protection_status')
    const record = journal()
    assert.equal(normalized(record.active), normalized(status.directory))
    const paths = { active: normalized(record.active), previous: record.previous && normalized(record.previous),
      candidate: record.candidate && normalized(record.candidate), control: normalized(originalControl) }
    h.state[label + '-paths'] = paths
    console.log(label, JSON.stringify(paths))
    return status
  }

  const select = async () => {
    await h.click('数据管理')
    await h.pickBackup(backup)
  }
  const preview = async () => {
    await select()
    await h.text('恢复预览', '.data-management')
    const candidate = journal().candidate
    independent(candidate, root)
    independent(candidate, originalControl)
    assert.equal(dirname(normalized(candidate)), normalized(join(dirname(root), identifier + '.knowpaper-libraries')))
    return candidate
  }
  const queue = async () => {
    await h.queueRestore()
    await h.text('已准备好切换')
  }
  const rollback = async () => {
    await h.click('数据管理')
    await h.click('回退上一次资源库')
    await h.click('确认操作')
    await h.text('已准备好切换')
    await h.stop(false)
    await h.start()
  }

  assert.ok(!existsSync(root) && !existsSync(backup), 'requires a fresh, isolated DEV-010 test identifier')
  h.python('seed', source, identifier)
  await h.start()
  const revision = (await h.invoke('current_revision', { questionId: 'dev008-q' })).revision
  const draft = {
    token: { id: 'c34f0ea7-a06c-4d12-8cf8-3ae7ad859328', sequence: 1 },
    object_type: 'question', object_id: revision.question_id, base_revision: revision.id,
    payload: { subjectId: 'math', fresh: false, content: revision.content, field: 'stem' },
    attachments: revision.content.attachments.map(({ id }) => id),
  }
  assert.equal(await h.invoke('put_draft', { draft }), true)
  const original = snapshot('default-schema9')
  await h.click('数据管理')
  await h.click('创建完整备份')
  await h.nativePick('保存知卷完整备份', backup)
  await h.text('完整备份已创建并验证')
  const big = join(work, 'beyond-volume.knowbackup')
  h.python('oversized-manifest', backup, big)
  const managed = join(dirname(root), identifier + '.knowpaper-libraries')
  const prior = existsSync(managed) ? readdirSync(managed) : []
  await h.pickBackup(big)
  await h.text('可用磁盘空间不足')
  assert.deepEqual(readdirSync(managed), prior)
  assert.ok(!existsSync(journalFile))
  console.log('Available-space precheck refused the oversized manifest before any candidate was allocated.')
  await h.stop(false)

  for (const target of ['candidate-created', 'unpack-mid', 'candidate-verified']) {
    await h.start(target)
    await select()
    await h.phase(target)
    const pending = journal()
    independent(pending.candidate, pending.active)
    independent(pending.candidate, originalControl)
    h.state[target + '-paths'] = pending
    await h.stop()
    await h.start()
    await h.text('数据操作在切换前中断')
    assert.deepEqual(snapshot('after-' + target), original)
    await h.stop(false)
  }
  await h.start()
  const future = await preview()
  h.state['verified-paths'] = journal()
  await queue()
  await h.stop(false)

  for (const target of ['before-open', 'first-open', 'startup-verified', 'before-pointer', 'after-pointer']) {
    await h.start(target, false, false)
    await h.phase(target)
    const pending = journal()
    h.state[target + '-paths'] = pending
    assert.equal(normalized(pending.active), normalized(target === 'after-pointer' ? future : root))
    await h.stop()
  }
  await h.start()
  const switched = await committed('restored-independent')
  independent(switched.directory, switched.previous)
  assert.deepEqual(snapshot('restored-tables', switched.directory), original)
  assert.deepEqual(snapshot('old-default-tables'), original)
  assert.deepEqual(await h.invoke('load_draft', { id: draft.token.id }), draft.payload)
  await h.click('数据管理')
  await h.text('旧库清理检查已拒绝')
  await h.shot('03-independent-active')
  await h.shot('04-retained-default-and-07-cleanup-refusal')
  await h.click('试题检索')
  await h.text('加入组卷')
  await h.shot('05-restored-questions')
  await h.click('我的收藏')
  await h.text('重点')
  assert.ok((await h.invoke('favorite_counts')).important > 0)
  const pinned = await h.invoke('read_composition', { id: 'a20f08a5a9c2567171f58ca111448f05' })
  assert.equal(pinned.items[0].question.revision.id, 1)
  await h.click('试卷库')
  const papers = await h.invoke('list_paper_records')
  const file = papers.find((paper) => paper.id === 'kp009-paper-000').files.find((file) => file.role === 'original')
  await h.clickElement('Array.from(document.querySelectorAll(".paper-library-list button")).find(e=>e.title==="SHA-256 ' +
    file.sha256 + '"&&e.textContent.includes("原卷"))', 'open restored PDF')
  await h.text('截取题目')
  await h.shot('10-original-pdf')

  await rollback()
  const rolled = await committed('rollback-default')
  assert.equal(normalized(rolled.directory), normalized(root))
  assert.deepEqual(snapshot('rollback-default-tables'), original)
  await h.click('数据管理')
  await h.shot('06-rollback-default')
  // Reopen so the following action starts on the editor, like a normal launch.
  await h.stop(false)
  await h.start()
  await rollback()
  const returned = await committed('reopen-managed')
  assert.equal(normalized(returned.directory), normalized(future))
  await h.click('数据管理')
  await h.text('旧库清理检查已拒绝')
  await h.shot('08-restart-correct-active')

  for (const fault of ['database', 'image', 'pdf']) {
    await h.stop(false)
    await h.start()
    const bad = await preview()
    await queue()
    await h.stop(false)
    const resources = snapshot('candidate-' + fault, bad).blobs
    if (fault === 'database') {
      writeFileSync(join(bad, 'study.sqlite3'), 'damaged synthetic candidate')
    } else {
      const name = Object.keys(resources).find((key) => key.startsWith(fault === 'image' ? 'attachments/' : 'paper-pdfs/'))
      const path = join(bad, name)
      if (fault === 'image') renameSync(path, path + '.missing-for-test')
      else {
        const bytes = readFileSync(path)
        bytes[bytes.length - 1] ^= 1
        writeFileSync(path, bytes)
      }
    }
    await h.start()
    const failure = await committed('refused-' + fault)
    assert.equal(failure.phase, 'failed')
    assert.equal(normalized(failure.directory), normalized(future))
    assert.deepEqual(snapshot('original-after-' + fault, future), original)
  }

  const destination = process.env.KNOWPAPER_DEV0101_STORAGE_TEST_PARENT
  assert.ok(destination, 'set the path of a new synthetic fixture directory on a different volume')
  mkdirSync(destination)
  await h.click('数据管理')
  await h.click('更改存储位置')
  await h.text('可用空间', 'dialog[open]')
  await h.click('确认操作')
  await h.nativePick('选择资源库的新存储位置', destination)
  await h.text('已准备好切换')
  await h.stop(false)
  await h.start()
  const moved = await committed('cross-volume')
  assert.notEqual(parse(moved.directory).root.toLowerCase(), parse(moved.previous).root.toLowerCase())
  assert.deepEqual(snapshot('cross-volume-fingerprints', moved.directory), original)
  await rollback()
  assert.equal(normalized((await h.invoke('protection_status')).directory), normalized(future))
  await h.stop(false)

  // Model a version-1 DEV-010 journal using only database and files from this test profile.
  const legacy = join(originalControl, 'restored-library-legacy')
  mkdirSync(legacy)
  h.python('copy-sqlite', join(root, 'study.sqlite3'), join(legacy, 'study.sqlite3'))
  for (const relativePath of ['attachments', 'paper-pdfs', 'questions.json']) {
    cpSync(join(root, relativePath), join(legacy, relativePath), { recursive: true, errorOnExist: true, force: false })
  }
  let layout = { version: 1, active: root, previous: null, candidate: legacy, phase: 'pending', error: null }
  cpSync(journalFile, join(work, 'before-legacy-root.json'))
  writeFileSync(journalFile, JSON.stringify(layout))
  await h.start()
  assert.equal(journal().phase, 'failed')
  assert.equal(normalized(journal().active), normalized(root))
  assert.deepEqual(snapshot('legacy-pending-refused'), original)
  await h.stop(false)

  layout = { ...layout, active: legacy, previous: root, candidate: null, phase: 'complete' }
  writeFileSync(journalFile, JSON.stringify(layout))
  await h.start()
  await h.text('检测到旧版嵌套资源库')
  await h.click('数据管理')
  await h.text('安全修复资源库布局')
  const old = await committed('legacy-nested-detected')
  assert.ok(contains(old.previous, old.directory))
  assert.deepEqual(snapshot('legacy-original', legacy), original)
  await h.shot('01-legacy-layout-detected')
  await h.click('回退上一次资源库')
  await h.click('确认操作')
  await h.text('请先在数据管理执行安全布局修复')
  const attachment = join(legacy, Object.keys(original.blobs).find((member) => member.startsWith('attachments/')))
  const movedAttachment = attachment + '.kept-by-test'
  renameSync(attachment, movedAttachment)
  try {
    await h.click('安全修复资源库布局')
    await h.text('原目录、旧库与控制日志会保留', 'dialog[open]')
    await h.shot('02-legacy-repair-confirmation')
    await h.click('确认操作')
    await h.text('无法读取已登记文件')
    assert.equal(normalized(journal().active), normalized(legacy))
  } finally {
    renameSync(movedAttachment, attachment)
  }
  await h.click('安全修复资源库布局')
  await h.click('确认操作')
  await h.text('已准备好切换')
  const repaired = journal().candidate
  independent(repaired, root)
  await h.stop(false)
  await h.start()
  const migrated = await committed('legacy-repaired')
  assert.equal(normalized(migrated.previous), normalized(legacy))
  assert.deepEqual(snapshot('legacy-repaired-tables', repaired), original)
  assert.deepEqual(snapshot('legacy-preserved-tables', legacy), original)
  await rollback()
  assert.equal(normalized((await h.invoke('protection_status')).directory), normalized(legacy))
  await rollback()
  assert.equal(normalized((await h.invoke('protection_status')).directory), normalized(repaired))
  await h.click('数据管理')
  await h.click('运行完整性检查')
  await h.text('SQLite、外键和登记文件校验通过')
  await h.shot('09-diagnostics')
  await h.stop(false)
  console.log('Native root safety acceptance completed.')
}
