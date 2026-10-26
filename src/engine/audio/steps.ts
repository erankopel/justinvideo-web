import { MAX_TIMELINE_MS, MAX_VOLUME_PERCENT } from '../timeline'
import { type AudioItem, MAX_FADE_MS, MIN_AUDIO_ITEM_MS } from './model'

/** How far one press of an Earlier, Later, Shorter or Longer button moves a piece of music, and a fade. */
export const AUDIO_STEP_MS = 500

/** The shortest a piece can be made with the buttons. */
export const MIN_PLAYED_MS = 500

const coerceIn = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

/** The piece moved by deltaMs on the edit's clock, with its length kept. It cannot start before the edit. */
export const movedBy = (item: AudioItem, deltaMs: number): AudioItem => ({
  ...item,
  startMs: coerceIn(item.startMs + deltaMs, 0, Math.max(MAX_TIMELINE_MS - item.lengthMs, 0)),
})

/** The piece with its fades shortened, if need be, so that together they are no longer than the piece. */
export function withFadesFitting(item: AudioItem): AudioItem {
  if (item.fadeInMs + item.fadeOutMs <= item.lengthMs) return item
  const out = Math.min(item.fadeOutMs, item.lengthMs)
  return { ...item, fadeOutMs: out, fadeInMs: Math.min(item.fadeInMs, item.lengthMs - out) }
}

/** The piece made longer or shorter at its end, within the file that is left after its start, and with its fades kept inside it. */
export function resizedBy(item: AudioItem, deltaMs: number): AudioItem {
  const room = item.fileDurationMs - item.trimStartMs
  const newLength = Math.min(
    coerceIn(item.lengthMs + deltaMs, Math.min(MIN_PLAYED_MS, room), room),
    Math.max(MAX_TIMELINE_MS - item.startMs, MIN_AUDIO_ITEM_MS),
  )
  return withFadesFitting({ ...item, lengthMs: newLength })
}

/** The piece started later or earlier in its file, with its length kept: skipping into a song, or back. */
export const skippedBy = (item: AudioItem, deltaMs: number): AudioItem => ({
  ...item,
  trimStartMs: coerceIn(item.trimStartMs + deltaMs, 0, Math.max(item.fileDurationMs - item.lengthMs, 0)),
})

/** The fade in made longer or shorter, never past the fade out or the length. */
export const fadeInBy = (item: AudioItem, deltaMs: number): AudioItem => ({
  ...item,
  fadeInMs: coerceIn(item.fadeInMs + deltaMs, 0, Math.min(MAX_FADE_MS, Math.max(item.lengthMs - item.fadeOutMs, 0))),
})

/** The fade out made longer or shorter, never past the fade in or the length. */
export const fadeOutBy = (item: AudioItem, deltaMs: number): AudioItem => ({
  ...item,
  fadeOutMs: coerceIn(item.fadeOutMs + deltaMs, 0, Math.min(MAX_FADE_MS, Math.max(item.lengthMs - item.fadeInMs, 0))),
})

/** The piece at a volume between silence and the loudest allowed. */
export const withVolume = (item: AudioItem, percent: number): AudioItem => ({
  ...item,
  volumePercent: coerceIn(percent, 0, MAX_VOLUME_PERCENT),
})

/** A master fade made longer or shorter, between zero and the longest fade. */
export const steppedFade = (currentMs: number, deltaMs: number): number => coerceIn(currentMs + deltaMs, 0, MAX_FADE_MS)
