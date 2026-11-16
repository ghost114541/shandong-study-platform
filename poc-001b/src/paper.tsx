import { Fragment } from 'react'
import katex from 'katex'
import { imageUrl, mathOptions } from './editor'
import { projectPaper } from './model'
import type { QuestionSet, RichDocument } from './model'

function Formula({ latex, block = false }: { latex: string; block?: boolean }) {
  const html = katex.renderToString(latex, { ...mathOptions, throwOnError: false, displayMode: block })
  return <span className={block ? 'display-formula' : undefined} dangerouslySetInnerHTML={{ __html: html }} />
}

export function Content({ data }: { data: RichDocument }) {
  return data.content.map((block, index) => {
    if (block.type === 'image') {
      return <img key={index} className="paper-image" src={imageUrl(block.attrs.src)} alt={block.attrs.alt ?? ''} />
    }
    if (block.type === 'blockMath') return <Formula key={index} latex={block.attrs.latex} block />
    return <p key={index}>{block.content?.map((node, i) => {
      if (node.type === 'hardBreak') return <br key={i} />
      if (node.type === 'inlineMath') return <Formula key={i} latex={node.attrs.latex} />
      let text = <Fragment>{node.text}</Fragment>
      for (const mark of node.marks ?? []) text = mark.type === 'bold' ? <strong>{text}</strong> : <em>{text}</em>
      return <Fragment key={i}>{text}</Fragment>
    })}</p>
  })
}

export function Paper({ data, answer }: { data: QuestionSet; answer: boolean }) {
  const total = data.questions.reduce((sum, q) => sum + q.score, 0)
  return <article className="paper" aria-label={answer ? '答案卷' : '题卷'}>
    <h1>{data.title}</h1>
    <div className="paper-meta">{answer ? '答案卷' : '题卷'} · 总分 {total} 分 · {data.duration_minutes} 分钟</div>
    {projectPaper(data, answer).map((q) => <section key={q.number}>
      <h2>第 {q.number} 题 · {q.subject}（{q.score} 分）</h2>
      {q.stem && <Content data={q.stem} />}
      {q.parts.map((part) => <section key={part.label} className="paper-part">
        <h3>（{part.label}）{part.score} 分</h3>
        <Content data={part.content} />
      </section>)}
    </section>)}
  </article>
}

