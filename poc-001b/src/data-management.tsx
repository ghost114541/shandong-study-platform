import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { localTime, protection, trashLabels } from './data-protection-api'
import type { BackupRecord, Diagnostics, DraftRecord, ProtectionProgress, RestorePreview, RootStatus, TrashItem } from './data-protection-api'
import type { ReportGuard } from './leave-guard'
import { describeError } from './sqlite-api'
import './data-management.css'

type Panel = 'backup' | 'trash' | 'drafts'
const progressLabels: Record<string, string> = {
  snapshot: '创建 SQLite 快照', hash: '计算快照摘要', resources: '复制并校验资源',
  legacy: '复制旧版题库资料', archive: '写入备份归档', verify: '校验文件',
  digest: '计算归档摘要', publish: '发布已验证备份', unpack: '隔离暂存并校验文件',
  unpacked: '校验数据库和迁移历史', validated: '预检完成', verified: '迁移验证完成',
}
const decimalBytes = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value / 1024 ** 2) + ' MiB'

export function DataManagement({ panel: initial, reportGuard, prepare, onPending, onRestoreDraft, onLibraryChanged }: {
  panel?: Panel
  reportGuard: ReportGuard
  prepare: () => Promise<void>
  onPending: () => void
  onRestoreDraft: (record: DraftRecord) => Promise<void>
  onLibraryChanged: () => void
}) {
  const [panel, setPanel] = useState<Panel>(initial ?? 'backup')
  const [status, setStatus] = useState<RootStatus | null>(null)
  const [history, setHistory] = useState<BackupRecord[]>([])
  const [trash, setTrash] = useState<TrashItem[]>([])
  const [drafts, setDrafts] = useState<DraftRecord[]>([])
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState('')
  const [cancellable, setCancellable] = useState(false)
  const [progress, setProgress] = useState<ProtectionProgress | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirming, setConfirming] = useState<{ text: string; action: () => void } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const running = useRef(false)

  async function refresh() {
    const root = await protection.status()
    setStatus(root)
    const results = await Promise.allSettled([protection.history(), protection.trash(), protection.drafts()] as const)
    const [backups, deleted, saved] = results
    if (backups.status === 'fulfilled') setHistory(backups.value)
    if (deleted.status === 'fulfilled') setTrash(deleted.value)
    if (saved.status === 'fulfilled') setDrafts(saved.value)
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
    }
  }

  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(describeError(cause)))
    const events = listen<ProtectionProgress>('protection-progress', ({ payload }) => setProgress(payload))
    void events.catch((cause: unknown) => setError(describeError(cause)))
    return () => { void events.then((stop) => stop(), () => {}) }
  }, [])
  useLayoutEffect(() => reportGuard(false, Boolean(busy)), [reportGuard, busy])
  useEffect(() => {
    if (confirming) dialog.current?.showModal()
    else dialog.current?.close()
  }, [confirming])

  async function run(label: string, task: () => Promise<void>, canCancel = false) {
    if (running.current || pending) return
    running.current = true
    setBusy(label)
    setCancellable(canCancel)
    setProgress(null)
    setError('')
    setNotice('')
    try { await task() }
    catch (cause) { setError(describeError(cause)) }
    finally {
      running.current = false
      setBusy('')
      setCancellable(false)
      setProgress(null)
    }
  }

  function finishSwitch() {
    setPending(true)
    setPreview(null)
    onPending()
    setNotice('已准备好切换。请关闭并重新打开知卷，启动时会验证并切换整个库。')
  }

  function request(text: string, action: () => void) { setConfirming({ text, action }) }
  const locked = Boolean(busy) || pending

  return <main className="data-management">
    <h1>数据管理</h1>
    {status?.error && <p role="alert">{status.error}</p>}
    {status?.pack_warning && <p role="alert">{status.pack_warning}</p>}
    <div className="protection-feedback" aria-live="polite">
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <div role="status">
        <strong>{progress ? progressLabels[progress.phase] ?? busy : busy}</strong>
        {cancellable && <progress aria-label="数据操作进度" max={progress?.total || 1} value={progress?.total ? progress.completed : undefined} />}
        {cancellable && <button onClick={() => void protection.cancel()}>取消数据操作</button>}
      </div>}
    </div>
    <nav aria-label="数据管理入口" className="actions">
      <button disabled={locked} aria-pressed={panel === 'backup'} onClick={() => setPanel('backup')}>备份与诊断</button>
      <button disabled={locked} aria-pressed={panel === 'trash'} onClick={() => setPanel('trash')}>回收站（{trash.length}）</button>
      <button disabled={locked} aria-pressed={panel === 'drafts'} onClick={() => setPanel('drafts')}>草稿恢复（{drafts.length}）</button>
    </nav>
    {panel === 'backup' && <>
      <section className="panel">
        <h2>资源库存储位置</h2>
        <p className="protection-path">{status?.directory ?? '正在读取资源库目录…'}</p>
        {status?.layout_warning && <p role="alert">{status.layout_warning}</p>}
        {status?.previous && <p className="protection-path">保留的回退库 {status.previous}</p>}
        {status?.previous_protection && <p role="status">旧库清理检查已拒绝。{status.previous_protection}</p>}
        <div className="actions">
          <button disabled={locked || !status || Boolean(preview)} onClick={() => void run('估算磁盘空间…', async () => {
            const required = await protection.estimate()
            request('会在新目录创建独立资源库，约需 ' + decimalBytes(required + 16 * 1024 ** 2) +
              ' 可用空间。旧库保留，重新打开知卷后切换。', () => void run('正在迁移资源库…', async () => {
                await prepare()
                if (await protection.migrate()) finishSwitch()
              }, true))
          })}>更改存储位置</button>
          {status?.layout_warning && <button disabled={locked || Boolean(preview)} onClick={() => request(
            '将当前资源库完整复制到独立位置，验证后等待重启切换。原目录、旧库与控制日志会保留。',
            () => void run('正在修复资源库布局…', async () => {
              await prepare()
              await protection.repairLayout()
              finishSwitch()
            }, true),
          )}>安全修复资源库布局</button>}
          {status?.previous && <button disabled={locked || Boolean(preview)} onClick={() => request(
            '重启后切回上一次的资源库，当前库会保留为回退点。', () => void run('准备回退…', async () => {
              await prepare()
              await protection.rollback()
              finishSwitch()
            }),
          )}>回退上一次资源库</button>}
        </div>
      </section>
      <section className="panel">
        <h2>完整备份与恢复</h2>
        <p>备份未加密，包含个人学习数据。请存放在只有你能访问且有足够空间的位置。</p>
        <div className="actions">
          <button className="primary" disabled={locked || !status} onClick={() => void run('选择备份保存位置…', async () => {
            await prepare()
            try {
              const result = await protection.backup()
              if (result) setNotice('完整备份已创建并验证 · ' + result.file_count + ' 个文件 · ' + decimalBytes(result.total_bytes))
            } finally { setHistory(await protection.history()) }
          }, true)}>创建完整备份</button>
          <button disabled={locked || !status} onClick={() => void run('选择并预检备份…', async () => {
            const result = await protection.preview()
            if (result) setPreview(result)
          }, true)}>选择备份恢复</button>
        </div>
        {preview && <section className="protection-preview" aria-label="恢复预览">
          <h3>恢复预览</h3>
          <p>已验证 {preview.manifest.file_count} 个文件。备份来源 {preview.manifest.platform} · {localTime(preview.manifest.created_at)} · Schema {preview.manifest.schema_version}</p>
          <p>试题 {preview.questions} · 试卷 {preview.papers} · 知识点 {preview.knowledge} · 收藏资源 {preview.favorites}</p>
          <p>重新打开知卷时，当前资源库将被此备份完整替换。当前库会原地保留，供回退。</p>
          <div className="actions">
            <button disabled={locked} onClick={() => void run('正在清理恢复暂存…', async () => {
              await protection.closePreview()
              setPreview(null)
            })}>取消恢复</button>
            <button disabled={locked} onClick={() => request('确认完整替换当前资源库？请关闭并重新打开应用以完成切换。',
              () => void run('正在准备切换…', async () => {
                await prepare()
                await protection.restore()
                finishSwitch()
              }),
            )}>确认替换资源库</button>
          </div>
        </section>}
        <h3>备份历史</h3>
        {history.length ? <ul className="protection-list">{history.map((item) => <li key={item.id}>
          <strong>{item.location_label}</strong> · {localTime(item.created_at)} · {item.verified ? '已完整验证' : item.error ?? '未验证'}
          {item.archive_sha256 && <code>SHA-256 {item.archive_sha256}</code>}
        </li>)}</ul> : <p>暂无备份记录。</p>}
      </section>
      <section className="panel">
        <h2>数据完整性检查</h2>
        <button disabled={locked || !status} onClick={() => void run('正在检查数据库和文件…', async () => {
          setDiagnostics(await protection.diagnostics())
        }, true)}>运行完整性检查</button>
        {diagnostics && <div className="protection-preview" aria-live="polite">
          <p>Schema {diagnostics.schema_version} · 已登记 {diagnostics.file_count} 个资源文件 · 回收站 {diagnostics.trashed} 项 · 草稿 {diagnostics.drafts} 份</p>
          <p>最近备份 {diagnostics.latest_backup ? (diagnostics.latest_backup.verified ? '已验证' : '未验证') : '无记录'}</p>
          {diagnostics.issues.length ? <ul>{diagnostics.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
            : <p>SQLite、外键和登记文件校验通过。</p>}
        </div>}
      </section>
    </>}
    {panel === 'trash' && <section className="panel">
      <h2>回收站</h2>
      <p>资源会保留到你主动处理。恢复会沿用原资源 ID。</p>
      <ul className="protection-list">{trash.map((item) => <li key={item.id}>
        <div><strong>{item.context.label}</strong> · {trashLabels[item.resource_type]} · {localTime(item.deleted_at)}
          <small>收藏 {item.context.favorites} · 原卷关系 {item.context.occurrences} · 固定组卷 {item.context.compositions}</small>
        </div>
        <button disabled={locked} onClick={() => void run('正在恢复资源…', async () => {
          await protection.recover(item.id)
          setTrash(await protection.trash())
          setNotice('资源已恢复。')
          onLibraryChanged()
        })}>恢复资源</button>
      </li>)}</ul>
      {!trash.length && <p>回收站为空。</p>}
      <button disabled={locked || !trash.length} onClick={() => request('确认请求清空回收站？系统会阻止危及稳定引用或历史的操作。',
        () => void run('正在检查永久清理条件…', async () => { await protection.clear(); setTrash(await protection.trash()) }),
      )}>清空回收站</button>
    </section>}
    {panel === 'drafts' && <section className="panel">
      <h2>可恢复草稿</h2>
      <ul className="protection-list">{drafts.map((record) => <li key={record.id}>
        <div><strong>{record.object_type === 'question' ? '试题草稿' : '组卷草稿'}</strong> · {localTime(record.saved_at)}
          <small>{record.object_id}{record.conflict ? ' · 当前修订已改变' : ''}</small></div>
        <div className="actions">
          <button disabled={locked} onClick={() => {
            void onRestoreDraft(record).catch((cause: unknown) => setError(describeError(cause)))
          }}>恢复草稿</button>
          <button disabled={locked} onClick={() => request('永久放弃此草稿？正式资源会保留。', () => void run('正在放弃草稿…', async () => {
            await protection.discard(record)
            setDrafts(await protection.drafts())
          }))}>放弃此草稿</button>
        </div>
      </li>)}</ul>
      {!drafts.length && <p>暂无可恢复草稿。</p>}
    </section>}
    <dialog ref={dialog} onCancel={() => setConfirming(null)}>
      <h3>确认数据操作</h3>
      <p>{confirming?.text}</p>
      <div className="actions">
        <button autoFocus onClick={() => setConfirming(null)}>返回</button>
        <button onClick={() => { const action = confirming?.action; setConfirming(null); action?.() }}>确认操作</button>
      </div>
    </dialog>
  </main>
}
