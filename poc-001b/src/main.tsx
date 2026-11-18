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
import type { KnowledgeTarget } from './favorites-workspace'
import { favoritesSaving, refreshFavorites } from './use-favorites'
import type { SearchSeed } from './knowledge-api'
import type { QuestionSummary } from './sqlite-api'
import type { ReaderTarget, ScreenshotDraft } from './paper-reader-api'
import 'katex/dist/katex.min.css'
import './style.css'

const PaperLibrary = lazy(() => import('./paper-library').then(({ PaperLibrary }) => ({ default: PaperLibrary })))

type Workspace = { name: 'editor'; question?: QuestionSummary; source?: ReaderTarget; draft?: ScreenshotDraft }
  | { name: 'search'; seed?: SearchSeed } | { name: 'papers'; target?: ReaderTarget }
  | { name: 'knowledge'; target?: KnowledgeTarget }
  | { name: 'legacy' | 'composition' | 'favorites' }

function App() {
  const [workspace, setWorkspace] = useState<Workspace>({ name: 'editor' })
  const composition = useComposition()
  const [visitedFavorites, setVisitedFavorites] = useState(false)
  const [searchSession, setSearchSession] = useState<{ id: number; seed?: SearchSeed } | null>(null)
  const [confirming, setConfirming] = useState('')
  const [windowError, setWindowError] = useState('')
  const [guard, setGuard] = useState({ dirty: false, busy: false })
  const currentGuard = useRef(guard)
  const draftGuard = useRef({ dirty: composition.dirty, busy: composition.busy })
  draftGuard.current = { dirty: composition.dirty, busy: composition.busy }
  const pendingAction = useRef<(() => void) | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  const reportGuard = useCallback((dirty: boolean, busy: boolean) => {
    currentGuard.current = { dirty, busy }
    setGuard(currentGuard.current)
  }, [])

  const confirmLoss = useCallback((message: string, action: () => void) => {
    pendingAction.current = action
    setConfirming(message)
  }, [])

  const confirmLeave = useCallback((action: () => void) => {
    if (currentGuard.current.busy || draftGuard.current.busy) return
    if (currentGuard.current.dirty) confirmLoss('离开当前编辑会丢弃这些修改。', action)
    else action()
  }, [confirmLoss])

  const confirmReplace = useCallback((action: () => void) => {
    if (draftGuard.current.busy) return
    if (draftGuard.current.dirty) confirmLoss('此操作会丢弃当前组卷草稿。', action)
    else action()
  }, [confirmLoss])

  useEffect(() => {
    const window = getCurrentWindow()
    const listening = window.onCloseRequested((event) => {
      const busy = currentGuard.current.busy || draftGuard.current.busy || favoritesSaving()
      const dirty = currentGuard.current.dirty || draftGuard.current.dirty
      if (!busy && !dirty) return
      event.preventDefault()
      if (!busy) confirmLoss('关闭应用会丢弃未保存的编辑和组卷草稿。', () => {
        void window.destroy().catch((error: unknown) => setWindowError(String(error)))
      })
    })
    void listening.catch((error: unknown) => setWindowError('无法注册关闭保护：' + String(error)))
    return () => void listening.then((unlisten) => unlisten(), () => {})
  }, [confirmLoss])

  useEffect(() => {
    if (confirming) dialog.current?.showModal()
    else dialog.current?.close()
  }, [confirming])

  function dismiss(proceed: boolean) {
    const action = pendingAction.current
    pendingAction.current = null
    setConfirming('')
    if (proceed) action?.()
  }

  function navigate(next: Workspace) {
    if (next.name !== workspace.name) confirmLeave(() => {
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
      <button aria-pressed={workspace.name === 'editor'} disabled={guard.busy || composition.busy} onClick={() => navigate({ name: 'editor' })}>SQLite 题库</button>
      <button aria-pressed={workspace.name === 'knowledge'} disabled={guard.busy || composition.busy} onClick={() => navigate({ name: 'knowledge' })}>知识库</button>
      <button aria-pressed={workspace.name === 'search'} disabled={guard.busy || composition.busy} onClick={() => navigate({ name: 'search' })}>试题检索</button>
      <button aria-pressed={workspace.name === 'papers'} disabled={guard.busy || composition.busy} onClick={() => navigate({ name: 'papers' })}>试卷库</button>
      <button aria-pressed={workspace.name === 'favorites'} disabled={guard.busy || composition.busy}
        onClick={() => navigate({ name: 'favorites' })}>我的收藏</button>
      <button aria-pressed={workspace.name === 'composition'} disabled={guard.busy || composition.busy}
        onClick={() => navigate({ name: 'composition' })}>自定义组卷</button>
      <button aria-pressed={workspace.name === 'legacy'} disabled={guard.busy || composition.busy} onClick={() => navigate({ name: 'legacy' })}>POC-001B JSON 演示</button>
      {composition.dirty && <span className="draft-indicator">未保存组卷 · {composition.draft.items.length} 题 · {totalScore(composition.draft.items)} 分</span>}
    </nav>
    {windowError && <p role="alert" className="window-error">{windowError}</p>}
    {workspace.name === 'legacy' && <LegacyWorkspace reportGuard={reportGuard} />}
    {workspace.name === 'editor' && <SQLiteWorkspace reportGuard={reportGuard} confirmLeave={confirmLeave}
      initialQuestion={workspace.question} initialDraft={workspace.draft} returnReader={workspace.source ?? workspace.draft?.target}
      openReader={(target) => navigate({ name: 'papers', target })} />}
    {workspace.name === 'papers' && <Suspense fallback={<p role="status">正在加载试卷库…</p>}>
      <PaperLibrary initialTarget={workspace.target} reportGuard={reportGuard} confirmLeave={confirmLeave}
        openQuestion={(question, source) => navigate({ name: 'editor', question, source })}
        openDraft={(draft) => navigate({ name: 'editor', draft })} />
    </Suspense>}
    {workspace.name === 'knowledge' && <KnowledgeWorkspace target={workspace.target} openSearch={(seed) => navigate({ name: 'search', seed })} />}
    {workspace.name === 'composition' && <CompositionWorkspace state={composition} confirmReplace={confirmReplace} />}
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
        onAdd={(id) => void composition.add(id)} adding={composition.busy}
        basketError={composition.error} basketStatus={composition.status}
        openQuestion={(question) => navigate({ name: 'editor', question })} />
    </div>}
    <dialog ref={dialog} aria-labelledby="leave-title" onCancel={() => dismiss(false)}>
      <h3 id="leave-title">存在未保存的修改</h3>
      <p>{confirming}</p>
      <div className="actions">
        <button autoFocus onClick={() => dismiss(false)}>继续编辑</button>
        <button onClick={() => dismiss(true)}>放弃修改</button>
      </div>
    </dialog>
  </>
}

const printRoute = new URLSearchParams(location.search).get('compositionPrint')
createRoot(document.getElementById('root')!).render(printRoute ? <PrintView token={printRoute} /> : <App />)
