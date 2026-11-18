
import { useEffect, useLayoutEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { ConfirmLeave, ReportGuard } from './leave-guard'
import { paperReader, roleLabels } from './paper-reader-api'
import type { PaperRecord, PdfRole, ReaderTarget, ScreenshotDraft } from './paper-reader-api'
import { PaperReader } from './paper-reader'
import { describeError, sqlite } from './sqlite-api'
import type { QuestionSummary, Subject } from './sqlite-api'
import './paper-reader.css'

export function PaperLibrary({ initialTarget, confirmLeave, reportGuard, openQuestion, openDraft }: {
  initialTarget?: ReaderTarget; confirmLeave: ConfirmLeave; reportGuard: ReportGuard
  openQuestion: (question: QuestionSummary, target?: ReaderTarget) => void; openDraft: (draft: ScreenshotDraft) => void
}) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [records, setRecords] = useState<PaperRecord[]>([])
  const [target, setTarget] = useState(initialTarget)
  const [filter, setFilter] = useState({ subject: '', year: '', region: '' })
  const [importTo, setImportTo] = useState<PaperRecord | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const paper = target && records.find((record) => record.files.some((file) => file.id === target.fileId))
  const file = paper?.files.find((file) => file.id === target?.fileId)

  useEffect(() => {
    let active = true
    void Promise.all([paperReader.records(), sqlite.subjects()]).then(([all, names]) => {
      if (active) { setRecords(all); setSubjects(names) }
    }).catch((reason: unknown) => { if (active) setError(describeError(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useLayoutEffect(() => {
    if (!busy) return
    reportGuard(false, true)
    return () => reportGuard(false, false)
  }, [busy, reportGuard])

  function change(next?: ReaderTarget) {
    confirmLeave(() => { setError(''); setTarget(next) })
  }

  async function submit(data: FormData) {
    setBusy(true)
    setError('')
    const read = (name: string) => String(data.get(name) ?? '').trim()
    try {
      const role = read('role')
      if (role !== 'original' && role !== 'answer' && role !== 'analysis') throw new Error('请选择文件角色。')
      const imported = await paperReader.import({
        paper_id: importTo && importTo !== 'new' ? importTo.id : null,
        title: read('title'), subject_id: read('subject'), year: read('year') ? Number(read('year')) : null,
        region: read('region') || null, source: read('source') || null, role,
      })
      if (!imported) return
      setRecords(await paperReader.records())
      setImportTo(null)
      setTarget({ fileId: imported.id })
    } catch (reason) { setError(describeError(reason)) }
    finally { setBusy(false) }
  }

  const names = new Map(subjects.map((subject) => [subject.id, subject.name]))
  const matching = records.filter((record) =>
    (!filter.subject || filter.subject === record.subject_id) &&
    (!filter.year || filter.year === String(record.year)) &&
    (!filter.region || record.region?.includes(filter.region.trim())))

  if (target) return <main className="paper-library">
    <header className="paper-library-heading">
      <button onClick={() => change()}>返回试卷库</button>
      <h1>{paper?.title ?? '原卷阅读'}</h1>
      {target.returnQuestion && <button onClick={() => openQuestion(target.returnQuestion!)}>返回试题</button>}
      {paper && file && <label>PDF 版本 <select aria-label="PDF 版本" value={file.id}
        onChange={(event) => change({ fileId: event.target.value, returnQuestion: target.returnQuestion })}>
        {paper.files.map((item) => <option key={item.id} value={item.id}>{fileLabel(item.role, item.original_name,
          item.page_count, item.id)}</option>)}
      </select></label>}
    </header>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">正在读取试卷登记…</p>}
    {!loading && !file && <p role="alert">该原卷版本已不存在。</p>}
    {paper && file && <PaperReader key={file.id} file={file} subjectId={paper.subject_id ?? ''} subjects={subjects}
      target={target} reportGuard={reportGuard} openQuestion={openQuestion} openDraft={openDraft} />}
  </main>

  return <main className="paper-library">
    <header className="paper-library-heading">
      <h1>试卷库</h1>
      <button className="primary" disabled={busy || loading} onClick={() => { setError(''); setImportTo('new') }}>导入 PDF</button>
    </header>
    {importTo && <section className="panel pdf-import-form" aria-label="PDF 导入信息">
      <h2>{importTo === 'new' ? '导入新试卷' : '添加文件 · ' + importTo.title}</h2>
      <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        void submit(new FormData(event.currentTarget))
      }}>
        <fieldset disabled={busy}>
          {importTo === 'new' && <>
            <label>试卷标题 <input required name="title" aria-label="试卷标题" maxLength={120} /></label>
            <label>学科 <select required name="subject" aria-label="导入学科" defaultValue="">
              <option value="">选择学科</option>
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select></label>
            <label>年份 <input name="year" type="number" min={1} max={9999} /></label>
            <label>地区 <input name="region" maxLength={120} /></label>
          </>}
          <label>来源 <input name="source" aria-label="PDF 来源" maxLength={120} /></label>
          <label>文件角色 <select name="role" aria-label="文件角色" defaultValue="original">
            {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <div className="actions">
            <button className="primary" type="submit">选择本地 PDF</button>
            <button type="button" onClick={() => { setImportTo(null); setError('') }}>取消导入</button>
          </div>
        </fieldset>
      </form>
      {busy && <p role="status">等待文件选择或校验导入…</p>}
    </section>}
    {error && <p role="alert">{error}</p>}
    <section className="actions paper-library-filters" aria-label="试卷筛选">
      <label>学科 <select aria-label="试卷筛选学科" value={filter.subject}
        onChange={(event) => setFilter({ ...filter, subject: event.target.value })}>
        <option value="">全部学科</option>
        {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
      </select></label>
      <label>年份 <select aria-label="试卷筛选年份" value={filter.year}
        onChange={(event) => setFilter({ ...filter, year: event.target.value })}>
        <option value="">全部年份</option>
        {[...new Set(records.flatMap((record) => record.year === null ? [] : [record.year]))].sort((a, b) => b - a)
          .map((year) => <option key={year}>{year}</option>)}
      </select></label>
      <label>地区 <input aria-label="试卷筛选地区" value={filter.region} maxLength={120}
        onChange={(event) => setFilter({ ...filter, region: event.target.value })} /></label>
    </section>
    {loading && <p role="status">正在读取试卷库…</p>}
    {!loading && !matching.length && <p>没有符合条件的试卷。</p>}
    <div className="paper-library-list">
      {matching.map((record) => <article className="panel" key={record.id}>
        <div>
          <h2>{record.title}</h2>
          <p>{[names.get(record.subject_id ?? ''), record.year, record.region, record.source].filter(Boolean).join(' · ')}</p>
        </div>
        {record.files.length ? <ul>{record.files.map((item) => <li key={item.id}>
          <button disabled={busy} title={'SHA-256 ' + item.sha256} onClick={() => change({ fileId: item.id })}>
            {fileLabel(item.role, item.original_name, item.page_count, item.id)}
          </button>
          <span>{(item.byte_size / 1024).toFixed(1)} KiB{item.source ? ' · ' + item.source : ''}</span>
        </li>)}</ul> : <p>只有来源记录，尚未导入 PDF。</p>}
        <button disabled={busy} onClick={() => { setError(''); setImportTo(record); window.scrollTo(0, 0) }}>添加 PDF 文件</button>
      </article>)}
    </div>
  </main>
}

function fileLabel(role: PdfRole, name: string, pages: number, id: string): string {
  return `${roleLabels[role]} · ${name} · ${pages} 页 · ${id.slice(0, 8)}`
}
