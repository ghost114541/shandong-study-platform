
import { invoke } from '@tauri-apps/api/core'

type Count = { added: number; updated: number; unchanged: number }
export type ResourceKind = 'knowledge' | 'questions' | 'papers' | 'images' | 'pdfs'
export type PackTimings = {
  zip_ms: number; manifest_ms: number; validate_ms: number; preview_ms: number
  stage_ms: number; commit_ms: number
}

export type PackPreview = {
  manifest: {
    pack_id: string; pack_version: string; display_name: string; source: string
    protocol_version: number; db_schema: number; content_version: number; min_app_version: string
    counts: Record<ResourceKind, number>; files: { path: string; bytes: number; sha256: string; role: string }[]
  }
  rights: { entries: {
    id: string; source: string; author: string; license: string; statement: string
    redistribution_claimed: boolean; scope: string; evidence: string | null
  }[] }
  archive_sha: string
  archive_bytes: number
  unpacked_bytes: number
  required_bytes: number
  free_bytes: number
  already_installed: boolean
  conflicts: string[]
  diff: Record<ResourceKind, Count> & { conflicts: number; personal_revisions: number }
  timings: PackTimings
}

export type Progress = {
  phase: string
  done: number
  total: number
  cancellable: boolean
}

export type History = {
  versions: {
    pack_id: string; version: string; display_name: string; source: string
    installed_at: string; integrity_error: string | null; is_current: boolean
  }[]
  operations: {
    id: string; pack_id: string; version: string; state: string; started_at: string
    finished_at: string | null; error: string | null; pending_cleanup: boolean
  }[]
}

type InstallResult = { already_installed: boolean; operation_id: string | null; timings: PackTimings }

export const packApi = {
  select: () => invoke<PackPreview | null>('select_resource_pack'),
  install: (archiveSha: string) => invoke<InstallResult>('install_resource_pack', { archiveSha }),
  cancel: () => invoke<boolean>('cancel_resource_pack'),
  discard: () => invoke<void>('discard_resource_pack'),
  history: () => invoke<History>('resource_pack_history'),
  recover: () => invoke<History>('recover_resource_packs'),
}
