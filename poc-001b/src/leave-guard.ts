import type { DraftProtection } from './use-autosave'
export type ReportGuard = (dirty: boolean, busy: boolean, draft?: DraftProtection) => void
export type ConfirmLeave = (action: () => void) => void
