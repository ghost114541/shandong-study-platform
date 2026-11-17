import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { convertSample, questionToRevision, parseRevisionContent } from '../src/model.ts'

const fixtures: { name: string; valid: boolean; content: unknown }[] =
  JSON.parse(readFileSync(new URL('revision-contract.json', import.meta.url), 'utf8'))
for (const { name, valid, content } of fixtures) {
  test('DEV002-T01 ' + name, () => {
    if (valid) assert.deepEqual(parseRevisionContent(parseRevisionContent(content)), parseRevisionContent(content))
    else assert.throws(() => parseRevisionContent(content))
  })
}

test('DEV002-T01 POC 样本保持富文本和小问 ID', () => {
  const sample = JSON.parse(readFileSync(new URL('../../poc-001/samples/questions.json', import.meta.url), 'utf8'))
  const original = convertSample(sample)
  for (const question of original.questions) {
    const revision = questionToRevision(question)
    assert.deepEqual(revision.stem, question.stem)
    assert.deepEqual(revision.parts.map(({ analysis: _, ...part }) => part), question.parts)
  }
})
