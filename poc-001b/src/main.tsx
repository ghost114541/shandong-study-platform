import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { SQLiteWorkspace } from './sqlite-workspace'
import { LegacyWorkspace } from './legacy'
import { KnowledgeWorkspace } from './knowledge-workspace'
import { SearchWorkspace } from './search-workspace'
import { CompositionWorkspace } from './composition-workspace'
import { PrintView } from './composition-print-view'
import { totalScore } from './composition-api'
import { useComposition } from './use-composition'
import { FavoritesWorkspace } from './favorites-workspace'
import { ResourcePacksWorkspace } from './resource-packs-workspace'
import { DataManagement } from './data-management'
import { protection } from './data-protection-api'
import type { DraftRecord } from './data-protection-api'
import type { DraftProtection } from './use-autosave'
import { describeError } from './sqlite-api'
import type { KnowledgeTarget } from './favorites-workspace'
import { favoritesSaving, refreshFavorites } from './use-favorites'
import type { SearchSeed } from './knowledge-api'
import type { QuestionSummary } from './sqlite-api'
import type { ReaderTarget, ScreenshotDraft } from './paper-reader-api'
import 'katex/dist/katex.min.css'
import './style.css'

const PaperLibrary = lazy(() => import('./paper-library').then(({ PaperLibrary }) => ({ default: PaperLibrary })))

type Workspace = { name: 'editor'; question?: QuestionSummary; source?: ReaderTarget; draft?: ScreenshotDraft; recovered?: DraftRecord }
  | { name: 'search'; seed?: SearchSeed } | { name: 'papers'; target?: ReaderTarget }
  | { name: 'knowledge'; target?: KnowledgeTarget }
  | { name: 'data'; panel?: 'drafts' }
  | { name: 'legacy' | 'composition' | 'favorites' | 'resources' }

