import { type AudioItem, type AudioMix, audioEndMs, clipGain, itemEnvelope, masterEnvelope } from '../engine/audio'

/** How long before a piece starts it is made ready, so that it can begin on time. */
export const ITEM_LOOKAHEAD_MS = 1_500

/** How far a playing piece may drift from the picture before it is moved back. */
export const SYNC_TOLERANCE_MS = 300

/** How far a waiting piece may be from the playhead before it is moved, so scrubbing does not seek on every frame. */
export const SEEK_TOLERANCE_MS = 100

/** The pieces of music and voiceover that are playing at editMs or about to: nothing else costs anything. */
export const wantedItems = (mix: AudioMix, editMs: number): AudioItem[] =>
  mix.items.filter((item) => editMs < audioEndMs(item) && editMs >= item.startMs - ITEM_LOOKAHEAD_MS)

/** What a piece should be doing at one moment of the edit. */
export interface ItemLevel {
  readonly item: AudioItem
  /** True once the playhead is at or past the piece's start; before that it waits, silent, at its first moment. */
  readonly inside: boolean
  /** Where in the piece the sound should be, in milliseconds from the piece's own start. */
  readonly pieceMs: number
  /** Where in its file that is: the piece's own start is trimStartMs into the file. */
  readonly fileMs: number
  /** How loud, counting the fades of the piece and of the whole edit. Above 1 is louder than the file is. */
  readonly gain: number
}

export interface Levels {
  /** The sound of the clip under the playhead, with the fades of the whole edit. */
  readonly clip: number
  readonly items: readonly ItemLevel[]
}

/**
 * How loud each sound should be at editMs: the clip under the playhead (volumePercent of the recording) and the music and
 * voiceovers near it. Every level comes from the same envelopes as the export, so the preview and the exported file
 * agree.
 */
export function levelsAt(clipVolumePercent: number, mix: AudioMix, editMs: number, editDurationMs: number): Levels {
  const master = masterEnvelope(mix, editDurationMs).atMs(editMs)
  const items = wantedItems(mix, editMs).map((item): ItemLevel => {
    const inside = editMs >= item.startMs
    const pieceMs = inside ? editMs - item.startMs : 0
    return {
      item,
      inside,
      pieceMs,
      fileMs: item.trimStartMs + pieceMs,
      gain: inside ? itemEnvelope(item).atMs(pieceMs) * master : 0,
    }
  })
  return { clip: clipGain(clipVolumePercent) * master, items }
}

/** True when two pieces make the same sound, so a player that was made for one can serve the other. */
export const samePlayedSound = (a: AudioItem, b: AudioItem): boolean =>
  a.file === b.file && a.trimStartMs === b.trimStartMs && a.lengthMs === b.lengthMs
