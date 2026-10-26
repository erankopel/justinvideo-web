import { spans, type Timeline } from '../engine'

export type SnapKind = 'start' | 'end' | 'clipEdge' | 'playhead' | 'piece'

export interface SnapPoint {
  readonly timeMs: number
  readonly kind: SnapKind
}

/**
 * The places a dragged edge sticks to, as in CutRoom's timeline: the start and end of the edit, every clip edge, and the
 * playhead. Edges inside ignoring (inclusive), such as the clip being trimmed, are left out so a drag does not stick to
 * itself.
 */
export function snapPoints(t: Timeline, playheadMs: number, ignoring?: { startMs: number; endMs: number }): SnapPoint[] {
  const points: SnapPoint[] = [
    { timeMs: 0, kind: 'start' },
    { timeMs: t.durationMs, kind: 'end' },
  ]
  // Two clips share the edge between them, so collect each time once.
  const edges = new Set<number>()
  for (const span of spans(t)) {
    for (const time of [span.startMs, span.endMs]) {
      if (ignoring && time >= ignoring.startMs && time <= ignoring.endMs) continue
      if (time !== 0 && time !== t.durationMs) edges.add(time)
    }
  }
  for (const time of edges) points.push({ timeMs: time, kind: 'clipEdge' })
  if (playheadMs >= 0 && playheadMs <= t.durationMs) points.push({ timeMs: playheadMs, kind: 'playhead' })
  return points
}

/** How close, in milliseconds, a drag must come to a point to stick to it: snapPx on screen, never more than capMs. */
export const snapThresholdMs = (pxPerMs: number, snapPx: number, capMs = 500): number => Math.min(capMs, Math.round(snapPx / pxPerMs))

/** The nearest point within thresholdMs of timeMs, or null. Of two equally near, the later one wins. */
export function snap(timeMs: number, points: readonly SnapPoint[], thresholdMs: number): SnapPoint | null {
  let nearest: SnapPoint | null = null
  let distance = thresholdMs
  for (const point of points) {
    const delta = Math.abs(timeMs - point.timeMs)
    if (delta <= distance) {
      nearest = point
      distance = delta
    }
  }
  return nearest
}

/** The time of the frame nearest to timeMs at fps, in whole milliseconds. */
export function quantizeToFrame(timeMs: number, fps: number): number {
  const frames = Math.round((timeMs * fps) / 1000)
  return Math.round((frames * 1000) / fps)
}
