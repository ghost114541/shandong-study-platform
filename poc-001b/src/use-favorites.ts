import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react'
import { observeRead } from './latest-read'
import type { ReadResult } from './latest-read'
import { describeError } from './sqlite-api'

let revision = 0
let pendingWrites = 0
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function refreshFavorites() {
  revision++
  for (const listener of listeners) listener()
}

export function favoritesSaving(): boolean {
  return pendingWrites > 0
}

export async function writeFavorites(task: () => Promise<void>): Promise<void> {
  pendingWrites++
  try {
    await task()
    refreshFavorites()
  } finally {
    pendingWrites--
  }
}

export function useFavoriteRead<T>(key: string | null, read: () => Promise<T>) {
  const version = useSyncExternalStore(subscribe, () => revision)
  const request = key === null ? null : JSON.stringify([key, version])
  const [state, setState] = useState<{ request: string; result: ReadResult<T> }>()
  const load = useEffectEvent(read)
  useEffect(() => {
    if (request === null) return
    return observeRead(load(), (result) => setState({ request, result }))
  }, [request])
  const result = state?.request === request ? state?.result : undefined
  return {
    value: result?.value,
    error: result && 'error' in result ? describeError(result.error) : '',
    loading: request !== null && !result,
  }
}
