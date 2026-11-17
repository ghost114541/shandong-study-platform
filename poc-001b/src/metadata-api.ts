import { invoke } from '@tauri-apps/api/core'

export interface PaperMetadata {
  year: number | null
  region: string | null
  source: string | null
}

interface PaperOccurrence extends PaperMetadata {
  paper_id: string
  original_id: string
  position: string
  title: string
}

export interface QuestionMetadata {
  difficulty: number | null
  tags: string[]
  inherited_tags: string[]
  origins: PaperOccurrence[]
}

export const difficulties = ['很易', '较易', '中等', '较难', '很难']
export const difficultyLabel = (value: number | null): string => value === null ? '难度未标注' : difficulties[value - 1]

export const metadataApi = {
  read: (questionId: string) => invoke<QuestionMetadata>('question_metadata', { questionId }),
  save: (questionId: string, difficulty: number | null, tags: string[]) =>
    invoke<void>('save_question_metadata', { questionId, difficulty, tags }),
  addOrigin: (questionId: string, paperId: string | null, title: string | null, position: string) =>
    invoke<void>('add_paper_occurrence', { questionId, paperId: paperId ?? crypto.randomUUID(), title, position }),
  savePaper: (paperId: string, expected: PaperMetadata, metadata: PaperMetadata) =>
    invoke<void>('save_paper_metadata', { paperId, expected, metadata }),
}
