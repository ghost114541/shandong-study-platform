import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { childrenByParent, choiceLabels, knowledge } from './knowledge-api'
import type { KnowledgePoint, SearchSeed } from './knowledge-api'
import { describeError, sqlite } from './sqlite-api'
import type { Subject } from './sqlite-api'
import { FavoriteControl } from './favorite-controls'
import { TrashButton } from './trash-button'
import type { KnowledgeTarget } from './favorites-workspace'

interface TreeProps {
  points: KnowledgePoint[]
  children: Map<string | null, KnowledgePoint[]>
  selected: string | null
  expanded: Set<string>
  onToggle: (id: string) => void
  onPick: (point: KnowledgePoint) => void
}

function Tree({ points, children, selected, expanded, onToggle, onPick }: TreeProps) {
  return <ul className="knowledge-tree">
    {points.map((point) => {
      const branches = children.get(point.id) ?? []
      const open = expanded.has(point.id)
      return <li key={point.id}>
        <div className="actions tree-row">
          {branches.length > 0 && <button type="button" className="tree-toggle" aria-expanded={open}
            aria-label={(open ? '收起 ' : '展开 ') + point.title} onClick={() => onToggle(point.id)}>{open ? '▾' : '▸'}</button>}
          <button type="button" data-knowledge-id={point.id} aria-pressed={selected === point.id} onClick={() => onPick(point)}>
            {point.title} <small>{point.question_count} 道试题</small>
          </button>
        </div>
        {open && <Tree points={branches} children={children} selected={selected} expanded={expanded} onToggle={onToggle} onPick={onPick} />}
      </li>
    })}
  </ul>
}

