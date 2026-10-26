import { type AudioItem, MIN_AUDIO_ITEM_MS } from '../engine/audio'
import { MAX_TIMELINE_MS, type Timeline } from '../engine'
import { type OnOutput, onOutput, type TextItem } from '../engine/text'
import { snap, snapPoints, type SnapPoint, snapThresholdMs } from './snap'

/** A stretch of the edit's clock that something else occupies: its start and end are places a dragged piece sticks to. */
export interface Stretch {
  readonly startMs: number
  readonly endMs: number
}

export interface Placement {
  readonly lengthMs: number
  /** Where the pointer would put the start, on the edit's clock. */
  readonly rawStartMs: number
  /** The latest start allowed, which a snap may not pass. */
  readonly latestStartMs: number
  /** The other pieces, titles and captions, whose starts and ends it sticks to. */
  readonly others: readonly Stretch[]
  readonly timeline: Timeline
  readonly playheadMs: number
  readonly snapping: boolean
  readonly pxPerMs: number
  readonly snapPx?: number
}

/**
 * Where something dragged along the timeline lands, keeping its length. Its start or its end, whichever is nearer a point,
 * first sticks to it when snapping is on: the start and end of the edit, every cut, the playhead, and the starts and ends
 * of the others. Then it is held between the start of the edit and the latest start, which win over a snap, so the guide
 * is dropped when a limit moved the result.
 */
export function placeSpan(place: Placement): { startMs: number; snappedTo: SnapPoint | null } {
  const { lengthMs, rawStartMs, latestStartMs, others, timeline, playheadMs, snapping, pxPerMs, snapPx = 8 } = place
  let start = Math.round(rawStartMs)
  let point: SnapPoint | null = null
  if (snapping) {
    const points: SnapPoint[] = [...snapPoints(timeline, playheadMs)]
    for (const other of others) points.push({ timeMs: other.startMs, kind: 'piece' }, { timeMs: other.endMs, kind: 'piece' })
    const threshold = snapThresholdMs(pxPerMs, snapPx)
    const byStart = snap(start, points, threshold)
    const byEnd = snap(start + lengthMs, points, threshold)
    const startDistance = byStart ? Math.abs(start - byStart.timeMs) : Number.POSITIVE_INFINITY
    const endDistance = byEnd ? Math.abs(start + lengthMs - byEnd.timeMs) : Number.POSITIVE_INFINITY
    if (byEnd && endDistance < startDistance) {
      start = byEnd.timeMs - lengthMs
      point = byEnd
    } else if (byStart) {
      start = byStart.timeMs
      point = byStart
    }
  }
  const held = Math.min(Math.max(start, 0), Math.max(latestStartMs, 0))
  return { startMs: held, snappedTo: point && held === start ? point : null }
}

/** Where a piece of music or voiceover dragged along the timeline ends up, and what stuck it there. */
export interface PieceTarget {
  readonly item: AudioItem
  /** The point the piece's start or end stuck to, for the guide line, or null. */
  readonly snappedTo: SnapPoint | null
}

export interface PieceDrag {
  readonly item: AudioItem
  readonly rawStartMs: number
  readonly others: readonly Stretch[]
  readonly timeline: Timeline
  readonly playheadMs: number
  readonly snapping: boolean
  readonly pxPerMs: number
  readonly snapPx?: number
}

/**
 * Turns a pointer position into a place for a piece of music or voiceover. It cannot go before the start of the edit, and
 * a sliver of it always stays inside the edit, so it cannot be lost beyond the end.
 */
export function pieceTarget(drag: PieceDrag): PieceTarget {
  const { item, ...rest } = drag
  const latestStartMs = Math.min(MAX_TIMELINE_MS - item.lengthMs, drag.timeline.durationMs - MIN_AUDIO_ITEM_MS)
  const placed = placeSpan({ ...rest, lengthMs: item.lengthMs, latestStartMs })
  return { item: placed.startMs === item.startMs ? item : { ...item, startMs: placed.startMs }, snappedTo: placed.snappedTo }
}

/** Where a title dragged along the timeline ends up, and what stuck it there. */
export interface TitleTarget {
  readonly item: TextItem
  readonly snappedTo: SnapPoint | null
}

export interface TitleDrag {
  readonly item: TextItem & { readonly placement: OnOutput }
  readonly rawStartMs: number
  readonly others: readonly Stretch[]
  readonly timeline: Timeline
  readonly playheadMs: number
  readonly snapping: boolean
  readonly pxPerMs: number
  readonly snapPx?: number
}

/**
 * Turns a pointer position into a place for a title, as the buttons that move one do: the whole of it stays inside the edit,
 * so it cannot go before the start nor be pulled past the end, and it keeps its length.
 */
export function titleTarget(drag: TitleDrag): TitleTarget {
  const { item, ...rest } = drag
  const { startMs, endMs } = item.placement
  const lengthMs = Math.max(Math.min(endMs - startMs, drag.timeline.durationMs), 1)
  const placed = placeSpan({ ...rest, lengthMs, latestStartMs: drag.timeline.durationMs - lengthMs })
  if (placed.startMs === startMs) return { item, snappedTo: placed.snappedTo }
  return { item: { ...item, placement: onOutput(placed.startMs, placed.startMs + lengthMs) }, snappedTo: placed.snappedTo }
}
