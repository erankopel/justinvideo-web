import { DEFAULT_VOLUME_PERCENT } from '../timeline'
import { type AudioItem, type AudioMix, MIN_AUDIO_ITEM_MS } from './model'

/** The length of a sound that goes on to the end of whatever it is laid under. */
export const UNBOUNDED_MS = Number.POSITIVE_INFINITY

/**
 * How loud something is over its own time: a steady gain that rises from silence over fadeInMs at the start and falls
 * to silence over fadeOutMs at the end, lengthMs after the start. A gain of 1 leaves the sound as it is. The preview
 * and the export both take their levels from here, so what is heard while editing is what is exported.
 */
export class GainEnvelope {
  constructor(
    readonly gain: number,
    readonly fadeInMs: number = 0,
    readonly fadeOutMs: number = 0,
    readonly lengthMs: number = UNBOUNDED_MS,
  ) {}

  /** True when the level never changes, so a sound can be scaled without looking at the time. */
  get isConstant(): boolean {
    return this.fadeInMs <= 0 && (this.fadeOutMs <= 0 || this.lengthMs === UNBOUNDED_MS)
  }

  /** True when the sound is left exactly as it is. */
  get isUnity(): boolean {
    return this.isConstant && this.gain === 1
  }

  /** The gain timeUs microseconds after the start. */
  atUs(timeUs: number): number {
    let level = this.gain
    if (this.fadeInMs > 0) {
      const fadeInUs = this.fadeInMs * 1000
      if (timeUs < fadeInUs) level *= Math.max(timeUs, 0) / fadeInUs
    }
    if (this.fadeOutMs > 0 && this.lengthMs !== UNBOUNDED_MS) {
      const fadeOutUs = this.fadeOutMs * 1000
      const remainingUs = this.lengthMs * 1000 - timeUs
      if (remainingUs < fadeOutUs) level *= Math.max(remainingUs, 0) / fadeOutUs
    }
    return level
  }

  /** The gain timeMs milliseconds after the start. */
  atMs(timeMs: number): number {
    return this.atUs(timeMs * 1000)
  }
}

/** A volume in percent as the factor that scales the sound. */
export const gainOfPercent = (percent: number): number => percent / 100

/** The envelope of a piece of music or voiceover, with time counted from the piece's own start. */
export const itemEnvelope = (item: AudioItem): GainEnvelope =>
  new GainEnvelope(gainOfPercent(item.volumePercent), item.fadeInMs, item.fadeOutMs, item.lengthMs)

/** The envelope of the whole edit's sound, with time counted from the start of the edit. */
export const masterEnvelope = (mix: AudioMix, editDurationMs: number): GainEnvelope =>
  new GainEnvelope(1, mix.masterFadeInMs, mix.masterFadeOutMs, editDurationMs)

/** The gain of a clip's own sound. */
export const clipGain = (volumePercent: number): number =>
  volumePercent === DEFAULT_VOLUME_PERCENT ? 1 : gainOfPercent(volumePercent)

/**
 * How much of the piece the export plays: all of it, or less where the edit ends first, because a piece of music that
 * outlasts the video must not make the file longer. Null when too little of it is left to hear. Its fades still count
 * from its own start and end, so a fade out that falls after the edit's end is not heard.
 */
export function playedLengthWithin(item: AudioItem, editDurationMs: number): number | null {
  const room = editDurationMs - item.startMs
  return room < MIN_AUDIO_ITEM_MS ? null : Math.min(item.lengthMs, room)
}
