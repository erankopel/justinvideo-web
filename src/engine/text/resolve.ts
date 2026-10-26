import type { Timeline } from '../timeline'
import { spans } from '../timeline'
import type { TextDirection, TextItem, TextPosition, TextSize } from './model'

/**
 * A caption placed on the output clock, that is, on the edited video after its cuts. id names the text it came from,
 * so a screen can tell which one is showing.
 */
export interface CaptionCue {
  readonly startMs: number
  readonly endMs: number
  readonly text: string
  readonly direction: TextDirection
  readonly position: TextPosition
  readonly size: TextSize
  readonly id: string
}

/**
 * Where each text is shown on the edited video, in order of time. A title is clamped to the edit. A caption of a
 * recording shows wherever the edit plays the part of the recording it was on: once for each time that part is used,
 * not at all where it was cut out, and only for the part that is left when a cut falls inside it. Pieces of one
 * caption that meet, such as either side of a split, are one cue again.
 */
export function resolveCues(t: Timeline, items: readonly TextItem[]): CaptionCue[] {
  if (items.length === 0) return []
  const all = spans(t)
  const duration = t.durationMs
  const cues: CaptionCue[] = []

  const add = (item: TextItem, startMs: number, endMs: number): void => {
    const last = cues[cues.length - 1]
    if (last !== undefined && last.id === item.id && last.endMs === startMs) {
      cues[cues.length - 1] = { ...last, endMs }
    } else {
      cues.push({
        startMs,
        endMs,
        text: item.text,
        direction: item.direction,
        position: item.position,
        size: item.size,
        id: item.id,
      })
    }
  }

  for (const item of items) {
    const placement = item.placement
    if (placement.type === 'onOutput') {
      const start = Math.max(placement.startMs, 0)
      const end = Math.min(placement.endMs, duration)
      if (end > start) add(item, start, end)
    } else {
      for (const span of all) {
        if (span.clip.sourceId !== placement.sourceId) continue
        const from = Math.max(placement.startMs, span.clip.sourceStartMs)
        const to = Math.min(placement.endMs, span.clip.sourceStartMs + span.clip.durationMs)
        if (to > from) {
          const shift = span.startMs - span.clip.sourceStartMs
          add(item, from + shift, to + shift)
        }
      }
    }
  }
  // Array.prototype.sort is stable, as the Kotlin sort is, so cues that begin and end together keep their order.
  return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
}

/** The cues that are on screen at timeMs of the edit. */
export function activeAt(cues: readonly CaptionCue[], timeMs: number): CaptionCue[] {
  return cues.filter((cue) => timeMs >= cue.startMs && timeMs < cue.endMs)
}
