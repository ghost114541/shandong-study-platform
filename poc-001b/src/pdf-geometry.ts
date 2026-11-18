
import type { Rect } from './paper-reader-api'

function turn(x: number, y: number, rotation: number): [number, number] {
  switch ((rotation % 360 + 360) % 360) {
    case 90: return [1 - y, x]
    case 180: return [1 - x, 1 - y]
    case 270: return [y, 1 - x]
    default: return [x, y]
  }
}

export function rotateRect([x0, y0, x1, y1]: Rect, rotation: number): Rect {
  const [left, top] = turn(x0, y0, rotation)
  const [right, bottom] = turn(x1, y1, rotation)
  return [Math.min(left, right), Math.min(top, bottom), Math.max(left, right), Math.max(top, bottom)]
}

export function orderedRect(start: readonly [number, number], end: readonly [number, number]): Rect {
  return [Math.min(start[0], end[0]), Math.min(start[1], end[1]),
    Math.max(start[0], end[0]), Math.max(start[1], end[1])]
}
