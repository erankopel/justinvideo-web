import { describe, expect, it } from 'vitest'
import { GainEnvelope } from '../engine/audio'
import { type Contribution, type DecodedAudio, EXPORT_RATE, mixBlock, sampleAt } from './mix'

const unity = new GainEnvelope(1)

/** A sine of a frequency and amplitude, as decoded sound at a rate, starting at startS of its file. */
function tone(seconds: number, hertz: number, amplitude: number, rate = EXPORT_RATE, startS = 0): DecodedAudio {
  const data = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < data.length; i++) data[i] = amplitude * Math.sin((2 * Math.PI * hertz * (i / rate + startS)))
  return { channels: [data], startS, rate }
}

const layer = (audio: DecodedAudio, over: Partial<Contribution> = {}): Contribution => ({
  startMs: 0,
  endMs: 1000,
  fileStartMs: 0,
  envelope: unity,
  audio,
  ...over,
})

const peak = (samples: Float32Array, from = 0, to = samples.length): number => {
  let largest = 0
  for (let i = from; i < to; i++) largest = Math.max(largest, Math.abs(samples[i] ?? 0))
  return largest
}

describe('sampleAt', () => {
  it('is the sample itself on a whole position and a smooth value between', () => {
    const data = Float32Array.from([0, 1, 0, -1, 0])
    expect(sampleAt(data, 1)).toBe(1)
    expect(sampleAt(data, 1.5)).toBeGreaterThan(0.5)
    expect(sampleAt(data, 1.5)).toBeLessThan(1.1)
  })

  it('is silence outside the sound', () => {
    const data = Float32Array.from([1, 1, 1])
    expect(sampleAt(data, -0.5)).toBe(0)
    expect(sampleAt(data, 3)).toBe(0)
    expect(sampleAt(data, 10)).toBe(0)
  })

  it('follows a tone sampled at another rate', () => {
    const source = tone(0.1, 440, 0.5, 44_100).channels[0]!
    for (const second of [0.01, 0.0234, 0.05]) {
      expect(sampleAt(source, second * 44_100)).toBeCloseTo(0.5 * Math.sin(2 * Math.PI * 440 * second), 2)
    }
  })
})

