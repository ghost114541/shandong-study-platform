
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { describeError } from './sqlite-api'
import { findText, pageWords, paintPage } from './pdf-document'
import { orderedRect, rotateRect } from './pdf-geometry'
import type { Location, PdfRegion, Rect } from './paper-reader-api'

type Point = readonly [number, number]
export type Zoom = 'fit-page' | 'fit-width' | number

function dimensions(rect: Rect): CSSProperties {
  return {
    left: rect[0] * 100 + '%', top: rect[1] * 100 + '%',
    width: (rect[2] - rect[0]) * 100 + '%', height: (rect[3] - rect[1]) * 100 + '%',
  }
}

function highlight(layer: TextLayer, words: ReturnType<typeof pageWords>, query: string) {
  const { hits, offsets } = findText(words, query)
  for (let index = 0; index < offsets.length; index++) {
    const div = layer.textDivs[index]
    const { start, end } = offsets[index]
    const text = div?.textContent
    const matches = hits.filter((hit) => hit.start < end && start < hit.end)
    if (!div || !text || !matches.length) continue
    const fragments = document.createDocumentFragment()
    let cursor = 0
    for (const hit of matches) {
      const from = Math.max(0, hit.start - start)
      const to = Math.min(text.length, hit.end - start)
      fragments.append(text.slice(cursor, from))
      const mark = document.createElement('mark')
      mark.className = 'pdf-text-hit'
      mark.textContent = text.slice(from, to)
      fragments.append(mark)
      cursor = to
    }
    fragments.append(text.slice(cursor))
    div.replaceChildren(fragments)
  }
}

