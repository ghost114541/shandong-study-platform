
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { importImage, imageByteLimit } from './attachment-image'
import { defaultFilters, knowledge } from './knowledge-api'
import type { SearchPage } from './knowledge-api'
import type { ReportGuard } from './leave-guard'
import type { Attachment } from './model'
import { paperReader } from './paper-reader-api'
import type { Location, PaperFile, PdfRegion, ReaderTarget, RegionLink, ScreenshotDraft } from './paper-reader-api'
import { findText, loadRegisteredPdf, pageWords, paintPage, png } from './pdf-document'
import { rotateRect } from './pdf-geometry'
import { PdfPage, PdfThumbnail } from './pdf-page'
import type { Zoom } from './pdf-page'
import { PaperPrintDialog } from './paper-print-dialog'
import { describeError } from './sqlite-api'
import type { QuestionSummary, Subject } from './sqlite-api'

type Callbacks = {
  reportGuard: ReportGuard
  openQuestion: (question: QuestionSummary, target: ReaderTarget) => void
  openDraft: (draft: ScreenshotDraft) => void
}

export function PaperReader({ file, subjectId, subjects, target, ...callbacks }: Callbacks & {
  file: PaperFile; subjectId: string; subjects: Subject[]; target: ReaderTarget
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    let loading: ReturnType<typeof loadRegisteredPdf> | undefined
    const fail = (reason: unknown) => {
      if (!live) return
      live = false
      setPdf(null)
      setError(describeError(reason))
      loading?.close()
    }
    const timeout = window.setTimeout(() => fail(new Error('读取 PDF 超时。')), 30_000)
    void paperReader.open(file.id).then(async ({ token, file: registered }) => {
      if (!live) { await paperReader.close(token); return }
      if (registered.id !== file.id) {
        await paperReader.close(token)
        throw new Error('返回的原卷版本与请求不一致。')
      }
      loading = loadRegisteredPdf(token, registered.byte_size, fail)
      const document = await loading.promise
      if (!live) return
      if (document.numPages !== registered.page_count) throw new Error('实际页数与登记信息不一致。')
      if (target.page !== undefined && (target.page < 0 || target.page >= document.numPages)) {
        throw new Error('关联的页码超过这份原卷的实际页数。')
      }
      setPdf(document)
    }).catch(fail).finally(() => clearTimeout(timeout))
    return () => { live = false; clearTimeout(timeout); loading?.close() }
  }, [file.id, target.page])

  if (error) return <p role="alert" className="pdf-load-error">无法打开《{file.original_name}》。{error}</p>
  if (!pdf) return <p role="status" className="pdf-load-error">正在核验 SHA-256 并打开 PDF…</p>
  return <ReaderView pdf={pdf} file={file} subjectId={subjectId} subjects={subjects} target={target} {...callbacks} />
}

