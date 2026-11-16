import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import sample from '../../poc-001/samples/questions.json'
import { QuestionEditor } from './editor'
import { Content, Paper } from './paper'
import { convertSample, parseQuestionSet, withLongStem } from './model'
import type { QuestionSet, RichDocument } from './model'
import 'katex/dist/katex.min.css'
import './style.css'

const original = convertSample(sample)
type Field = 'stem' | 'prompt' | 'answer'
type Mode = 'edit' | 'paper' | 'answers'
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

function App() {
  const [data, setData] = useState<QuestionSet>(original)
  const [selected, setSelected] = useState(0)
  const [target, setTarget] = useState<{ field: Field; part: number }>({ field: 'stem', part: 0 })
  const [mode, setMode] = useState<Mode>('edit')
  const [longSample, setLongSample] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [busy, setBusy] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [loadBlocked, setLoadBlocked] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const totalParts = data.questions.reduce((sum, q) => sum + q.parts.length, 0)
  const q = (showOriginal ? original : data).questions[selected]
  const activeDoc = target.field === 'stem' ? q.stem : q.parts[target.part][target.field]

  useEffect(() => {
    invoke<unknown>('load_questions').then((saved) => {
      if (saved !== null) {
        setData(parseQuestionSet(saved))
        setMessage('已读取本地编辑版。')
      }
    }).catch((err: unknown) => {
      setLoadBlocked(true)
      setError(errorMessage(err))
    }).finally(() => { setLoaded(true); setBusy(false) })
  }, [])

  function update(content: RichDocument) {
    setData((previous) => {
      const questions = [...previous.questions]
      const q = questions[selected]
      if (target.field === 'stem') questions[selected] = { ...q, stem: content }
      else {
        const parts = [...q.parts]
        parts[target.part] = { ...parts[target.part], [target.field]: content }
        questions[selected] = { ...q, parts }
      }
      return { ...previous, questions }
    })
    setDirty(true)
    setMessage('')
    setError('')
  }

  async function perform(action: () => Promise<string>) {
    setBusy(true)
    setError('')
    setMessage('')
    try { setMessage(await action()) }
    catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }

  async function save() {
    const path = await invoke<string>('save_questions', { data: parseQuestionSet(data) })
    setDirty(false)
    return '已保存到 ' + path
  }

  async function exportPdf() {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('.paper img'))
    await Promise.all(images.map((image) => image.decode()))
    await document.fonts.ready
    const path = await invoke<string>('export_pdf', { kind: mode, longSample })
    return 'PDF 已保存到 ' + path
  }

  function pick(index: number) {
    setSelected(index)
    setTarget({ field: 'stem', part: 0 })
  }

  return <>
    <header className="app-header">
      <div><h1>山东高中学习资源平台</h1><p>POC-001B · 本地试题编辑与 PDF</p></div>
      <div className="actions">
        <button className="primary" disabled={busy || loadBlocked || showOriginal} onClick={() => void perform(save)}>保存本地 JSON</button>
      </div>
    </header>
    <main>
      <nav className="mode-bar" aria-label="工作区">
        <div className="actions">
          <button aria-pressed={mode === 'edit'} disabled={busy} onClick={() => setMode('edit')}>编辑试题</button>
          <button aria-pressed={mode === 'paper'} disabled={busy} onClick={() => setMode('paper')}>题卷预览</button>
          <button aria-pressed={mode === 'answers'} disabled={busy} onClick={() => setMode('answers')}>答案卷预览</button>
        </div>
        {mode !== 'edit' && <div className="actions">
          {mode === 'paper' && <label className="check"><input type="checkbox" checked={longSample} disabled={busy} onChange={(event) => setLongSample(event.target.checked)} />长题分页样本</label>}
          <button className="primary" disabled={busy} onClick={() => void perform(exportPdf)}>导出当前 PDF</button>
        </div>}
      </nav>
      <div className="status" aria-live="polite">
        {error ? <p role="alert">{error}</p> : <p>{busy ? '正在处理…' : message || (dirty ? '有未保存的修改。' : '本地工作区')}</p>}
        {loadBlocked && <p>请备份并修复或移走本地 JSON，重启后再保存。</p>}
      </div>
      {!loaded ? null : mode === 'edit' ? <div className="workspace">
        <aside className="sidebar">
          <h2>示例试题</h2>
          <p>{data.questions.length} 道整题 · {totalParts} 个小问 · {data.questions.reduce((sum, item) => sum + item.score, 0)} 分</p>
          {(showOriginal ? original : data).questions.map((q, index) => <button key={q.id} aria-pressed={selected === index} onClick={() => pick(index)}>
            <span>{index + 1}. {q.subject}</span><small>{q.score} 分</small>
          </button>)}
          <label className="check"><input type="checkbox" disabled={busy} checked={showOriginal} onChange={(event) => {
            setShowOriginal(event.target.checked)
            pick(0)
          }} />查看公共原版</label>
        </aside>
        <section className="panel">
          <h2>{q.subject} · {q.type}</h2>
          <label className="select-field">编辑内容<select value={target.field + ':' + target.part} onChange={(event) => {
            const [field, part] = event.target.value.split(':')
            if (field === 'stem' || field === 'prompt' || field === 'answer') setTarget({ field, part: Number(part) })
          }}>
            <option value="stem:0">整题题干</option>
            {q.parts.flatMap((p, index) => [
              <option key={p.id + '-prompt'} value={'prompt:' + index}>小问 {index + 1} · 题干</option>,
              <option key={p.id + '-answer'} value={'answer:' + index}>小问 {index + 1} · 答案</option>,
            ])}
          </select></label>
          {showOriginal ? <div className="paper original-view"><Content data={activeDoc} /></div>
            : <div inert={busy}><QuestionEditor key={selected + ':' + target.field + ':' + target.part}
              content={activeDoc} onChange={update} onError={setError} /></div>}
        </section>
      </div> : <Paper data={longSample && mode === 'paper' ? withLongStem(showOriginal ? original : data) : showOriginal ? original : data} answer={mode === 'answers'} />}
    </main>
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
