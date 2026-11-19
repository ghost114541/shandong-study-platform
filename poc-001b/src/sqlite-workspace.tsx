import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { protection } from './data-protection-api'
import type { DraftContent, DraftRecord, DraftToken } from './data-protection-api'
import { useAutosave } from './use-autosave'
import { TrashButton } from './trash-button'
import { FavoriteControl } from './favorite-controls'
import { invoke } from '@tauri-apps/api/core'
import { QuestionEditor } from './editor'
import { AttachmentDeclarations } from './attachment-image'
import type { ConfirmLeave, ReportGuard } from './leave-guard'
import { CONTENT_VERSION, referencedAttachments, revisionToPaper } from './model'
import type { Attachment, PaperData, RevisionContent, RichDocument } from './model'
import { Content, Paper } from './paper'
import { QuestionKnowledge } from './question-knowledge'
import { QuestionMetadataPanel } from './question-metadata'
import { PaperLocations } from './paper-locations'
import type { ReaderTarget, ScreenshotDraft } from './paper-reader-api'
import { describeError, reviewStatusLabel, sqlite } from './sqlite-api'
import type { QuestionSummary, RevisionDetail, RevisionSummary, Subject } from './sqlite-api'

type Mode = 'paper' | 'answers'
type Field = 'stem' | 'answer' | 'analysis' | `prompt:${number}` | `answer:${number}`
type View = 'current' | 'original' | number
interface QuestionDraftState {
  subjectId: string
  fresh: boolean
  content: RevisionContent
  field: Field
  screenshot?: ScreenshotDraft
}
interface Selection {
  questionId: string
  subjectId: string
  detail: RevisionDetail | null
  view: View
  fresh: boolean
  screenshot?: ScreenshotDraft
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
  if (field === 'stem' || field === 'answer' || field === 'analysis') return content[field] ?? blank
  const { index, key } = targetPart(field)
  return content.parts[index]?.[key] ?? blank
}

