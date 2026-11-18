export type ReadResult<T> = { value: T; error?: never } | { value?: never; error: unknown }

export function observeRead<T>(read: Promise<T>, publish: (result: ReadResult<T>) => void): () => void {
  let current = true
  void read.then(
    (value) => { if (current) publish({ value }) },
    (error: unknown) => { if (current) publish({ error }) },
  )
  return () => { current = false }
}
