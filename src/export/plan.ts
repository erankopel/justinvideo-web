import { clipGain, GainEnvelope, itemEnvelope, playedLengthWithin } from '../engine/audio'
import type { Project } from '../project/model'
import { type ExportPiece, pieceDurationMs } from './settings'

/** Which file a sound comes from: a recording of the project, or a piece of music or voiceover. */
export type SoundFile = { readonly kind: 'source'; readonly id: string } | { readonly kind: 'audio'; readonly id: string }

/** One sound of the export, placed on the edit's clock. */
export interface SoundLayer {
  readonly file: SoundFile
  readonly startMs: number
  readonly endMs: number
  /** Where in its file the sound is at startMs. */
  readonly fileStartMs: number
  /** How loud, over its own time from startMs. */
  readonly envelope: GainEnvelope
}

/** A key that is the same for every layer that reads the same file, so the file is opened once. */
export const fileKey = (file: SoundFile): string => `${file.kind}:${file.id}`

/**
 * Every sound that is heard in the export: the sound of each piece of a recording that has any, at its clip volume, and
 * each piece of music or voiceover that is heard before the edit ends, at its own volume and with its fades. The fades
 * over the whole edit are applied to the mix, not here.
 */
export function soundLayers(project: Project, pieces: readonly ExportPiece[]): SoundLayer[] {
  const layers: SoundLayer[] = []
  let offsetMs = 0
  for (const piece of pieces) {
    const duration = pieceDurationMs(piece)
    const source = project.sources.find((s) => s.id === piece.sourceId)
    if (source?.hasAudio) {
      layers.push({
        file: { kind: 'source', id: source.id },
        startMs: offsetMs,
        endMs: offsetMs + duration,
        fileStartMs: piece.startMs,
        envelope: new GainEnvelope(clipGain(piece.volumePercent)),
      })
    }
    offsetMs += duration
  }
  for (const item of project.edit.mix.items) {
    const played = playedLengthWithin(item, offsetMs)
    if (played === null) continue
    layers.push({
      file: { kind: 'audio', id: item.id },
      startMs: item.startMs,
      endMs: item.startMs + played,
      fileStartMs: item.trimStartMs,
      envelope: itemEnvelope(item),
    })
  }
  return layers
}

/** A layer whose level is constant zero adds nothing, so its file need not be read. */
export const isSilent = (layer: SoundLayer): boolean => layer.envelope.isConstant && layer.envelope.gain === 0
