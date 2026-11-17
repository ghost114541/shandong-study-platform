import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { difficulties, metadataApi } from './metadata-api'
import type { PaperMetadata, QuestionMetadata } from './metadata-api'
import { describeError } from './sqlite-api'

const value = (form: FormData, key: string): string => String(form.get(key) ?? '').trim()

export function QuestionMetadataPanel({ questionId, editable }: { questionId: string; editable: boolean }) {
  const [opened, setOpened] = useState(false)
  const [data, setData] = useState<QuestionMetadata | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!opened || data) return
    let active = true
    setError('')
    void metadataApi.read(questionId).then((result) => {
      if (active) setData(result)
    }).catch((err: unknown) => { if (active) setError(describeError(err)) })
    return () => { active = false }
  }, [opened, data, questionId])

  async function perform(action: () => Promise<void>, label: string) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      setData(await metadataApi.read(questionId))
      setMessage(label)
    } catch (err) { setError(describeError(err)) }
    finally { setBusy(false) }
  }

  function saveQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const difficulty = value(form, 'difficulty')
    const tags = value(form, 'tags').split(/\r?\n/).map((tag) => tag.trim()).filter(Boolean)
    void perform(() => metadataApi.save(questionId, difficulty ? Number(difficulty) : null, tags), '已保存难度与标签')
  }

  function addOrigin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const element = event.currentTarget
    const form = new FormData(element)
    const paper = value(form, 'paper')
    const title = value(form, 'title')
    if (Boolean(paper) === Boolean(title)) {
      setError('请填写已有原卷 ID 或新原卷名称。')
      return
    }
    void perform(async () => {
      await metadataApi.addOrigin(questionId, paper || null, title || null, value(form, 'position'))
      element.reset()
    }, '已添加原卷出处')
  }

  const papers = new Map<string, QuestionMetadata['origins']>()
  for (const origin of data?.origins ?? []) {
    const group = papers.get(origin.paper_id)
    if (group) group.push(origin)
    else papers.set(origin.paper_id, [origin])
  }

  return <details className="question-metadata" onToggle={(event) => setOpened(event.currentTarget.open)}>
    <summary>试题元数据与出处</summary>
    <div className="metadata-status" aria-live="polite">
      {error ? <p role="alert">{error}</p> : <p>{!data && opened ? '正在读取元数据…' : message}</p>}
    </div>
    {data && <>
      <form className="metadata-annotations" onSubmit={saveQuestion}>
        <fieldset className="metadata-fields" disabled={busy || !editable}>
          <label>难度 <select aria-label="编辑难度" name="difficulty" defaultValue={data.difficulty ?? ''}>
            <option value="">未标注</option>
            {difficulties.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
          </select></label>
          <label>自定义标签（每行一项）<textarea name="tags" aria-label="自定义标签" maxLength={3872} defaultValue={data.tags.join('\n')} /></label>
          <button type="submit">保存难度与标签</button>
        </fieldset>
      </form>
      {data.inherited_tags.length > 0 && <p>原重复题标签 {data.inherited_tags.join('、')}</p>}
      <h3>原卷出处</h3>
      {data.origins.length === 0 && <p>暂无原卷出处。</p>}
      {data.origins.length > 0 && <p className="hint">年份、地区和来源是供同卷各题共享的本地标注。分发许可需另行核验。</p>}
      {[...papers].map(([id, origins]) => <PaperForm key={id} origins={origins} questionId={questionId}
        disabled={busy || !editable} save={async (expected, next) => {
          await metadataApi.savePaper(id, expected, next)
          setMessage('已保存原卷本地标注')
        }} refresh={async () => {
          const latest = await metadataApi.read(questionId)
          setData(latest)
          const origin = latest.origins.find((item) => item.paper_id === id)
          if (!origin) throw new Error('找不到该原卷。')
          return origin
        }} />)}
      {editable && <form className="add-origin" onSubmit={addOrigin}>
        <fieldset className="metadata-fields" disabled={busy}>
          <legend>添加原卷出处</legend>
          <label>新原卷名称 <input name="title" aria-label="新原卷名称" maxLength={120} /></label>
          <label>或已有原卷 ID <input name="paper" maxLength={120} /></label>
          <label>题位 <input name="position" aria-label="原卷题位" required maxLength={120} /></label>
          <button type="submit">添加出处</button>
        </fieldset>
      </form>}
    </>}
  </details>
}

function paperFields({ year, region, source }: PaperMetadata): PaperMetadata {
  return { year, region, source }
}

function PaperForm({ origins, questionId, disabled, save, refresh }: {
  origins: QuestionMetadata['origins']
  questionId: string
  disabled: boolean
  save: (expected: PaperMetadata, next: PaperMetadata) => Promise<void>
  refresh: () => Promise<PaperMetadata>
}) {
  const first = origins[0]
  const [baseline, setBaseline] = useState(() => paperFields(first))
  const [generation, setGeneration] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function perform(action: () => Promise<PaperMetadata>) {
    setBusy(true)
    setError('')
    try {
      setBaseline(paperFields(await action()))
      setGeneration((previous) => previous + 1)
    } catch (err) { setError(describeError(err)) }
    finally { setBusy(false) }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const year = value(form, 'year')
    const next = { year: year ? Number(year) : null, region: value(form, 'region') || null, source: value(form, 'source') || null }
    void perform(async () => {
      await save(baseline, next)
      return next
    })
  }

  return <form className="origin-form" data-paper-id={first.paper_id} onSubmit={submit}>
    <h4>{first.title}</h4>
    <p className="hint">原卷 ID {first.paper_id}</p>
    <ul>{origins.map((item) => <li key={item.position}>
      题位 {item.position}{item.original_id !== questionId && ' · 来自原题 ' + item.original_id}
    </li>)}</ul>
    <fieldset key={generation} className="metadata-fields" disabled={disabled || busy}>
      <label>年份 <input name="year" aria-label="原卷年份" type="number" min={1} max={9999} defaultValue={baseline.year ?? ''} /></label>
      <label>地区 <input name="region" aria-label="原卷地区" maxLength={120} defaultValue={baseline.region ?? ''} /></label>
      <label>来源 <input name="source" aria-label="原卷来源" maxLength={120} defaultValue={baseline.source ?? ''} /></label>
      <button type="submit">保存原卷标注</button>
      <button type="button" onClick={() => void perform(refresh)}>重新读取并放弃本表修改</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </form>
}
