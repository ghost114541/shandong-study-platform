import { useLayoutEffect, useRef, useState } from 'react'
import { protection } from './data-protection-api'
import type { DraftContent, DraftToken } from './data-protection-api'
import { describeError } from './sqlite-api'

const QUIET_MS = 2_000
const MAX_WAIT_MS = 15_000

interface Update { token: DraftToken; draft: DraftContent }
export interface DraftProtection {
  flush: () => Promise<void>
  discard: () => Promise<void>
}

export function useAutosave(identity: DraftToken, content: DraftContent | null) {
  const current = useRef({ id: identity.id, sequence: identity.sequence, durable: identity.sequence })
  const latest = useRef<Update | null>(null)
  const pending = useRef<Promise<void>>(Promise.resolve())
  const quiet = useRef<number | undefined>(undefined)
  const deadline = useRef<number | undefined>(undefined)
  const [status, setStatus] = useState('')

  function clearTimers() {
    window.clearTimeout(quiet.current)
    window.clearTimeout(deadline.current)
    quiet.current = undefined
    deadline.current = undefined
  }

  function write(update: Update) {
    const send = async () => {
      const state = current.current
      if (state.id === update.token.id && state.durable >= update.token.sequence) return
      try {
        if (state.id === update.token.id) setStatus('正在保存草稿…')
        if (!await protection.write(update.token, update.draft)) throw new Error('草稿已关闭或有更新版本。')
        if (current.current.id === update.token.id) {
          current.current.durable = update.token.sequence
          if (latest.current?.token.sequence === update.token.sequence) setStatus('草稿已安全保存')
        }
      } catch (error) {
        if (current.current.id === update.token.id) setStatus('草稿保存失败：' + describeError(error))
        throw error
      }
    }
    const next = pending.current.then(send, send)
    pending.current = next
    return next
  }

  async function flush() {
    clearTimers()
    const update = latest.current
    if (update) await write(update)
  }

  async function discard() {
    clearTimers()
    const update = latest.current
    if (!update) return
    await pending.current.catch(() => {})
    const { object_id, object_type } = update.draft
    await protection.discard({ ...update.token, object_id, object_type, base_revision: null, saved_at: '', conflict: false })
    latest.current = null
    setStatus('')
  }

  useLayoutEffect(() => {
    if (current.current.id !== identity.id) {
      clearTimers()
      current.current = { id: identity.id, sequence: identity.sequence, durable: identity.sequence }
      latest.current = null
      setStatus('')
    }
    if (!content) {
      clearTimers()
      latest.current = null
      setStatus('')
      return
    }
    latest.current = { token: { id: identity.id, sequence: ++current.current.sequence }, draft: content }
    setStatus('草稿有修改，等待自动保存')
    const run = () => { void flush().catch(() => {}) }
    window.clearTimeout(quiet.current)
    quiet.current = window.setTimeout(run, QUIET_MS)
    deadline.current ??= window.setTimeout(run, MAX_WAIT_MS)
  }, [identity, content])

  useLayoutEffect(() => () => { void flush().catch(() => {}) }, [])

  return {
    status,
    flush,
    discard,
    token: () => latest.current?.token,
  }
}
