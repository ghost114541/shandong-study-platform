
import { AnnotationMode, getDocument, GlobalWorkerOptions, PDFDataRangeTransport } from 'pdfjs-dist'
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { paperReader } from './paper-reader-api'
import type { Rect } from './paper-reader-api'

const MiB = 1024 * 1024
GlobalWorkerOptions.workerSrc = workerUrl

class RegisteredPdf extends PDFDataRangeTransport {
  private stopped = false
  constructor(length: number, private token: number, private onError: (error: unknown) => void) {
    super(length, null)
  }

  override requestDataRange(begin: number, end: number): void {
    void this.read(begin, end).catch((error: unknown) => {
      if (!this.stopped) this.onError(error)
    })
  }

  private async read(begin: number, end: number): Promise<void> {
    const data = new Uint8Array(end - begin)
    for (let offset = begin; offset < end && !this.stopped; offset += MiB) {
      const chunk = new Uint8Array(await paperReader.chunk(this.token, offset, Math.min(end, offset + MiB)))
      data.set(chunk, offset - begin)
    }
    if (!this.stopped) this.onDataRange(begin, data)
  }

  override abort(): void {
    if (this.stopped) return
    this.stopped = true
    void paperReader.close(this.token).catch(() => {})
  }
}

export function loadRegisteredPdf(token: number, length: number, onError: (error: unknown) => void) {
  const range = new RegisteredPdf(length, token, onError)
  const assets = new URL('pdf-resources/', document.baseURI).href
  try {
    const task = getDocument({
      range, cMapUrl: assets + 'cmaps/', cMapPacked: true,
      standardFontDataUrl: assets + 'standard_fonts/', iccUrl: assets + 'iccs/',
      disableStream: true, disableAutoFetch: true, stopAtErrors: true,
      disableWorkerRendering: true, enableXfa: false, useWasm: false,
      maxImageSize: 16_000_000, canvasMaxAreaInBytes: 64 * MiB,
    })
    return {
      promise: task.promise,
      close() {
        range.abort()
        void task.destroy().catch(() => {})
      },
    }
  } catch (reason) {
    range.abort()
    throw reason
  }
}

export function paintPage(page: PDFPageProxy, canvas: HTMLCanvasElement, scale: number, rotation: number,
  { clip, print = false }: { clip?: Rect; print?: boolean } = {}): RenderTask {
  const viewport = page.getViewport({ scale, rotation })
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) ||
      viewport.width <= 0 || viewport.height <= 0) throw new Error('PDF 页面尺寸无效。')
  const [x0, y0, x1, y1] = clip ?? [0, 0, 1, 1]
  const left = Math.floor(x0 * viewport.width)
  const top = Math.floor(y0 * viewport.height)
  const width = Math.ceil(x1 * viewport.width) - left
  const height = Math.ceil(y1 * viewport.height) - top
  if (width > 4096 || height > 4096 || width * height > 12_000_000) {
    throw new Error('渲染超过 4096 像素边长或 1200 万像素。请缩小选区或降低浏览缩放。')
  }
  canvas.width = width
  canvas.height = height
  return page.render({
    canvas, viewport, annotationMode: AnnotationMode.DISABLE,
    intent: print ? 'print' : 'display', background: '#ffffff',
    transform: clip ? [1, 0, 0, 1, -left, -top] : undefined,
  })
}

export function png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('无法编码 PNG 截图。')), 'image/png'))
}

export function pageWords(content: Awaited<ReturnType<PDFPageProxy['getTextContent']>>) {
  return content.items.flatMap((item) => 'str' in item ? [{ text: item.str, newline: item.hasEOL }] : [])
}

export function findText(words: ReturnType<typeof pageWords>, query: string) {
  let text = ''
  const offsets = words.map(({ text: word, newline }) => {
    const start = text.length
    text += word.toLowerCase()
    const end = text.length
    if (newline) text += ' '
    return { start, end }
  })
  const hits: { start: number; end: number }[] = []
  const needle = query.trim().toLowerCase()
  if (needle) {
    for (let start = text.indexOf(needle); start !== -1 && hits.length < 200;
      start = text.indexOf(needle, start + needle.length)) hits.push({ start, end: start + needle.length })
  }
  return { hits, offsets, hasText: Boolean(text.trim()) }
}
