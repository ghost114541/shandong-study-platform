import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AdvancedFilters, appliedConditions, sortLabels } from './advanced-filters'
import { choiceLabels, defaultFilters, knowledge } from './knowledge-api'
import type { KnowledgePoint, SearchFilters, SearchHit, SearchPage, SearchSeed } from './knowledge-api'
import { difficultyLabel } from './metadata-api'
import { SearchPreview } from './search-preview'
import type { LoadedPreview } from './search-preview'
import { describeError, sqlite } from './sqlite-api'
import type { QuestionSummary, Subject } from './sqlite-api'

export function SearchWorkspace({ seed, active, openQuestion }: {
  seed?: SearchSeed; active: boolean; openQuestion: (question: QuestionSummary) => void
}) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [points, setPoints] = useState<KnowledgePoint[]>([])
  const [filters, setFilters] = useState(() => defaultFilters(seed))
  const [applied, setApplied] = useState(filters)
  const [result, setResult] = useState<SearchPage | null>(null)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<SearchHit | null>(null)
  const [preview, setPreview] = useState<LoadedPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const previewRequest = useRef(0)
  const wasActive = useRef(active)
  const activePointName = useRef('')
  const choices = useMemo(() => choiceLabels(points), [points])
  const subjectName = (id: string) => subjects.find((subject) => subject.id === id)?.name ?? id

  useEffect(() => {
    void Promise.all([
      sqlite.subjects(),
      filters.subjectId ? knowledge.list(filters.subjectId) : Promise.resolve([]),
      knowledge.search(filters, 0),
    ]).then(([allSubjects, nodes, first]) => {
      setSubjects(allSubjects)
      setPoints(nodes)
      activePointName.current = nodes.find((node) => node.id === filters.knowledgeId)?.title ?? ''
      setResult(first)
    }).catch((err: unknown) => setError(describeError(err))).finally(() => setBusy(false))
  }, [])

  useEffect(() => {
    if (active && !wasActive.current && result) search(applied, page)
    wasActive.current = active
  }, [active])

  function closePreview() {
    previewRequest.current++
    setSelected(null)
    setPreview(null)
    setPreviewError('')
  }

  function select(hit: SearchHit) {
    const request = ++previewRequest.current
    setSelected(hit)
    setPreview(null)
    setPreviewError('')
    void Promise.all([sqlite.current(hit.id), knowledge.forQuestion(hit.id)]).then(([detail, links]) => {
      if (!detail) throw new Error('找不到当前修订。')
      if (request === previewRequest.current) setPreview({ detail, links })
    }).catch((err: unknown) => {
      if (request === previewRequest.current) setPreviewError(describeError(err))
    })
  }

  async function perform(task: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await task() }
    catch (err) { setError(describeError(err)) }
    finally { setBusy(false) }
  }

  function changeSubject(subjectId: string) {
    void perform(async () => {
      setPoints(subjectId ? await knowledge.list(subjectId) : [])
      setFilters((value) => ({ ...value, subjectId, knowledgeId: '' }))
    })
  }

  function search(active: SearchFilters, next: number) {
    void perform(async () => {
      const data = await knowledge.search(active, next)
      if (active.knowledgeId !== applied.knowledgeId) {
        activePointName.current = points.find((node) => node.id === active.knowledgeId)?.title ?? active.knowledgeId
      }
      closePreview()
      setApplied(active)
      setPage(next)
      setResult(data)
    })
  }

  function clear() {
    const reset = defaultFilters()
    setFilters(reset)
    setPoints([])
    search(reset, 0)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    search(filters, 0)
  }

  const conditions = appliedConditions(applied, applied.subjectId && subjectName(applied.subjectId), activePointName.current)
  return <main>
    <h1>试题检索</h1>
    <form className="panel search-filters" onSubmit={submit}>
      <fieldset className="question-fields" disabled={busy}>
        <label>学科 <select aria-label="筛选学科" value={filters.subjectId} onChange={(event) => changeSubject(event.target.value)}>
          <option value="">全部学科</option>
          {subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>知识点 <select aria-label="筛选知识点" value={filters.knowledgeId} disabled={!filters.subjectId}
          onChange={(event) => setFilters({ ...filters, knowledgeId: event.target.value })}>
          <option value="">{filters.subjectId ? '全部知识点' : '先选择学科'}</option>
          {choices.filter(({ point }) => point.enabled).map(({ point, label }) => <option key={point.id} value={point.id}>{label}</option>)}
        </select></label>
        <label className="check"><input type="checkbox" disabled={!filters.knowledgeId} checked={filters.descendants}
          onChange={(event) => setFilters({ ...filters, descendants: event.target.checked })} />包含下级知识点</label>
        <label>题干关键词 <input aria-label="题干关键词" maxLength={120} value={filters.keyword}
          onChange={(event) => setFilters({ ...filters, keyword: event.target.value })} /></label>
        <button className="primary" type="submit">搜索试题</button>
        <button type="button" onClick={clear}>清空条件</button>
      </fieldset>
      <AdvancedFilters filters={filters} busy={busy} update={(change) => setFilters((previous) => ({ ...previous, ...change }))} />
    </form>
    <div className="status" aria-live="polite">
      {error ? <p role="alert">{error}</p> : <p>{busy ? '正在查询…' : result?.hits.length === 0 ? '没有匹配的试题。' : ''}</p>}
    </div>
    {result && <div className={'search-layout' + (selected ? ' has-preview' : '')}><section className="panel" aria-label="搜索结果">
      <h2>搜索结果</h2>
      <p className="applied-filters">已应用 {conditions.join(' · ') || '全部试题'} · {sortLabels[applied.sort]}{applied.descending ? '降序' : '升序'}</p>
      <ul className="search-results">
        {result.hits.map((hit) => <li key={hit.id}>
          <button type="button" data-search-question-id={hit.id} disabled={busy} aria-pressed={selected?.id === hit.id} onClick={() => select(hit)}>
            <strong>{subjectName(hit.subject_id)} · {hit.question_type ?? '题型未标注'} · {difficultyLabel(hit.difficulty)}</strong>
            <span>{hit.snippet || '无可检索题干文字'}</span>
            {hit.source_label && <small>{hit.source_label}</small>}
          </button>
        </li>)}
      </ul>
      <div className="actions">
        <button type="button" disabled={busy || page === 0} onClick={() => search(applied, page - 1)}>上一页</button>
        <span>第 {page + 1} 页</span>
        <button type="button" disabled={busy || !result.has_next} onClick={() => search(applied, page + 1)}>下一页</button>
      </div>
    </section>
      {selected && <SearchPreview key={previewRequest.current} hit={selected} subject={subjectName(selected.subject_id)}
        loaded={preview} error={previewError} close={closePreview} open={() => { closePreview(); openQuestion(selected) }} />}
    </div>}
  </main>
}
