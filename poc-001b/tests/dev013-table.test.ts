import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseQuestionDraftContent, parseRevisionContent, projectPaper, revisionToPaper, withRevisionContentVersion } from '../src/model.ts'

const fixture = JSON.parse(readFileSync(new URL('dev013-table.json', import.meta.url), 'utf8'))

test('TAB-03/05 preserves the full table through JSON and draft parsing', () => {
  const content = parseRevisionContent(fixture)
  assert.deepEqual(content.stem, fixture.stem)
  assert.deepEqual(parseQuestionDraftContent(JSON.parse(JSON.stringify(content))), content)
  assert.equal(withRevisionContentVersion({ ...content, stem: { type: 'doc', content: [{ type: 'paragraph' }] } }).schema_version, 1)
})

test('TAB-09 rejects invalid geometry, unsupported blocks and dangerous attributes', () => {
  const mutations: ((table: typeof fixture, doc: typeof fixture) => void)[] = [
    (_, doc) => { doc.schema_version = 1 },
    (table) => { table.content[1].content.pop() },
    (table) => { table.content = Array(121).fill(table.content[0]) },
    (table) => { table.content[1].content[0].type = 'tableHeader' },
    (table) => { table.content[0].content[0].attrs = { onmouseover: 'unsafe' } },
    (table) => { table.content[0].content[0].content[0] = { type: 'image', attrs: { src: 'https://example.test/image.png' } } },
    (table) => { table.content[0].content[0].content[0].content[0].text = '测'.repeat(180000) },
    (table, doc) => { doc.stem.content = Array(17).fill(table) },
  ]
  for (const mutate of mutations) {
    const doc = structuredClone(fixture)
    mutate(doc.stem.content[0], doc)
    assert.throws(() => parseRevisionContent(doc))
  }
})

test('TAB-11 single-question paper projection excludes answer and analysis tables', () => {
  const base = parseRevisionContent(fixture)
  const paper = revisionToPaper({ ...base, answer: base.stem, analysis: base.stem }, '数学')
  assert.equal(projectPaper(paper, false)[0].analysis, undefined)
  assert.deepEqual(projectPaper(paper, true)[0].analysis, base.stem)
})
