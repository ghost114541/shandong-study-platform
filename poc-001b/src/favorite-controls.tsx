import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { favoriteLabels, favorites } from './favorites-api'
import type { FavoriteMembership, FavoriteRef, FavoriteStatus } from './favorites-api'
import { describeError } from './sqlite-api'
import { useFavoriteRead, writeFavorites } from './use-favorites'

export function FavoriteModal({ title, busy, close, children }: {
  title: string; busy: boolean; close: () => void; children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return <dialog ref={ref} className="favorite-modal" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!busy) close() }}>
    <h2 id={titleId}>{title}</h2>
    {children}
  </dialog>
}

export function FavoritePicker({ targets, memberships, initialSource, onClose, onSuccess }: {
  targets: FavoriteRef[]
  memberships?: FavoriteMembership[]
  initialSource?: string
  onClose: () => void
  onSuccess: (message: string) => void
}) {
  const collections = useFavoriteRead('picker collections', favorites.collections)
  const [destination, setDestination] = useState('default')
  const [source, setSource] = useState(initialSource ?? memberships?.[0]?.id ?? '')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const single = targets.length === 1 ? targets[0] : null
  const membership = memberships?.find((entry) => entry.id === source)
  const validDestination = collections.value?.some(({ id }) => id === destination)

  async function save(task: () => Promise<void>, message: string) {
    setBusy(true)
    setError('')
    try {
      await writeFavorites(task)
      onSuccess(message)
      onClose()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return <FavoriteModal title={confirming ? '确认取消收藏' : single ? '收藏' + favoriteLabels[single.kind] : `批量收藏（${targets.length} 题）`}
    busy={busy} close={onClose}>
    {(error || collections.error) && <p role="alert">{error || collections.error}</p>}
    {busy && <p role="status">正在保存收藏…</p>}
    {!busy && collections.loading && <p role="status">正在读取收藏夹…</p>}
    {confirming && single && membership ? <>
      <p>将从「{membership.name}」移除该资源及其中的 {membership.relations} 条原始收藏关系。其他收藏夹和原资源会保留。</p>
      <div className="actions">
        <button type="button" autoFocus disabled={busy} onClick={() => setConfirming(false)}>返回</button>
        <button type="button" disabled={busy} onClick={() => void save(
          () => favorites.change({ action: 'remove', collection: source, target: single, expected_relations: membership.relations }),
          '已取消此收藏夹中的收藏。')}>
          确认取消收藏
        </button>
      </div>
    </> : <form onSubmit={(event) => {
      event.preventDefault()
      if (!busy && validDestination) void save(
        () => favorites.change({ action: 'add', collection: destination, targets }),
        single ? '已收藏。' : '已保存所选试题的收藏。',
      )
    }}>
      <fieldset className="favorite-form" disabled={busy || !collections.value}>
        <label>目标收藏夹 <select autoFocus value={destination} onChange={(event) => setDestination(event.target.value)}>
          {collections.value?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <button className="primary" type="submit" disabled={!validDestination}>收藏到此处</button>
        {single && Boolean(memberships?.length) && <>
          <label>来源收藏夹 <select value={source} onChange={(event) => setSource(event.target.value)}>
            {memberships?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select></label>
          <div className="actions">
            <button type="button" disabled={!membership || !validDestination || source === destination} onClick={() => void save(
              () => favorites.change({ action: 'transfer', from: source, to: destination, target: single, move_item: false }),
              '已复制收藏。')}>复制到目标</button>
            <button type="button" disabled={!membership || !validDestination || source === destination} onClick={() => void save(
              () => favorites.change({ action: 'transfer', from: source, to: destination, target: single, move_item: true }),
              '已移动收藏。')}>移动到目标</button>
            <button type="button" disabled={!membership} onClick={() => setConfirming(true)}>取消此收藏夹中的收藏</button>
          </div>
        </>}
      </fieldset>
      <button type="button" disabled={busy} onClick={onClose}>关闭</button>
    </form>}
  </FavoriteModal>
}

export function FavoriteControl({ kind, id, known, shared = false, showMark = false, disabled = false }: FavoriteRef & {
  known?: FavoriteStatus; shared?: boolean; showMark?: boolean; disabled?: boolean
}) {
  const read = useFavoriteRead(shared ? null : JSON.stringify([kind, id]), () => favorites.status([{ kind, id }]))
  const status = known ?? read.value?.[0]
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const saved = Boolean(status?.collections.length)
  const label = favoriteLabels[kind]
  return <div className="actions favorite-control">
    <button type="button" aria-haspopup="dialog" disabled={disabled || busy || !status}
      onClick={() => { setOpen(true); setMessage(''); setError('') }}>
      {saved ? '已收藏 · 管理' : '收藏' + label}
    </button>
    {showMark && saved && <button type="button" disabled={disabled || busy} aria-pressed={status?.important}
      onClick={() => {
        setBusy(true)
        setError('')
        setMessage('')
        void writeFavorites(() => favorites.change({ action: 'mark', target: { kind, id }, important: !status?.important }))
          .then(() => setMessage(status?.important ? '已取消重点。' : '已标为重点。'))
          .catch((err: unknown) => setError(describeError(err))).finally(() => setBusy(false))
      }}>{status?.important ? '取消重点' : '标为重点'}</button>}
    {message && <small role="status">{message}</small>}
    {(error || read.error) && <small role="alert">{error || read.error}</small>}
    {open && <FavoritePicker targets={[{ kind, id }]} memberships={status?.collections}
      onClose={() => setOpen(false)} onSuccess={setMessage} />}
  </div>
}
