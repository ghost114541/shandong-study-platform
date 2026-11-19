import { invoke } from '@tauri-apps/api/core'

export type TrashKind = 'question' | 'knowledge' | 'paper'
export interface TrashItem {
  id: number
  resource_type: TrashKind
  target_id: string
  deleted_at: string
  context: { label: string; favorites: number; occurrences: number; compositions: number; drafts: number }
}

export const trashLabels: Record<TrashKind, string> = { question: '试题', knowledge: '知识点', paper: '试卷' }

export interface DraftToken { id: string; sequence: number }
export interface DraftRecord extends DraftToken {
  object_type: 'question' | 'composition'
  object_id: string
  base_revision: number | null
  saved_at: string
  conflict: boolean
}

export interface DraftContent {
  object_type: DraftRecord['object_type']
  object_id: string
  base_revision: number | null
  payload: object
  attachments: string[]
}

export interface BackupManifest {
  schema_version: number
  created_at: string
  platform: string
  file_count: number
  total_bytes: number
}

export interface BackupRecord {
  id: string
  created_at: string
  archive_sha256: string | null
  file_count: number
  verified: boolean
  error: string | null
  location_label: string
}

export interface RestorePreview {
  manifest: BackupManifest
  questions: number
  papers: number
  knowledge: number
  favorites: number
}

export interface RootStatus {
  directory: string
  previous: string | null
  phase: string
  error: string | null
  pack_warning: string | null
}

export interface Diagnostics {
  schema_version: number
  file_count: number
  issues: string[]
  trashed: number
  drafts: number
  latest_backup: BackupRecord | null
}

export interface ProtectionProgress { phase: string; completed: number; total: number }

export function localTime(utc: string) {
  const date = new Date(utc.includes('T') ? utc : utc.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.getTime()) ? utc : date.toLocaleString()
}

export const protection = {
  status: () => invoke<RootStatus>('protection_status'),
  history: () => invoke<BackupRecord[]>('backup_history'),
  backup: () => invoke<BackupManifest | null>('create_backup'),
  preview: () => invoke<RestorePreview | null>('preview_restore'),
  cancel: () => invoke<void>('cancel_protection'),
  closePreview: () => invoke<void>('discard_restore'),
  restore: () => invoke<void>('confirm_restore'),
  estimate: () => invoke<number>('storage_estimate'),
  migrate: () => invoke<boolean>('migrate_storage'),
  rollback: () => invoke<void>('rollback_library'),
  diagnostics: () => invoke<Diagnostics>('diagnose_library'),
  trash: () => invoke<TrashItem[]>('list_trash'),
  move: (kind: TrashKind, id: string) => invoke<void>('trash_resource', { kind, id, operation: crypto.randomUUID() }),
  recover: (id: number) => invoke<void>('restore_trash', { id }),
  clear: () => invoke<void>('clear_trash'),
  drafts: () => invoke<DraftRecord[]>('list_drafts'),
  write: (token: DraftToken, draft: DraftContent) => invoke<boolean>('put_draft', { draft: { token, ...draft } }),
  load: <T>(id: string) => invoke<T>('load_draft', { id }),
  discard: (record: DraftRecord) => invoke<void>('discard_draft', { token: record, kind: record.object_type, target: record.object_id }),
}
