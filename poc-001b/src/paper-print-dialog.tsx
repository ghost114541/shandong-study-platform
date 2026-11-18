
import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { paintPage, png } from './pdf-document'
import { describeError } from './sqlite-api'

const MAX_PRINT_BYTES = 48 * 1024 * 1024
const MAX_PRINT_PIXELS = 72_000_000

export function PaperPrintDialog({ pdf, close }: { pdf: PDFDocumentProxy; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [start, setStart] = useState('1')
  const [end, setEnd] = useState(String(pdf.numPages))
  const [pages, setPages] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef(true)
  const urls = useRef<string[]>([])
  const task = useRef<RenderTask | null>(null)

  useEffect(() => {
    dialog.current?.showModal()
    return () => {
      active.current = false
      task.current?.cancel()
      urls.current.forEach((url) => URL.revokeObjectURL(url))
      document.body.classList.remove('printing-source-pdf')
    }
  }, [])

  async function prepare() {
    setError('')
    const first = Number(start)
    const last = Number(end)
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first ||
        last > pdf.numPages || last - first >= 100) {
      setError('请选择有效的打印范围，每批最多 100 页。')
      return
    }
    setBusy(true)
    setPages([])
    urls.current.forEach((url) => URL.revokeObjectURL(url))
    urls.current = []
    let total = 0
    let pixels = 0
    const canvas = document.createElement('canvas')
    try {
      for (let index = first; index <= last; index++) {
        if (!active.current) break
        setStatus(`正在准备第 ${index} / ${last} 页…`)
        const page = await pdf.getPage(index)
        if (!active.current) break
        task.current = paintPage(page, canvas, 2, page.rotate, { print: true })
        await task.current.promise
        pixels += canvas.width * canvas.height
        if (pixels > MAX_PRINT_PIXELS) throw new Error('打印页面像素合计超过上限。请缩小打印页范围后重试。')
        const blob = await png(canvas)
        page.cleanup()
        if (!active.current) break
        total += blob.size
        if (total > MAX_PRINT_BYTES) throw new Error('打印准备超过 48 MiB。请缩小打印页范围后重试。')
        urls.current.push(URL.createObjectURL(blob))
      }
      if (active.current) {
        await Promise.all(urls.current.map((url) => {
          const image = new Image()
          image.src = url
          return image.decode()
        }))
        if (active.current) setPages([...urls.current])
      }
    } catch (reason) {
      urls.current.forEach((url) => URL.revokeObjectURL(url))
      urls.current = []
      if (active.current) setError(describeError(reason))
    } finally {
      task.current = null
      canvas.width = 0
      canvas.height = 0
      if (active.current) { setStatus(''); setBusy(false) }
    }
  }

  async function systemPrint() {
    setError('')
    document.body.classList.add('printing-source-pdf')
    try { await invoke('show_source_print_dialog') }
    catch (reason) { if (active.current) setError(describeError(reason)) }
  }

  return <>
    <dialog ref={dialog} onCancel={close} aria-labelledby="pdf-print-title">
      <form onSubmit={(event) => { event.preventDefault(); void prepare() }}>
        <h3 id="pdf-print-title">打印原始 PDF</h3>
        <div className="actions">
          <label>起始页 <input aria-label="起始页" type="number" min={1} max={pdf.numPages} value={start} disabled={busy}
            onChange={(event) => { setStart(event.target.value); setPages([]) }} /></label>
          <label>结束页 <input aria-label="结束页" type="number" min={1} max={pdf.numPages} value={end} disabled={busy}
            onChange={(event) => { setEnd(event.target.value); setPages([]) }} /></label>
        </div>
        {status && <p role="status">{status}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={busy}>准备打印页面</button>
          <button type="button" onClick={() => void systemPrint()} disabled={!pages.length || busy}>打开系统打印</button>
          <button type="button" onClick={close}>关闭打印</button>
        </div>
      </form>
    </dialog>
    {pages.length > 0 && <div className="source-print-pages" aria-hidden="true">
      {pages.map((url) => <div key={url}><img src={url} alt="" /></div>)}
    </div>}
  </>
}
