import { useState } from 'react'
import type { FormEvent } from 'react'
import { AttachmentDeclarations } from './attachment-image'
import { grouped, totalScore } from './composition-api'
import type { Draft, PaperItem, PaperMode, PaperPoints, PaperSettings } from './composition-api'
import { CompositionPaper } from './composition-paper'
import { Content } from './paper'
import type { CompositionWorkspaceState } from './use-composition'

const MAX_SCORE = 4294967295

function integer(value: string, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(Number(value) || 0)))
}

function move<T>(items: T[], index: number, offset: number): T[] {
  const updated = [...items]
  const [item] = updated.splice(index, 1)
  updated.splice(index + offset, 0, item)
  return updated
}

function GroupSettings({ draft, edit }: { draft: Draft; edit: (draft: Draft) => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const { groups } = draft.settings

  function update(next: string[], renamed?: { from: string; to: string }) {
    const items = renamed ? draft.items.map(({ question, points }) => ({
      question, points: points.group === renamed.from ? { ...points, group: renamed.to } : points,
    })) : draft.items
    edit({ ...draft, settings: { ...draft.settings, groups: next }, items: grouped(items, next) })
    setError('')
  }

  function add(event: FormEvent) {
    event.preventDefault()
    const title = name.trim()
    if (groups.includes(title)) return setError('分组名称已存在。')
    if (title) update([...groups, title])
    setName('')
  }

  return <section className="panel">
    <h2>题型分组</h2>
    <ul className="composition-groups">
      {groups.map((group, index) => <li key={group} className="actions">
        <input aria-label={'分组 ' + (index + 1) + ' 名称'} defaultValue={group} maxLength={40}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
          onBlur={(event) => {
            const value = event.target.value.trim()
            if (value === group) return
            if (!value || groups.includes(value)) {
              event.target.value = group
              setError('分组名称不能为空或重复。')
              return
            }
            update(groups.map((item) => item === group ? value : item), { from: group, to: value })
          }} />
        <button type="button" disabled={index === 0} onClick={() => update(move(groups, index, -1))}>上移分组</button>
        <button type="button" disabled={index === groups.length - 1} onClick={() => update(move(groups, index, 1))}>下移分组</button>
        <button type="button" disabled={draft.items.some((item) => item.points.group === group)}
          onClick={() => update(groups.filter((item) => item !== group))}>移除空分组</button>
      </li>)}
    </ul>
    <form className="actions" onSubmit={add}>
      <input aria-label="新分组名称" placeholder="分组名称" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} />
      <button disabled={!name.trim() || groups.length >= 50}>新增分组</button>
    </form>
    {error && <p role="alert">{error}</p>}
  </section>
}

function QuestionPreview({ item }: { item: PaperItem }) {
  const [open, setOpen] = useState(false)
  const content = item.question.revision.content
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>预览固定修订</summary>
    {open && <AttachmentDeclarations.Provider value={content.attachments}>
      <Content data={content.stem} />
      {content.parts.map((part, index) => <section key={part.id}>
        <h4>小问 {index + 1}</h4><Content data={part.prompt} />
      </section>)}
    </AttachmentDeclarations.Provider>}
  </details>
}