export function PdfPage({ pdf, index, angle, zoom, query, picking, selections, locations, activeLocation, add, open }: {
  pdf: PDFDocumentProxy; index: number; angle: number; zoom: Zoom; query: string; picking: boolean
  selections: PdfRegion[]; locations: Location[]; activeLocation?: Location
  add: (region: PdfRegion) => void; open: (location: Location) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const dragStart = useRef<Point | null>(null)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [drag, setDrag] = useState<Rect | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const rotation = ((page?.rotate ?? 0) + angle) % 360
  const unit = page?.getViewport({ scale: 1, rotation })
  const scale = unit && (typeof zoom === 'number' ? zoom : Math.max(0.01, Math.min(
    (size.width - 32) / unit.width, zoom === 'fit-width' ? Infinity : (size.height - 32) / unit.height,
  )))
  const width = unit && scale ? unit.width * scale : 0
  const height = unit && scale ? unit.height * scale : 0

  useEffect(() => {
    const node = container.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let live = true
    let loaded: PDFPageProxy | undefined
    void pdf.getPage(index + 1).then((result) => {
      loaded = result
      if (live) setPage(result)
      else result.cleanup()
    }).catch((reason: unknown) => { if (live) setError(describeError(reason)) })
    return () => { live = false; loaded?.cleanup() }
  }, [pdf, index])

  useEffect(() => {
    if (!page || !scale || !canvas.current || size.width <= 1) return
    const node = canvas.current
    let live = true
    let task: RenderTask | undefined
    setReady(false)
    setError('')
    try {
      task = paintPage(page, node, scale * Math.min(2, window.devicePixelRatio || 1), rotation)
      void task.promise.then(() => { if (live) setReady(true) })
        .catch((reason: unknown) => { if (live) setError(describeError(reason)) })
    } catch (reason) { setError(describeError(reason)) }
    return () => {
      live = false
      task?.cancel()
      node.width = 0
      node.height = 0
    }
  }, [page, scale, rotation, size.width > 1])

  useEffect(() => {
    if (!page || !scale || !query || !text.current) return
    const node = text.current
    let live = true
    let layer: TextLayer | undefined
    void page.getTextContent().then(async (content) => {
      if (!live) return
      layer = new TextLayer({
        textContentSource: content, container: node, viewport: page.getViewport({ scale, rotation }),
      })
      await layer.render()
      if (live) highlight(layer, pageWords(content), query)
    }).catch((reason: unknown) => { if (live) setError(describeError(reason)) })
    return () => { live = false; layer?.cancel(); node.replaceChildren() }
  }, [page, scale, query, rotation])

  function pointer(event: PointerEvent<HTMLDivElement>): Point {
    const box = event.currentTarget.getBoundingClientRect()
    const clamp = (value: number) => Math.max(0, Math.min(1, value))
    return [clamp((event.clientX - box.left) / box.width), clamp((event.clientY - box.top) / box.height)]
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return
    const rect = orderedRect(dragStart.current, pointer(event))
    dragStart.current = null
    setDrag(null)
    if ((rect[2] - rect[0]) * width >= 4 && (rect[3] - rect[1]) * height >= 4) {
      add({ page_index: index, rect: rotateRect(rect, -rotation) })
    }
  }

  return <div className="pdf-viewport" ref={container}>
    {error && <p role="alert" className="pdf-page-error">第 {index + 1} 页无法显示。{error}</p>}
    {!ready && !error && <p role="status" className="pdf-page-error">正在渲染第 {index + 1} 页…</p>}
    <div className="pdf-sheet" data-pdf-page={index + 1} data-pdf-ready={ready}
      style={{ width, height, '--total-scale-factor': (scale ?? 1) * (page?.userUnit ?? 1) } as CSSProperties}>
      <canvas ref={canvas} aria-label={`PDF 第 ${index + 1} 页`} />
      <div className="pdf-text-layer" ref={text} aria-hidden="true" />
      {ready && locations.map((item) => {
        const active = item.source_key === activeLocation?.source_key && item.ordinal === activeLocation.ordinal
        return <button key={item.source_key + ':' + item.ordinal} type="button" className="pdf-region-marker"
          data-current={active} title={`打开试题 · ${item.source_key} · 区域 ${item.ordinal + 1}`}
          aria-label={`打开试题 · ${item.source_key} · 区域 ${item.ordinal + 1}`}
          style={dimensions(rotateRect(item.rect, rotation))} disabled={picking}
          onClick={() => open(item)}><span>{item.source_key}</span></button>
      })}
      {ready && selections.map((selection, position) => <div key={position} className="pdf-selection"
        style={dimensions(rotateRect(selection.rect, rotation))} />)}
      {ready && picking && <div className="pdf-pick-layer" aria-label="拖动选取题目区域"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          dragStart.current = pointer(event)
        }}
        onPointerMove={(event) => {
          if (event.isPrimary && dragStart.current) setDrag(orderedRect(dragStart.current, pointer(event)))
        }}
        onPointerUp={finish} onLostPointerCapture={() => { dragStart.current = null; setDrag(null) }}>
        {drag && <div className="pdf-selection" style={dimensions(drag)} />}
      </div>}
    </div>
  </div>
}

export function PdfThumbnail({ pdf, index, angle }: { pdf: PDFDocumentProxy; index: number; angle: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const node = canvas.current
    if (!node) return
    let live = true
    let task: RenderTask | undefined
    let loaded: PDFPageProxy | undefined
    void pdf.getPage(index + 1).then((page) => {
      loaded = page
      if (!live) { page.cleanup(); return }
      const rotation = (page.rotate + angle) % 360
      const view = page.getViewport({ scale: 1, rotation })
      task = paintPage(page, node, Math.min(84 / view.width, 95 / view.height), rotation)
      return task.promise.then(() => { if (live) node.dataset.pdfThumbReady = 'true' })
    }).catch(() => { if (live) node.width = 0 })
    return () => { live = false; task?.cancel(); node.width = 0; delete node.dataset.pdfThumbReady; loaded?.cleanup() }
  }, [pdf, index, angle])
  return <canvas ref={canvas} width={0} height={0} aria-hidden="true" />
}
