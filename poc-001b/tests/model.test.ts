import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import katex from 'katex'
import 'katex/contrib/mhchem'
import { bundledGraph, convertSample, parseQuestionSet, projectPaper, withLongStem } from '../src/model.ts'

const sample = JSON.parse(readFileSync(new URL('../../poc-001/samples/questions.json', import.meta.url), 'utf8'))
const original = convertSample(sample)

test('converts POC-001 with the same question and part IDs, scores and source formulae', () => {
  assert.equal(original.questions.length, 3)
  assert.equal(original.questions.flatMap((q) => q.parts).length, 6)
  assert.equal(original.questions.reduce((sum, q) => sum + q.score, 0), 40)
  for (const [index, question] of original.questions.entries()) {
    assert.equal(question.id, sample.questions[index].id)
    assert.deepEqual(question.parts.map((part) => part.id), sample.questions[index].parts.map((part: { id: string }) => part.id))
  }
  assert.equal(original.questions[0].stem.content[1].type, 'image')
  assert.match(JSON.stringify(original), /poc001:parabola/)
  const formulae: string[] = []
  for (const q of original.questions) {
    for (const doc of [q.stem, ...q.parts.flatMap((part) => [part.prompt, part.answer])]) {
      for (const block of doc.content) {
        if (block.type === 'blockMath') formulae.push(block.attrs.latex)
        if (block.type === 'paragraph') {
          const inline = block.content?.filter((node) => node.type === 'inlineMath') ?? []
          formulae.push(...inline.map((node) => node.attrs.latex))
        }
      }
    }
  }
  assert.equal(formulae.length, 10)
  for (const latex of [...formulae, '\\ce{2H2 + O2 -> 2H2O}']) {
    assert.match(katex.renderToString(latex, { throwOnError: true }), /class="katex"/)
  }
})

test('round trip preserves edits, marks, formula sources and bundled/embedded attachments', () => {
  const data = structuredClone(original)
  data.questions[0].stem.content.push(
    { type: 'paragraph', content: [{ type: 'text', text: '粗体斜体 ABC 123', marks: [{ type: 'bold' }, { type: 'italic' }] }] },
    { type: 'blockMath', attrs: { latex: '  \\sqrt{313}  ' } },
    { type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: '附件' } },
  )
  const reopened = parseQuestionSet(JSON.parse(JSON.stringify(data)))
  assert.deepEqual(reopened, data)
  const block = reopened.questions[0].stem.content.at(-2)
  assert.ok(block?.type === 'blockMath')
  block.attrs.latex = '\\frac{21}{7}'
  const secondSave = parseQuestionSet(JSON.parse(JSON.stringify(reopened)))
  assert.deepEqual(secondSave, reopened)
  assert.equal(secondSave.questions[0].parts[0].id, 'p1')
  assert.ok(secondSave.questions[0].stem.content.some((node) => node.type === 'image' && node.attrs.src === bundledGraph))
})

test('rejects unsupported versions, duplicate IDs, bad nodes, and remote images', () => {
  assert.throws(() => parseQuestionSet({ ...original, schema_version: 2 }), /不兼容/)
  assert.throws(() => parseQuestionSet({ ...original, questions: [original.questions[0], original.questions[0]] }), /ID 重复/)
  const q = structuredClone(original)
  q.questions[0].parts[1].id = q.questions[0].parts[0].id
  assert.throws(() => parseQuestionSet(q), /小问 ID 重复/)
  assert.throws(() => parseQuestionSet({ ...original, questions: [{
    ...original.questions[0], stem: { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.com/a.png' } }] },
  }] }), /图片/)
  assert.throws(() => parseQuestionSet({ ...original, questions: [{
    ...original.questions[0], stem: { type: 'doc', content: [{ type: 'codeBlock' }] },
  }] }), /无效/)
})

test('paper and answer projection use identical numbering and disjoint content', () => {
  const paper = projectPaper(original, false)
  const answers = projectPaper(original, true)
  assert.deepEqual(paper.map((q) => q.parts.map((p) => p.label)), [['1.1', '1.2', '1.3'], ['2.1', '2.2'], ['3.1']])
  assert.deepEqual(paper.map((q) => q.parts.map((p) => p.label)), answers.map((q) => q.parts.map((p) => p.label)))
  assert.doesNotMatch(JSON.stringify(paper), /CaCl_2|顶点 \(2,-1\)|v=at=6/)
  assert.match(JSON.stringify(answers), /CaCl_2|顶点 \(2,-1\)|v=at=6/)
  const long = withLongStem(original)
  assert.equal(long.questions[0].stem.content.length, original.questions[0].stem.content.length + 36)
  assert.equal(long.questions[0].stem.content.at(-1)?.type, 'paragraph')
})