export function SQLiteWorkspace({ reportGuard, confirmLeave, initialQuestion, initialDraft, recovered, returnReader, openReader, onTrashed }: {
  reportGuard: ReportGuard
  confirmLeave: ConfirmLeave
  initialQuestion?: QuestionSummary
  initialDraft?: ScreenshotDraft
  recovered?: DraftRecord
  returnReader?: ReaderTarget
  openReader: (target: ReaderTarget) => void
  onTrashed: () => void
}) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [newSubject, setNewSubject] = useState('')
  const [questions, setQuestions] = useState<QuestionSummary[]>([])
  const [history, setHistory] = useState<RevisionSummary[]>([])
  const [returnFromQuestion, setReturnFromQuestion] = useState(initialQuestion?.id)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [draft, setDraft] = useState(emptyRevision)
  const [field, setField] = useState<Field>('stem')
  const [editorGeneration, setEditorGeneration] = useState(0)
  const [busy, setBusy] = useState(true)
  const [importing, setImporting] = useState(false)
  const blocked = busy || importing
  const [dirty, setDirty] = useState(false)
  const [identity, setIdentity] = useState<DraftToken>(() => ({ id: crypto.randomUUID(), sequence: 0 }))
  const [draftConflict, setDraftConflict] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<{ data: PaperData; attachments: Attachment[]; revisionId: number; mode: Mode } | null>(null)
  const revisionId = selection?.detail?.revision.id ?? null
  const readOnly = selection?.view !== 'current'
  const subjectName = (id: string) => subjects.find((subject) => subject.id === id)?.name ?? id

  const snapshot = useMemo<DraftContent | null>(() => dirty && selection && !readOnly ? {
    object_type: 'question',
    object_id: selection.questionId,
    base_revision: revisionId,
    payload: { subjectId: selection.subjectId, fresh: selection.fresh, screenshot: selection.screenshot, field, content: draft },
    attachments: referencedAttachments(draft).map(({ id }) => id),
  } : null, [dirty, readOnly, selection?.questionId, selection?.subjectId, selection?.fresh, selection?.screenshot, revisionId, field, draft])
  const autosave = useAutosave(identity, snapshot)
  useLayoutEffect(() => reportGuard(dirty, blocked, dirty ? autosave : undefined))

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
    setIdentity({ id: crypto.randomUUID(), sequence: 0 })
    setDraftConflict(false)
    setHistory(revisions)
    const captures = next.screenshot?.attachments
    if (captures) {
      setDraft({
        ...emptyRevision,
        attachments: [...new Map(captures.map((item) => [item.id, item])).values()],
        stem: { type: 'doc', content: [{ type: 'paragraph' }, ...captures.map((item, index) => ({
          type: 'image' as const, attrs: { src: 'attachment:' + item.id, alt: '原卷截图 ' + (index + 1) },
        }))] },
      })
    } else setDraft(next.detail?.revision.content ?? emptyRevision)
    setDirty(next.fresh)
    setField('stem')
    setEditorGeneration((generation) => generation + 1)
    setPreview(null)
  }

  async function load(question: QuestionSummary, view: View, pinned?: number) {
    let [detail, revisions] = await Promise.all([
      view === 'current' ? sqlite.current(question.id)
        : view === 'original' ? sqlite.original(question.id) : sqlite.revision(view),
      sqlite.revisions(question.id),
    ])
    if (pinned !== undefined && view === 'current' && detail?.revision.id !== pinned) {
      view = pinned
      detail = await sqlite.revision(pinned)
    }
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
      if (recovered) {
        const data = await protection.load<QuestionDraftState>(recovered.id)
        const [detail, revisions, current] = await Promise.all([
          recovered.base_revision === null ? null : sqlite.revision(recovered.base_revision),
          data.fresh ? [] : sqlite.revisions(recovered.object_id),
          sqlite.current(recovered.object_id),
        ])
        setIdentity({ id: recovered.id, sequence: recovered.sequence })
        setSelection({ questionId: recovered.object_id, subjectId: data.subjectId,
          detail, view: 'current', fresh: data.fresh, screenshot: data.screenshot })
        setHistory(revisions)
        setDraft(data.content)
        setField(data.field)
        setDraftConflict(recovered.conflict || (current?.revision.id ?? null) !== recovered.base_revision)
        setDirty(true)
        setMessage('已恢复试题草稿。')
      } else if (initialDraft) {
        const questionId = crypto.randomUUID()
        setReturnFromQuestion(questionId)
        reset({ questionId, subjectId: initialDraft.subjectId, detail: null, view: 'current',
          fresh: true, screenshot: initialDraft }, [])
      } else if (target) await load(target, 'current', initialQuestion?.current_revision_id ?? undefined)
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

  function updateDocument(doc: RichDocument, imported?: Attachment) {
    update((previous) => {
      const attachments = imported && !previous.attachments.some((item) => item.id === imported.id)
        ? [...previous.attachments, imported] : previous.attachments
      if (field === 'stem' || field === 'answer' || field === 'analysis') return { ...previous, attachments, [field]: doc }
      const { index, key } = targetPart(field)
      return { ...previous, attachments, parts: previous.parts.map((part, i) => i === index ? { ...part, [key]: doc } : part) }
    })
  }

  async function save() {
    if (!selection || readOnly || !dirty || draftConflict) return
    const revision = await sqlite.save(selection.questionId, selection.subjectId, selection.fresh, revisionId,
      { ...draft, attachments: referencedAttachments(draft) }, selection.screenshot?.link, autosave.token())
    setSelection({ ...selection, detail: { revision, review: null, review_status: 'unreviewed' }, fresh: false })
    setDraft(revision.content)
    setIdentity({ id: crypto.randomUUID(), sequence: 0 })
    setDirty(false)
    setHistory([revision, ...history])
    setQuestions([{ id: revision.question_id, subject_id: selection.subjectId, current_revision_id: revision.id },
      ...questions.filter((question) => question.id !== revision.question_id)].slice(0, 25))
    setMessage('已保存 SQLite 修订 #' + revision.id)
  }

  async function acceptNewBase() {
    if (!selection || !window.confirm('以当前修订为新基线继续编辑？请先核对最新修订。草稿保留，正式保存时会创建新修订。')) return
    const detail = await sqlite.current(selection.questionId)
    if (!detail) throw new Error('找不到当前修订。请保留草稿。')
    setSelection({ ...selection, detail, fresh: false })
    setDraftConflict(false)
  }

  function afterTrash() {
    setSelection(null)
    setHistory([])
    onTrashed()
    void perform(async () => setQuestions(await sqlite.questions()))
  }

  async function openPreview(mode: Mode) {
    if (!selection || revisionId === null || dirty) return
    const saved = await sqlite.revision(revisionId)
    if (saved?.revision.question_id !== selection.questionId) throw new Error('找不到预览所引用的已保存修订。')
    setPreview({ mode, revisionId, attachments: saved.revision.content.attachments, data: revisionToPaper(saved.revision.content, subjectName(selection.subjectId)) })
    setMessage('正在预览 SQLite 修订 #' + revisionId)
  }

  async function exportPdf() {
    if (!preview) return
    const attachmentIssue = document.querySelector('.paper .attachment-notice')
    if (attachmentIssue) throw new Error('无法导出 PDF。' + attachmentIssue.textContent)
    await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.paper img')).map((img) => img.decode()
      .catch(() => { throw new Error('预览中有图片无法解码，无法导出完整 PDF。') })))
    await document.fonts.ready
    const path = await invoke<string>('export_pdf', { kind: preview.mode, longSample: false, revisionId: preview.revisionId })
    setMessage('PDF 已保存到 ' + path)
  }

  return <>
    <header className="app-header">
      <div><h1>知卷</h1><p>本地 SQLite 题库</p></div>
      <button className="primary" disabled={blocked || readOnly || !dirty || draftConflict} onClick={() => void perform(save)}>保存到 SQLite</button>
    </header>
    <main>
      <nav className="mode-bar" aria-label="题卷与答案">
        <div className="actions">
          <button aria-pressed={!preview} disabled={blocked} onClick={() => { setPreview(null); setMessage(''); setError('') }}>编辑试题</button>
          <button aria-pressed={preview?.mode === 'paper'} disabled={blocked || dirty || revisionId === null} onClick={() => void perform(() => openPreview('paper'))}>题卷预览</button>
          <button aria-pressed={preview?.mode === 'answers'} disabled={blocked || dirty || revisionId === null} onClick={() => void perform(() => openPreview('answers'))}>答案卷预览</button>
        </div>
        {preview && <button className="primary" disabled={blocked} onClick={() => void perform(exportPdf)}>导出当前 PDF</button>}
      </nav>
      <div className="status" aria-live="polite">
        {error && <p role="alert">{error}</p>}
        <p>{busy ? '正在处理…' : message || (dirty ? '有未保存的修改。' : '')}</p>
        {dirty && <p role="status">{autosave.status}</p>}
        {draftConflict && <div role="alert">
          <p>当前试题修订已变化。请保留草稿并核对最新版本。</p>
          <button disabled={blocked} onClick={() => void perform(acceptNewBase)}>确认使用最新修订作为基线</button>
        </div>}
      </div>
      {preview ? <AttachmentDeclarations.Provider key={preview.mode + preview.revisionId} value={preview.attachments}>
        <Paper data={preview.data} answer={preview.mode === 'answers'} />
      </AttachmentDeclarations.Provider> : <div className="workspace">
        <aside className="sidebar">
          <h2>最近试题</h2>
          <label className="select-field">学科<select value={newSubject} disabled={blocked} onChange={(event) => setNewSubject(event.target.value)}>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select></label>
          <button disabled={blocked || !newSubject} onClick={newQuestion}>新建试题</button>
          {questions.map((question) => <button key={question.id} title={question.id} data-question-id={question.id}
            disabled={blocked} aria-pressed={selection?.questionId === question.id} onClick={() => open(question)}>
            <span>{subjectName(question.subject_id)} · {question.id.slice(0, 8)}</span>
          </button>)}
        </aside>
        {selection ? <section className="panel">
          <h2>{subjectName(selection.subjectId)} · {draft.question_type || '未填写题型'}</h2>
          {!selection.fresh && <FavoriteControl key={selection.questionId} kind="question" id={selection.questionId} disabled={blocked} />}
          <p className="revision-meta">{selection.fresh ? '新试题' : revisionId === null ? '尚无修订'
            : `修订 #${revisionId} · ${selection.detail?.revision.scope === 'public' ? '公共版' : '用户版'}`
              + (selection.detail?.revision.base_revision_id != null ? ' · 基线 #' + selection.detail.revision.base_revision_id : '')}
          </p>
          {!selection.fresh && <div className="actions revision-controls">
            <button disabled={blocked} onClick={() => viewRevision('current')}>读取当前修订</button>
            {selection.detail?.revision.scope !== 'public' && <TrashButton kind="question" id={selection.questionId}
              disabled={blocked || dirty || readOnly} onTrashed={afterTrash} />}
            <button disabled={blocked || !history.some((item) => item.scope === 'public')} onClick={() => viewRevision('original')}>查看公共原版</button>
            <label className="select-field">历史修订<select disabled={blocked} value={typeof selection.view === 'number' ? selection.view : ''}
              onChange={(event) => { if (event.target.value) viewRevision(Number(event.target.value)) }}>
              <option value="">选择修订</option>
              {history.map((item) => <option key={item.id} value={item.id}>#{item.id} · {item.scope === 'public' ? '公共' : '用户'}</option>)}
            </select></label>
          </div>}
          {selection.detail && <p className="review-status">答案审核记录 · {reviewStatusLabel(selection.detail)}</p>}
          {returnReader && returnFromQuestion === selection.questionId && <button disabled={blocked}
            onClick={() => openReader(returnReader)}>返回原卷定位</button>}
          {selection.detail && <PaperLocations key={selection.questionId + ':' + revisionId} questionId={selection.questionId}
            disabled={blocked} open={(location) => openReader({
              fileId: location.file_id, page: location.page_index, location,
              returnQuestion: { id: selection.questionId, subject_id: selection.subjectId, current_revision_id: null },
            })} />}
          {readOnly && <p>历史与公共原版视图为只读。可返回当前修订继续编辑。</p>}
          <fieldset className="question-fields" disabled={blocked || readOnly}>
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
          <label className="select-field">编辑内容<select value={field} disabled={blocked} onChange={(event) => setField(event.target.value as Field)}>
            <option value="stem">整题题干</option>
            <option value="answer">整题答案</option>
            <option value="analysis">整题解析</option>
            {draft.parts.flatMap((part, index) => [
              <option key={part.id + '-prompt'} value={'prompt:' + index}>小问 {index + 1} · 题干</option>,
              <option key={part.id + '-answer'} value={'answer:' + index}>小问 {index + 1} · 答案</option>,
            ])}
          </select></label>
          <AttachmentDeclarations.Provider value={draft.attachments}>
            {readOnly ? <div className="original-view"><Content data={activeDocument(draft, field)} /></div>
              : <div inert={busy}><QuestionEditor key={editorGeneration + ':' + revisionId + ':' + field}
                externalImages onImportingChange={setImporting} content={activeDocument(draft, field)} onChange={updateDocument} onError={setError} /></div>}
          </AttachmentDeclarations.Provider>
          {!selection.fresh && <QuestionKnowledge key={selection.questionId} questionId={selection.questionId}
            subjectId={selection.subjectId} editable={!blocked && !readOnly} />}
          {!selection.fresh && <QuestionMetadataPanel key={'metadata:' + selection.questionId}
            questionId={selection.questionId} editable={!blocked && !readOnly} />}
        </section> : <section className="panel"><p>{busy ? '正在读取试题…' : '选择一道试题，或新建试题。'}</p></section>}
      </div>}
    </main>
  </>
}
