import { Fragment } from 'react'
import type { CSSProperties } from 'react'
import katex from 'katex'
import { imageUrl, mathOptions } from './editor'
import { AttachmentImage } from './attachment-image'
import { projectPaper } from './model'
import type { PaperData, RichBlock, RichDocument } from './model'

function Formula({ latex, block = false, punctuation }: { latex: string; block?: boolean; punctuation?: string }) {
  const html = katex.renderToString(latex, { ...mathOptions, throwOnError: false, displayMode: block })
  const formula = <span className="formula-source" dangerouslySetInnerHTML={{ __html: html }} />
  return block ? <span className="display-formula">{formula}{punctuation}</span> : formula
}

function trailingPunctuation(block: RichBlock | undefined): string | undefined {
  if (block?.type !== 'paragraph' || block.content?.length !== 1) return
  const [node] = block.content
  if (node.type === 'text' && !node.marks?.length && /^[。．，；、.!?,;]$/.test(node.text)) return node.text
}

export function Content({ data, printImages }: { data: RichDocument; printImages?: Readonly<Record<string, string>> }) {
  return data.content.map((block, index) => {
    if (block.type === 'image') {
      const { src, alt, title, width, height } = block.attrs
      const url = imageUrl(src)
      if (printImages) {
        const verified = url ?? printImages[src.slice('attachment:'.length)]
        return verified ? <img key={index} className="paper-image" src={verified} alt={alt ?? ''} title={title ?? undefined}
          style={{ '--image-width': width ? width + 'px' : undefined, '--image-height': height ? height + 'px' : undefined } as CSSProperties} />
          : <span key={index} data-print-image-missing>图片未验证</span>
      }
      return url === null ? <AttachmentImage key={index} id={src.slice('attachment:'.length)} attrs={block.attrs} className="paper-image" />
        : <img key={index} className="paper-image" src={url} alt={alt ?? ''} title={title ?? undefined}
          style={{ width: width ?? undefined, height: height ?? undefined }} />
    }
    if (block.type === 'blockMath') {
      return <Formula key={index} latex={block.attrs.latex} block punctuation={trailingPunctuation(data.content[index + 1])} />
    }
    if (data.content[index - 1]?.type === 'blockMath' && trailingPunctuation(block)) return null
    return <p key={index}>{block.content?.map((node, i) => {
      if (node.type === 'hardBreak') return <br key={i} />
      if (node.type === 'inlineMath') return <Formula key={i} latex={node.attrs.latex} />
      let text = <Fragment>{node.text}</Fragment>
      for (const mark of node.marks ?? []) text = mark.type === 'bold' ? <strong>{text}</strong> : <em>{text}</em>
      return <Fragment key={i}>{text}</Fragment>
    })}</p>
  })
}

export function Paper({ data, answer }: { data: PaperData; answer: boolean }) {
  const total = data.questions.reduce((sum, q) => sum + q.score, 0)
  return <article className="paper" aria-label={answer ? '答案卷' : '题卷'}>
    <h1>{data.title}</h1>
    <div className="paper-meta">{answer ? '答案卷' : '题卷'} · 总分 {total} 分{data.duration_minutes && ' · ' + data.duration_minutes + ' 分钟'}</div>
    {projectPaper(data, answer).map((q) => <section key={q.number}>
      <h2>第 {q.number} 题 · {q.subject}（{q.score} 分）</h2>
      {q.stem && <Content data={q.stem} />}
      {answer && !q.stem && !q.parts.length && <p>暂无答案</p>}
      {q.parts.map((part) => <section key={part.label} className="paper-part">
        <h3>（{part.label}）{part.score} 分</h3>
        {part.content ? <Content data={part.content} /> : <p>暂无答案</p>}
      </section>)}
    </section>)}
  </article>
}
