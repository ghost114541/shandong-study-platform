import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(new URL(path,import.meta.url)))
const batch = read('../scripts/content003_batch.mjs')
const native = read('../scripts/content003_native.mjs')
const paper = read('../src-tauri/src/paper_reader_ipc.rs')
const backup = read('../src-tauri/src/protection_ipc.rs')

function matchesTitle(script, pattern, title) {
  assert.equal(script.match(pattern)?.[1],title,'File picker title differs from the Rust window title')
}

const importTitle = /native\.pick\('import_paper_pdf',\s*fileArgs\([^)]*\),\s*'([^']+)'/
const rustTitle = paper.match(/set_title\("([^"]+)"\)\.pick_file\(callback\)/)?.[1]
test('PATCH-T01 PDF import, backup and restore titles match the UTF-8 Rust source', () => {
  assert.equal(rustTitle,'\u5bfc\u5165\u8bd5\u5377 PDF')
  matchesTitle(batch,importTitle,rustTitle)
  const backupTitles = [...backup.matchAll(/set_title\("([^"]+)"\)/g)].map(match => match[1])
  const save = '\u4fdd\u5b58\u77e5\u5377\u5b8c\u6574\u5907\u4efd'
  const restore = '\u9009\u62e9\u77e5\u5377\u5907\u4efd'
  assert.ok(backupTitles.includes(save) && backupTitles.includes(restore))
  matchesTitle(native,/pick\('create_backup',\{\},'([^']+)'/,save)
  matchesTitle(native,/pick\('preview_restore',\{\},'([^']+)'/,restore)
})

test('PATCH-T02 substituted title fails the same contract assertion', () => {
  const wrongTitle = batch.replace(rustTitle,'Wrong title')
  assert.throws(() => matchesTitle(wrongTitle,importTitle,rustTitle),/title differs/)
})
