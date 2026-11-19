import { useRef, useState } from 'react'
import { protection, trashLabels } from './data-protection-api'
import type { TrashKind } from './data-protection-api'
import { describeError } from './sqlite-api'

export function TrashButton({ kind, id, disabled, onTrashed }: {
  kind: TrashKind; id: string; disabled?: boolean; onTrashed: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function remove() {
    setBusy(true)
    try {
      await protection.move(kind, id)
      dialog.current?.close()
      onTrashed()
    } catch (cause) {
      setError(describeError(cause))
    } finally { setBusy(false) }
  }
  return <>
    <button disabled={disabled || busy} onClick={() => { setError(''); dialog.current?.showModal() }}>移入回收站</button>
    <dialog ref={dialog} onCancel={(event) => { if (busy) event.preventDefault() }}>
      <h3>移入回收站</h3>
      <p>{trashLabels[kind]}将从相应资源库隐藏。收藏、原卷和固定组卷中的历史引用会保留。</p>
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <button autoFocus disabled={busy} onClick={() => dialog.current?.close()}>取消</button>
        <button disabled={busy} onClick={() => void remove()}>确认移入回收站</button>
      </div>
    </dialog>
  </>
}
