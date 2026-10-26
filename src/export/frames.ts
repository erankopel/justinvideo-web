/** Where a decoded frame goes on the export's clock, in seconds. */
export interface PlacedFrame {
  readonly timestamp: number
  readonly duration: number
}

/** A frame closer than this to the one before, within the cadence of the target rate, is still taken, so a little jitter does not drop one. */
const JITTER_S = 0.002

/**
 * Places the frames of one piece of a recording on the export's clock: the piece starts at offsetS there, and its frames
 * keep their own spacing, so a 25 fps recording stays at 25 fps. The first frame is put at the start of the piece, as the
 * frame that was showing when the piece began, and the last is cut off where the piece ends, so pieces follow each other
 * with no gap and no overlap. When dropTo is given, frames are thinned to that rate: frames can be dropped but not made.
 */
export class FrameRetimer {
  private lastTimestamp: number | null = null
  private readonly length: number

  constructor(
    private readonly pieceStartS: number,
    pieceEndS: number,
    private readonly offsetS: number,
    private readonly dropTo: number | null = null,
  ) {
    this.length = pieceEndS - pieceStartS
  }

  /** The place of a frame with the recording's own timestamp and duration, or null when the frame is not used. */
  place(timestampS: number, durationS: number): PlacedFrame | null {
    const first = this.lastTimestamp === null
    // A frame that began before the piece is the one that was showing at its start.
    const skipped = Math.max(0, this.pieceStartS - timestampS)
    const timestamp = first ? this.offsetS : this.offsetS + (timestampS - this.pieceStartS)
    const end = this.offsetS + this.length
    if (timestamp >= end - 1e-6) return null
    if (this.dropTo !== null && this.lastTimestamp !== null && timestamp < this.lastTimestamp + 1 / this.dropTo - JITTER_S) return null
    const own = Math.max(durationS - skipped, 0)
    const wanted = this.dropTo !== null ? 1 / this.dropTo : own > 0 ? own : 1 / 60
    const duration = Math.min(wanted, end - timestamp)
    this.lastTimestamp = timestamp
    return { timestamp, duration }
  }
}
