import { useEffect, useState } from 'react'
import { FavoriteModal, FavoritePicker } from './favorite-controls'
import { favoriteLabels, favorites } from './favorites-api'
import type { CollectionCommand, FavoriteCollection, FavoriteItem, FavoriteKind, FavoriteQuery } from './favorites-api'
import { describeError, reviewLabels } from './sqlite-api'
import type { QuestionSummary } from './sqlite-api'
import type { SearchSeed } from './knowledge-api'
import { refreshFavorites, useFavoriteRead, writeFavorites } from './use-favorites'
import './favorites.css'

export interface KnowledgeTarget { subjectId: string; pointId: string }

interface Props {
  active: boolean
  openQuestion: (question: QuestionSummary) => void
  openPaper: (fileId: string) => void
  openKnowledge: (target: KnowledgeTarget) => void
  openSearch: (seed: SearchSeed) => void
  onAdd: (revisionId: number) => void
  adding: boolean
  basketStatus: string
  basketError: string
}

type CollectionEdit = { action: 'create' } | { action: 'rename' | 'delete'; collection: FavoriteCollection }

const initialQuery: FavoriteQuery = {
  collection: null, kind: null, important: false, keyword: '', sort: 'recent', page: 0,
}
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

export function FavoritesWorkspace(props: Props) {
  const { active, adding, basketError, basketStatus } = props
  const [filters, setFilters] = useState(initialQuery)
  const [input, setInput] = useState('')
  const [edit, setEdit] = useState<CollectionEdit | null>(null)
  const [picker, setPicker] = useState<FavoriteItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const navigation = useFavoriteRead(active ? 'favorite navigation' : null, async () => {
    const [collections, counts] = await Promise.all([favorites.collections(), favorites.counts()])
    return { collections, counts }
  })
  const result = useFavoriteRead(active ? JSON.stringify(filters) : null, () => favorites.page(filters))
  const collections = navigation.value?.collections
  const collection = collections?.find(({ id }) => id === filters.collection)
  const counts = filters.collection ? collection?.counts : navigation.value?.counts
  const index = collections?.findIndex(({ id }) => id === filters.collection) ?? -1

  useEffect(() => {
    if (!active) return
    if (filters.collection && collections && !collection) {
      setFilters((current) => ({ ...current, collection: null, page: 0 }))
    } else if (filters.page > 0 && result.value?.items.length === 0) {
      setFilters((current) => ({ ...current, page: current.page - 1 }))
    }
  }, [active, filters.collection, filters.page, collections, collection, result.value])

  function filter(update: Partial<FavoriteQuery>) {
    setFilters((current) => ({ ...current, page: 0, ...update }))
    setMessage('')
    setError('')
  }

  async function save(task: () => Promise<void>, done: string) {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await writeFavorites(task)
      setMessage(done)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  function reorder(direction: -1 | 1) {
    if (collection) void save(() => favorites.changeCollection({ action: 'reorder', id: collection.id, direction }),
      '已更新收藏夹顺序。')
  }

  return <main className="favorites-workspace">
    <header className="favorite-heading"><h1>我的收藏</h1></header>
    <div className="workspace">
      <aside className="sidebar favorite-sidebar" aria-label="收藏夹">
        <h2>收藏夹{collections && <small> · {collections.length} 个</small>}</h2>
        <button type="button" aria-pressed={!filters.collection} onClick={() => filter({ collection: null })}>
          <span>全部收藏</span>{navigation.value && <span>{navigation.value.counts.targets}</span>}
        </button>
        {collections?.map((folder) => <button key={folder.id} type="button" data-favorite-collection={folder.id}
          aria-pressed={folder.id === filters.collection} onClick={() => filter({ collection: folder.id })}>
          <span>{folder.name}</span><span>{folder.counts.targets}</span>
        </button>)}
        <button type="button" onClick={() => setEdit({ action: 'create' })}>新建收藏夹</button>
      </aside>
      <section className="panel favorite-list-panel" aria-label="收藏资源">
        <header className="favorite-list-heading">
          <div>
            <h2>{collection?.name ?? (filters.collection ? '收藏夹' : '全部收藏')}</h2>
            {counts && <p className="favorite-counts">{counts.targets} 项资源 · {counts.relations} 条收藏关系 · {counts.questions} 道试题 · {counts.papers} 份试卷 · {counts.knowledge} 个知识点 · {counts.important} 项重点</p>}
          </div>
          {collection && <div className="actions" aria-label="管理当前收藏夹">
            <button type="button" disabled={busy} onClick={() => setEdit({ action: 'rename', collection })}>重命名</button>
            <button type="button" disabled={busy || index < 1} onClick={() => reorder(-1)}>上移</button>
            <button type="button" disabled={busy || index < 0 || index >= (collections?.length ?? 0) - 1} onClick={() => reorder(1)}>下移</button>
            {!collection.is_default && <button type="button" disabled={busy} onClick={() => setEdit({ action: 'delete', collection })}>删除收藏夹</button>}
          </div>}
        </header>
        <form className="actions favorite-filters" onSubmit={(event) => {
          event.preventDefault()
          filter({ keyword: input.trim() })
        }}>
          <label>收藏类型 <select value={filters.kind ?? ''} onChange={(event) =>
            filter({ kind: (event.target.value as FavoriteKind) || null })}>
            <option value="">全部类型</option>
            {Object.entries(favoriteLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label className="check"><input type="checkbox" checked={filters.important}
            onChange={(event) => filter({ important: event.target.checked })} />仅重点</label>
          <label>收藏内搜索 <input type="search" maxLength={120} value={input} onChange={(event) => setInput(event.target.value)} /></label>
          <button type="submit">搜索收藏</button>
          <label>排序 <select value={filters.sort} onChange={(event) => filter({ sort: event.target.value === 'name' ? 'name' : 'recent' })}>
            <option value="recent">最近收藏</option><option value="name">资源名称</option>
          </select></label>
        </form>
        <div className="status" aria-live="polite">
          {(error || basketError || navigation.error || result.error) && <p role="alert">{error || basketError || navigation.error || result.error}</p>}
          {(navigation.error || result.error) && <button type="button" onClick={refreshFavorites}>重新读取</button>}
          {(result.loading || busy) && <p role="status">{busy ? '正在保存…' : '正在读取收藏…'}</p>}
          {!busy && message && <p role="status">{message}</p>}
          {basketStatus.startsWith('已加入组卷篮') && <p role="status">{basketStatus}</p>}
        </div>
        {result.value?.items.length === 0 && <p>当前条件下没有收藏。</p>}
        <ul className="favorite-items">
          {result.value?.items.map((item) => <FavoriteCard key={JSON.stringify([item.kind, item.id])}
            item={item} {...props} busy={busy || adding} manage={() => setPicker(item)}
            mark={() => void save(() => favorites.change({
              action: 'mark', target: { kind: item.kind, id: item.id }, important: !item.important,
            }), item.important ? '已取消重点。' : '已标为重点。')} />)}
        </ul>
        <div className="actions" aria-label="收藏分页">
          <button type="button" disabled={filters.page === 0 || result.loading} onClick={() => filter({ page: filters.page - 1 })}>上一页</button>
          <span>第 {filters.page + 1} 页</span>
          <button type="button" disabled={!result.value?.has_next} onClick={() => filter({ page: filters.page + 1 })}>下一页</button>
        </div>
      </section>
    </div>
    {edit && <CollectionDialog edit={edit} close={() => setEdit(null)} done={(label) => {
      if (edit.action === 'delete') filter({ collection: null })
      setMessage(label)
    }} />}
    {picker && <FavoritePicker targets={[{ id: picker.id, kind: picker.kind }]} memberships={picker.collections}
      initialSource={filters.collection ?? undefined} onClose={() => setPicker(null)} onSuccess={setMessage} />}
  </main>
}

function CollectionDialog({ edit, close, done }: { edit: CollectionEdit; close: () => void; done: (text: string) => void }) {
  const [name, setName] = useState(edit.action === 'rename' ? edit.collection.name : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const title = { create: '新建收藏夹', rename: '重命名收藏夹', delete: '删除收藏夹' }[edit.action]

  async function submit() {
    const command: CollectionCommand = edit.action === 'create' ? { action: 'create', name }
      : edit.action === 'rename' ? { action: 'rename', id: edit.collection.id, name }
      : { action: 'delete', id: edit.collection.id }
    setBusy(true)
    setError('')
    try {
      await writeFavorites(() => favorites.changeCollection(command))
      done(edit.action === 'delete' ? '收藏夹已删除。' : '收藏夹已保存。')
      close()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return <FavoriteModal title={title} busy={busy} close={close}>
    <form className="favorite-form" onSubmit={(event) => { event.preventDefault(); if (!busy) void submit() }}>
      {edit.action === 'delete'
        ? <p>删除「{edit.collection.name}」会移除其中的 {edit.collection.counts.relations} 条收藏关系。原资源及其他收藏夹会保留。</p>
        : <label>收藏夹名称 <input autoFocus required maxLength={80} disabled={busy} value={name}
            onChange={(event) => setName(event.target.value)} /></label>}
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <button type="button" autoFocus={edit.action === 'delete'} disabled={busy} onClick={close}>取消</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? '正在保存…' : edit.action === 'delete' ? '确认删除收藏夹' : '保存收藏夹'}</button>
      </div>
    </form>
  </FavoriteModal>
}

function FavoriteCard({ item, openPaper, openQuestion, openKnowledge, openSearch, onAdd, manage, mark, busy }: Pick<Props,
  'openPaper' | 'openQuestion' | 'openKnowledge' | 'openSearch' | 'onAdd'> & {
  item: FavoriteItem; manage: () => void; mark: () => void; busy: boolean
}) {
  const [version, setVersion] = useState('')
  const file = item.versions.find((entry) => entry.id === version) ?? item.versions[0]
  const date = new Date(item.added_at)
  const added = Number.isNaN(date.valueOf()) ? item.added_at : dateFormat.format(date)
  const subjectId = item.subject_id
  const revision = item.revision_id
  return <li className="favorite-item" data-favorite-kind={item.kind} data-favorite-id={item.id}>
    <div className="favorite-item-head">
      <span>{favoriteLabels[item.kind]}{item.subject && ' · ' + item.subject}</span>
      <time dateTime={item.added_at}>{added}</time>
    </div>
    <h3>{item.title}</h3>
    {item.kind === 'question' && <p className="favorite-meta">{[
      item.question_type, revision !== null && '修订 #' + revision, item.review && '答案审核 · ' + reviewLabels[item.review],
    ].filter(Boolean).join(' · ')}</p>}
    {item.kind === 'paper' && <p className="favorite-meta">{[item.year, item.region, item.versions.length + ' 个原卷版本'].filter(Boolean).join(' · ')}</p>}
    {item.kind === 'knowledge' && <p className="favorite-meta">上级知识点 · {item.parent ?? '无（顶层）'}</p>}
    <p className="favorite-meta">{item.collections.map(({ name, relations }) => name + (relations > 1 ? `（${relations} 条原始关系）` : '')).join('、')}</p>
    {item.unavailable && <p className="favorite-warning">{item.unavailable}</p>}
    <div className="actions">
      {item.kind === 'question' && subjectId && <>
        <button type="button" disabled={busy || revision === null || !!item.unavailable}
          onClick={() => openQuestion({ id: item.id, subject_id: subjectId, current_revision_id: revision })}>打开题目</button>
        <button type="button" disabled={busy || revision === null || !!item.unavailable}
          onClick={() => { if (revision !== null) onAdd(revision) }}>加入组卷</button>
      </>}
      {item.kind === 'paper' && <>
        {file && <label>原卷 PDF 版本 <select value={file.id} onChange={(event) => setVersion(event.target.value)}>
          {item.versions.map((entry) => <option key={entry.id} value={entry.id}>
            {entry.name} · {entry.pages} 页 · {entry.id.slice(0, 8)}{entry.available ? '' : ' · 文件不可用'}
          </option>)}
        </select></label>}
        <button type="button" disabled={busy || !file?.available} onClick={() => { if (file) openPaper(file.id) }}>打开试卷</button>
      </>}
      {item.kind === 'knowledge' && subjectId && <>
        <button type="button" disabled={busy || !!item.unavailable} onClick={() =>
          openKnowledge({ subjectId, pointId: item.id })}>打开知识点</button>
        <button type="button" disabled={busy || !!item.unavailable} onClick={() =>
          openSearch({ subjectId, knowledgeId: item.id, descendants: false })}>查看关联试题</button>
      </>}
      <button type="button" disabled={busy} aria-pressed={item.important} onClick={mark}>{item.important ? '取消重点' : '标为重点'}</button>
      <button type="button" disabled={busy} aria-haspopup="dialog" onClick={manage}>管理此收藏</button>
    </div>
  </li>
}
