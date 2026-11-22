import { z } from 'zod'

export const bundledGraph = 'poc001:parabola'
const id = z.string().min(1)
const score = z.number().int().nonnegative()
const unicode = z.string().refine((value) => !/[\uD800-\uDFFF]/u.test(value), '无效的 Unicode 字符')
const textNode = z.strictObject({
  type: z.literal('text'), text: unicode.min(1),
  marks: z.array(z.strictObject({ type: z.enum(['bold', 'italic']) })).optional(),
})
const latexAttrs = z.strictObject({ latex: unicode.min(1).max(4000).refine((value) => /\P{White_Space}/u.test(value), 'LaTeX 不能为空') })
const inlineMath = z.strictObject({ type: z.literal('inlineMath'), attrs: latexAttrs })
const inline = z.discriminatedUnion('type', [
  textNode, inlineMath, z.strictObject({ type: z.literal('hardBreak') }),
])
const paragraph = z.strictObject({ type: z.literal('paragraph'), content: z.array(inline).optional() })
const cellParagraph = paragraph.extend({ content: z.array(inline).max(256).optional() })
const tableCell = z.strictObject({
  type: z.enum(['tableHeader', 'tableCell']), content: z.array(cellParagraph).min(1).max(16),
})
const table = z.strictObject({
  type: z.literal('table'),
  content: z.array(z.strictObject({
    type: z.literal('tableRow'), content: z.array(tableCell).min(1).max(8),
  })).min(1).max(120),
}).superRefine(({ content }, ctx) => {
  const columns = content[0]?.content.length ?? 0
  if (content.length * columns > 480 || content.some((row, i) =>
    row.content.length !== columns || (i > 0 && row.content.some((cell) => cell.type === 'tableHeader')))) {
    ctx.addIssue({ code: 'custom', message: '表格必须为等宽矩形，表头限首行，最多 480 格。' })
  }
})
const imageSource = z.string().refine(
  (src) => src === bundledGraph || /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}(?![\s\S])/.test(src)
    || /^attachment:[A-Za-z0-9_-]+(?![\s\S])/.test(src),
  '图片必须为内置配图、内嵌位图或附件引用',
)
const document = z.strictObject({
  type: z.literal('doc'),
  content: z.array(z.discriminatedUnion('type', [
    paragraph,
    table,
    z.strictObject({ type: z.literal('blockMath'), attrs: latexAttrs }),
    z.strictObject({
      type: z.literal('image'),
      attrs: z.strictObject({
        src: imageSource, alt: unicode.nullable().optional(), title: unicode.nullable().optional(),
        width: z.number().positive().nullable().optional(), height: z.number().positive().nullable().optional(),
      }),
    }),
  ])).min(1),
}).superRefine(({ content }, ctx) => {
  const tables = content.filter((block) => block.type === 'table')
  if (tables.length > 16 || (tables.length && new TextEncoder().encode(JSON.stringify(tables)).length > 512 * 1024)) {
    ctx.addIssue({ code: 'custom', message: '单份文档最多 16 张表格，合计不得超过 512 KiB。' })
  }
})

const question = z.strictObject({
  id, subject: id, type: id, score, stem: document,
  parts: z.array(z.strictObject({ id, score, prompt: document, answer: document })),
})

const questionSet = z.strictObject({
  schema_version: z.literal(1),
  document_type: z.literal('poc001b_question_set'),
  title: id, duration_minutes: z.number().int().positive(),
  questions: z.array(question).min(1),
}).superRefine(({ questions }, ctx) => {
  const ids = new Set<string>()
  for (const q of questions) {
    if (ids.has(q.id)) ctx.addIssue({ code: 'custom', message: '题目 ID 重复 ' + q.id })
    ids.add(q.id)
    if (new Set(q.parts.map((p) => p.id)).size !== q.parts.length) {
      ctx.addIssue({ code: 'custom', message: '小问 ID 重复 ' + q.id })
    }
    if (q.parts.length && q.parts.reduce((sum, p) => sum + p.score, 0) !== q.score) {
      ctx.addIssue({ code: 'custom', message: '小问分值与整题分值不一致 ' + q.id })
    }
    if (pictures([q.stem, ...q.parts.flatMap((p) => [p.prompt, p.answer])]).some((src) => src.startsWith('attachment:'))) {
      ctx.addIssue({ code: 'custom', message: '旧版 JSON 文件不包含附件登记表' })
    }
    if ([q.stem, ...q.parts.flatMap((p) => [p.prompt, p.answer])].some(documentHasTable)) {
      ctx.addIssue({ code: 'custom', message: '旧版 JSON 试题集不支持表格。' })
    }
  }
})

