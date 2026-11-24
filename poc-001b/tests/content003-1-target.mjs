import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { readJson, writeJson } from '../scripts/content003_batch.mjs'
import { TargetGuard } from '../scripts/content003_target.mjs'

const [identityFile, wrongExecutable] = process.argv.slice(2)
const identity = readJson(identityFile)
const root = dirname(resolve(identityFile))
const workspace = realpathSync(root)
const scripts = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts')
const repository = resolve(scripts, '../..')
const execute = promisify(execFile)
const db = join(identity.library, 'study.sqlite3')
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const fingerprint = () => [db, db+'-wal'].map(path => {
  try { return sha(path) } catch (error) { if (error.code !== 'ENOENT') throw error; return null }
})
const before = fingerprint()
const values = (label, change) => {
  const path = join(root,'fault-'+label+'.json')
  writeJson(path,{...identity,...change})
  return path
}
const fault = async (label, pattern, path, config) => {
  await assert.rejects(execute(process.execPath,[join(scripts,'content003_native.mjs'),
    'import', workspace, path,'not-a-manifest','not-a-registry',config], {timeout:30000}), pattern)
  assert.deepEqual(fingerprint(),before)
  console.log(label+' rejected; database and WAL unchanged')
}
await fault('wrong-exe', /Unexpected executable path/, wrongExecutable, identityFile)
await fault('wrong-hash', /EXE hash mismatch/, identity.executable, values('hash',{sha256:'0'.repeat(64)}))
await fault('wrong-app-identifier', /lacks dedicated application identifier/, wrongExecutable,
  values('identifier',{executable:wrongExecutable,sha256:sha(wrongExecutable)}))
const server = createServer()
await new Promise((ok, fail) => server.listen(0,'127.0.0.1',ok).once('error',fail))
try {
  const occupied = values('port',{port:server.address().port})
  await fault('occupied-port', /Debug port already occupied/, identity.executable, occupied)
  const guard = new TargetGuard(workspace,identity.executable,occupied,repository)
  guard.app = process.execPath
  const rows = await guard.listeners()
  await assert.rejects(guard.target({pid:process.pid,exitCode:null},rows), /belongs to another process/)
  await assert.rejects(guard.target({},rows), /launch PID unavailable/)
  assert.deepEqual(fingerprint(),before)
  console.log('foreign target and unknown PID rejected before connection; database and WAL unchanged')
} finally {
  await new Promise((ok,fail) => server.close(error => error ? fail(error) : ok()))
}
const guard = new TargetGuard(workspace,identity.executable,identityFile,repository)
const previous = guard.pointer().previous
assert.ok(previous)
await fault('stale-pre-restore-path', /Prelaunch library mismatch/, identity.executable,
  values('old-library',{library:previous}))
let mutations = 0
const fakeIpc = command => {
  if (command === 'protection_status') return {directory:previous,phase:'complete'}
  if (command === 'database_status') return 9
  mutations++
}
await assert.rejects(guard.active(fakeIpc), /Application opened an unexpected library/)
assert.equal(mutations,0)
assert.deepEqual(fingerprint(),before)
console.log('in-process library mismatch rejected by active-library guard; database and WAL unchanged')
