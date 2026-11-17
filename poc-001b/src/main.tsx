import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { SQLiteWorkspace } from './sqlite-workspace'
import { LegacyWorkspace } from './legacy'
import { KnowledgeWorkspace } from './knowledge-workspace'
import { SearchWorkspace } from './search-workspace'
import type { SearchSeed } from './knowledge-api'
import type { QuestionSummary } from './sqlite-api'
import 'katex/dist/katex.min.css'
import './style.css'

type Workspace = { name: 'editor'; question?: QuestionSummary } | { name: 'search'; seed?: SearchSeed }
  | { name: 'knowledge' | 'legacy' }

function App() {
  const [workspace, setWorkspace] = useState<Workspace>({ name: 'editor' })
  const [confirming, setConfirming] = useState(false)
  const [windowError, setWindowError] = useState('')
  const [guard, setGuard] = useState({ dirty: false, busy: false })
  const currentGuard = useRef(guard)
  const pendingAction = useRef<(() => void) | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  const reportGuard = useCallback((dirty: boolean, busy: boolean) => {
    currentGuard.current = { dirty, busy }
    setGuard(currentGuard.current)
  }, [])

  const confirmLeave = useCallback((action: () => void) => {
    if (currentGuard.current.busy) return
    if (!currentGuard.current.dirty) action()
    else {
      pendingAction.current = action
      setConfirming(true)
    }
  }, [])

  useEffect(() => {
    const window = getCurrentWindow()
    const listening = window.onCloseRequested((event) => {
      if (!currentGuard.current.dirty && !currentGuard.current.busy) return
      event.preventDefault()
      confirmLeave(() => void window.destroy().catch((error: unknown) => setWindowError(String(error))))
    })
    void listening.catch((error: unknown) => setWindowError('无法注册关闭保护：' + String(error)))
    return () => void listening.then((unlisten) => unlisten(), () => {})
  }, [confirmLeave])

  useEffect(() => {
    if (confirming) dialog.current?.showModal()
    else dialog.current?.close()
  }, [confirming])

  function dismiss(proceed: boolean) {
    const action = pendingAction.current
    pendingAction.current = null
    setConfirming(false)
    if (proceed) action?.()
  }

  function navigate(next: Workspace) {
    if (next.name !== workspace.name) confirmLeave(() => {
      reportGuard(false, false)
      setWorkspace(next)
    })
  }

  return <>
    <nav className="workspace-switch" aria-label="切换工作区">
      <button aria-pressed={workspace.name === 'editor'} disabled={guard.busy} onClick={() => navigate({ name: 'editor' })}>SQLite 题库</button>
      <button aria-pressed={workspace.name === 'knowledge'} disabled={guard.busy} onClick={() => navigate({ name: 'knowledge' })}>知识库</button>
      <button aria-pressed={workspace.name === 'search'} disabled={guard.busy} onClick={() => navigate({ name: 'search' })}>试题检索</button>
      <button aria-pressed={workspace.name === 'legacy'} disabled={guard.busy} onClick={() => navigate({ name: 'legacy' })}>POC-001B JSON 演示</button>
    </nav>
    {windowError && <p role="alert" className="window-error">{windowError}</p>}
    {workspace.name === 'legacy' && <LegacyWorkspace reportGuard={reportGuard} />}
    {workspace.name === 'editor' && <SQLiteWorkspace reportGuard={reportGuard} confirmLeave={confirmLeave} initialQuestion={workspace.question} />}
    {workspace.name === 'knowledge' && <KnowledgeWorkspace openSearch={(seed) => navigate({ name: 'search', seed })} />}
    {workspace.name === 'search' && <SearchWorkspace seed={workspace.seed} openQuestion={(question) => navigate({ name: 'editor', question })} />}
    <dialog ref={dialog} aria-labelledby="leave-title" onCancel={() => dismiss(false)}>
      <h3 id="leave-title">存在未保存的修改</h3>
      <p>离开当前编辑会丢弃这些修改。</p>
      <div className="actions">
        <button autoFocus onClick={() => dismiss(false)}>继续编辑</button>
        <button onClick={() => dismiss(true)}>放弃修改</button>
      </div>
    </dialog>
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
