
import { invoke } from '@tauri-apps/api/core'
import type { Attachment } from './model'
import type { QuestionSummary } from './sqlite-api'

export const roleLabels = { original: '原卷', answer: '答案', analysis: '解析' } as const
export type PdfRole = keyof typeof roleLabels
export type Rect = readonly [number, number, number, number]

export interface PdfRegion {
  page_index: number
  rect: Rect
}

export interface RegionLink {
  file_id: string
  source_key: string
  regions: PdfRegion[]
}

export interface Location extends PdfRegion {
  paper_id: string
  title: string
  file_id: string
  source_key: string
  question_id: string
  ordinal: number
}

export interface ReaderTarget {
  fileId: string
  page?: number
  location?: Location
  returnQuestion?: QuestionSummary
}

export interface ScreenshotDraft {
  subjectId: string
  link: RegionLink
  attachments: Attachment[]
  target: ReaderTarget
}

export interface PaperFile {
  id: string
  paper_id: string
  role: PdfRole
  sha256: string
  byte_size: number
  page_count: number
  original_name: string
  source: string | null
  imported_at: string
}

export interface PaperRecord {
  id: string
  title: string
  subject_id: string | null
  year: number | null
  region: string | null
  source: string | null
  files: PaperFile[]
}

interface ImportInput {
  paper_id: string | null
  title: string
  subject_id: string
  year: number | null
  region: string | null
  source: string | null
  role: PdfRole
}

export const paperReader = {
  records: () => invoke<PaperRecord[]>('list_paper_records'),
  import: (input: ImportInput) => invoke<PaperFile | null>('import_paper_pdf', { input }),
  open: (fileId: string) => invoke<{ token: number; file: PaperFile }>('open_paper_pdf', { fileId }),
  chunk: (token: number, begin: number, end: number) =>
    invoke<ArrayBuffer>('read_paper_chunk', { token, begin, end }),
  close: (token: number) => invoke<void>('close_paper_pdf', { token }),
  save: (fileId: string) => invoke<boolean>('save_original_pdf', { fileId }),
  fileLocations: (fileId: string) => invoke<Location[]>('list_pdf_locations', { fileId }),
  questionLocations: (questionId: string) => invoke<Location[]>('list_pdf_locations', { questionId }),
  link: (questionId: string, link: RegionLink, correct: boolean) =>
    invoke<void>('link_paper_regions', { questionId, link, correct }),
  question: ({ file_id: fileId, source_key: sourceKey, ordinal }: Location) =>
    invoke<QuestionSummary>('open_region_question', { fileId, sourceKey, ordinal }),
}
