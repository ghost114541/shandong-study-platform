import { invoke } from '@tauri-apps/api/core'
import type { ReviewStatus } from './sqlite-api'

export const favoriteLabels = { question: '试题', paper: '试卷', knowledge: '知识点' } as const
export type FavoriteKind = keyof typeof favoriteLabels
export interface FavoriteRef { kind: FavoriteKind; id: string }
export interface FavoriteMembership { id: string; name: string; relations: number }
export interface FavoriteStatus {
  logical_id: string
  important: boolean
  collections: FavoriteMembership[]
}
export interface FavoriteCounts {
  relations: number
  targets: number
  questions: number
  papers: number
  knowledge: number
  important: number
}
export interface FavoriteCollection {
  id: string
  name: string
  is_default: boolean
  counts: FavoriteCounts
}
interface FavoritePaperVersion { id: string; name: string; pages: number; available: boolean }
export interface FavoriteItem extends FavoriteRef {
  title: string
  added_at: string
  important: boolean
  subject_id: string | null
  subject: string | null
  revision_id: number | null
  question_type: string | null
  review: ReviewStatus | null
  year: number | null
  region: string | null
  parent: string | null
  unavailable: string | null
  versions: FavoritePaperVersion[]
  collections: FavoriteMembership[]
}
export interface FavoriteQuery {
  collection: string | null
  kind: FavoriteKind | null
  important: boolean
  keyword: string
  sort: 'recent' | 'name'
  page: number
}
interface FavoritePage { items: FavoriteItem[]; has_next: boolean }
export type FavoriteCommand =
  | { action: 'add'; collection: string; targets: FavoriteRef[] }
  | { action: 'remove'; collection: string; target: FavoriteRef; expected_relations: number }
  | { action: 'transfer'; from: string; to: string; target: FavoriteRef; move_item: boolean }
  | { action: 'mark'; target: FavoriteRef; important: boolean }
export type CollectionCommand =
  | { action: 'create'; name: string }
  | { action: 'rename'; id: string; name: string }
  | { action: 'reorder'; id: string; direction: -1 | 1 }
  | { action: 'delete'; id: string }

export const favorites = {
  collections: () => invoke<FavoriteCollection[]>('favorite_collections'),
  counts: () => invoke<FavoriteCounts>('favorite_counts'),
  page: (query: FavoriteQuery) => invoke<FavoritePage>('favorite_page', { query }),
  status: (targets: FavoriteRef[]) => invoke<FavoriteStatus[]>('favorite_status', { targets }),
  change: (command: FavoriteCommand) => invoke<void>('change_favorites', { command }),
  changeCollection: (command: CollectionCommand) => invoke<void>('change_favorite_collection', { command }),
}
