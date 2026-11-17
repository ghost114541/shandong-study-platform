import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { mergeAttributes } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import { EditorContent, useEditor, useEditorState, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import katex from 'katex'
import 'katex/contrib/mhchem'
import graph from '../../poc-001/assets/parabola.svg?url'
import { bundledGraph, parseDocument } from './model'
import type { Attachment, RichDocument, RichImageAttributes } from './model'
import { AttachmentImage, imageByteLimit, imageTypes, importImage } from './attachment-image'
import { describeError } from './sqlite-api'

export const mathOptions = { trust: false, strict: 'ignore' } as const
export function imageUrl(src: string): string | null {
  if (src.startsWith('attachment:')) return null
  return src === bundledGraph ? graph : src
}

function EditorImage({ node, selected }: NodeViewProps) {
  const attrs = node.attrs as RichImageAttributes
  const url = imageUrl(attrs.src)
  return <NodeViewWrapper className={selected ? 'ProseMirror-selectednode' : undefined} contentEditable={false}>
    {url === null ? <AttachmentImage id={attrs.src.slice('attachment:'.length)} attrs={attrs} />
      : <img src={url} alt={attrs.alt ?? ''} title={attrs.title ?? undefined}
        style={{ width: attrs.width ?? undefined, height: attrs.height ?? undefined }} />}
  </NodeViewWrapper>
}

const LocalImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(EditorImage)
  },
  renderHTML({ HTMLAttributes }) {
    const src = imageUrl(HTMLAttributes.src)
    if (src === null) return ['span', { class: 'attachment-notice' }, '图片附件']
    return ['img', mergeAttributes(HTMLAttributes, { src })]
  },
}).configure({ allowBase64: true })

interface FormulaDraft {
  kind: 'inline' | 'block'
  latex: string
  pos?: number
}

interface Props {
  content: RichDocument
  onChange: (data: RichDocument, imported?: Attachment) => void
  externalImages?: boolean
  onImportingChange?: (importing: boolean) => void
  onError: (message: string) => void
}

export function QuestionEditor({ content, onChange, onError, externalImages = false, onImportingChange }: Props) {
  const [draft, setDraft] = useState<FormulaDraft | null>(null)
  const [formulaError, setFormulaError] = useState('')
  const [imageBusy, setImageBusy] = useState(false)
  const imported = useRef<Attachment | undefined>(undefined)
  const dialog = useRef<HTMLDialogElement>(null)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false, bulletList: false, code: false, codeBlock: false, dropcursor: false,
        heading: false, horizontalRule: false, link: false, listItem: false, orderedList: false,
        listKeymap: false, strike: false, underline: false,
      }),
      LocalImage,
      InlineMath.configure({
        katexOptions: mathOptions,
        onClick: (node, pos) => setDraft({ kind: 'inline', latex: node.attrs.latex, pos }),
      }),
      BlockMath.configure({
        katexOptions: mathOptions,
        onClick: (node, pos) => setDraft({ kind: 'block', latex: node.attrs.latex, pos }),
      }),
    ],
    content,
    editorProps: {
      attributes: { 'aria-label': '题目内容', spellcheck: 'false' },
      // Only the image chooser inserts images. Pasted HTML must not introduce remote image URLs.
      transformPastedHTML(html) {
        const document = new DOMParser().parseFromString(html, 'text/html')
        document.querySelectorAll('img').forEach((node) => node.remove())
        return document.body.innerHTML
      },
    },
    onUpdate({ editor }) {
      try {
        onChange(parseDocument(editor.getJSON()), imported.current)
      } catch (error) {
        onError(String(error))
      }
    },
  })
  const formatting = useEditorState({
    editor,
    selector: ({ editor }) => ({ bold: editor.isActive('bold'), italic: editor.isActive('italic') }),
  })
  const dialogOpen = draft !== null
  useEffect(() => {
    if (dialogOpen) dialog.current?.showModal()
    else dialog.current?.close()
  }, [dialogOpen])

  function dismiss() {
    setFormulaError('')
    setDraft(null)
  }

  function applyFormula(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    const latex = draft.latex
    if (!/\P{White_Space}/u.test(latex) || latex.length > 4000) {
      setFormulaError('请输入 1–4000 字符的 LaTeX。')
      return
    }
    try {
      katex.renderToString(latex, { ...mathOptions, displayMode: draft.kind === 'block' })
      const args = { latex, pos: draft.pos }
      const updated = draft.pos !== undefined
        ? (draft.kind === 'inline' ? editor.commands.updateInlineMath(args) : editor.commands.updateBlockMath(args))
        : (draft.kind === 'inline' ? editor.commands.insertInlineMath(args) : editor.commands.insertBlockMath(args))
      if (!updated) throw new Error('此位置不能插入或更新公式。')
      dismiss()
    } catch (error) {
      setFormulaError(String(error))
    }
  }

  async function insertImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (file.size > imageByteLimit || (!externalImages && !imageTypes.includes(file.type))) {
      onError('请选择不超过 5 MiB 的 PNG、JPEG、WebP 或 GIF。')
      return
    }
    setImageBusy(true)
    onImportingChange?.(true)
    try {
      let src: string
      if (externalImages) {
        imported.current = await importImage(file)
        src = 'attachment:' + imported.current.id
      } else {
        src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error('读取图片失败。'))
          reader.readAsDataURL(file)
        })
        const image = new window.Image()
        image.src = src
        await image.decode().catch(() => { throw new Error('图片无法解码。') })
      }
      if (!editor.isDestroyed && !editor.chain().focus().insertContentAt(editor.state.selection.to, {
        type: 'image', attrs: { src, alt: file.name },
      }).run()) onError('此位置不能插入图片。')
    } catch (error) {
      if (!editor.isDestroyed) onError(describeError(error))
    } finally {
      imported.current = undefined
      setImageBusy(false)
      onImportingChange?.(false)
    }
  }

  return <>
    <div className="toolbar" aria-label="富文本工具">
      <button aria-pressed={formatting.bold} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()}><b>粗体</b></button>
      <button aria-pressed={formatting.italic} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()}><i>斜体</i></button>
      <button onClick={() => setDraft({ kind: 'inline', latex: '' })}>插入行内公式</button>
      <button onClick={() => setDraft({ kind: 'block', latex: '' })}>插入独立公式</button>
      <label className="file-button">添加图片<input type="file" aria-label="添加图片" accept={imageTypes.join(',')} onChange={insertImage} disabled={imageBusy} /></label>
    </div>
    {imageBusy && <p role="status">正在导入图片…</p>}
    <EditorContent editor={editor} />
    <p className="hint">点击编辑区中的公式可以修改原始 LaTeX。</p>
    <dialog ref={dialog} onCancel={dismiss} aria-labelledby="formula-title">
      <form onSubmit={applyFormula}>
        <h3 id="formula-title">{draft?.kind === 'block' ? '独立公式' : '行内公式'}</h3>
        <label>LaTeX<textarea autoFocus value={draft?.latex ?? ''} onChange={(event) => {
          if (draft) setDraft({ ...draft, latex: event.target.value })
        }} /></label>
        {formulaError && <p role="alert">{formulaError}</p>}
        <div className="actions"><button type="button" onClick={dismiss}>取消</button><button className="primary" type="submit">应用公式</button></div>
      </form>
    </dialog>
  </>
}
