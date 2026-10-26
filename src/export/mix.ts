import type { GainEnvelope } from '../engine/audio'

/** The sample rate of the sound of an export: what every encoder takes and the phones record at. */
export const EXPORT_RATE = 48_000

/** Samples that this code made itself, so a browser's audio code takes them as they are. */
export type Samples = Float32Array<ArrayBuffer>

/** Sound that has been decoded, ready to be sampled: its channels, from startS seconds into its file, at rate. */
export interface DecodedAudio {
  readonly channels: readonly Float32Array[]
  readonly startS: number
  readonly rate: number
}

/** One sound that is heard in the export: a clip's own sound, a piece of music, or a voiceover. */
export interface Contribution {
  /** Where it begins and ends on the edit's clock, in milliseconds. */
  readonly startMs: number
  readonly endMs: number
  /** Where in its file the sound is at startMs. */
  readonly fileStartMs: number
  /** How loud it is over its own time, counted from startMs. */
  readonly envelope: GainEnvelope
  /** The sound, decoded for at least the part of the file that this block uses, with a little to spare either side. */
  readonly audio: DecodedAudio
}

/**
 * The value at a fractional position in a channel, by cubic interpolation between the four samples around it. Outside the
 * decoded sound there is silence.
 */
export function sampleAt(channel: Float32Array, position: number): number {
  const index = Math.floor(position)
  const fraction = position - index
  if (index < 0 || index >= channel.length) return 0
  if (fraction === 0) return channel[index] ?? 0
  const before = channel[index - 1] ?? channel[index] ?? 0
  const here = channel[index] ?? 0
  const next = channel[index + 1] ?? here
  const after = channel[index + 2] ?? next
  // Catmull-Rom: passes through every sample, and does not overshoot a steady tone.
  const a = -0.5 * before + 1.5 * here - 1.5 * next + 0.5 * after
  const b = before - 2.5 * here + 2 * next - 0.5 * after
  const c = -0.5 * before + 0.5 * next
  return ((a * fraction + b) * fraction + c) * fraction + here
}

/**
 * The mixed sound of frames [startFrame, startFrame + frames) of the edit, at EXPORT_RATE: every contribution that is
 * playing, each at its own level, then the fades over the whole edit, clamped to full scale. A sound of one channel is
 * heard on both sides; of more than two, the first two channels are used. The levels come from the same envelopes as
 * the preview, so what was heard while editing is what is exported.
 */
export function mixBlock(
  contributions: readonly Contribution[],
  master: GainEnvelope,
  startFrame: number,
  frames: number,
): [Samples, Samples] {
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (const contribution of contributions) {
    const { audio, envelope } = contribution
    const first = audio.channels[0]
    if (!first) continue
    const second = audio.channels[1] ?? first
    const startS = contribution.startMs / 1000
    const endS = contribution.endMs / 1000
    const steady = envelope.isConstant ? envelope.gain : null
    for (let n = 0; n < frames; n++) {
      const t = (startFrame + n) / EXPORT_RATE
      if (t < startS || t >= endS) continue
      const local = t - startS
      const at = (contribution.fileStartMs / 1000 + local - audio.startS) * audio.rate
      const gain = steady ?? envelope.atUs(local * 1_000_000)
      left[n] = (left[n] ?? 0) + sampleAt(first, at) * gain
      right[n] = (right[n] ?? 0) + sampleAt(second, at) * gain
    }
  }
  const steadyMaster = master.isConstant ? master.gain : null
  for (let n = 0; n < frames; n++) {
    const gain = steadyMaster ?? master.atUs(((startFrame + n) / EXPORT_RATE) * 1_000_000)
    left[n] = Math.max(-1, Math.min(1, (left[n] ?? 0) * gain))
    right[n] = Math.max(-1, Math.min(1, (right[n] ?? 0) * gain))
  }
  return [left, right]
}