describe('mixBlock', () => {
  it('passes a sound through at gain one', () => {
    const audio = tone(1, 440, 0.5)
    const [left, right] = mixBlock([layer(audio)], unity, 0, 4800)
    expect(left[100]).toBeCloseTo(audio.channels[0]![100]!, 6)
    expect(right[100]).toBe(left[100])
    expect(peak(left)).toBeCloseTo(0.5, 2)
  })

  it('scales a clip by its volume and clamps what goes past full scale', () => {
    const audio = tone(1, 440, 0.4)
    expect(peak(mixBlock([layer(audio, { envelope: new GainEnvelope(0.5) })], unity, 0, 4800)[0])).toBeCloseTo(0.2, 2)
    expect(peak(mixBlock([layer(audio, { envelope: new GainEnvelope(1.5) })], unity, 0, 4800)[0])).toBeCloseTo(0.6, 2)
    const loud = mixBlock([layer(tone(1, 440, 0.9), { envelope: new GainEnvelope(2) })], unity, 0, 4800)[0]
    expect(peak(loud)).toBe(1)
  })

  it('is silent before a piece starts and after it ends, and plays it from where it is placed', () => {
    const audio = tone(2, 1000, 0.5)
    const [left] = mixBlock([layer(audio, { startMs: 500, endMs: 1500 })], unity, 0, EXPORT_RATE * 2)
    expect(peak(left, 0, 24_000 - 1)).toBe(0)
    expect(peak(left, 24_000 + 100, 72_000 - 100)).toBeGreaterThan(0.45)
    expect(peak(left, 72_000, 96_000)).toBe(0)
    // The piece starts at the start of its file: the sample at 500 ms is the file's first.
    expect(left[24_000]).toBeCloseTo(audio.channels[0]![0]!, 6)
    expect(left[24_000 + 7]).toBeCloseTo(audio.channels[0]![7]!, 6)
  })

  it('skips the part of its file that is trimmed', () => {
    const audio = tone(2, 440, 0.5)
    const [left] = mixBlock([layer(audio, { fileStartMs: 750 })], unity, 0, 100)
    expect(left[0]).toBeCloseTo(audio.channels[0]![36_000]!, 6)
    expect(left[10]).toBeCloseTo(audio.channels[0]![36_010]!, 6)
  })

  it('resamples a sound from another rate and keeps its level and pitch', () => {
    const audio = tone(1, 440, 0.5, 44_100)
    const [left] = mixBlock([layer(audio)], unity, 0, EXPORT_RATE)
    for (const frame of [1000, 12_345, 30_000]) {
      expect(left[frame]).toBeCloseTo(0.5 * Math.sin((2 * Math.PI * 440 * frame) / EXPORT_RATE), 2)
    }
  })

  it('gives each channel of a stereo sound its own side, and a mono one both', () => {
    const stereo: DecodedAudio = { channels: [new Float32Array(100).fill(0.25), new Float32Array(100).fill(-0.5)], startS: 0, rate: EXPORT_RATE }
    const [left, right] = mixBlock([layer(stereo, { endMs: 2 })], unity, 0, 50)
    expect(left[10]).toBeCloseTo(0.25, 6)
    expect(right[10]).toBeCloseTo(-0.5, 6)
    const mono: DecodedAudio = { channels: [new Float32Array(100).fill(0.25)], startS: 0, rate: EXPORT_RATE }
    const [l2, r2] = mixBlock([layer(mono, { endMs: 2 })], unity, 0, 50)
    expect(l2[10]).toBeCloseTo(0.25, 6)
    expect(r2[10]).toBeCloseTo(0.25, 6)
  })

  it('adds contributions together', () => {
    const a: DecodedAudio = { channels: [new Float32Array(48_000).fill(0.2)], startS: 0, rate: EXPORT_RATE }
    const b: DecodedAudio = { channels: [new Float32Array(48_000).fill(0.3)], startS: 0, rate: EXPORT_RATE }
    const [left] = mixBlock([layer(a), layer(b)], unity, 0, 100)
    expect(left[50]).toBeCloseTo(0.5, 6)
  })

  it('follows the fades of a piece over its own time', () => {
    const steady: DecodedAudio = { channels: [new Float32Array(EXPORT_RATE * 2).fill(0.8)], startS: 0, rate: EXPORT_RATE }
    const faded = new GainEnvelope(1, 1000, 1000, 2000)
    const [left] = mixBlock([layer(steady, { endMs: 2000, envelope: faded })], unity, 0, EXPORT_RATE * 2)
    expect(left[0]).toBeCloseTo(0, 6)
    expect(left[24_000]).toBeCloseTo(0.4, 3)
    expect(left[48_000]).toBeCloseTo(0.8, 3)
    expect(left[72_000]).toBeCloseTo(0.4, 3)
    expect(left[95_999]).toBeCloseTo(0, 3)
  })

  it('applies the fades over the whole edit to the mixed sound', () => {
    const steady: DecodedAudio = { channels: [new Float32Array(EXPORT_RATE * 2).fill(0.5)], startS: 0, rate: EXPORT_RATE }
    const master = new GainEnvelope(1, 1000, 1000, 2000)
    const [left] = mixBlock([layer(steady, { endMs: 2000 })], master, 0, EXPORT_RATE * 2)
    expect(left[0]).toBeCloseTo(0, 6)
    expect(left[24_000]).toBeCloseTo(0.25, 3)
    expect(left[48_000]).toBeCloseTo(0.5, 3)
    expect(left[72_000]).toBeCloseTo(0.25, 3)
  })

  it('gives the same sound whether the edit is mixed in one block or several', () => {
    const audio = tone(2, 523, 0.4, 44_100)
    const envelope = new GainEnvelope(1.2, 500, 500, 2000)
    const contribution = layer(audio, { endMs: 2000, envelope })
    const whole = mixBlock([contribution], unity, 0, EXPORT_RATE * 2)[0]
    const pieces = [0, 1, 2, 3].map((i) => mixBlock([contribution], unity, i * 24_000, 24_000)[0])
    pieces.forEach((piece, i) => {
      for (const n of [0, 1, 5_000, 23_999]) expect(piece[n]).toBeCloseTo(whole[i * 24_000 + n]!, 6)
    })
  })

  it('is silence when nothing is playing', () => {
    const [left, right] = mixBlock([], unity, 0, 10)
    expect(Array.from(left)).toEqual(new Array(10).fill(0))
    expect(Array.from(right)).toEqual(new Array(10).fill(0))
  })
})
