import { type Edge, type EditOp, frameMs, spans, type Timeline } from '../engine'
import { quantizeToFrame, snap, snapPoints, type SnapPoint, snapThresholdMs } from './snap'

type TrimClip = Extract<EditOp, { type: 'trimClip' }>

/** Where a trim drag ended up and what stuck it there. */
export interface TrimTarget {
  readonly op: TrimClip
  readonly snappedTo: SnapPoint | null
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

/**
 * Turns a pointer position into a trim of one clip's edge. The raw time first sticks to a nearby point when snapping is
 * on, then falls on a whole frame, then is held inside what the recording allows: the clip keeps at least one frame, and
 * it cannot reveal footage before the start or after the end of its source. Those limits always win over a snap, as in
 * CutRoom, so the snap guide is dropped when a limit moved the result. Null when the clip is not on the timeline.
 */
export function trimTarget(
  t: Timeline,
  clipId: string,
  edge: Edge,
  rawTimeMs: number,
  sourceDurationMs: number,
  fps: number,
  snapping: boolean,
  pxPerMs: number,
  playheadMs: number,
  snapPx = 8,
): TrimTarget | null {
  const span = spans(t).find((s) => s.clip.id === clipId)
  if (!span) return null
  const clip = span.clip
  const frame = frameMs(fps)
  let earliest: number
  let latest: number
  if (edge === 'start') {
    earliest = Math.max(0, span.startMs - clip.sourceStartMs)
    latest = span.endMs - frame
  } else {
    earliest = span.startMs + frame
    latest = span.endMs + (sourceDurationMs - (clip.sourceStartMs + clip.durationMs))
  }
  let time = rawTimeMs
  let point: SnapPoint | null = null
  if (snapping) {
    point = snap(time, snapPoints(t, playheadMs, { startMs: span.startMs, endMs: span.endMs }), snapThresholdMs(pxPerMs, snapPx))
    if (point) time = point.timeMs
  }
  const held = clamp(quantizeToFrame(time, fps), earliest, Math.max(earliest, latest))
  if (point && held !== point.timeMs) point = null
  return { op: { type: 'trimClip', clipId, edge, timeMs: held }, snappedTo: point }
}

/** How much of a clip's width, from each edge inward, a pointer may land in and still grab that edge. */
export const INWARD_REACH_SHARE = 0.25

/**
 * Which edge of the selected clip a pointer that came down at x has grabbed, if any. The grab reaches reachPx outside the
 * clip but only a quarter of the clip's width inside it, so a clip that is narrow at a low zoom keeps most of its body for
 * scrubbing: a plain drag across the timeline must not turn into a trim.
 */
export function trimHandleAt(x: number, startX: number, endX: number, reachPx: number): Edge | null {
  const inward = Math.min(reachPx, Math.max(0, endX - startX) * INWARD_REACH_SHARE)
  const fromStart = x - startX
  const fromEnd = endX - x
  const onStart = fromStart >= 0 ? fromStart <= inward : -fromStart <= reachPx
  const onEnd = fromEnd >= 0 ? fromEnd <= inward : -fromEnd <= reachPx
  return onStart ? 'start' : onEnd ? 'end' : null
}
