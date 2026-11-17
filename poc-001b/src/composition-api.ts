import { invoke } from '@tauri-apps/api/core'
import type { RevisionContent, RichDocument, Attachment } from './model'
import type { RevisionSummary } from './sqlite-api'

export interface PaperSettings {
  scope: string
  duration_minutes: number | null
  gap_mm: number
  answer_space_mm: number
  groups: string[]
}

export interface PaperHeader {
  id: string
  title: string
  created_at: string
  previous_id: string | null
  legacy: boolean
}

export interface PaperQuestion {
  revision: RevisionSummary & { question_id: string; content: RevisionContent }
  logical_id: string
  subject: string
  snippet: string
  summary: string
}

export interface PaperPoints {
  group: string
  score: number
  part_scores: number[]
}

export interface PaperItem {
  question: PaperQuestion
  points: PaperPoints
}

export interface SavedPaper {
  header: PaperHeader
  settings: PaperSettings
  items: PaperItem[]
}

export interface Draft {
  title: string
  previous_id: string | null
  settings: PaperSettings
  items: PaperItem[]
}

export type PaperMode = 'paper' | 'answers'

export interface PrintEntry {
  revision_id: number
  subject: string
  group: string
  score: number
  main: RichDocument | null
  analysis: RichDocument | null
  parts: Array<{ score: number; main: RichDocument | null; analysis: RichDocument | null }>
  attachments: Attachment[]
}

export interface PrintSnapshot {
  id: string
  previous_id: string | null
  title: string
  settings: PaperSettings
  mode: PaperMode
  identity: string
  entries: PrintEntry[]
}

export interface PrintPair {
  identity: string
  paper: PrintSnapshot
  answers: PrintSnapshot
}

export const blankDraft = (): Draft => ({
  title: '自定义试卷',
  previous_id: null,
  settings: { scope: '', duration_minutes: null, gap_mm: 4, answer_space_mm: 12, groups: [] },
  items: [],
})

export const totalScore = (items: readonly PaperItem[]) => items.reduce((sum, item) => sum + item.points.score, 0)

export const grouped = (items: readonly PaperItem[], groups: readonly string[]) =>
  groups.flatMap((group) => items.filter((item) => item.points.group === group))

export function initialPoints(question: PaperQuestion, group: string): PaperPoints {
  return {
    group, score: question.revision.content.score,
    part_scores: question.revision.content.parts.map(({ score }) => score),
  }
}

export const composition = {
  question: (revisionId: number, existing: number[]) => invoke<PaperQuestion>('composition_question', { revisionId, existing }),
  latest: (questionId: string) => invoke<PaperQuestion>('composition_latest', { questionId }),
  list: () => invoke<PaperHeader[]>('list_compositions'),
  read: (id: string) => invoke<SavedPaper>('read_composition', { id }),
  save: (draft: Draft) => invoke<SavedPaper>('save_composition', {
    draft: { ...draft, items: draft.items.map(({ question, points }) => ({ revision_id: question.revision.id, points })) },
  }),
  preview: (id: string) => invoke<PrintPair>('preview_composition', { id }),
  export: (id: string, identity: string, confirmed: boolean) =>
    invoke<{ warnings: string[]; paper: string | null; answers: string | null }>('export_composition', { id, identity, confirmed }),
}
