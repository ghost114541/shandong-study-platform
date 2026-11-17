import { Fragment } from 'react'
import type { CSSProperties } from 'react'
import { AttachmentDeclarations } from './attachment-image'
import type { PrintSnapshot } from './composition-api'
import type { RichDocument } from './model'
import { Content } from './paper'

type PrintImages = Readonly<Record<string, string>>

function Solution({ answer, analysis, images }: {
  answer: RichDocument | null; analysis: RichDocument | null; images?: PrintImages
}) {
  return <>
    <p className="solution-label">答案{!answer && ' · 暂无答案'}</p>
    {answer && <Content data={answer} printImages={images} />}
    <p className="solution-label">解析{!analysis && ' · 暂无解析'}</p>
    {analysis && <Content data={analysis} printImages={images} />}
  </>
}

export function CompositionPaper({ snapshot, images }: { snapshot: PrintSnapshot; images?: PrintImages }) {
  const { entries, settings, mode } = snapshot
  const answers = mode === 'answers'
  const total = entries.reduce((sum, entry) => sum + entry.score, 0)
  return <article className="paper composition-paper" aria-label={answers ? '答案解析卷' : '题卷'}
    data-print-identity={snapshot.identity} data-print-mode={mode}
    style={{ '--question-gap': settings.gap_mm + 'mm' } as CSSProperties}>
    <h1>{snapshot.title}</h1>
    <p className="paper-meta">{answers ? '答案解析卷' : '题卷'} · 总分 {total} 分
      {settings.duration_minutes && ' · ' + settings.duration_minutes + ' 分钟'}
      {settings.scope && ' · ' + settings.scope}</p>
    {entries.map((entry, index) => <Fragment key={index}>
      {entry.group !== entries[index - 1]?.group && <h2 className="paper-group">{entry.group}</h2>}
      <section className="composition-print-entry" data-print-group={entry.group}
        data-print-revision={entry.revision_id} data-print-score={entry.score}>
        <h3>第 {index + 1} 题 · {entry.subject}（{entry.score} 分）</h3>
        <AttachmentDeclarations.Provider value={entry.attachments}>
          {answers
            ? (!entry.parts.length || entry.main || entry.analysis) && <Solution answer={entry.main} analysis={entry.analysis} images={images} />
            : entry.main && <Content data={entry.main} printImages={images} />}
          {entry.parts.map((part, partIndex) => <section key={partIndex} className="paper-part" data-print-part-score={part.score}>
            <h4>（{partIndex + 1}）{part.score} 分</h4>
            {answers ? <Solution answer={part.main} analysis={part.analysis} images={images} />
              : part.main && <Content data={part.main} printImages={images} />}
          </section>)}
        </AttachmentDeclarations.Provider>
        {!answers && settings.answer_space_mm > 0 &&
          <div className="answer-space" aria-label="作答空间" style={{ height: settings.answer_space_mm + 'mm' }} />}
      </section>
    </Fragment>)}
  </article>
}
