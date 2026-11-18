
import assert from 'node:assert/strict'
import test from 'node:test'
import { orderedRect, rotateRect } from '../src/pdf-geometry.ts'
import type { Rect } from '../src/paper-reader-api.ts'

test('DEV007-T09 crop coordinates round-trip through all right-angle viewport rotations', () => {
  const rect: Rect = [0.125, 0.25, 0.5, 0.75]
  assert.deepEqual(rotateRect(rect, 90), [0.25, 0.125, 0.75, 0.5])
  for (const rotation of [0, 90, 180, 270]) {
    assert.deepEqual(rotateRect(rotateRect(rect, rotation), -rotation), rect)
  }
  assert.deepEqual(rotateRect([0, 0, 1, 1], 90), [0, 0, 1, 1])
  assert.deepEqual(orderedRect([0.5, 0.75], [0.125, 0.25]), rect)
})
