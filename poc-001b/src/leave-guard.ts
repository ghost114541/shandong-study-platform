export type ReportGuard = (dirty: boolean, busy: boolean) => void
export type ConfirmLeave = (action: () => void) => void