function ReaderView({ pdf, file, subjectId, subjects, target, reportGuard, openQuestion, openDraft }: Callbacks & {
  pdf: PDFDocumentProxy; file: PaperFile; subjectId: string; subjects: Subject[]; target: ReaderTarget
}) {
  const [page, setPage] = useState(target.page ?? 0)
  const [pageInput, setPageInput] = useState(String(page + 1))
  const [angle, setAngle] = useState(0)
  const [zoom, setZoom] = useState<Zoom>('fit-page')
  const [thumbs, setThumbs] = useState(true)
  const [locations, setLocations] = useState<Location[]>([])
  const [highlight, setHighlight] = useState<Location>()
  const [picking, setPicking] = useState(false)
  const [selections, setSelections] = useState<PdfRegion[]>([])
  const [correction, setCorrection] = useState<Location | null>(null)
  const [showLink, setShowLink] = useState(false)
  const [showLocations, setShowLocations] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ index: number; count: number }[]>([])
  const [searched, setSearched] = useState('')
  const [searchStatus, setSearchStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const searchRun = useRef(0)
  const live = useRef(true)

  useLayoutEffect(() => {
    reportGuard(picking && selections.length > 0, busy)
    return () => reportGuard(false, false)
  }, [picking, selections.length, busy, reportGuard])

  function applyLocations(rows: Location[]) {
    if (live.current) setLocations(rows)
  }

  useEffect(() => {
    void paperReader.fileLocations(file.id).then((rows) => {
      if (!live.current) return
      applyLocations(rows)
      const requested = target.location
      if (requested) {
        const item = rows.find((row) => row.source_key === requested.source_key && row.ordinal === requested.ordinal
          && row.page_index === target.page && row.question_id === requested.question_id && row.paper_id === requested.paper_id
          && row.rect.every((value, index) => value === requested.rect[index]))
        if (item) setHighlight(item)
        else {
          setHighlight(undefined)
          setError('这个原卷定位已修改或不存在，请回到试题重新选择。')
        }
      }
    }).catch((reason: unknown) => { if (live.current) setError(describeError(reason)) })
    return () => { live.current = false; searchRun.current++ }
  }, [file.id, target])

  function jump(next: number) {
    if (next < 0 || next >= pdf.numPages) return
    setPage(next)
    setPageInput(String(next + 1))
  }

  function goToPage(event: FormEvent) {
    event.preventDefault()
    const number = Number(pageInput)
    if (!Number.isInteger(number) || number < 1 || number > pdf.numPages) {
      setError(`请输入 1 至 ${pdf.numPages} 的页码。`)
      return
    }
    setError('')
    jump(number - 1)
  }

  async function search(event: FormEvent) {
    event.preventDefault()
    const keyword = query.trim()
    const id = ++searchRun.current
    setResults([])
    setSearched('')
    setSearchStatus('')
    if (!keyword) return
    let hasText = false
    const found: typeof results = []
    try {
      for (let index = 0; index < pdf.numPages && id === searchRun.current; index++) {
        setSearchStatus(`正在搜索 ${index + 1} / ${pdf.numPages} 页…`)
        const current = await pdf.getPage(index + 1)
        const { hits, hasText: hasPageText } = findText(pageWords(await current.getTextContent()), keyword)
        if (index !== page) current.cleanup()
        if (hits.length) found.push({ index, count: hits.length })
        hasText ||= hasPageText
      }
      if (id !== searchRun.current) return
      setResults(found)
      setSearched(keyword)
      setSearchStatus(found.length ? `${found.length} 页包含关键词`
        : hasText ? '没有找到匹配文字。' : '这份 PDF 无可提取文字。扫描件暂不支持 OCR。')
      if (found.length) jump(found[0].index)
    } catch (reason) {
      if (id === searchRun.current) setSearchStatus('搜索失败。' + describeError(reason))
    }
  }

  function resetSelection() {
    setPicking(false)
    setSelections([])
    setShowLink(false)
    setCorrection(null)
  }

  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setStatus('')
    try { await action() }
    catch (reason) { if (live.current) setError(describeError(reason)) }
    finally { if (live.current) setBusy(false) }
  }

  function openLinked(location: Location) {
    void perform(async () => {
      const question = await paperReader.question(location)
      reportGuard(false, false)
      openQuestion(question, { fileId: file.id, page: location.page_index, location })
    })
  }

  function add(region: PdfRegion) {
    if (selections.length >= 64) { setError('每题最多选择 64 个区域。'); return }
    setSelections([...selections, region])
  }

  function link(sourceKey: string): RegionLink {
    return { file_id: file.id, source_key: sourceKey.trim() || ('区域-' + crypto.randomUUID().slice(0, 8)), regions: selections }
  }

  async function attach(questionId: string, sourceKey: string) {
    const previous = correction
    const region = link(previous?.source_key ?? sourceKey)
    await paperReader.link(questionId, region, Boolean(previous))
    const rows = await paperReader.fileLocations(file.id)
    applyLocations(rows)
    const location = rows.find((row) => row.source_key === region.source_key && row.question_id === questionId)
    setHighlight(location)
    resetSelection()
    setStatus(previous ? '原卷区域已更正。' : '原卷区域已关联。')
    if (location) jump(location.page_index)
  }

  async function capture(sourceKey: string, selectedSubject: string) {
    const canvas = document.createElement('canvas')
    const images: Blob[] = []
    let totalBytes = 0
    try {
      for (const [index, region] of selections.entries()) {
        const source = await pdf.getPage(region.page_index + 1)
        try {
          const rotation = (source.rotate + angle) % 360
          const clip = rotateRect(region.rect, rotation)
          // Capture at 144 DPI, independent of the current display zoom and display DPI.
          await paintPage(source, canvas, 2, rotation, { clip }).promise
          const image = await png(canvas)
          if (image.size > imageByteLimit) throw new Error(`第 ${index + 1} 张截图超过 5 MiB。请缩小选区。`)
          totalBytes += image.size
          if (totalBytes > 24 * 1024 * 1024) throw new Error('单题截图合计超过 24 MiB，请缩小选区或分批关联。')
          images.push(image)
        } finally {
          if (region.page_index !== page) source.cleanup()
        }
      }
    } finally { canvas.width = 0; canvas.height = 0 }
    const attachments: Attachment[] = []
    for (const image of images) attachments.push(await importImage(new File([image], '原卷截图.png', { type: 'image/png' })))
    const source = link(sourceKey)
    reportGuard(false, false)
    openDraft({ attachments, link: source, subjectId: selectedSubject, target: { fileId: file.id, page: selections[0].page_index } })
  }

  function correct(item: Location) {
    setCorrection(item)
    setSelections(locations.filter((row) => row.source_key === item.source_key)
      .map(({ page_index, rect }) => ({ page_index, rect })))
    setPicking(true)
    setShowLocations(false)
    jump(item.page_index)
  }

  const firstThumbnail = Math.max(0, Math.min(page - 2, pdf.numPages - 5))
  const pageLocations = locations.filter((item) => item.page_index === page)
  return <section className="reader-workspace" aria-label="PDF 阅读器">
    <div className="reader-controls">
      <div className="actions">
        <button disabled={page <= 0 || busy} onClick={() => jump(page - 1)}>上一页</button>
        <button disabled={page + 1 >= pdf.numPages || busy} onClick={() => jump(page + 1)}>下一页</button>
        <form className="actions" onSubmit={goToPage}>
          <label>页码 <input aria-label="跳转页码" type="number" min={1} max={pdf.numPages} value={pageInput}
            onChange={(event) => setPageInput(event.target.value)} /></label>
          <span>/ {pdf.numPages}</span><button type="submit" disabled={busy}>跳转</button>
        </form>
        <label>缩放 <select aria-label="页面缩放" value={zoom} disabled={busy}
          onChange={(event) => setZoom(event.target.value === 'fit-page' || event.target.value === 'fit-width'
            ? event.target.value : Number(event.target.value))}>
          <option value="fit-page">适合整页</option><option value="fit-width">适合宽度</option>
          {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((value) => <option key={value} value={value}>{value * 100}%</option>)}
        </select></label>
        <button disabled={busy} onClick={() => setAngle((value) => (value + 90) % 360)}>旋转</button>
        <button disabled={busy} aria-pressed={thumbs} onClick={() => setThumbs(!thumbs)}>缩略图</button>
      </div>
      <div className="actions">
        <form className="actions" onSubmit={(event) => void search(event)}>
          <input aria-label="PDF 搜索关键词" value={query} maxLength={120} placeholder="在 PDF 中搜索"
            onChange={(event) => setQuery(event.target.value)} />
          <button type="submit" disabled={busy || !query.trim()}>搜索 PDF</button>
        </form>
        {searched && <button onClick={() => { searchRun.current++; setSearched(''); setResults([]); setSearchStatus('') }}>清除搜索</button>}
        <button disabled={busy} onClick={() => void perform(async () => {
          if (await paperReader.save(file.id)) setStatus('原始 PDF 已保存。')
        })}>保存原始 PDF</button>
        <button disabled={busy} onClick={() => setPrinting(true)}>打印原卷</button>
        {file.role === 'original' && <>
          <button disabled={busy} aria-pressed={showLocations} onClick={() => setShowLocations(!showLocations)}>
            已关联试题（{new Set(locations.map((row) => row.source_key)).size}）
          </button>
          <button className="primary" disabled={busy || picking} onClick={() => setPicking(true)}>截取题目</button>
        </>}
      </div>
      {picking && <div className="actions pdf-selection-controls">
        <span>{correction ? '更正区域 · ' + correction.source_key : '拖动框选题目，可翻页继续选取。'}</span>
        <strong>已选 {selections.length} 个区域</strong>
        {selections.map((region, index) => <button key={index} disabled={busy} title={`跳到选区 ${index + 1}`}
          onClick={() => jump(region.page_index)}>第 {region.page_index + 1} 页</button>)}
        <button disabled={busy || !selections.length} onClick={() => setSelections(selections.slice(0, -1))}>撤销最后选区</button>
        <button disabled={busy || !selections.length} onClick={() => setSelections([])}>清空选区</button>
        <button disabled={busy} onClick={resetSelection}>取消截题</button>
        <button className="primary" disabled={busy || !selections.length}
          onClick={() => correction ? void perform(() => attach(correction.question_id, correction.source_key))
            : setShowLink(true)}>{correction ? '保存区域更正' : '继续处理选区'}</button>
      </div>}
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {searchStatus && <p role="status">{searchStatus}</p>}
      {results.length > 0 && <div className="actions pdf-search-results" aria-label="PDF 搜索结果">
        {results.map(({ index, count }) => <button key={index} aria-pressed={page === index} disabled={busy}
          onClick={() => jump(index)}>第 {index + 1} 页 · {count} 处</button>)}
      </div>}
    </div>
    {showLocations && <div className="pdf-linked-questions">
      {locations.length === 0 && <p>暂未关联试题。</p>}
      {locations.map((item) => <div key={item.source_key + ':' + item.ordinal} className="actions">
        <button disabled={busy} onClick={() => { setHighlight(item); jump(item.page_index); setShowLocations(false) }}>
          {item.source_key} · 第 {item.page_index + 1} 页 · 区域 {item.ordinal + 1}
        </button>
        <button disabled={busy || picking} onClick={() => openLinked(item)}>打开试题</button>
        <button disabled={busy || picking} onClick={() => correct(item)}>更正区域</button>
      </div>)}
    </div>}
    <div className="pdf-reading-area">
      {thumbs && <aside className="pdf-thumbnails" aria-label="PDF 缩略图">
        {Array.from({ length: Math.min(5, pdf.numPages) }, (_, offset) => {
          const index = firstThumbnail + offset
          return <button key={index} disabled={busy} aria-label={`缩略图第 ${index + 1} 页`}
            aria-pressed={index === page} onClick={() => jump(index)}>
            <PdfThumbnail pdf={pdf} index={index} angle={angle} /><span>{index + 1}</span>
          </button>
        })}
      </aside>}
      <PdfPage key={page} pdf={pdf} index={page} angle={angle} zoom={zoom} query={searched}
        picking={picking && !busy} selections={selections.filter((region) => region.page_index === page)}
        locations={pageLocations} activeLocation={highlight}
        add={add} open={openLinked} />
    </div>
    {showLink && <LinkDialog busy={busy} count={selections.length} close={() => setShowLink(false)}
      subjectId={subjectId} subjects={subjects} error={error}
      capture={(key, subject) => void perform(() => capture(key, subject))}
      link={(question, key) => void perform(() => attach(question, key))} />}
    {printing && <PaperPrintDialog pdf={pdf} close={() => setPrinting(false)} />}
  </section>
}