export type QuestionSet = z.infer<typeof questionSet>
export type RichDocument = z.infer<typeof document>
export type RichBlock = RichDocument['content'][number]
export type RichParagraph = z.infer<typeof paragraph>
export type RichImageAttributes = Extract<RichBlock, { type: 'image' }>['attrs']

function pictures(documents: RichDocument[]): string[] {
  return documents.flatMap((doc) => doc.content.flatMap((block) => block.type === 'image' ? [block.attrs.src] : []))
}

export const CONTENT_VERSION = 1
export const TABLE_CONTENT_VERSION = 2
const nonblank = unicode.refine((value) => /\P{White_Space}/u.test(value))
const points = score.max(0xffffffff)
const optionalDocument = document.nullish().transform((value) => value ?? null)
const attachment = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]+(?![\s\S])/),
  media_type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  byte_size: z.number().int().positive(),
  sha256: z.string().length(64).regex(/^[0-9a-fA-F]+$/),
})
export type Attachment = z.infer<typeof attachment>

const questionDraftContent = z.strictObject({
  schema_version: z.union([z.literal(CONTENT_VERSION), z.literal(TABLE_CONTENT_VERSION)]),
  question_type: unicode,
  score: points,
  stem: document,
  answer: optionalDocument,
  analysis: optionalDocument,
  parts: z.array(z.strictObject({
    id: nonblank, score: points, prompt: document, answer: optionalDocument, analysis: optionalDocument,
  })),
  attachments: z.array(attachment).default([]),
}).superRefine((value, ctx) => {
  const attachments = new Set(value.attachments.map((item) => item.id))
  const partIds = new Set(value.parts.map((part) => part.id))
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (attachments.size !== value.attachments.length) issue('附件 ID 重复')
  if (partIds.size !== value.parts.length) issue('小问 ID 重复')
  if (value.parts.length && value.parts.reduce((sum, part) => sum + part.score, 0) !== value.score) {
    issue('小问分值与整题分值不一致')
  }
  const docs = [value.stem, value.answer, value.analysis,
    ...value.parts.flatMap((part) => [part.prompt, part.answer, part.analysis])]
  if ((value.schema_version === TABLE_CONTENT_VERSION) !== docs.some(documentHasTable)) {
    issue('富文本版本 2 仅用于含表格的修订。')
  }
  for (const src of pictures(docs.filter((doc) => doc !== null))) {
    if (src.startsWith('attachment:') && !attachments.has(src.slice('attachment:'.length))) issue('图片引用未登记的附件')
    if (src.startsWith('data:') && src.slice(src.indexOf(',') + 1).length % 4 !== 0) issue('图片 Base64 长度无效')
  }
})

const revisionContent = questionDraftContent.safeExtend({ question_type: nonblank })
export type RevisionContent = z.infer<typeof revisionContent>

export function parseQuestionDraftContent(input: unknown): RevisionContent {
  return questionDraftContent.parse(input)
}

function documentHasTable(doc: RichDocument | null): boolean {
  return doc?.content.some((block) => block.type === 'table') ?? false
}

export function withRevisionContentVersion(value: RevisionContent): RevisionContent {
  const docs = [value.stem, value.answer, value.analysis,
    ...value.parts.flatMap((part) => [part.prompt, part.answer, part.analysis])]
  return { ...value, schema_version: docs.some(documentHasTable) ? TABLE_CONTENT_VERSION : CONTENT_VERSION }
}

export function referencedAttachments(value: RevisionContent): Attachment[] {
  const documents = [value.stem, value.answer, value.analysis,
    ...value.parts.flatMap((part) => [part.prompt, part.answer, part.analysis])]
  const sources = new Set(pictures(documents.filter((doc) => doc !== null)))
  return value.attachments.filter((item) => sources.has('attachment:' + item.id))
}

export function parseRevisionContent(input: unknown): RevisionContent {
  const result = revisionContent.safeParse(input)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new Error('无效的试题修订：' + issue.path.join('.') + ' ' + issue.message)
  }
  return result.data
}

