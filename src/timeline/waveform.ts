import type { Peaks } from '../audio/peaks'
import { type AudioItem, GainEnvelope, gainOfPercent } from '../engine/audio'

/** How far apart the columns of a waveform are, and how wide each is, in CSS pixels. */
export const COLUMN_PITCH_PX = 3
export const COLUMN_PX = 2

export interface WaveLayout {
  /** Where the piece starts, in pixels, on the same ruler as originX. It may be far outside the view. */
  readonly itemLeft: number
  /** Where the drawn part begins, and how wide it is. */
  readonly originX: number
  readonly drawnWidth: number
  readonly pxPerMs: number
}

export interface Column {
  /** The left edge, in pixels from the left edge of what is drawn. */
  readonly x: number
  /** How tall the column is, from 0 for silence to 1 for full scale, both sides of the middle together. */
  readonly level: number
}

type Shaped = Pick<AudioItem, 'trimStartMs' | 'lengthMs' | 'volumePercent' | 'fadeInMs' | 'fadeOutMs'>

/**
 * The columns of a piece of music or voiceover that lie in the drawn part: each is the loudest stretch of the sound under
 * it, as loud as the piece plays it, which is the file's level times the piece's volume and its fades, never more than
 * full scale. They are laid from the piece's own start, so they stay put on it when the view moves.
 */
export function columnsOf(peaks: Peaks, item: Shaped, layout: WaveLayout): Column[] {
  const { itemLeft, originX, drawnWidth, pxPerMs } = layout
  if (!(pxPerMs > 0) || !(drawnWidth > 0) || !(item.lengthMs > 0) || peaks.values.length === 0) return []
  const columnMs = COLUMN_PITCH_PX / pxPerMs
  const count = Math.ceil(item.lengthMs / columnMs)
  const rawFirst = Math.floor((originX - itemLeft) / COLUMN_PITCH_PX)
  const rawLast = Math.ceil((originX + drawnWidth - itemLeft) / COLUMN_PITCH_PX) - 1
  if (rawLast < 0 || rawFirst > count - 1) return []
  const first = Math.max(rawFirst, 0)
  const last = Math.min(rawLast, count - 1)
  const envelope = new GainEnvelope(gainOfPercent(item.volumePercent), item.fadeInMs, item.fadeOutMs, item.lengthMs)
  const { values, bucketMs } = peaks
  const columns: Column[] = []
  for (let j = first; j <= last; j++) {
    const from = j * columnMs
    const to = Math.min((j + 1) * columnMs, item.lengthMs)
    const firstBucket = Math.floor((item.trimStartMs + from) / bucketMs)
    const lastBucket = Math.max(firstBucket, Math.ceil((item.trimStartMs + to) / bucketMs) - 1)
    let peak = 0
    for (let b = Math.max(firstBucket, 0); b <= lastBucket && b < values.length; b++) {
      const value = values[b] ?? 0
      if (value > peak) peak = value
    }
    // The fades are counted at the middle of the stretch; a column is a few pixels wide, a few frames at most.
    const level = Math.min(1, (peak / 255) * envelope.atMs((from + to) / 2))
    columns.push({ x: Math.round(itemLeft + j * COLUMN_PITCH_PX - originX), level })
  }
  return columns
}
