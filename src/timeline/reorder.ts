import type { EditAction } from '../editing/actions'
import type { Span } from '../engine'

/** Where a dragged clip would be dropped: the edit that does it, and the place on the timeline to show as the target. */
export interface ClipDrop {
  readonly action: EditAction
  /** Where on the timeline, as it is now, the clip will have its leading edge: the start of the clip it goes before, or the end of the one it goes after. */
  readonly boundaryMs: number
}

/** The offset that keeps a dragged clip inside the edit: it can be dragged to the very start or the very end, and no further. */
export function clampedOffset(spans: readonly Span[], clipId: string, offsetMs: number): number {
  const span = spans.find((s) => s.clip.id === clipId)
  const total = spans[spans.length - 1]?.endMs ?? 0
  if (!span) return 0
  return Math.min(Math.max(offsetMs, -span.startMs), total - span.endMs)
}

/**
 * Where a clip that has been dragged offsetMs from its place would be dropped. Clips can only sit end to end, so it goes
 * between two clips (or to either end), never into one. Dragging later, it passes a clip once its front edge is past the
 * middle of that clip; dragging earlier, once its back edge is. So a long clip is as quick to pass a short one as a short
 * one is to pass it. Null when it would still be in its own place. The edit is the one the Earlier and Later buttons make:
 * moveRange to where the clip will begin, and the playhead goes there too.
 */
export function clipDropTarget(spans: readonly Span[], clipId: string, offsetMs: number): ClipDrop | null {
  const index = spans.findIndex((s) => s.clip.id === clipId)
  const dragged = spans[index]
  if (!dragged) return null
  const offset = clampedOffset(spans, clipId, offsetMs)
  const front = dragged.endMs + offset
  const back = dragged.startMs + offset
  let target = index
  if (offset > 0) {
    for (let next = spans[target + 1]; next && front > (next.startMs + next.endMs) / 2; next = spans[target + 1]) target++
  } else if (offset < 0) {
    for (let previous = spans[target - 1]; previous && back < (previous.startMs + previous.endMs) / 2; previous = spans[target - 1]) target--
  }
  if (target === index) return null
  const boundary = spans[target]
  if (!boundary) return null
  // Later: it begins where it did, plus the clips it has passed. Earlier: it begins where the first clip it has passed began.
  const toMs = target > index ? dragged.startMs + spans.slice(index + 1, target + 1).reduce((sum, s) => sum + (s.endMs - s.startMs), 0) : boundary.startMs
  return {
    action: { op: { type: 'moveRange', startMs: dragged.startMs, endMs: dragged.endMs, toMs }, playheadAfter: toMs },
    boundaryMs: target > index ? boundary.endMs : boundary.startMs,
  }
}