function App() {
  const [workspace, setWorkspace] = useState<Workspace>({ name: 'editor' })
  const composition = useComposition()
  const [visitedFavorites, setVisitedFavorites] = useState(false)
  const [resourceEpoch, setResourceEpoch] = useState(0)
  const [searchSession, setSearchSession] = useState<{ id: number; seed?: SearchSeed } | null>(null)
  const [confirming, setConfirming] = useState('')
  const [windowError, setWindowError] = useState('')
  const [guard, setGuard] = useState({ dirty: false, busy: false })
  const currentGuard = useRef<{ dirty: boolean; busy: boolean; draft?: DraftProtection }>(guard)
  const draftGuard = useRef({ dirty: composition.dirty, busy: composition.busy, draft: composition.autosave })
  draftGuard.current = { dirty: composition.dirty, busy: composition.busy, draft: composition.autosave }
  const [storagePending, setStoragePending] = useState(false)
  const [recoveryNotice, setRecoveryNotice] = useState(false)
  const [startupWarning, setStartupWarning] = useState('')
  const [canKeep, setCanKeep] = useState(false)
  const pendingAction = useRef<{ action: () => void; drafts: DraftProtection[] } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  const reportGuard = useCallback((dirty: boolean, busy: boolean, draft?: DraftProtection) => {
    const previous = currentGuard.current
    currentGuard.current = { dirty, busy, draft }
    if (previous.dirty !== dirty || previous.busy !== busy) setGuard({ dirty, busy })
  }, [])

  const confirmLoss = useCallback((message: string, action: () => void, drafts: DraftProtection[] = [], keep = drafts.length > 0) => {
    pendingAction.current = { action, drafts }
    setCanKeep(keep)
    setConfirming(message)
  }, [])

  useEffect(() => {
    void protection.drafts().then((records) => setRecoveryNotice(records.length > 0)).catch(() => {})
    void protection.status().then((status) => {
      setStartupWarning(status.error ?? status.layout_warning ?? status.pack_warning ?? (status.previous && status.phase === 'complete'
        ? '已打开切换后的资源库。可在数据管理中回退。' : ''))
    }).catch(() => {})
  }, [])

  const confirmLeave = useCallback((action: () => void) => {
    if (currentGuard.current.busy || draftGuard.current.busy) return
    const current = currentGuard.current
    if (current.dirty) confirmLoss(current.draft
      ? '可保存草稿后离开，或放弃修改并删除草稿。'
      : '离开当前编辑会丢弃这些修改。', action, current.draft ? [current.draft] : [])
    else action()
  }, [confirmLoss])

  const confirmReplace = useCallback((action: () => void) => {
    if (draftGuard.current.busy) return
    if (draftGuard.current.dirty) confirmLoss('可保留当前组卷草稿，或放弃并删除草稿。', action, [draftGuard.current.draft])
    else action()
  }, [confirmLoss])

  useEffect(() => {
    const window = getCurrentWindow()
    const listening = window.onCloseRequested((event) => {
      const busy = currentGuard.current.busy || draftGuard.current.busy || favoritesSaving()
      const editor = currentGuard.current
      const composition = draftGuard.current
      if (!busy && (storagePending || (!editor.dirty && !composition.dirty))) return
      event.preventDefault()
      if (!busy) {
        const drafts = [editor.dirty ? editor.draft : undefined, composition.dirty ? composition.draft : undefined]
          .filter((draft): draft is DraftProtection => Boolean(draft))
        const keep = drafts.length > 0 && (!editor.dirty || Boolean(editor.draft))
        confirmLoss(keep ? '保留草稿后关闭，或放弃未保存修改并删除对应草稿。'
          : '关闭应用会丢弃未保存的修改。', () => {
          void window.destroy().catch((error: unknown) => setWindowError(String(error)))
        }, drafts, keep)
      }
    })
    void listening.catch((error: unknown) => setWindowError('无法注册关闭保护：' + String(error)))
    return () => void listening.then((unlisten) => unlisten(), () => {})
  }, [confirmLoss, storagePending])

  useEffect(() => {
    if (confirming) dialog.current?.showModal()
    else dialog.current?.close()
  }, [confirming])

  async function dismiss(mode: 'stay' | 'keep' | 'discard') {
    const pending = pendingAction.current
    if (mode === 'stay') {
      pendingAction.current = null
      setConfirming('')
      return
    }
    if (!pending) return
    pendingAction.current = null
    setWindowError('')
    try {
      for (const draft of pending.drafts) await (mode === 'keep' ? draft.flush() : draft.discard())
      setConfirming('')
      pending.action()
    } catch (error) {
      setConfirming('')
      setWindowError('未离开工作区。' + describeError(error))
    }
  }

  function libraryChanged() {
    setResourceEpoch((epoch) => epoch + 1)
    refreshFavorites()
  }

  async function recoverDraft(record: DraftRecord) {
    setRecoveryNotice(false)
    if (record.object_type === 'question') {
      await protection.load(record.id)
      navigate({ name: 'editor', recovered: record })
    } else if (composition.dirty) {
      await composition.autosave.flush()
      await composition.recover(record)
      setWorkspace({ name: 'composition' })
    } else {
      await composition.recover(record)
      setWorkspace({ name: 'composition' })
    }
  }

  function navigate(next: Workspace) {
    if (!storagePending && next.name !== workspace.name) confirmLeave(() => {
      reportGuard(false, false)
      if (next.name === 'search') {
        setSearchSession((previous) => previous && !next.seed ? previous : { id: (previous?.id ?? 0) + 1, seed: next.seed })
      }
      if (next.name === 'composition') void composition.refreshList()
      if (next.name === 'favorites') {
        setVisitedFavorites(true)
        refreshFavorites()
      }
      setWorkspace(next)
    })
  }

  return <>
    <nav className="workspace-switch" aria-label="切换工作区">
      <button aria-pressed={workspace.name === 'editor'} disabled={guard.busy || composition.busy || storagePending} onClick={() => navigate({ name: 'editor' })}>SQLite 题库</button>
      <button aria-pressed={workspace.name === 'knowledge'} disabled={guard.busy || composition.busy || storagePending} onClick={() => navigate({ name: 'knowledge' })}>知识库</button>
      <button aria-pressed={workspace.name === 'search'} disabled={guard.busy || composition.busy || storagePending} onClick={() => navigate({ name: 'search' })}>试题检索</button>
      <button aria-pressed={workspace.name === 'papers'} disabled={guard.busy || composition.busy || storagePending} onClick={() => navigate({ name: 'papers' })}>试卷库</button>
      <button aria-pressed={workspace.name === 'favorites'} disabled={guard.busy || composition.busy || storagePending}
        onClick={() => navigate({ name: 'favorites' })}>我的收藏</button>
      <button aria-pressed={workspace.name === 'composition'} disabled={guard.busy || composition.busy || storagePending}
        onClick={() => navigate({ name: 'composition' })}>自定义组卷</button>
      <button aria-pressed={workspace.name === 'resources'} disabled={guard.busy || composition.busy || storagePending}
        onClick={() => navigate({ name: 'resources' })}>资源管理</button>
      <button aria-pressed={workspace.name === 'data'} disabled={guard.busy || composition.busy || storagePending}
        onClick={() => navigate({ name: 'data' })}>数据管理</button>
      <button aria-pressed={workspace.name === 'legacy'} disabled={guard.busy || composition.busy || storagePending} onClick={() => navigate({ name: 'legacy' })}>旧版 JSON 演示</button>
      {composition.dirty && <span className="draft-indicator">未保存组卷 · {composition.draft.items.length} 题 · {totalScore(composition.draft.items)} 分</span>}
    </nav>
    {windowError && <p role="alert" className="window-error">{windowError}</p>}
    {startupWarning && <p className="startup-notice" role="status">{startupWarning}</p>}
    {recoveryNotice && workspace.name !== 'data' && <div className="startup-notice actions">
      <span>存在可恢复草稿。</span><button disabled={guard.busy || composition.busy || storagePending}
        onClick={() => navigate({ name: 'data', panel: 'drafts' })}>查看可恢复草稿</button>
    </div>}
    {workspace.name === 'legacy' && <LegacyWorkspace reportGuard={reportGuard} />}
    {workspace.name === 'editor' && <SQLiteWorkspace reportGuard={reportGuard} confirmLeave={confirmLeave}
      initialQuestion={workspace.question} initialDraft={workspace.draft} recovered={workspace.recovered}
      returnReader={workspace.source ?? workspace.draft?.target} onTrashed={libraryChanged}
      openReader={(target) => navigate({ name: 'papers', target })} />}
    {workspace.name === 'papers' && <Suspense fallback={<p role="status">正在加载试卷库…</p>}>
      <PaperLibrary initialTarget={workspace.target} reportGuard={reportGuard} confirmLeave={confirmLeave}
        openQuestion={(question, source) => navigate({ name: 'editor', question, source })}
        openDraft={(draft) => navigate({ name: 'editor', draft })} onTrashed={libraryChanged} />
    </Suspense>}
    {workspace.name === 'knowledge' && <KnowledgeWorkspace target={workspace.target} onTrashed={libraryChanged} openSearch={(seed) => navigate({ name: 'search', seed })} />}
    {workspace.name === 'composition' && <CompositionWorkspace state={composition} confirmReplace={confirmReplace} />}
    {workspace.name === 'data' && <DataManagement panel={workspace.panel} reportGuard={reportGuard}
      prepare={async () => { if (composition.dirty) await composition.autosave.flush() }}
      onPending={() => setStoragePending(true)} onRestoreDraft={recoverDraft} onLibraryChanged={libraryChanged} />}
    {workspace.name === 'resources' && <ResourcePacksWorkspace reportGuard={reportGuard}
      onInstalled={() => { setResourceEpoch((epoch) => epoch + 1); refreshFavorites() }} />}
    {visitedFavorites && <div hidden={workspace.name !== 'favorites'}>
      <FavoritesWorkspace active={workspace.name === 'favorites'} onAdd={(id) => void composition.add(id)}
        adding={composition.busy} basketError={composition.error} basketStatus={composition.status}
        openQuestion={(question) => navigate({ name: 'editor', question })}
        openPaper={(fileId) => navigate({ name: 'papers', target: { fileId } })}
        openKnowledge={(target) => navigate({ name: 'knowledge', target })}
        openSearch={(seed) => navigate({ name: 'search', seed })} />
    </div>}
    {searchSession && <div hidden={workspace.name !== 'search'} className="search-container">
      <SearchWorkspace key={searchSession.id} seed={searchSession.seed} active={workspace.name === 'search'}
        resourceEpoch={resourceEpoch}
        onAdd={(id) => void composition.add(id)} adding={composition.busy}
        basketError={composition.error} basketStatus={composition.status}
        openQuestion={(question) => navigate({ name: 'editor', question })} />
    </div>}
    <dialog ref={dialog} aria-labelledby="leave-title" onCancel={() => void dismiss('stay')}>
      <h3 id="leave-title">存在未保存的修改</h3>
      <p>{confirming}</p>
      <div className="actions">
        <button autoFocus onClick={() => void dismiss('stay')}>继续编辑</button>
        {canKeep && <button onClick={() => void dismiss('keep')}>保留草稿并离开</button>}
        <button onClick={() => void dismiss('discard')}>放弃修改</button>
      </div>
    </dialog>
  </>
}

const printRoute = new URLSearchParams(location.search).get('compositionPrint')
createRoot(document.getElementById('root')!).render(printRoute ? <PrintView token={printRoute} /> : <App />)
