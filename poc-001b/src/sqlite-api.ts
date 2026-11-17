import { invoke } from '@tauri-apps/api/core'
import { parseRevisionContent } from './model'
import type { RevisionContent } from './model'

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

export interface RevisionDetail {
  revision: Revision
  review_status: 'unreviewed' | 'scheduled' | 'passed' | 'expired' | 'disputed' | 'failed'
  review: {
    verdict: 'passed' | 'disputed' | 'failed'
    reviewer: string
    checked_on: string
    expires_on: string | null
  } | null
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
  questions: () => invoke<QuestionSummary[]>('list_questions'),
  revisions: (questionId: string) => invoke<RevisionSummary[]>('list_revisions', { questionId }),
  current: (questionId: string) => read('current_revision', { questionId }),
  original: (questionId: string) => read('public_original', { questionId }),
  revision: (revisionId: number) => read('read_revision', { revisionId }),
  async save(questionId: string, subjectId: string, fresh: boolean, expectedCurrent: number | null, draft: RevisionContent): Promise<Revision> {
    const contentJson = JSON.stringify(parseRevisionContent(draft))
    return validated(await (fresh
      ? invoke<Revision>('create_question', { questionId, subjectId, contentJson })
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