function LinkDialog({ busy, count, subjectId, subjects, error, close, capture, link }: {
  busy: boolean; count: number; subjectId: string; subjects: Subject[]; error: string; close: () => void
  capture: (sourceKey: string, subject: string) => void; link: (questionId: string, sourceKey: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [source, setSource] = useState('')
  const [subject, setSubject] = useState(subjectId)
  const [keyword, setKeyword] = useState('')
  const [result, setResult] = useState<SearchPage | null>(null)
  const [page, setPage] = useState(0)
  const [applied, setApplied] = useState('')
  const [selection, setSelection] = useState('')
  const [loading, setLoading] = useState(true)
  const [searchError, setSearchError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => {
    let live = true
    setLoading(true)
    setSearchError('')
    setSelection('')
    void knowledge.search({ ...defaultFilters(), keyword: applied }, page).then((rows) => {
      if (live) setResult(rows)
    }).catch((reason: unknown) => { if (live) setSearchError(describeError(reason)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [page, applied])

  return <dialog ref={dialog} className="pdf-link-dialog" aria-labelledby="pdf-link-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) close() }}>
    <h3 id="pdf-link-title">处理 {count} 个原卷区域</h3>
    <label>原题号或位置 <input aria-label="原题号或位置" value={source} maxLength={120}
      placeholder="留空时生成位置编号" disabled={busy} onChange={(event) => setSource(event.target.value)} /></label>
    {!subjectId && <label> 新题学科 <select value={subject} disabled={busy} onChange={(event) => setSubject(event.target.value)}>
      <option value="">选择学科</option>
      {subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>}
    <div className="actions">
      <button className="primary" disabled={busy || !subject} onClick={() => capture(source, subject)}>截图并新建试题</button>
      <button disabled={busy || loading || !selection} onClick={() => link(selection, source)}>关联所选试题</button>
      <button disabled={busy} onClick={close}>返回选区</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">正在处理选区…</p>}
    <form className="actions" onSubmit={(event) => {
      event.preventDefault(); setApplied(keyword.trim()); setPage(0)
    }}>
      <input aria-label="查找已有试题" value={keyword} maxLength={120} onChange={(event) => setKeyword(event.target.value)} />
      <button disabled={busy || loading}>查找已有试题</button>
    </form>
    {searchError && <p role="alert">{searchError}</p>}
    <div className="pdf-question-options">
      {result?.hits.map((item) => <label key={item.id}>
        <input type="radio" name="reader-question" disabled={busy || loading} checked={selection === item.id}
          onChange={() => setSelection(item.id)} />
        {item.snippet || item.id} · {item.question_type ?? '试题'} · #{item.current_revision_id}
      </label>)}
      {!loading && !result?.hits.length && <p>没有匹配的试题。</p>}
    </div>
    <div className="actions">
      <button disabled={busy || loading || page === 0} onClick={() => setPage(page - 1)}>上一组试题</button>
      <button disabled={busy || loading || !result?.has_next}
        onClick={() => setPage(page + 1)}>下一组试题</button>
    </div>
  </dialog>
}
