import assert from 'node:assert/strict'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const within = (root, path) => {
  const difference = relative(root, path)
  return !isAbsolute(difference) && difference !== '..' && !difference.startsWith('..' + sep)
}

export function controlledPath(root, path, {missing = false, type = 'file'} = {}) {
  root = resolve(root)
  const absolute = resolve(path)
  if (process.platform === 'win32') {
    const segments = absolute.slice(parse(absolute).root.length).split(sep)
    assert.ok(segments.every(segment => !/[:<>|?*"\x00-\x1f]|[. ]$/.test(segment) &&
      !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment)),
    'Private path contains a Windows device or stream name')
  }
  assert.ok(within(root, absolute), 'Private path escapes its directory')
  let cursor = absolute
  while (true) {
    let stat
    try {
      stat = lstatSync(cursor)
    } catch (error) {
      if (error.code !== 'ENOENT' || !missing || relative(root, cursor) === '') throw error
    }
    if (stat) {
      assert.ok(!stat.isSymbolicLink() && relative(cursor, realpathSync(cursor)) === '',
        'Private path traverses a redirected path')
      if (cursor === absolute && type === 'file') {
        assert.ok(stat.isFile() && stat.nlink === 1, 'Expected a private regular file')
      } else {
        assert.ok(stat.isDirectory(), 'Expected a private directory')
      }
    }
    if (relative(root, cursor) === '') break
    cursor = dirname(cursor)
  }
  return absolute
}

export function privateDirectory(path, repository = repositoryRoot) {
  const root = resolve(path)
  const repo = realpathSync(repository)
  assert.ok(!within(repo, root) && !within(root, repo), 'Choose a private directory outside the repository')
  const verified = controlledPath(root, root, {type:'directory'})
  for (let cursor = verified; ; cursor = dirname(cursor)) {
    assert.ok(!existsSync(resolve(cursor, '.git')), 'Private directory belongs to a Git checkout')
    if (dirname(cursor) === cursor) break
  }
  return verified
}

export function controlledCompositionPdf(library, path, filename) {
  assert.ok(filename === 'paper.pdf' || filename === 'answers.pdf', 'Unexpected PDF role')
  // Rust canonicalizes the active library. On Windows the IPC path can therefore
  // use the extended drive spelling for the same directory seen by Node.
  if (process.platform === 'win32' && /^\\\\\?\\[a-z]:\\/i.test(path)) {
    const ordinary = path.slice(4)
    assert.ok(!ordinary.includes('/') && ordinary.slice(3).split('\\').every(Boolean),
      'Invalid extended Windows PDF path')
    assert.ok(!ordinary.slice(3).split('\\').some(segment => segment === '.' || segment === '..'),
      'Relative segment in extended Windows PDF path')
    path = ordinary
  }
  assert.ok(isAbsolute(path), 'Expected an absolute PDF path')
  const pdf = controlledPath(library, resolve(library, 'pdf'), {type:'directory'})
  const output = controlledPath(pdf, path)
  const parts = relative(pdf, output).split(sep)
  assert.ok(parts.length === 2 && /^composition-[a-f0-9]{12}-[a-z0-9]+$/i.test(parts[0]) &&
    parts[1] === filename, 'Unexpected composition PDF path')
  return output
}
