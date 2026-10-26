import { isSafeRelativePath, isValidId } from '../ids'
import { MAX_TIMELINE_MS, MAX_VOLUME_PERCENT } from '../timeline'

/** The most pieces of music and voiceover a project may hold. */
export const MAX_AUDIO_ITEMS = 20

/** The shortest a piece of music or voiceover may play. */
export const MIN_AUDIO_ITEM_MS = 100

/** The longest a fade may last, for a piece or for the whole edit. */
export const MAX_FADE_MS = 10_000

export const MAX_AUDIO_NAME_LENGTH = 200

export type AudioKind = 'music' | 'voiceover'

/**
 * A piece of sound laid under the edit: music from a file, or a voiceover that was recorded. It starts at startMs on
 * the edited video's own clock and plays lengthMs of its file from trimStartMs. It is mixed with the sound of the
 * clips, volumePercent as loud as the file is, and may fade in and out. file is relative to the project folder: the
 * app keeps its own copy, as it does of the videos.
 */
export interface AudioItem {
  readonly id: string
  readonly kind: AudioKind
  readonly file: string
  readonly displayName: string
  readonly fileDurationMs: number
  readonly startMs: number
  readonly lengthMs: number
  readonly trimStartMs: number
  readonly volumePercent: number
  readonly fadeInMs: number
  readonly fadeOutMs: number
}

export function audioItem(
  fields: Pick<AudioItem, 'id' | 'kind' | 'file' | 'displayName' | 'fileDurationMs' | 'startMs' | 'lengthMs'> &
    Partial<Pick<AudioItem, 'trimStartMs' | 'volumePercent' | 'fadeInMs' | 'fadeOutMs'>>,
): AudioItem {
  return { trimStartMs: 0, volumePercent: 100, fadeInMs: 0, fadeOutMs: 0, ...fields }
}

export const audioEndMs = (item: AudioItem): number => item.startMs + item.lengthMs

/** The sound of the edit apart from its clips: the pieces of music and voiceover, and fades over the whole edit. */
export interface AudioMix {
  readonly items: readonly AudioItem[]
  readonly masterFadeInMs: number
  readonly masterFadeOutMs: number
}

export function audioMix(items: readonly AudioItem[] = [], masterFadeInMs = 0, masterFadeOutMs = 0): AudioMix {
  return { items, masterFadeInMs, masterFadeOutMs }
}

export const EMPTY_MIX: AudioMix = audioMix()

export const mixItem = (mix: AudioMix, id: string): AudioItem | undefined => mix.items.find((item) => item.id === id)

export const mixIsEmpty = (mix: AudioMix): boolean =>
  mix.items.length === 0 && mix.masterFadeInMs === 0 && mix.masterFadeOutMs === 0

const within = (value: number, min: number, max: number): boolean => value >= min && value <= max

/** The first rule that the mix breaks, or null when it is fine. */
export function validateMix(mix: AudioMix): string | null {
  if (mix.items.length > MAX_AUDIO_ITEMS) {
    return `A project holds at most ${MAX_AUDIO_ITEMS} pieces of music and voiceover`
  }
  if (!within(mix.masterFadeInMs, 0, MAX_FADE_MS) || !within(mix.masterFadeOutMs, 0, MAX_FADE_MS)) {
    return 'A fade is not between zero and ten seconds'
  }
  const ids = new Set<string>()
  for (const item of mix.items) {
    if (!isValidId(item.id) || ids.has(item.id)) return 'An audio id is not valid or is repeated'
    ids.add(item.id)
    if (!isSafeRelativePath(item.file)) return 'An audio file path is not valid'
    if (item.displayName.length > MAX_AUDIO_NAME_LENGTH) return 'An audio name is too long'
    if (!within(item.fileDurationMs, MIN_AUDIO_ITEM_MS, MAX_TIMELINE_MS)) return 'An audio file length is not valid'
    if (item.lengthMs < MIN_AUDIO_ITEM_MS) return `A piece of audio is shorter than ${MIN_AUDIO_ITEM_MS} ms`
    if (item.trimStartMs < 0 || item.trimStartMs + item.lengthMs > item.fileDurationMs) {
      return 'A piece of audio reaches past its file'
    }
    if (item.startMs < 0 || item.startMs + item.lengthMs > MAX_TIMELINE_MS) {
      return 'A piece of audio is outside the longest possible edit'
    }
    if (!within(item.volumePercent, 0, MAX_VOLUME_PERCENT)) {
      return `An audio volume is not between 0 and ${MAX_VOLUME_PERCENT} percent`
    }
    if (!within(item.fadeInMs, 0, MAX_FADE_MS) || !within(item.fadeOutMs, 0, MAX_FADE_MS)) {
      return 'A fade is not between zero and ten seconds'
    }
    if (item.fadeInMs + item.fadeOutMs > item.lengthMs) return 'The fades of a piece of audio are longer than the piece'
  }
  return null
}