export function KnowledgeWorkspace({ target, openSearch, onTrashed }: { target?: KnowledgeTarget; openSearch: (seed: SearchSeed) => void; onTrashed: () => void }) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [subject, setSubject] = useState('')
  const [points, setPoints] = useState<KnowledgePoint[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(new Set<string>())
  const [title, setTitle] = useState('')
  const [parent, setParent] = useState('')
  const [sort, setSort] = useState('0')
  const [rename, setRename] = useState('')
  const [alias, setAlias] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const current = points.find((point) => point.id === selected)
  const parentTitle = points.find((point) => point.id === current?.parent_id)?.title
  const tree = useMemo(() => childrenByParent(points), [points])
  const choices = useMemo(() => choiceLabels(points), [points])

  useEffect(() => {
    let active = true
    void sqlite.subjects().then(async (items) => {
      if (!active) return
      setSubjects(items)
      const id = target?.subjectId ?? (items.find((item) => item.id === 'math') ?? items[0])?.id
      if (!id) return
      const result = await knowledge.list(id)
      if (!active) return
      setSubject(id)
      setPoints(result)
      if (target) {
        const point = result.find((entry) => entry.id === target.pointId)
        if (!point || !point.enabled) throw new Error('该知识点已停用或无法找到。')
        setSelected(point.id)
        setRename(point.title)
        const ancestors = new Set<string>()
        let parent = point.parent_id
        while (parent && !ancestors.has(parent)) {
          ancestors.add(parent)
          parent = result.find((entry) => entry.id === parent)?.parent_id ?? null
        }
        setExpanded(ancestors)
      }
    }).catch((err: unknown) => { if (active) setError(describeError(err)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [target])

  async function perform(task: () => Promise<void>) {
    setBusy(true)
    setError('')
    setStatus('')
    try { await task() }
    catch (err) { setError(describeError(err)) }
    finally { setBusy(false) }
  }

  function openSubject(id: string) {
    if (id === subject) return
    void perform(async () => {
      const result = await knowledge.list(id)
      setSubject(id)
      setPoints(result)
      setSelected(null)
      setExpanded(new Set())
      setParent('')
    })
  }

  function pick(point: KnowledgePoint) {
    if (busy) return
    setSelected(point.id)
    setRename(point.title)
    setAlias('')
  }

  function toggle(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function create(event: FormEvent) {
    event.preventDefault()
    void perform(async () => {
      await knowledge.create(subject, parent || null, title, Number(sort))
      setPoints(await knowledge.list(subject))
      if (parent) setExpanded((items) => new Set([...items, parent]))
      setTitle('')
      setStatus('已创建用户知识点')
    })
  }

  function saveDetails(event: FormEvent, action: () => Promise<void>, done: string) {
    event.preventDefault()
    void perform(async () => {
      await action()
      setPoints(await knowledge.list(subject))
      setAlias('')
      setStatus(done)
    })
  }

  return <main>
    <h1>知识库</h1>
    <div className="status" aria-live="polite">
      {error ? <p role="alert">{error}</p> : <p>{busy ? '正在读取或保存…' : status}</p>}
    </div>
    <div className="workspace">
      <aside className="sidebar">
        <h2>学科</h2>
        {subjects.map((item) => <button key={item.id} disabled={busy} aria-pressed={subject === item.id}
          onClick={() => openSubject(item.id)}>{item.name}</button>)}
      </aside>
      <div className="knowledge-panels">
        <section className="panel">
          <h2>{subjects.find((item) => item.id === subject)?.name ?? '学科'}知识点</h2>
          {points.length > 0
            ? <Tree points={tree.get(null) ?? []} children={tree} selected={selected} expanded={expanded} onToggle={toggle} onPick={pick} />
            : <p>{busy ? '正在读取…' : '本学科暂无知识点。'}</p>}
          <form className="knowledge-form" onSubmit={create}>
            <fieldset className="question-fields" disabled={busy || !subject}>
              <legend>新建用户知识点</legend>
              <label>知识点名称 <input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label>上级知识点 <select value={parent} onChange={(event) => setParent(event.target.value)}>
                <option value="">无（顶层）</option>
                {choices.filter(({ point }) => point.enabled).map(({ point, label }) => <option key={point.id} value={point.id}>{label}</option>)}
              </select></label>
              <label>排序值 <input type="number" required min={-2147483648} max={2147483647} value={sort}
                onChange={(event) => setSort(event.target.value)} /></label>
              <button type="submit">创建知识点</button>
            </fieldset>
          </form>
        </section>
        {current && <section className="panel knowledge-detail">
          <h2>{current.title}</h2>
          <p>{current.origin === 'standard' ? '公共标准（演示）' : '用户知识点'} · {current.enabled ? '已启用' : '已停用'}</p>
          <p>上级知识点 {parentTitle ?? '无'} · 直接关联 {current.question_count} 道试题</p>
          <FavoriteControl key={current.id} kind="knowledge" id={current.id} showMark disabled={busy} />
          <button type="button" disabled={!current.enabled || busy}
            onClick={() => openSearch({ subjectId: subject, knowledgeId: current.id, descendants: false })}>查看关联试题</button>
          {current.origin === 'user' && <TrashButton kind="knowledge" id={current.id} disabled={busy}
            onTrashed={() => {
              onTrashed()
              setSelected(null)
              void perform(async () => setPoints(await knowledge.list(subject)))
            }} />}
          {current.origin === 'user' && <form className="knowledge-form actions" onSubmit={(event) =>
            saveDetails(event, () => knowledge.rename(current.id, rename), '已保存知识点名称')}>
            <label>修改名称 <input required maxLength={120} value={rename} disabled={busy} onChange={(event) => setRename(event.target.value)} /></label>
            <button disabled={busy} type="submit">保存名称</button>
          </form>}
          <p>别名 {current.aliases.join('、') || '无'}</p>
          <form className="knowledge-form actions" onSubmit={(event) =>
            saveDetails(event, () => knowledge.alias(current.id, alias), '已添加别名')}>
            <label>添加别名 <input required maxLength={120} value={alias} disabled={busy} onChange={(event) => setAlias(event.target.value)} /></label>
            <button disabled={busy} type="submit">保存别名</button>
          </form>
        </section>}
      </div>
    </div>
  </main>
}
