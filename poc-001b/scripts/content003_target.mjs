import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { readJson } from './content003_batch.mjs'
import { controlledPath, privateDirectory } from './content003_paths.mjs'

const execute = promisify(execFile)
const identifier = 'org.shandong-study.content003-2-isolated'
const normal = path => resolve(path.startsWith('\\\\?\\') ? path.slice(4) : path).toLowerCase()
export class TargetGuard {
  constructor(workspace, executable, identityFile, repository) {
    assert.equal(process.platform, 'win32', 'The dedicated bridge is Windows-only')
    this.workspace = privateDirectory(workspace, repository)
    const identity = readJson(controlledPath(this.workspace, identityFile))
    this.app = realpathSync(executable)
    assert.ok(isAbsolute(executable) && normal(executable) === normal(this.app), 'Supply the real absolute EXE path')
    assert.ok(isAbsolute(identity.executable))
    assert.equal(normal(this.app), normal(identity.executable), 'Unexpected executable path')
    this.hash = identity.sha256
    this.identifier = identity.identifier ?? identifier
    assert.ok([identifier, 'org.shandong-study.content003-2-patch-isolated',
      'org.shandong-study.content004-isolated', 'org.shandong-study.content004-b-isolated',
      'org.shandong-study.content004-export-isolated'].includes(this.identifier),
      'Unexpected dedicated application identifier')
    this.profile = join(privateDirectory(process.env.APPDATA, repository), this.identifier)
    this.journal = join(this.profile, 'data-protection', 'root.json')
    this.expected = this.library(identity.library)
    this.port = identity.port ?? 19444
    assert.ok(Number.isInteger(this.port) && this.port >= 1024 && this.port <= 65535)
    this.endpoint = '127.0.0.1:' + this.port
  }

  library(path) {
    assert.ok(isAbsolute(path))
    const root = normal(path)
    const base = normal(this.profile)
    assert.ok(root === base || (dirname(root) === base + '.knowpaper-libraries'
      && /^knowpaper-library-[a-z0-9]+$/i.test(basename(root))), 'Unexpected isolated library path')
    controlledPath(dirname(this.profile), root, {missing:true, type:'directory'})
    return root
  }

  pointer() {
    controlledPath(dirname(this.profile), this.journal, {missing:true})
    return existsSync(this.journal) ? readJson(this.journal) : {active:this.profile, phase:'complete'}
  }

