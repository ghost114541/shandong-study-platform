import assert from 'node:assert/strict'
import test from 'node:test'
import { observeRead } from '../src/latest-read.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('DEV008-T17 changed collection drops a late result and an unmounted read drops a late error', async () => {
  const results: unknown[] = []
  const first = deferred<string>()
  const second = deferred<string>()
  const third = deferred<string>()
  const cleanup = observeRead(first.promise, (result) => results.push(result))
  cleanup()
  observeRead(second.promise, (result) => results.push(result))
  const unmount = observeRead(third.promise, (result) => results.push(result))
  unmount()
  second.resolve('数学重点')
  first.resolve('默认收藏夹')
  third.reject(new Error('收藏夹已不存在'))
  await Promise.allSettled([first.promise, second.promise, third.promise])
  assert.deepEqual(results, [{ value: '数学重点' }])
})