export function CompositionWorkspace({ state, confirmReplace }: {
  state: CompositionWorkspaceState
  confirmReplace: (action: () => void) => void
}) {
  const { draft, saved, busy, dirty, papers, preview } = state
  const [mode, setMode] = useState<PaperMode>('paper')
  const settings = (values: Partial<PaperSettings>) => state.edit({ ...draft, settings: { ...draft.settings, ...values } })
  const setItems = (items: PaperItem[]) => state.edit({ ...draft, items })
  function setPoints(index: number, points: PaperPoints) {
    setItems(grouped(draft.items.map((item, i) => i === index ? { ...item, points } : item), draft.settings.groups))
  }

  return <main className="composition-workspace">
    <h1>自定义组卷</h1>
    <div className="composition-layout">
      <aside className="panel" aria-label="已保存组卷">
        <h2>已保存组卷</h2>
        <button disabled={busy} onClick={() => confirmReplace(() => state.begin(null))}>新建空白组卷</button>
        <ul className="saved-papers">
          {papers.map((paper) => <li key={paper.id}>
            <button disabled={busy} data-composition-id={paper.id} aria-pressed={saved?.id === paper.id}
              onClick={() => confirmReplace(() => void state.open(paper.id))}>
              <strong>{paper.title}</strong>
              <small>{paper.created_at} UTC · {paper.legacy ? '历史组卷' : paper.previous_id ? '新版本' : '独立组卷'}</small>
            </button>
          </li>)}
        </ul>
        {!papers.length && <p>暂无已保存组卷。</p>}
      </aside>
      <div>
        {state.error && <p role="alert">{state.error}</p>}
        <p className="composition-status" role="status">{busy ? '正在处理组卷…' : state.status}</p>
        <section className="panel">
          <h2>{saved ? saved.title : '组卷篮'}</h2>
          <p>{draft.items.length} 道题 · 总分 {totalScore(draft.items)} 分 · {saved ? '已保存' : dirty ? '有未保存修改' : '草稿'}</p>
          {saved ? <>
            <p>组卷 ID {saved.id}{saved.previous_id && ' · 上一版 ' + saved.previous_id}</p>
            <p>{draft.settings.scope || '范围未填写'} · {draft.settings.duration_minutes ? draft.settings.duration_minutes + ' 分钟' : '不限时'} · A4 · 题距 {draft.settings.gap_mm} mm · 作答空间 {draft.settings.answer_space_mm} mm</p>
            <p>分组顺序 {draft.settings.groups.join(' → ')}</p>
            <div className="actions">
              <button disabled={busy} onClick={() => state.begin(false)}>复制为新组卷</button>
              <button disabled={busy} onClick={() => state.begin(true)}>编辑为新版本</button>
              <button className="primary" disabled={busy} onClick={() => { setMode('paper'); void state.showPreview() }}>生成双卷预览</button>
            </div>
          </> : <>
            <fieldset className="composition-fields" disabled={busy}>
              <label>试卷标题 <input value={draft.title} maxLength={160} onChange={(event) => state.edit({ ...draft, title: event.target.value })} /></label>
              <label>学科或范围 <input value={draft.settings.scope} maxLength={160} onChange={(event) => settings({ scope: event.target.value })} /></label>
              <label>考试时长（分钟） <input type="number" min={1} max={1440} value={draft.settings.duration_minutes ?? ''}
                onChange={(event) => settings({ duration_minutes: event.target.value ? integer(event.target.value, 1, 1440) : null })} /></label>
              <label>纸张 <output>A4</output></label>
              <label>题目间距（mm） <input type="number" min={0} max={20} value={draft.settings.gap_mm}
                onChange={(event) => settings({ gap_mm: integer(event.target.value, 0, 20) })} /></label>
              <label>每题作答空间（mm） <input type="number" min={0} max={60} value={draft.settings.answer_space_mm}
                onChange={(event) => settings({ answer_space_mm: integer(event.target.value, 0, 60) })} /></label>
            </fieldset>
            <div className="actions">
              <button className="primary" disabled={busy || !draft.items.length || !draft.title.trim()} onClick={() => void state.save()}>
                {draft.previous_id ? '保存为新版本' : '保存组卷'}
              </button>
              {dirty && <button disabled={busy} onClick={() => confirmReplace(() => state.begin(null))}>清空草稿</button>}
            </div>
          </>}
        </section>
        {!saved && <fieldset className="composition-controls" disabled={busy}><GroupSettings draft={draft} edit={state.edit} /></fieldset>}
        <section className="panel" aria-label="组卷题目">
          <h2>组卷题目</h2>
          {!draft.items.length && <p>在试题检索中加入所需试题。</p>}
          <ol className="composition-items">
            {draft.items.map((item, index) => {
              const { question, points } = item
              const revision = question.revision
              const group = points.group
              return <li key={revision.id} data-revision-id={revision.id}>
                <h3>第 {index + 1} 题 · {question.subject} · {revision.content.question_type}（{points.score} 分）</h3>
                <p>{group} · 固定修订 #{revision.id}{question.summary && ' · ' + question.summary}</p>
                {points.score !== revision.content.score && <p>原题修订分值 {revision.content.score} 分</p>}
                <p>{question.snippet || '图片或公式题干'}</p>
                <QuestionPreview item={item} />
                {saved && points.part_scores.length > 0 && <p>小问分值 {points.part_scores.join(' / ')}</p>}
                {!saved && <fieldset className="composition-fields" disabled={busy}>
                  <label>分组 <select value={group} onChange={(event) => setPoints(index, { ...points, group: event.target.value })}>
                    {draft.settings.groups.map((name) => <option key={name}>{name}</option>)}
                  </select></label>
                  {points.part_scores.length ? points.part_scores.map((score, part) => <label key={revision.content.parts[part].id}>小问 {part + 1} 分值
                    <input type="number" min={0} max={MAX_SCORE} value={score} onChange={(event) => {
                      const others = points.score - score
                      const next = integer(event.target.value, 0, MAX_SCORE - others)
                      setPoints(index, { ...points, score: others + next, part_scores: points.part_scores.map((previous, i) => i === part ? next : previous) })
                    }} />
                  </label>) : <label>整题分值 <input type="number" min={0} max={MAX_SCORE} value={points.score}
                    onChange={(event) => setPoints(index, { ...points, score: integer(event.target.value, 0, MAX_SCORE) })} /></label>}
                  <button disabled={draft.items[index - 1]?.points.group !== group} onClick={() => setItems(move(draft.items, index, -1))}>上移</button>
                  <button disabled={draft.items[index + 1]?.points.group !== group} onClick={() => setItems(move(draft.items, index, 1))}>下移</button>
                  <button onClick={() => setItems(draft.items.filter((_, i) => i !== index))}>移除</button>
                  <button onClick={() => void state.refreshRevision(index)}>刷新到最新修订</button>
                </fieldset>}
              </li>
            })}
          </ol>
        </section>
      </div>
    </div>
    {preview && <section className="panel">
      <div className="actions">
        <button aria-pressed={mode === 'paper'} onClick={() => setMode('paper')}>题卷预览</button>
        <button aria-pressed={mode === 'answers'} onClick={() => setMode('answers')}>答案解析预览</button>
        <button className="primary" disabled={busy || state.warnings.length > 0} onClick={() => void state.exportPair(false)}>导出双 PDF</button>
      </div>
      {state.warnings.length > 0 && <section className="image-warnings" aria-label="图片分辨率提示">
        <h3>图片分辨率提示</h3>
        <ul>{state.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        <div className="actions">
          <button disabled={busy} onClick={state.dismissWarnings}>取消导出</button>
          <button disabled={busy} onClick={() => void state.exportPair(true)}>确认并导出</button>
        </div>
      </section>}
      <CompositionPaper snapshot={preview[mode]} />
    </section>}
  </main>
}
