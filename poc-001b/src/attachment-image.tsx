import { invoke } from '@tauri-apps/api/core'
import { createContext, useContext, useEffect, useState } from 'react'
import type { Attachment, RichImageAttributes } from './model'
import { describeError } from './sqlite-api'

export const AttachmentDeclarations = createContext<readonly Attachment[]>([])
export const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const imageByteLimit = 5 * 1024 * 1024

export async function importImage(file: File): Promise<Attachment> {
  return invoke<Attachment>('import_attachment', await file.arrayBuffer(), { headers: { 'x-image-media-type': file.type } })
}

type ImageStatus = { src: string } | { error: string }

export function AttachmentImage({ id, attrs, className }: {
  id: string; attrs: RichImageAttributes; className?: string
}) {
  const declared = useContext(AttachmentDeclarations).find((item) => item.id === id)
  const [result, setResult] = useState<{ id: string; declared?: Attachment; status: ImageStatus } | null>(null)
  const status = result?.id === id && result.declared === declared ? result.status : null

  useEffect(() => {
    let active = true
    void invoke<string>('read_attachment', { attachmentId: id, expected: declared }).then(async (src) => {
      if (!active) return
      const image = new Image()
      image.src = src
      await image.decode().catch(() => { throw new Error('附件 ' + id + ' 无法在浏览器中解码。') })
      if (active) setResult({ id, declared, status: { src } })
    }).catch((error: unknown) => {
      if (active) setResult({ id, declared, status: { error: describeError(error) } })
    })
    return () => { active = false }
  }, [id, declared])

  if (!status || 'error' in status) {
    return <span className="attachment-notice" role={status ? 'alert' : 'status'}>
      {status ? status.error : '正在加载图片附件…'}
    </span>
  }
  return <img src={status.src} className={className} alt={attrs.alt ?? ''} title={attrs.title ?? undefined}
    style={{ width: attrs.width ?? undefined, height: attrs.height ?? undefined }} />
}
