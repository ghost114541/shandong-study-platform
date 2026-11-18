
import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { ReportGuard } from './leave-guard'
import { packApi } from './resource-packs-api'
import type { History, PackPreview, Progress, ResourceKind } from './resource-packs-api'
import { describeError } from './sqlite-api'
import './resource-packs.css'

const resources: [ResourceKind, string][] = [
  ['knowledge', '知识点'], ['questions', '顶层试题'], ['papers', '逻辑试卷'], ['images', '图片'], ['pdfs', 'PDF'],
]
const phases: Record<string, string> = {
  validating: '正在校验 ZIP、SHA-256 与内容引用…',
  previewing: '正在计算新增和更新差异…',
  staging: '正在暂存已验证的资源…',
  writing: '正在写入暂存文件…',
  staged: '暂存完成，等待提交…',
  committing: '正在提交安装，请保持应用开启…',
  publishing: '正在发布已验证的文件…',
  before_commit: '正在写入资源版本和安装记录…',
  committed: '数据库已提交，正在清理暂存文件…',
}
const states: Record<string, string> = {
  validated: '已校验', staged: '已暂存', committing: '提交中',
  installed: '已安装', failed: '失败', interrupted: '已恢复的中断',
}
const sizes = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const mib = (bytes: number) => sizes.format(bytes / 1024 ** 2) + ' MiB'
type Busy = 'select' | 'install' | 'recover' | null

export function ResourcePacksWorkspace({ reportGuard, onInstalled }: { reportGuard: ReportGuard; onInstalled: () => void }) {
  const [busy, setBusy] = useState<Busy>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<PackPreview>()
  const [progress, setProgress] = useState<Progress>()
  const [history, setHistory] = useState<History>()
  const [confirming, setConfirming] = useState(false)
  const [ready, setReady] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    let active = true
    const listening = listen<Progress>('resource-pack-progress', ({ payload }) => {
      if (active) setProgress(payload)
    })
    void listening.then(() => {
      if (active) setReady(true)
    }).catch((failure: unknown) => {
      if (active) setError(describeError(failure))
    })
    void packApi.history().then((records) => {
      if (active) setHistory(records)
    }).catch((failure: unknown) => {
      if (active) setError(describeError(failure))
    })
    return () => {
      active = false
      void listening.then((unlisten) => unlisten(), () => {})
      void packApi.discard().catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (confirming) dialog.current?.showModal()
    else dialog.current?.close()
  }, [confirming])

  async function run(action: Exclude<Busy, null>, callback: () => Promise<void>) {
    setError('')
    setStatus('')
    setProgress(undefined)
    setBusy(action)
    reportGuard(false, true)
    try {
      await callback()
    } catch (failure) {
      setError(describeError(failure))
      if (action !== 'select') await packApi.history().then(setHistory, () => {})
    } finally {
      setBusy(null)
      setProgress(undefined)
      reportGuard(false, false)
    }
  }

  function select() {
    setPreview(undefined)
    void run('select', async () => {
      const result = await packApi.select()
      if (result) setPreview(result)
    })
  }

  function install() {
    if (!preview) return
    setConfirming(false)
    setPreview(undefined)
    void run('install', async () => {
      const result = await packApi.install(preview.archive_sha)
      if (!result.already_installed) onInstalled()
      setStatus(result.already_installed ? '此资源包的相同版本已经安装。' : '资源包安装完成。')
      setHistory(await packApi.history())
    })
  }

  function recover() {
    void run('recover', async () => {
      setHistory(await packApi.recover())
      setStatus('安装记录与已安装文件检查完成。')
    })
  }

  function cancel() {
    void packApi.cancel().then((accepted) => {
      setStatus(accepted ? '已请求取消，正在等待安全清理。' : '已进入当前操作的最后阶段，请等待完成。')
    }).catch((failure: unknown) => setError(describeError(failure)))
  }

  const latestFailure = history?.operations.find((item) => item.error)
  const progressText = progress ? phases[progress.phase] : (
    busy === 'select' ? '请选择本地 .studyzip 文件。' : busy === 'recover' ? '正在恢复安装记录并校验文件…' : '正在准备安装…'
  )
  return <main className="resource-workspace">
    <header className="resource-intro">
      <div>
        <h1>资源管理</h1>
        <p>从本地安装或更新知识点、试题和试卷。</p>
      </div>
      <div className="actions">
        <button className="primary" disabled={!!busy || !ready} onClick={select}>选择本地资源包</button>
        <button disabled={!!busy} onClick={recover}>重新检查与恢复</button>
      </div>
    </header>
    {busy && <div className="resource-status" role="status" aria-label="资源包操作进度">
      <p>{progressText}{progress && progress.total > 0 ? ` ${progress.done} / ${progress.total}` : ''}</p>
      {busy !== 'select' && <progress aria-label="资源包操作进度"
        max={progress && progress.total > 0 ? progress.total : undefined}
        value={progress && progress.total > 0 ? progress.done : undefined} />}
      {busy === 'install' && <button disabled={!progress?.cancellable} onClick={cancel}>取消安装</button>}
      {busy === 'select' && progress?.cancellable && <button onClick={cancel}>取消校验</button>}
    </div>}
    {status && <p className="resource-status" role="status">{status}</p>}
    {error && <p className="resource-error" role="alert">{error}</p>}
    {preview && <Preview pack={preview} disabled={!!busy} confirm={() => setConfirming(true)} />}
    {latestFailure && <p className="resource-error">上次失败或中断 · {latestFailure.error}</p>}
    <section className="resource-panel" aria-labelledby="installed-resource-packs">
      <h2 id="installed-resource-packs">已安装资源包</h2>
      {history?.versions.length ? <ul className="resource-records">
        {history.versions.map((item) => <li key={item.pack_id + '@' + item.version}>
          <div><strong>{item.display_name}</strong><p>{item.pack_id} · {item.version} · {item.source}</p></div>
          <div>
            <strong>{item.integrity_error ? '文件异常' : item.is_current ? '当前版本' : '历史版本'}</strong>
            <p>{item.integrity_error ?? item.installed_at + ' UTC'}</p>
          </div>
        </li>)}
      </ul> : <p>{history ? '尚未安装资源包。' : '正在读取安装记录…'}</p>}
    </section>
    <section className="resource-panel" aria-labelledby="resource-install-history">
      <h2 id="resource-install-history">安装历史</h2>
      {history?.operations.length ? <ul className="resource-records">
        {history.operations.map((item) => <li key={item.id}>
          <div><strong>{item.pack_id} · {item.version}</strong><p>{item.started_at} UTC</p></div>
          <div><strong>{states[item.state] ?? item.state}{item.pending_cleanup ? ' · 待清理' : ''}</strong>
            {item.error && <p>{item.error}</p>}</div>
        </li>)}
      </ul> : <p>{history ? '暂无安装操作。' : '正在读取安装记录…'}</p>}
    </section>
    <dialog ref={dialog} aria-labelledby="pack-confirm-title" onCancel={() => setConfirming(false)}>
      <h2 id="pack-confirm-title">确认安装资源包</h2>
      <p>安装 {preview?.manifest.display_name} {preview?.manifest.pack_version}。公共内容更新会保留个人修订和组卷固定修订。</p>
      <div className="actions">
        <button autoFocus onClick={() => setConfirming(false)}>返回预览</button>
        <button className="primary" onClick={install}>确认并安装</button>
      </div>
    </dialog>
  </main>
}

