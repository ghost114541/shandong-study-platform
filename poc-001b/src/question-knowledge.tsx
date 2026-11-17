import { useEffect, useMemo, useState } from 'react'
import { choiceLabels, knowledge } from './knowledge-api'
import type { KnowledgePoint } from './knowledge-api'
import { describeError } from './sqlite-api'

export function QuestionKnowledge({ questionId, subjectId, editable }: { questionId: string; subjectId: string; editable: boolean }) {
  const [points, setPoints] = useState<KnowledgePoint[]>([])
  const [linked, setLinked] = useState<string[]>([])
  const [choice, setChoice] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const choices = useMemo(() => choiceLabels(points), [points])
  useEffect(() => {
    void Promise.all([knowledge.list(subjectId), knowledge.forQuestion(questionId)]).then(([nodes, associations]) => {
      setPoints(nodes)
      setLinked(associations)
      setLoaded(true)
    }).catch((err: unknown) => setError(describeError(err)))
  }, [questionId, subjectId])

  async function change(id: string, attach: boolean) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await knowledge.link(questionId, id, attach)
      setLinked(await knowledge.forQuestion(questionId))
      setChoice('')
      setMessage(attach ? '已关联知识点' : '已解除知识点关联')
    } catch (err) { setError(describeError(err)) }
    finally { setBusy(false) }
  }

  return <section className="question-knowledge" aria-label="试题知识点">
    <h2>试题知识点</h2>
    <p className="hint">关联适用于整道逻辑题及其所有修订。</p>
    {loaded && linked.length === 0 && <p>暂无关联知识点。</p>}
    {linked.length > 0 && <ul>
      {linked.map((id) => {
        const title = choices.find(({ point }) => point.id === id)?.label ?? id
        return <li key={id}>
          <span>{title}</span>
          {editable && <button type="button" disabled={busy} aria-label={'解除关联 ' + title}
            onClick={() => void change(id, false)}>解除关联</button>}
        </li>
      })}
    </ul>}
    {editable && <form className="actions" onSubmit={(event) => {
      event.preventDefault()
      if (choice) void change(choice, true)
    }}>
      <label>关联知识点 <select aria-label="关联知识点" value={choice} disabled={busy || !loaded} onChange={(event) => setChoice(event.target.value)}>
        <option value="">选择同学科知识点</option>
        {choices.filter(({ point }) => point.enabled && !linked.includes(point.id)).map(({ point, label }) =>
          <option key={point.id} value={point.id}>{label}</option>)}
      </select></label>
      <button type="submit" disabled={busy || !loaded || !choice}>添加关联</button>
    </form>}
    <p className="knowledge-status" aria-live="polite">{error ? <span role="alert">{error}</span> : message}</p>
  </section>
}
