import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { choiceLabels, knowledge } from './knowledge-api'
import type { KnowledgePoint, SearchFilters, SearchPage, SearchSeed } from './knowledge-api'
import { describeError, sqlite } from './sqlite-api'
import type { QuestionSummary, Subject } from './sqlite-api'

export function SearchWorkspace({ seed, openQuestion }: { seed?: SearchSeed; openQuestion: (question: QuestionSummary) => void }) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [points, setPoints] = useState<KnowledgePoint[]>([])
  const [filters, setFilters] = useState<SearchFilters>({
    subjectId: seed?.subjectId ?? '', knowledgeId: seed?.knowledgeId ?? '',
    keyword: '', descendants: seed?.descendants ?? true,
  })
  const [applied, setApplied] = useState(filters)
  const [result, setResult] = useState<SearchPage | null>(null)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const choices = useMemo(() => choiceLabels(points), [points])

  useEffect(() => {
    void Promise.all([
      sqlite.subjects(),
      filters.subjectId ? knowledge.list(filters.subjectId) : Promise.resolve([]),
      knowledge.search(filters, 0),
    ]).then(([allSubjects, nodes, first]) => {
      setSubjects(allSubjects)
      setPoints(nodes)
      setResult(first)
    }).catch((err: unknown) => setError(describeError(err))).finally(() => setBusy(false))
  }, [])

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
      setApplied(active)
      setPage(next)
      setResult(data)
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    search(filters, 0)
  }

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
      </fieldset>
    </form>
    <div className="status" aria-live="polite">
      {error ? <p role="alert">{error}</p> : <p>{busy ? '正在查询…' : result?.hits.length === 0 ? '没有匹配的试题。' : ''}</p>}
    </div>
    {result && <section className="panel" aria-label="搜索结果">
      <h2>搜索结果</h2>
      <ul className="search-results">
        {result.hits.map((hit) => <li key={hit.id}>
          <button type="button" data-search-question-id={hit.id} disabled={busy} onClick={() => openQuestion(hit)}>
            <strong>{subjects.find((item) => item.id === hit.subject_id)?.name ?? hit.subject_id} · 修订 #{hit.current_revision_id}</strong>
            <span>{hit.snippet || '无可检索题干文字'}</span>
          </button>
        </li>)}
      </ul>
      <div className="actions">
        <button type="button" disabled={busy || page === 0} onClick={() => search(applied, page - 1)}>上一页</button>
        <span>第 {page + 1} 页</span>
        <button type="button" disabled={busy || !result.has_next} onClick={() => search(applied, page + 1)}>下一页</button>
      </div>
    </section>}
  </main>
}
