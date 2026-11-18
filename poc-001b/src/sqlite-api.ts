import { invoke } from '@tauri-apps/api/core'
import { parseRevisionContent } from './model'
import type { RevisionContent } from './model'
import type { RegionLink } from './paper-reader-api'

export interface Subject {
  id: string
  name: string
}

export interface QuestionSummary {
  id: string
  subject_id: string
  current_revision_id: number | null
}

export interface RevisionSummary {
  id: number
  base_revision_id: number | null
  scope: 'public' | 'user'
}

interface Revision extends RevisionSummary {
  question_id: string
  content: RevisionContent
}

export const reviewLabels = {
  unreviewed: '无审核记录', scheduled: '审核尚未生效', passed: '有效通过',
  expired: '已过期', disputed: '争议', failed: '不通过',
} as const

export type ReviewStatus = keyof typeof reviewLabels

export interface RevisionReview {
  review_status: ReviewStatus
  review: {
    verdict: 'passed' | 'disputed' | 'failed'
    reviewer: string
    checked_on: string
    expires_on: string | null
  } | null
}

export function reviewStatusLabel({ review, review_status }: RevisionReview): string {
  const label = reviewLabels[review_status]
  return review
    ? [label, review.reviewer, review.checked_on, review.expires_on && '有效至 ' + review.expires_on].filter(Boolean).join(' · ')
    : label
}

export interface RevisionDetail extends RevisionReview {
  revision: Revision
}

function validated(revision: Revision): Revision {
  if (!Number.isSafeInteger(revision.id)) throw new Error('修订 ID 超出支持范围。')
  return { ...revision, content: parseRevisionContent(revision.content) }
}

async function read(command: string, args: Record<string, string | number>): Promise<RevisionDetail | null> {
  const detail = await invoke<RevisionDetail | null>(command, args)
  return detail && { ...detail, revision: validated(detail.revision) }
}

export const sqlite = {
  subjects: () => invoke<Subject[]>('list_subjects'),
  questions: () => invoke<QuestionSummary[]>('list_questions', { limit: 25 }),
  revisions: (questionId: string) => invoke<RevisionSummary[]>('list_revisions', { questionId }),
  current: (questionId: string) => read('current_revision', { questionId }),
  original: (questionId: string) => read('public_original', { questionId }),
  revision: (revisionId: number) => read('read_revision', { revisionId }),
  review: (revisionId: number) => invoke<RevisionReview>('revision_review', { revisionId }),
  async save(questionId: string, subjectId: string, fresh: boolean, expectedCurrent: number | null, draft: RevisionContent, source?: RegionLink): Promise<Revision> {
    const contentJson = JSON.stringify(parseRevisionContent(draft))
    return validated(await (fresh
      ? invoke<Revision>('create_question', { questionId, subjectId, contentJson, source })
      : invoke<Revision>('save_user_revision', { questionId, expectedCurrent, contentJson })))
  },
}

export function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    if ('kind' in error && error.kind === 'busy') return '数据库正被占用。修改仍保留，请稍后重试。'
    return error.message
  }
  return String(error)
}