  async beforeLaunch(switching) {
    const bytes = readFileSync(this.app)
    assert.match(this.hash, /^[0-9a-f]{64}$/)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), this.hash, 'EXE hash mismatch')
    assert.ok(bytes.includes(Buffer.from(this.identifier)), 'EXE lacks dedicated application identifier')
    const pointer = this.pointer()
    assert.equal(this.library(switching ? pointer.candidate : pointer.active), this.expected, 'Prelaunch library mismatch')
    assert.equal(pointer.phase, switching ? 'pending' : 'complete')
    assert.equal((await this.listeners()).length, 0, 'Debug port already occupied')
    this.webview = controlledPath(this.workspace, join(this.workspace, 'webview2-' + randomUUID()),
      {missing:true, type:'directory'})
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('WEBVIEW2_')))
    return {...env, WEBVIEW2_USER_DATA_FOLDER:this.webview,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port='+this.port+' --remote-debugging-address=127.0.0.1'}
  }

  async tcpRows() {
    const {stdout} = await execute('netstat.exe',['-ano'],{windowsHide:true,timeout:5000})
    return stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/))
      .filter(row => row[0] === 'TCP')
  }

  async listeners() {
    return (await this.tcpRows()).filter(row => row[1].endsWith(':'+this.port) && /:0$/.test(row[2]))
  }

  async verifySocket(child) {
    const rows = await this.tcpRows()
    const listener = rows.filter(row => row[1].endsWith(':'+this.port) && /:0$/.test(row[2]))
    await this.verifyOwner(child, listener)
    const connections = rows.filter(row => row[2] === this.endpoint && Number(row[4]) === process.pid)
    assert.ok(connections.some(client => rows.some(peer => peer[1] === this.endpoint &&
      peer[2] === client[1] && peer[4] === listener[0][4])), 'CDP socket peer could not be verified')
  }

  async verifyOwner(child, rows) {
    assert.ok(rows.length === 1 && rows[0][1] === this.endpoint, 'Expected one loopback-only listener')
    const owner = Number(rows[0][4])
    assert.ok(Number.isSafeInteger(owner) && owner > 0 && child?.pid, 'Listener or launch PID unavailable')
    const script = "$p = Get-CimInstance Win32_Process -Filter 'ProcessId = "+owner+"'; "+
      "$a = Get-CimInstance Win32_Process -Filter 'ProcessId = "+child.pid+"'; "+
      'if (!$p -or !$a) { exit 1 }; '+
      "@($p,$a) | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,"+
      "@{Name='Created';Expression={[string]$_.CreationDate.ToUniversalTime().Ticks}} | ConvertTo-Json -Compress"
    const {stdout} = await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],
      {windowsHide:true,timeout:8000})
    const [browser, process] = JSON.parse(stdout)
    assert.equal(process.ProcessId, child.pid)
    assert.equal(normal(process.ExecutablePath), normal(this.app), 'Launch PID executable mismatch')
    assert.equal(browser.ProcessId, owner)
    assert.equal(browser.ParentProcessId, child.pid, 'WebView2 listener belongs to another process')
    assert.ok(/^\d+$/.test(process.Created) && /^\d+$/.test(browser.Created) &&
      BigInt(browser.Created) >= BigInt(process.Created), 'WebView2 creation time mismatch')
    assert.equal(browser.Name.toLowerCase(), 'msedgewebview2.exe')
    assert.ok(browser.CommandLine?.toLowerCase().includes(this.webview.toLowerCase()), 'WebView2 profile mismatch')
    assert.equal(child.exitCode, null, 'Launched application exited')
  }

  async target(child, rows) {
    await this.verifyOwner(child, rows)
    const response = await fetch('http://'+this.endpoint+'/json/list', {redirect:'error', signal:AbortSignal.timeout(5000)})
    const targets = (await response.json()).filter(t => t.type === 'page' && t.url === 'http://tauri.localhost/')
    assert.equal(targets.length, 1, 'Expected one packaged Tauri page')
    const target = new URL(targets[0].webSocketDebuggerUrl)
    assert.ok(target.protocol === 'ws:' && target.host === this.endpoint
      && target.pathname === '/devtools/page/' + targets[0].id && !target.username && !target.password && !target.search && !target.hash)
    await this.verifyOwner(child, await this.listeners())
    return target
  }

  async active(rawCall, phase = 'complete') {
    const status = await rawCall('protection_status')
    assert.equal(this.library(status.directory), this.expected, 'Application opened an unexpected library')
    assert.equal(status.phase, phase, 'Application library is not ready')
    assert.ok(!status.error)
    assert.equal(await rawCall('database_status'), 9, 'Application schema mismatch')
    assert.equal(this.library(this.pointer().active), this.expected, 'Isolated profile pointer mismatch')
    return status
  }

  async schema() {
    const db = join(this.expected, 'study.sqlite3')
    assert.ok(lstatSync(db).isFile() && normal(realpathSync(db)) === db)
    const {stdout} = await execute('python',['-B','-c',
      'from pathlib import Path; import sqlite3,sys; print(sqlite3.connect(Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True).execute("PRAGMA user_version").fetchone()[0])',
      db],{windowsHide:true,timeout:5000})
    assert.equal(stdout.trim(), '9', 'Active SQLite schema mismatch')
  }

  restoreCandidate(phase) {
    const pointer = this.pointer()
    assert.equal(pointer.phase, phase)
    assert.equal(this.library(pointer.active), this.expected)
    const candidate = this.library(pointer.candidate)
    assert.notEqual(candidate, this.expected)
    return candidate
  }
}
