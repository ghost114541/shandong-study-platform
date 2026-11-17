import { invoke } from '@tauri-apps/api/core'
import type { QuestionSummary } from './sqlite-api'

export interface KnowledgePoint {
  id: string
  subject_id: string
  parent_id: string | null
  title: string
  origin: 'user' | 'standard'
  sort_order: number
  enabled: boolean
  aliases: string[]
  question_count: number
}

export interface SearchFilters {
  subjectId: string
  knowledgeId: string
  keyword: string
  descendants: boolean
}

export type SearchSeed = Pick<SearchFilters, 'subjectId' | 'knowledgeId' | 'descendants'>
type SearchHit = QuestionSummary & { current_revision_id: number; snippet: string }
export interface SearchPage {
  hits: SearchHit[]
  has_next: boolean
}

export const knowledge = {
  list: (subjectId: string) => invoke<KnowledgePoint[]>('list_knowledge', { subjectId }),
  create: (subjectId: string, parentId: string | null, title: string, sortOrder: number) =>
    invoke<void>('create_knowledge', { id: crypto.randomUUID(), subjectId, parentId, title, sortOrder }),
  rename: (id: string, title: string) => invoke<void>('rename_knowledge', { id, title }),
  alias: (id: string, alias: string) => invoke<void>('add_knowledge_alias', { id, alias }),
  forQuestion: (questionId: string) => invoke<string[]>('question_knowledge', { questionId }),
  link: (questionId: string, id: string, linked: boolean) => invoke<void>('set_question_knowledge', { questionId, id, linked }),
  search: (filters: SearchFilters, page: number) => invoke<SearchPage>('search_questions', { query: {
    subject_id: filters.subjectId || null, knowledge_id: filters.knowledgeId || null,
    keyword: filters.keyword, descendants: filters.descendants, page, page_size: 25,
  } }),
}

export function childrenByParent(points: KnowledgePoint[]): Map<string | null, KnowledgePoint[]> {
  const children = new Map<string | null, KnowledgePoint[]>()
  for (const point of points) {
    const siblings = children.get(point.parent_id)
    if (siblings) siblings.push(point)
    else children.set(point.parent_id, [point])
  }
  return children
}

export function choiceLabels(points: KnowledgePoint[]): { point: KnowledgePoint; label: string }[] {
  const byParent = childrenByParent(points)
  const labels: { point: KnowledgePoint; label: string }[] = []
  const visit = (parent: string | null, prefix: string) => {
    for (const point of byParent.get(parent) ?? []) {
      const label = prefix + point.title
      labels.push({ point, label })
      visit(point.id, label + ' / ')
    }
  }
  visit(null, '')
  return labels
}
