import type { Edge, EditOp, EditResult, Span, Timeline } from '../engine'
import type { StringKey } from '../strings'
import type { TimeSpan } from '../timeline/range'
import { trimTarget } from '../timeline/trim'

/** One thing the person asked for: the edit, and where the playhead and the selection go if it is made. */
export interface EditAction {
  readonly op: EditOp
  readonly playheadAfter?: number
  readonly clearSelection?: boolean
}

export const splitAction = (playheadMs: number): EditAction => ({ op: { type: 'split', timeMs: playheadMs } })

export const removeClipAction = (span: Span): EditAction => ({
  op: { type: 'removeRange', startMs: span.startMs, endMs: span.endMs },
  playheadAfter: span.startMs,
  clearSelection: true,
})

export const duplicateClipAction = (span: Span): EditAction => ({
  op: { type: 'duplicateRange', startMs: span.startMs, endMs: span.endMs, toMs: span.endMs },
  playheadAfter: span.endMs,
  clearSelection: true,
})

/** Swaps the clip with the one before it. Null for the first clip. */
export function moveEarlierAction(spans: readonly Span[], index: number): EditAction | null {
  const selected = spans[index]
  const previous = spans[index - 1]
  if (!selected || !previous) return null
  return { op: { type: 'moveRange', startMs: selected.startMs, endMs: selected.endMs, toMs: previous.startMs }, playheadAfter: previous.startMs }
}

/** Swaps the clip with the one after it. Null for the last clip. */
export function moveLaterAction(spans: readonly Span[], index: number): EditAction | null {
  const selected = spans[index]
  const next = spans[index + 1]
  if (!selected || !next) return null
  const to = selected.startMs + next.clip.durationMs
  return { op: { type: 'moveRange', startMs: selected.startMs, endMs: selected.endMs, toMs: to }, playheadAfter: to }
}

export const removeRangeAction = (range: TimeSpan): EditAction => ({
  op: { type: 'removeRange', startMs: range.startMs, endMs: range.endMs },
  playheadAfter: range.startMs,
  clearSelection: true,
})

/**
 * Trims one edge of a clip to the playhead, as dragging that edge there would: the same limits (a frame at least stays,
 * and no more than the recording has) and the same whole frame. Trimming the start brings the playhead to the start of
 * the clip, where its new first frame is. Null when the clip is not on the timeline.
 */
export function trimToPlayheadAction(timeline: Timeline, span: Span, edge: Edge, playheadMs: number, sourceDurationMs: number, fps: number): EditAction | null {
  const target = trimTarget(timeline, span.clip.id, edge, playheadMs, sourceDurationMs, fps, false, 1, playheadMs)
  if (!target) return null
  return edge === 'start' ? { op: target.op, playheadAfter: span.startMs } : { op: target.op }
}

/** The words for why an edit did nothing, or null when it was made. */
export function refusalText(result: EditResult): StringKey | null {
  if (result.kind === 'changed') return null
  if (result.kind === 'unchanged') return 'nothingChanged'
  switch (result.error) {
    case 'OutsideTimeline':
      return 'refusedOutside'
    case 'TooShort':
      return 'refusedTooShort'
    case 'FragmentTooShort':
      return 'refusedFragment'
    case 'PlacementOutOfRange':
      return 'refusedPlacement'
    case 'EdgeBlocked':
      return 'refusedBlocked'
    case 'BeyondSourceMedia':
      return 'refusedBeyond'
    case 'TooManyClips':
      return 'refusedTooMany'
    case 'TooLong':
      return 'refusedTooLong'
    default:
      return 'refusedOther'
  }
}