function Preview({ pack, disabled, confirm }: { pack: PackPreview; disabled: boolean; confirm: () => void }) {
  const m = pack.manifest
  const space = pack.free_bytes >= pack.required_bytes
  return <section className="resource-panel" aria-labelledby="pack-preview-title">
    <h2 id="pack-preview-title">安装预览</h2>
    <h3>{m.display_name}</h3>
    <dl className="resource-facts">
      <div><dt>资源包 ID</dt><dd>{m.pack_id}</dd></div>
      <div><dt>版本</dt><dd>{m.pack_version}</dd></div>
      <div><dt>来源声明</dt><dd>{m.source}</dd></div>
      <div><dt>兼容性</dt><dd>通过 · 协议 {m.protocol_version} · Schema {m.db_schema} · 内容 v{m.content_version} · 软件 ≥ {m.min_app_version}</dd></div>
      <div><dt>完整性</dt><dd>SHA-256 校验通过 · {m.files.length} 个清单成员</dd></div>
      <div><dt>文件体积</dt><dd>{mib(pack.archive_bytes)} · 解压 {mib(pack.unpacked_bytes)}</dd></div>
      <div><dt>存储空间</dt><dd>预计需要 {mib(pack.required_bytes)} · 可用 {mib(pack.free_bytes)}</dd></div>
    </dl>
    <table className="resource-diff">
      <caption>安装差异</caption>
      <thead><tr><th scope="col">资源</th><th scope="col">包内</th><th scope="col">新增</th><th scope="col">公共更新</th><th scope="col">已存在</th></tr></thead>
      <tbody>{resources.map(([key, label]) => <tr key={key}>
        <th scope="row">{label}</th><td>{m.counts[key]}</td><td>{pack.diff[key].added}</td>
        <td>{pack.diff[key].updated}</td><td>{pack.diff[key].unchanged}</td>
      </tr>)}</tbody>
    </table>
    <p>冲突 {pack.diff.conflicts} 项 · 本次涉及的个人修订试题 {pack.diff.personal_revisions} 道。个人修订仍默认显示。</p>
    {pack.already_installed && <p role="status" className="resource-status">此资源包的相同版本已经安装。</p>}
    {pack.conflicts.map((message) => <p key={message} role="alert" className="resource-error">{message}</p>)}
    {!space && <p role="alert" className="resource-error">存储空间不足。</p>}
    <details>
      <summary>来源与许可声明（未核实）</summary>
      <p>SHA-256 校验确认文件完整性。发布者身份、内容审核和再分发许可仍需独立核实。</p>
      <ul className="resource-records">{pack.rights.entries.map((item) => <li key={item.id}>
        <div><strong>{item.license} · {item.author}</strong><p>{item.source} · {item.scope}</p>
          <p>{item.statement}</p>{item.evidence && <p>{item.evidence}</p>}</div>
        <div>{item.redistribution_claimed ? '包内声明允许再分发' : '包内未声明可再分发'}</div>
      </li>)}</ul>
    </details>
    <div className="actions">
      <button className="primary" disabled={disabled || pack.already_installed || pack.conflicts.length > 0 || !space}
        onClick={confirm}>安装此资源包</button>
    </div>
  </section>
}
