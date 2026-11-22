import { Extension, type JSONContent } from '@tiptap/core'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Plugin } from '@tiptap/pm/state'
import { parseDocument } from './model'

const cellContent = 'paragraph+'
const cellAttributes = () => ({
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null },
})

export function documentFromEditor(json: JSONContent) {
  for (const block of json.content ?? []) {
    if (block.type !== 'table') continue
    for (const row of block.content ?? []) {
      for (const cell of row.content ?? []) {
        const attrs = cell.attrs
        if (attrs && Object.keys(attrs).every((key) =>
          (key === 'colspan' || key === 'rowspan') ? attrs[key] === 1 : key === 'colwidth' && attrs[key] === null)) {
          delete cell.attrs
        }
      }
    }
  }
  return parseDocument(json)
}

export function tableExtensions(onError: (message: string) => void) {
  return [
    Table.configure({ resizable: false }),
    TableRow,
    TableCell.extend({ content: cellContent, addAttributes: cellAttributes }),
    TableHeader.extend({ content: cellContent, addAttributes: cellAttributes }),
    Extension.create({
      name: 'knowpaperTableLimits',
      addProseMirrorPlugins() {
        return [new Plugin({
          filterTransaction(transaction) {
            if (!transaction.docChanged || !transaction.doc.content.content.some((node) => node.type.name === 'table')) return true
            try {
              documentFromEditor(transaction.doc.toJSON())
              return true
            } catch (error) {
              onError('表格修改未应用。' + String(error))
              return false
            }
          },
        })]
      },
    }),
  ]
}
