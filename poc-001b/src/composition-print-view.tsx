import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'
import { CompositionPaper } from './composition-paper'
import type { PrintSnapshot } from './composition-api'
import { describeError } from './sqlite-api'

interface PrintPayload {
  snapshot: PrintSnapshot
  images: Record<string, string>
}

async function prepareLayout(article: HTMLElement) {
  if (article.querySelector('[data-print-image-missing], .katex-error')) {
    throw new Error('打印快照存在未验证的图片或无法排版的公式。')
  }
  await Promise.all(Array.from(article.querySelectorAll('img'), async (image) => {
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('打印图片没有有效像素。')
  }))
  // Force layout before waiting for locally bundled KaTeX fonts.
  const availableWidth = article.getBoundingClientRect().width
  await document.fonts.ready
  if (document.fonts.status !== 'loaded' || [...document.fonts].some((face) => face.status === 'error')) {
    throw new Error('打印字体未准备完成。')
  }
  for (const formula of article.querySelectorAll<HTMLElement>('.formula-source')) {
    const formulaWidth = formula.querySelector('.katex-html')?.getBoundingClientRect().width ?? 0
    if (formulaWidth > availableWidth - 16) {
      const ratio = (availableWidth - 16) / formulaWidth
      if (ratio < 0.55) throw new Error('公式过宽，请在题目中分行后另存并明确更新组卷修订。')
      formula.style.fontSize = ratio * 0.98 + 'em'
    }
  }
  for (const entry of article.querySelectorAll<HTMLElement>('.composition-print-entry')) {
    if (entry.getBoundingClientRect().height < 240) entry.dataset.keepTogether = 'true'
  }
  // Force a final style/layout pass after image and formula sizing.
  article.getBoundingClientRect()
}

export function PrintView({ token }: { token: string }) {
  const [payload, setPayload] = useState<PrintPayload | null>(null)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    void invoke<ArrayBuffer>('composition_print_payload', { token })
      .then((bytes) => {
        const data: PrintPayload = JSON.parse(new TextDecoder().decode(bytes))
        if (active) setPayload(data)
      })
      .catch((error: unknown) => {
        if (active) void invoke('composition_print_ready', { token, identity: null, failure: describeError(error) }).catch(() => {})
      })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    const article = container.current?.querySelector('article')
    if (!article || !payload) return
    let active = true
    void prepareLayout(article).then(() => {
      if (active) return invoke('composition_print_ready', { token, identity: payload.snapshot.identity, failure: null })
    }).catch((error: unknown) => {
      if (active) void invoke('composition_print_ready', { token, identity: payload.snapshot.identity, failure: describeError(error) }).catch(() => {})
    })
    return () => { active = false }
  }, [payload, token])

  return <div ref={container} className="controlled-print">
    {payload && <CompositionPaper snapshot={payload.snapshot} images={payload.images} />}
  </div>
}