export function questionToRevision(question: QuestionSet['questions'][number]): RevisionContent {
  return parseRevisionContent({
    schema_version: CONTENT_VERSION, question_type: question.type, score: question.score,
    stem: question.stem, parts: question.parts,
  })
}

export function parseDocument(input: unknown): RichDocument {
  return document.parse(input)
}

export function parseQuestionSet(input: unknown): QuestionSet {
  if (typeof input === 'object' && input !== null && 'schema_version' in input && input.schema_version !== 1) {
    throw new Error('不兼容的 JSON 数据版本 ' + String(input.schema_version))
  }
  const result = questionSet.safeParse(input)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new Error('无效的试题 JSON：' + issue.path.join('.') + ' ' + issue.message)
  }
  return result.data
}

interface SampleBlock {
  type: string
  src?: string
  alt?: string
  children?: { type: string; text?: string; latex?: string }[]
}

function convertBlocks(blocks: SampleBlock[], displayMath = false): RichDocument {
  const content = blocks.flatMap<RichBlock>((block) => {
    if (block.type === 'image' && block.src === 'assets/parabola.svg') {
      return [{ type: 'image', attrs: { src: bundledGraph, alt: block.alt } }]
    }
    if (block.type !== 'paragraph' || !block.children) throw new Error('无法转换示例段落')
    if (displayMath && block.children[0]?.type === 'math') {
      const [formula, ...rest] = block.children
      return [
        { type: 'blockMath', attrs: { latex: formula.latex ?? '' } },
        ...convertBlocks([{ type: 'paragraph', children: rest }]).content,
      ]
    }
    return [{
      type: 'paragraph',
      content: block.children.map((child) => child.type === 'math'
        ? { type: 'inlineMath', attrs: { latex: child.latex ?? '' } }
        : { type: 'text', text: child.text ?? '' }),
    }]
  })
  return parseDocument({ type: 'doc', content })
}

interface Sample {
  title: string
  duration_minutes: number
  questions: {
    id: string; score: number; type: string; subject: string; stem: SampleBlock[]
    parts: { id: string; score: number; prompt: SampleBlock[]; answer: SampleBlock[] }[]
  }[]
}

export function convertSample(sample: Sample): QuestionSet {
  return parseQuestionSet({
    ...sample, schema_version: 1, document_type: 'poc001b_question_set',
    questions: sample.questions.map((q) => ({
      ...q, stem: convertBlocks(q.stem),
      parts: q.parts.map((p) => ({
        ...p, prompt: convertBlocks(p.prompt), answer: convertBlocks(p.answer, q.subject === '化学'),
      })),
    })),
  })
}

export function withLongStem(source: QuestionSet): QuestionSet {
  const copy = structuredClone(source)
  const blocks: RichBlock[] = Array.from({ length: 36 }, (_, index) => ({
    type: 'paragraph',
    content: [{
      type: 'text',
      text: '分页检查 ' + String(index + 1).padStart(2, '0') + '：记录图像交点与区间符号，说明比较依据。'
        + '先观察曲线的走势，再结合坐标轴核对推导结果。请写出必要步骤并保留单位。'.repeat(4),
    }],
  }))
  copy.questions[0].stem.content.push(...blocks)
  return copy
}

export interface PaperData {
  title: string
  duration_minutes?: number
  questions: {
    subject: string
    score: number
    stem: RichDocument
    answer?: RichDocument | null
    analysis?: RichDocument | null
    parts: { score: number; prompt: RichDocument; answer: RichDocument | null; analysis?: RichDocument | null }[]
  }[]
}

export function revisionToPaper(content: RevisionContent, subject: string): PaperData {
  return {
    title: '知卷试题',
    questions: [{ subject, score: content.score, stem: content.stem, answer: content.answer, analysis: content.analysis, parts: content.parts }],
  }
}

export function projectPaper(source: PaperData, answer: boolean) {
  return source.questions.map((q, index) => ({
    number: index + 1, subject: q.subject, score: q.score,
    stem: answer ? q.answer : q.stem,
    analysis: answer ? q.analysis : undefined,
    parts: q.parts.map((p, i) => ({
      label: String(index + 1) + '.' + String(i + 1), score: p.score,
      content: answer ? p.answer : p.prompt,
      analysis: answer ? p.analysis : undefined,
    })),
  }))
}
