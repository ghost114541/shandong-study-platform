import { useEffect, useLayoutEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { QuestionEditor } from './editor'
import type { ConfirmLeave, ReportGuard } from './leave-guard'
import { CONTENT_VERSION, revisionToPaper } from './model'
import type { PaperData, RevisionContent, RichDocument } from './model'
import { Content, Paper } from './paper'
import { QuestionKnowledge } from './question-knowledge'
import { describeError, sqlite } from './sqlite-api'
import type { QuestionSummary, RevisionDetail, RevisionSummary, Subject } from './sqlite-api'

type Mode = 'paper' | 'answers'
type Field = 'stem' | 'answer' | `prompt:${number}` | `answer:${number}`
type View = 'current' | 'original' | number
interface Selection {
  questionId: string
  subjectId: string
  detail: RevisionDetail | null
  view: View
  fresh: boolean
}

const blank: RichDocument = { type: 'doc', content: [{ type: 'paragraph' }] }
const emptyRevision: RevisionContent = {
  schema_version: CONTENT_VERSION, question_type: '解答题', score: 0,
  stem: blank, answer: null, analysis: null, attachments: [], parts: [],
}

function targetPart(field: Field): { index: number; key: 'prompt' | 'answer' } {
  const [key, index] = field.split(':')
  return { index: Number(index), key: key === 'prompt' ? 'prompt' : 'answer' }
}

function activeDocument(content: RevisionContent, field: Field): RichDocument {
  if (field === 'stem' || field === 'answer') return content[field] ?? blank
  const { index, key } = targetPart(field)
  return content.parts[index]?.[key] ?? blank
}

function reviewStatus({ review, review_status }: RevisionDetail): string {
  const label = {
    unreviewed: '无审核记录', scheduled: '审核尚未生效', passed: '有效通过',
    expired: '已过期', disputed: '争议', failed: '不通过',
  }[review_status]
  return review
    ? [label, review.reviewer, review.checked_on, review.expires_on && '有效至 ' + review.expires_on].filter(Boolean).join(' · ')
    : label
}

export function SQLiteWorkspace({ reportGuard, confirmLeave, initialQuestion }: {
  reportGuard: ReportGuard
  confirmLeave: ConfirmLeave
  initialQuestion?: QuestionSummary
}) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [newSubject, setNewSubject] = useState('')
  const [questions, setQuestions] = useState<QuestionSummary[]>([])
  const [history, setHistory] = useState<RevisionSummary[]>([])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [draft, setDraft] = useState(emptyRevision)
  const [field, setField] = useState<Field>('stem')
  const [editorGeneration, setEditorGeneration] = useState(0)
  const [busy, setBusy] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<{ data: PaperData; revisionId: number; mode: Mode } | null>(null)
  const revisionId = selection?.detail?.revision.id ?? null
  const readOnly = selection?.view !== 'current'
  const subjectName = (id: string) => subjects.find((subject) => subject.id === id)?.name ?? id

  useLayoutEffect(() => reportGuard(dirty, busy), [reportGuard, dirty, busy])

  useEffect(() => {
    if (revisionId === null) return
    let day = new Date().toISOString().slice(0, 10)
    let active = true
    const refresh = () => {
      const requestedDay = new Date().toISOString().slice(0, 10)
      void sqlite.review(revisionId).then((evaluation) => {
        if (!active) return
        day = requestedDay
        setSelection((previous) => previous?.detail?.revision.id === revisionId
          ? { ...previous, detail: { ...previous.detail, ...evaluation } } : previous)
      }).catch(() => { /* Keep the loaded record if background refresh fails. */ })
    }
    const timer = window.setInterval(() => {
      if (day !== new Date().toISOString().slice(0, 10)) refresh()
    }, 60_000)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [revisionId])

  function reset(next: Selection, revisions: RevisionSummary[]) {
    setSelection(next)
    setHistory(revisions)
    setDraft(next.detail?.revision.content ?? emptyRevision)
    setDirty(next.fresh)
    setField('stem')
    setEditorGeneration((generation) => generation + 1)
    setPreview(null)
  }

  async function load(question: QuestionSummary, view: View) {
    const [detail, revisions] = await Promise.all([
      view === 'current' ? sqlite.current(question.id)
        : view === 'original' ? sqlite.original(question.id) : sqlite.revision(view),
      sqlite.revisions(question.id),
    ])
    if (!detail && view === 'original') throw new Error('这道题没有公共原版。')
    if (detail && detail.revision.question_id !== question.id) throw new Error('该修订属于另一道试题。')
    if (!detail && typeof view === 'number') throw new Error('该历史修订不存在。')
    reset({ questionId: question.id, subjectId: question.subject_id, detail, view, fresh: false }, revisions)
  }

  useEffect(() => {
    void Promise.all([sqlite.subjects(), sqlite.questions()]).then(async ([allSubjects, allQuestions]) => {
      setSubjects(allSubjects)
      setNewSubject((allSubjects.find((subject) => subject.name === '数学') ?? allSubjects[0])?.id ?? '')
      const target = initialQuestion ?? allQuestions[0]
      const list = initialQuestion && !allQuestions.some((question) => question.id === initialQuestion.id)
        ? [initialQuestion, ...allQuestions].slice(0, 25) : allQuestions
      setQuestions(list)
      if (target) await load(target, 'current')
    }).catch((err: unknown) => setError('无法打开 SQLite 工作区：' + describeError(err)))
      .finally(() => setBusy(false))
  }, [])

  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setMessage('')
    try { await action() }
    catch (err) { setError(describeError(err)) }
    finally { setBusy(false) }
  }

  function open(question: QuestionSummary, view: View = 'current') {
    confirmLeave(() => void perform(() => load(question, view)))
  }

  function viewRevision(view: View) {
    if (!selection || selection.fresh) return
    open({ id: selection.questionId, subject_id: selection.subjectId, current_revision_id: revisionId }, view)
  }

  function newQuestion() {
    confirmLeave(() => {
      setError('')
      setMessage('')
      reset({ questionId: crypto.randomUUID(), subjectId: newSubject, detail: null, view: 'current', fresh: true }, [])
    })
  }

  function update(transform: (previous: RevisionContent) => RevisionContent) {
    setDraft(transform)
    setDirty(true)
    setError('')
    setMessage('')
  }

  function addPart() {
    const id = crypto.randomUUID()
    update((previous) => {
      const score = previous.parts.length ? 0 : previous.score
      return { ...previous, parts: [...previous.parts, { id, score, prompt: blank, answer: null, analysis: null }] }
    })
    setField(`prompt:${draft.parts.length}`)
  }

  function updatePartScore(index: number, score: number) {
    update((previous) => {
      const parts = previous.parts.map((part, i) => i === index ? { ...part, score } : part)
      return { ...previous, parts, score: parts.reduce((sum, part) => sum + part.score, 0) }
    })
  }

  function updateDocument(doc: RichDocument) {
    update((previous) => {
      if (field === 'stem' || field === 'answer') return { ...previous, [field]: doc }
      const { index, key } = targetPart(field)
      return { ...previous, parts: previous.parts.map((part, i) => i === index ? { ...part, [key]: doc } : part) }
    })
  }

  async function save() {
    if (!selection || readOnly || !dirty) return
    const revision = await sqlite.save(selection.questionId, selection.subjectId, selection.fresh, revisionId, draft)
    setSelection({ ...selection, detail: { revision, review: null, review_status: 'unreviewed' }, fresh: false })
    setDraft(revision.content)
    setDirty(false)
    setHistory([revision, ...history])
    setQuestions([{ id: revision.question_id, subject_id: selection.subjectId, current_revision_id: revision.id },
      ...questions.filter((question) => question.id !== revision.question_id)].slice(0, 25))
    setMessage('已保存 SQLite 修订 #' + revision.id)
  }

  async function openPreview(mode: Mode) {
    if (!selection || revisionId === null || dirty) return
    const saved = await sqlite.revision(revisionId)
    if (saved?.revision.question_id !== selection.questionId) throw new Error('找不到预览所引用的已保存修订。')
    setPreview({ mode, revisionId, data: revisionToPaper(saved.revision.content, subjectName(selection.subjectId)) })
    setMessage('正在预览 SQLite 修订 #' + revisionId)
  }

  async function exportPdf() {
    if (!preview) return
    if (document.querySelector('.paper .attachment-notice')) throw new Error('预览中有文件未验证的附件，无法导出完整 PDF。')
    await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.paper img')).map((img) => img.decode()
      .catch(() => { throw new Error('预览中有图片无法解码，无法导出完整 PDF。') })))
    await document.fonts.ready
    const path = await invoke<string>('export_pdf', { kind: preview.mode, longSample: false, revisionId: preview.revisionId })
    setMessage('PDF 已保存到 ' + path)
  }

  return <>
    <header className="app-header">
      <div><h1>知卷</h1><p>本地 SQLite 题库</p></div>
      <button className="primary" disabled={busy || readOnly || !dirty} onClick={() => void perform(save)}>保存到 SQLite</button>
    </header>
    <main>
      <nav className="mode-bar" aria-label="题卷与答案">
        <div className="actions">
          <button aria-pressed={!preview} disabled={busy} onClick={() => { setPreview(null); setMessage(''); setError('') }}>编辑试题</button>
          <button aria-pressed={preview?.mode === 'paper'} disabled={busy || dirty || revisionId === null} onClick={() => void perform(() => openPreview('paper'))}>题卷预览</button>
          <button aria-pressed={preview?.mode === 'answers'} disabled={busy || dirty || revisionId === null} onClick={() => void perform(() => openPreview('answers'))}>答案卷预览</button>
        </div>
        {preview && <button className="primary" disabled={busy} onClick={() => void perform(exportPdf)}>导出当前 PDF</button>}
      </nav>
      <div className="status" aria-live="polite">
        {error && <p role="alert">{error}</p>}
        <p>{busy ? '正在处理…' : message || (dirty ? '有未保存的修改。' : '')}</p>
      </div>
      {preview ? <Paper data={preview.data} answer={preview.mode === 'answers'} /> : <div className="workspace">
        <aside className="sidebar">
          <h2>最近试题</h2>
          <label className="select-field">学科<select value={newSubject} disabled={busy} onChange={(event) => setNewSubject(event.target.value)}>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select></label>
          <button disabled={busy || !newSubject} onClick={newQuestion}>新建试题</button>
          {questions.map((question) => <button key={question.id} title={question.id} data-question-id={question.id}
            disabled={busy} aria-pressed={selection?.questionId === question.id} onClick={() => open(question)}>
            <span>{subjectName(question.subject_id)} · {question.id.slice(0, 8)}</span>
          </button>)}
        </aside>
        {selection ? <section className="panel">
          <h2>{subjectName(selection.subjectId)} · {draft.question_type || '未填写题型'}</h2>
          <p className="revision-meta">{selection.fresh ? '新试题' : revisionId === null ? '尚无修订'
            : `修订 #${revisionId} · ${selection.detail?.revision.scope === 'public' ? '公共版' : '用户版'}`
              + (selection.detail?.revision.base_revision_id != null ? ' · 基线 #' + selection.detail.revision.base_revision_id : '')}
          </p>
          {!selection.fresh && <div className="actions revision-controls">
            <button disabled={busy} onClick={() => viewRevision('current')}>读取当前修订</button>
            <button disabled={busy || !history.some((item) => item.scope === 'public')} onClick={() => viewRevision('original')}>查看公共原版</button>
            <label className="select-field">历史修订<select disabled={busy} value={typeof selection.view === 'number' ? selection.view : ''}
              onChange={(event) => { if (event.target.value) viewRevision(Number(event.target.value)) }}>
              <option value="">选择修订</option>
              {history.map((item) => <option key={item.id} value={item.id}>#{item.id} · {item.scope === 'public' ? '公共' : '用户'}</option>)}
            </select></label>
          </div>}
          {selection.detail && <p className="review-status">答案审核记录 · {reviewStatus(selection.detail)}</p>}
          {readOnly && <p>历史与公共原版视图为只读。可返回当前修订继续编辑。</p>}
          <fieldset className="question-fields" disabled={busy || readOnly}>
            <label>题型 <input aria-label="题型" value={draft.question_type} onChange={(event) => {
              const question_type = event.target.value
              update((previous) => ({ ...previous, question_type }))
            }} /></label>
            <label>整题分值 <input aria-label="整题分值" type="number" min={0} max={0xffffffff} step={1}
              value={draft.score} readOnly={Boolean(draft.parts.length)} onChange={(event) => {
                const score = event.target.valueAsNumber
                if (Number.isFinite(score)) update((previous) => ({ ...previous, score }))
              }} /></label>
            <button onClick={addPart}>添加小问</button>
            {draft.parts.map((part, index) => <label key={part.id}>小问 {index + 1} 分值 <input aria-label={`小问 ${index + 1} 分值`}
              type="number" min={0} max={0xffffffff} step={1} value={part.score} onChange={(event) => {
                const score = event.target.valueAsNumber
                if (Number.isFinite(score)) updatePartScore(index, score)
              }} /></label>)}
          </fieldset>
          <label className="select-field">编辑内容<select value={field} disabled={busy} onChange={(event) => setField(event.target.value as Field)}>
            <option value="stem">整题题干</option>
            <option value="answer">整题答案</option>
            {draft.parts.flatMap((part, index) => [
              <option key={part.id + '-prompt'} value={'prompt:' + index}>小问 {index + 1} · 题干</option>,
              <option key={part.id + '-answer'} value={'answer:' + index}>小问 {index + 1} · 答案</option>,
            ])}
          </select></label>
          {readOnly ? <div className="original-view"><Content data={activeDocument(draft, field)} /></div>
            : <div inert={busy}><QuestionEditor key={editorGeneration + ':' + revisionId + ':' + field}
              content={activeDocument(draft, field)} onChange={updateDocument} onError={setError} /></div>}
          {!selection.fresh && <QuestionKnowledge key={selection.questionId} questionId={selection.questionId}
            subjectId={selection.subjectId} editable={!busy && !readOnly} />}
        </section> : <section className="panel"><p>{busy ? '正在读取试题…' : '选择一道试题，或新建试题。'}</p></section>}
      </div>}
    </main>
  </>
}
