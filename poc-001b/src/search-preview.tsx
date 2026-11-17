import { useState } from 'react'
import { difficultyLabel } from './metadata-api'
import { Content } from './paper'
import { AttachmentDeclarations } from './attachment-image'
import { reviewStatusLabel } from './sqlite-api'
import type { RevisionDetail } from './sqlite-api'
import type { KnowledgeLink, SearchHit } from './knowledge-api'

export interface LoadedPreview {
  detail: RevisionDetail
  links: KnowledgeLink[]
}

export function SearchPreview({ hit, subject, loaded, error, close, open }: {
  hit: SearchHit; subject: string; loaded: LoadedPreview | null; error: string
  close: () => void; open: () => void
}) {
  const [showAnswers, setShowAnswers] = useState(false)
  const content = loaded?.detail.revision.content
  const points = [...new Set(loaded?.links.map(({ title }) => title))]
  return <aside className="panel search-preview" aria-label="试题侧边预览">
    <header className="preview-header">
      <h2>试题预览</h2>
      <button type="button" onClick={close}>关闭预览</button>
    </header>
    <p>{subject} · {content?.question_type ?? hit.question_type ?? '题型未标注'} · {difficultyLabel(hit.difficulty)}</p>
    {hit.source_label && <p>原卷 {hit.source_label}</p>}
    {error && <p role="alert">{error}</p>}
    {!error && !loaded && <p role="status">正在读取试题…</p>}
    {loaded && content && <AttachmentDeclarations.Provider value={content.attachments}>
      <p className="review-status">答案审核 · {reviewStatusLabel(loaded.detail)} · 修订 #{loaded.detail.revision.id}</p>
      <p>知识点 {points.join('、') || '未关联'}</p>
      <div className="preview-stem"><Content data={content.stem} />
        {content.parts.map((part, index) => <section key={part.id}>
          <h3>小问 {index + 1} · {part.score} 分</h3>
          <Content data={part.prompt} />
        </section>)}
      </div>
      <div className="actions">
        <button type="button" aria-expanded={showAnswers} aria-controls="search-preview-answer"
          onClick={() => setShowAnswers(!showAnswers)}>{showAnswers ? '收起答案' : '展开答案'}</button>
        <button type="button" onClick={open}>打开完整试题</button>
      </div>
      {showAnswers && <section id="search-preview-answer" className="preview-answers">
        {content.answer && <Content data={content.answer} />}
        {!content.answer && !content.parts.length && <p>暂无答案。</p>}
        {content.parts.map((part, index) => <section key={part.id}>
          <h3>小问 {index + 1} 答案</h3>
          {part.answer ? <Content data={part.answer} /> : <p>暂无答案。</p>}
        </section>)}
      </section>}
    </AttachmentDeclarations.Provider>}
  </aside>
}
