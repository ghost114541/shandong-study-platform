import { useRef, useState } from 'react'
import { blankDraft, composition, grouped, initialPoints } from './composition-api'
import type { Draft, PaperHeader, PrintPair, SavedPaper } from './composition-api'
import { describeError } from './sqlite-api'

export function useComposition() {
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [saved, setSaved] = useState<PaperHeader | null>(null)
  const [papers, setPapers] = useState<PaperHeader[]>([])
  const [preview, setPreview] = useState<PrintPair | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])

  function edit(next: Draft) {
    setDraft(next)
    setDirty(true)
    setStatus('')
    setError('')
  }

  function clearView() {
    setPreview(null)
    setWarnings([])
    setStatus('')
    setError('')
  }

  async function run(task: () => Promise<void>) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try { await task() }
    catch (cause) { setError(describeError(cause)) }
    finally { running.current = false; setBusy(false) }
  }

  function openPaper(paper: SavedPaper) {
    clearView()
    setSaved(paper.header)
    setDraft({ title: paper.header.title, previous_id: null, settings: paper.settings, items: paper.items })
    setDirty(false)
  }

  function begin(version: boolean | null) {
    clearView()
    const copy = saved && version !== null
    setDraft(copy ? { ...draft, previous_id: version ? saved.id : null } : blankDraft())
    setSaved(null)
    setDirty(Boolean(copy))
  }

  function refreshList() {
    return run(async () => setPapers(await composition.list()))
  }

  function open(id: string) {
    return run(async () => openPaper(await composition.read(id)))
  }

  function save() {
    return run(async () => {
      const paper = await composition.save(draft)
      openPaper(paper)
      setPapers((list) => [paper.header, ...list])
      setStatus('组卷已保存。')
    })
  }

  function add(revisionId: number) {
    return run(async () => {
      const target = saved ? blankDraft() : draft
      const question = await composition.question(revisionId, target.items.map(({ question }) => question.revision.id))
      const type = [...question.revision.content.question_type.trim()].slice(0, 40).join('')
      const group = target.settings.groups.includes(type) || target.settings.groups.length < 50
        ? type : target.settings.groups[0]
      const groups = target.settings.groups.includes(group) ? target.settings.groups : [...target.settings.groups, group]
      const items = grouped([...target.items, { question, points: initialPoints(question, group) }], groups)
      clearView()
      setSaved(null)
      edit({ ...target, settings: { ...target.settings, groups }, items })
      setStatus('已加入组卷篮 · 修订 #' + revisionId)
    })
  }

  function refreshRevision(index: number) {
    return run(async () => {
      const current = draft.items[index]
      const question = await composition.latest(current.question.revision.question_id)
      if (question.revision.id === current.question.revision.id) {
        setStatus('已固定当前最新修订 #' + question.revision.id)
        return
      }
      const oldParts = current.question.revision.content.parts
      const newParts = question.revision.content.parts
      const sameParts = oldParts.length === newParts.length && oldParts.every((part, i) => part.id === newParts[i].id)
      const points = sameParts ? current.points : initialPoints(question, current.points.group)
      edit({ ...draft, items: draft.items.map((item, i) => i === index ? { question, points } : item) })
      setStatus('已改用修订 #' + question.revision.id + (sameParts ? '' : ' · 小问结构有变化，已采用新版原题分值。'))
    })
  }

  function showPreview() {
    const id = saved?.id
    if (!id) return
    return run(async () => {
      clearView()
      const pair = await composition.preview(id)
      if (pair.paper.id !== id || pair.answers.id !== id || pair.paper.mode !== 'paper' || pair.answers.mode !== 'answers') {
        throw new Error('预览响应与当前组卷不一致，请重新生成预览。')
      }
      setPreview(pair)
    })
  }

  function exportPair(confirmed: boolean) {
    if (!saved || !preview) return
    const id = saved.id
    const identity = preview.identity
    return run(async () => {
      setStatus('')
      const result = await composition.export(id, identity, confirmed)
      setWarnings(result.warnings)
      if (result.paper && result.answers) setStatus('双 PDF 导出成功\n题卷 ' + result.paper + '\n答案解析卷 ' + result.answers)
    })
  }

  return { draft, saved, papers, preview, dirty, busy, error, status, warnings,
    edit, begin, refreshList, open, save, add, refreshRevision, showPreview, exportPair,
    dismissWarnings: () => setWarnings([]) }
}

export type CompositionWorkspaceState = ReturnType<typeof useComposition>
