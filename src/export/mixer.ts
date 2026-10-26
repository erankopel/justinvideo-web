import { EXPORT_RATE, mixBlock, type Contribution, type DecodedAudio, type Samples } from './mix'
import { fileKey, isSilent, type SoundLayer } from './plan'
import type { GainEnvelope } from '../engine/audio'

/** Decoded sound from one file, for any stretch of it. */
export interface AudioReader {
  /** The sound from fromS to toS seconds of the file, or a little more. */
  read(fromS: number, toS: number): Promise<DecodedAudio>
  close(): void
}

export interface MixRequest {
  readonly layers: readonly SoundLayer[]
  /** The fades over the whole edit. */
  readonly master: GainEnvelope
  readonly durationMs: number
  readonly openReader: (layer: SoundLayer) => Promise<AudioReader>
  readonly signal?: AbortSignal
  /** How many frames are mixed at a time. A second of sound by default. */
  readonly blockFrames?: number
}

export interface MixedBlock {
  readonly startFrame: number
  readonly left: Samples
  readonly right: Samples
}

/** What is read beyond a block either side, so the interpolation has the samples around its edges. */
const MARGIN_S = 0.05

export const frameCountOf = (durationMs: number): number => Math.round((durationMs * EXPORT_RATE) / 1000)

/**
 * Mixes the edit's sound one block at a time, so a long edit never has all of its sound in memory: for each block, the
 * layers that are playing read the stretch of their files that it needs. A file is opened when its first layer is
 * reached, kept for its other layers, and closed when its last one has passed.
 */
export async function* mixBlocks(request: MixRequest): AsyncGenerator<MixedBlock, void, unknown> {
  const { layers, master, durationMs, openReader, signal } = request
  const blockFrames = request.blockFrames ?? EXPORT_RATE
  const total = frameCountOf(durationMs)
  const readers = new Map<string, AudioReader>()
  const lastMs = new Map<string, number>()
  for (const layer of layers) lastMs.set(fileKey(layer.file), Math.max(lastMs.get(fileKey(layer.file)) ?? 0, layer.endMs))
  try {
    for (let startFrame = 0; startFrame < total; startFrame += blockFrames) {
      if (signal?.aborted) throw new DOMException('The export was cancelled', 'AbortError')
      const frames = Math.min(blockFrames, total - startFrame)
      const from = startFrame / EXPORT_RATE
      const to = (startFrame + frames) / EXPORT_RATE
      const contributions: Contribution[] = []
      for (const layer of layers) {
        const startS = layer.startMs / 1000
        const endS = layer.endMs / 1000
        if (isSilent(layer) || endS <= from || startS >= to) continue
        const key = fileKey(layer.file)
        let reader = readers.get(key)
        if (!reader) {
          reader = await openReader(layer)
          readers.set(key, reader)
        }
        const fileFrom = layer.fileStartMs / 1000 + (Math.max(from, startS) - startS)
        const fileTo = layer.fileStartMs / 1000 + (Math.min(to, endS) - startS)
        const audio = await reader.read(Math.max(0, fileFrom - MARGIN_S), fileTo + MARGIN_S)
        contributions.push({ startMs: layer.startMs, endMs: layer.endMs, fileStartMs: layer.fileStartMs, envelope: layer.envelope, audio })
      }
      const [left, right] = mixBlock(contributions, master, startFrame, frames)
      yield { startFrame, left, right }
      for (const [key, reader] of [...readers]) {
        if ((lastMs.get(key) ?? 0) / 1000 <= to) {
          reader.close()
          readers.delete(key)
        }
      }
    }
  } finally {
    for (const reader of readers.values()) reader.close()
  }
}
