import { frameMs, type Timeline } from '../engine'
import { quantizeToFrame, snap, snapPoints, type SnapPoint, snapThresholdMs } from './snap'

export type RangeEdge = 'start' | 'end'

/** A stretch of the edit chosen for removal, from startMs up to endMs. */
export interface TimeSpan {
  readonly startMs: number
  readonly endMs: number
}

export function timeSpan(startMs: number, endMs: number): TimeSpan {
  if (!(endMs > startMs)) throw new RangeError('A range must end after it starts')
  return { startMs, endMs }
}

/** A range edge dragged to a place, and what stuck it there. */
export interface RangeTarget {
  readonly range: TimeSpan
  readonly snappedTo: SnapPoint | null
}

/** How long the range is when it first appears: two seconds, or the whole edit if that is shorter. */
export const DEFAULT_RANGE_MS = 2_000

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

/**
 * The range that appears when the range tool is turned on: DEFAULT_RANGE_MS long, starting at the playhead, moved back if
 * that would run past the end of the edit. Null when the edit is shorter than one frame.
 */
export function defaultRange(t: Timeline, playheadMs: number, fps: number): TimeSpan | null {
  const frame = frameMs(fps)
  const duration = t.durationMs
  if (duration < frame) return null
  const length = Math.min(DEFAULT_RANGE_MS, duration)
  const start = clamp(quantizeToFrame(clamp(playheadMs, 0, duration - length), fps), 0, duration - length)
  const end = Math.min(duration, Math.max(start + length, start + frame))
  return timeSpan(start, end)
}

/**
 * Turns a pointer position into a new edge of the range. The time sticks to a nearby point when snapping is on, falls on a
 * whole frame, and is held so that the range keeps at least one frame and stays inside the edit. A limit always wins over
 * a snap, so the guide is dropped when one moved the result.
 */
export function rangeTarget(
  t: Timeline,
  range: TimeSpan,
  edge: RangeEdge,
  rawTimeMs: number,
  fps: number,
  snapping: boolean,
  pxPerMs: number,
  playheadMs: number,
  snapPx = 8,
): RangeTarget {
  const frame = frameMs(fps)
  const duration = t.durationMs
  let time = rawTimeMs
  let point: SnapPoint | null = null
  if (snapping) {
    point = snap(time, snapPoints(t, playheadMs), snapThresholdMs(pxPerMs, snapPx))
    if (point) time = point.timeMs
  }
  const onFrame = quantizeToFrame(time, fps)
  const held =
    edge === 'start'
      ? clamp(onFrame, 0, Math.max(0, Math.min(range.endMs - frame, duration)))
      : clamp(onFrame, Math.min(range.startMs + frame, duration), duration)
  if (point && held !== point.timeMs) point = null
  const moved = edge === 'start' ? timeSpan(held, range.endMs) : timeSpan(range.startMs, held)
  return { range: moved, snappedTo: point }
}

/** The range cut down to what is still inside an edit of durationMs, or null if nothing of it is left. */
export function rangeWithin(range: TimeSpan, durationMs: number, fps: number): TimeSpan | null {
  const end = Math.min(range.endMs, durationMs)
  return end - range.startMs >= frameMs(fps) ? timeSpan(range.startMs, end) : null
}
