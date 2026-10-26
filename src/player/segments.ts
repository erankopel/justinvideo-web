import type { Span } from '../engine'

/**
 * A stretch of the edit that plays straight on from one recording, without a jump. Clips that continue each other, such
 * as the two halves of a split, are one segment, so playback runs through the cut with no seek. Volume is part of the
 * rule: a change of volume is a change of gain, so those two clips stay apart.
 */
export interface Segment {
  readonly sourceId: string
  /** Where in the recording the segment begins, and the edit time it begins at. */
  readonly sourceStartMs: number
  readonly startMs: number
  readonly endMs: number
  readonly volumePercent: number
}

const continues = (before: Segment, span: Span): boolean =>
  before.sourceId === span.clip.sourceId &&
  before.volumePercent === span.clip.volumePercent &&
  before.sourceStartMs + (before.endMs - before.startMs) === span.clip.sourceStartMs

export function buildSegments(spans: readonly Span[]): Segment[] {
  const segments: Segment[] = []
  for (const span of spans) {
    const last = segments[segments.length - 1]
    if (last && continues(last, span)) {
      segments[segments.length - 1] = { ...last, endMs: span.endMs }
    } else {
      segments.push({
        sourceId: span.clip.sourceId,
        sourceStartMs: span.clip.sourceStartMs,
        startMs: span.startMs,
        endMs: span.endMs,
        volumePercent: span.clip.volumePercent,
      })
    }
  }
  return segments
}

export interface Location {
  readonly index: number
  /** How far into the segment, kept inside it so that the end of the edit shows its last frame. */
  readonly offsetMs: number
}

/** The segment that an edit time falls in and the offset in it. Null for an empty edit. */
export function locate(segments: readonly Segment[], editMs: number): Location | null {
  let index = -1
  segments.forEach((segment, i) => {
    if (segment.startMs <= editMs) index = i
  })
  const segment = segments[Math.max(index, 0)]
  if (!segment) return null
  const length = segment.endMs - segment.startMs
  return { index: Math.max(index, 0), offsetMs: Math.min(Math.max(editMs - segment.startMs, 0), length - 1) }
}

/** The time in the recording for a place in a segment. */
export const sourceTimeMs = (segment: Segment, offsetMs: number): number => segment.sourceStartMs + offsetMs

/** The edit time for a time in the recording, which may lie a little outside the segment while a frame is being swapped. */
export const editTimeMs = (segment: Segment, sourceMs: number): number => segment.startMs + (sourceMs - segment.sourceStartMs)
