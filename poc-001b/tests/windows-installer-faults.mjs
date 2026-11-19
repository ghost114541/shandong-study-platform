import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const [setupArgument, evidenceArgument] = process.argv.slice(2)
assert.ok(setupArgument && evidenceArgument,
  'Run from poc-001b: node tests/windows-installer-faults.mjs <B.exe> <completed acceptance directory>')
const setupPath = resolve(setupArgument)
const evidence = resolve(evidenceArgument)
const expected = JSON.parse(readFileSync(join(evidence, 'data-fingerprints.json'), 'utf8'))['A-before-upgrade']
const setupManifest = JSON.parse(readFileSync(join(resolve(setupPath, '..'), 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''))
const profile = join(process.env.APPDATA, 'org.shandong-study.knowpaper-preview')
const install = join(process.env.LOCALAPPDATA, 'KnowPaper Preview')
const program = join(install, 'knowpaper-preview.exe')
const journal = join(profile, 'data-protection', 'root.json')
const stagedProgram = join(install, 'knowpaper-preview.next')
const expectedVersion = '0.2.1'
const output = []
const pathFromJournal = path => path.replace(/^\\\\\?\\/, '')
const ps = command => execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
  { encoding: 'utf8', timeout: 90000 }).trim()
const q = value => "'" + value.replaceAll("'", "''") + "'"
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')

function installedVersion() {
  return ps("(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\org.shandong-study.knowpaper-preview').DisplayVersion")
}
function fingerprint(label, details = {}) {
  assert.equal(installedVersion(), expectedVersion)
  assert.equal(hash(journal), expected.journalHash)
  assert.equal(hash(join(evidence, 'synthetic.knowbackup')), expected.userBackup)
  const roots = [expected.journal.active, expected.journal.previous].map(pathFromJournal)
  for (let i = 0; i < roots.length; i++) {
    const actual = JSON.parse(execFileSync('python', ['tests/dev010-fixtures.py', 'snapshot', roots[i]],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
    const { backupHistory, ...core } = expected.library[i]
    assert.deepEqual(actual, core)
  }
  const row = { label, ...details, version: installedVersion(), programSHA: hash(program), journalSHA: hash(journal), dataEqual: true }
  output.push(row)
  console.log(JSON.stringify(row))
  writeFileSync(join(evidence, 'supplemental-faults.json'), JSON.stringify(output, null, 2) + '\n')
}

async function silent() {
  const child = spawn(setupPath, ['/S'], { windowsHide: true, stdio: 'ignore' })
  const [code] = await once(child, 'exit')
  return code
}

assert.equal(setupManifest.version, expectedVersion)
assert.equal(hash(setupPath), setupManifest.sha256)
assert.equal(hash(journal), expected.journalHash, 'Only the synthetic acceptance profile can be used')
assert.equal(installedVersion(), expectedVersion)
assert.equal(ps('if (Get-Process knowpaper-preview -ErrorAction SilentlyContinue) { "running" }'), '')
const programHash = hash(program)

const wizard = spawn(setupPath, [], { stdio: 'ignore' })
const wizardExit = once(wizard, 'exit')
try {
  const deadline = performance.now() + 20000
  let ready = false
  while (!ready && performance.now() < deadline && wizard.exitCode === null) {
    ready = ps('$p=Get-Process -Id ' + wizard.pid + ' -ErrorAction SilentlyContinue; if ($p.MainWindowHandle) { "ready" }') === 'ready'
    if (!ready) await delay(100)
  }
  assert.ok(ready, 'The first installer must have a real active wizard before launching the second')
  const exit = await silent()
  assert.equal(exit, 10)
  fingerprint('concurrent-installer-refused', { secondInstallerExitCode: exit })
} finally {
  if (wizard.exitCode === null) wizard.kill()
  await wizardExit
}

let stopped
for (let attempt = 1; attempt <= 3 && !stopped; attempt++) {
  assert.ok(!existsSync(stagedProgram))
  const child = spawn(setupPath, ['/S'], { windowsHide: true, stdio: 'ignore' })
  let observedStage = false
  const watcher = watch(install, (_event, file) => {
    if (file === basename(stagedProgram) && child.exitCode === null && existsSync(stagedProgram)) {
      observedStage = true
      child.kill()
    }
  })
  let code, signal
  try { [code, signal] = await once(child, 'exit') }
  finally { watcher.close() }
  if (observedStage && signal) {
    fingerprint('installer-terminated-during-file-extraction', { attempt, exitCode: code, exitSignal: signal,
      stagedProgramExists: existsSync(stagedProgram) })
    const retry = await silent()
    assert.equal(retry, 0)
    assert.equal(hash(program), programHash)
    fingerprint('repair-after-extraction-interruption', { retryExitCode: retry })
    stopped = true
  }
}
if (!stopped) fingerprint('interruption-target-window-missed', { status: 'NOT TESTED' })

const savedProgram = join(evidence, 'test-original-program.exe')
assert.ok(!existsSync(savedProgram))
renameSync(program, savedProgram)
try {
  writeFileSync(program, 'deliberately damaged DEV-011 synthetic executable')
  const repair = await silent()
  assert.equal(repair, 0)
  assert.equal(hash(program), programHash)
  fingerprint('repair-damaged-installed-file', { repairExitCode: repair })
} finally {
  if (!existsSync(program) || hash(program) !== programHash) copyFileSync(savedProgram, program)
}

const denyWrite = JSON.parse(ps(
  '$path=' + q(install) + '; $setup=' + q(setupPath) + '; ' +
  '$saved=Get-Acl -LiteralPath $path; $ruleAcl=Get-Acl -LiteralPath $path; ' +
  '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; ' +
  '$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid, "WriteData,AppendData", "None", "None", "Deny"); ' +
  '$ruleAcl.AddAccessRule($rule); Set-Acl -LiteralPath $path -AclObject $ruleAcl; ' +
  'try { $p=Start-Process -FilePath $setup -ArgumentList /S -WindowStyle Hidden -PassThru -Wait; ' +
  '@{code=$p.ExitCode; programExists=(Test-Path -LiteralPath (Join-Path $path "knowpaper-preview.exe"))} | ConvertTo-Json -Compress } ' +
  'finally { Set-Acl -LiteralPath $path -AclObject $saved }'
))
assert.ok([12, 13].includes(denyWrite.code))
assert.equal(denyWrite.programExists, true)
assert.equal(hash(program), programHash)
fingerprint('write-denied-install-directory', { setupExitCode: denyWrite.code })

const shortcutDenied = JSON.parse(ps(
  '$link=Join-Path ([Environment]::GetFolderPath("Programs")) "知卷 KnowPaper（测试版）.lnk"; ' +
  '$stream=[IO.File]::Open($link,"Open","Read","Read"); ' +
  'try { $p=Start-Process -FilePath ' + q(setupPath) + ' -ArgumentList /S -WindowStyle Hidden -PassThru -Wait; ' +
  '@{code=$p.ExitCode; linkExists=(Test-Path -LiteralPath $link)} | ConvertTo-Json -Compress } finally { $stream.Dispose() }'
))
assert.equal(shortcutDenied.code, 14)
assert.equal(shortcutDenied.linkExists, true)
assert.equal(hash(program), programHash)
fingerprint('start-menu-shortcut-write-denied', { setupExitCode: shortcutDenied.code })

const retry = await silent()
assert.equal(retry, 0)
fingerprint('repair-after-write-and-shortcut-denial', { retryExitCode: retry })
