import { describe, expect, it } from 'vitest'
import { PEAK_BUCKET_MS, PeakBuilder } from './peaks'

const RATE = 44_100
/** Samples in one stretch: 10 ms at 44.1 kHz. */
const BUCKET = (RATE * PEAK_BUCKET_MS) / 1000

const steady = (level: number, samples: number): Float32Array => new Float32Array(samples).fill(level)

describe('PeakBuilder', () => {
  it('keeps the loudest sample of every stretch, as a number from 0 to 255', () => {
    const builder = new PeakBuilder()
    const block = new Float32Array(BUCKET * 3)
    block[10] = 0.5
    block[BUCKET + 5] = -1
    block[BUCKET * 2 + 7] = 0.25
    builder.add([block], 0, RATE)
    const peaks = builder.finish()
    expect(Array.from(peaks.values)).toEqual([128, 255, 64])
    expect(peaks.bucketMs).toBe(10)
    expect(peaks.durationMs).toBe(30)
  })

  it('takes the loudest of the channels', () => {
    const builder = new PeakBuilder()
    builder.add([steady(0.1, BUCKET), steady(-0.6, BUCKET)], 0, RATE)
    expect(Array.from(builder.finish().values)).toEqual([153])
  })

  it('puts a block where its start time says, whatever the blocks before it, and keeps the louder where blocks share a stretch', () => {
    const builder = new PeakBuilder()
    // A quiet block that ends in the middle of the first stretch, then a loud one that carries on from there.
    builder.add([steady(0.2, 200)], 0, RATE)
    builder.add([steady(0.8, BUCKET * 2)], 200 / RATE, RATE)
    const values = Array.from(builder.finish().values)
    expect(values[0]).toBe(204)
    expect(values[1]).toBe(204)
    expect(values).toHaveLength(3)
    expect(values[2]).toBe(204)
  })

  it('leaves silence where nothing arrived, and cuts the end where the sound ends', () => {
    const builder = new PeakBuilder()
    builder.add([steady(1, BUCKET)], 0.5, RATE)
    const peaks = builder.finish()
    expect(peaks.values).toHaveLength(51)
    expect(Array.from(peaks.values.slice(0, 50)).every((value) => value === 0)).toBe(true)
    expect(peaks.values[50]).toBe(255)
    expect(peaks.durationMs).toBe(510)
  })

  it('clamps a sample past full scale', () => {
    const builder = new PeakBuilder()
    builder.add([steady(3.5, BUCKET)], 0, RATE)
    expect(Array.from(builder.finish().values)).toEqual([255])
  })

  it('grows past what was expected', () => {
    const builder = new PeakBuilder(PEAK_BUCKET_MS, 100)
    builder.add([steady(0.5, RATE * 5)], 0, RATE)
    const peaks = builder.finish()
    expect(peaks.values).toHaveLength(500)
    expect(peaks.values.every((value) => value === 128)).toBe(true)
  })

  it('works at another sample rate, with blocks that do not fit the stretches', () => {
    const builder = new PeakBuilder()
    const rate = 48_000
    // Three blocks of 1000 samples each, 20.8 ms: each one reaches into the next stretch.
    for (let b = 0; b < 3; b++) builder.add([steady(0.5, 1000)], (b * 1000) / rate, rate)
    const peaks = builder.finish()
    expect(peaks.durationMs).toBe(70)
    expect(Array.from(peaks.values)).toEqual([128, 128, 128, 128, 128, 128, 128])
  })

  it('has nothing for nothing', () => {
    const builder = new PeakBuilder()
    builder.add([], 0, RATE)
    builder.add([new Float32Array(0)], 0, RATE)
    builder.add([steady(1, 100)], 0, 0)
    const peaks = builder.finish()
    expect(peaks.values).toHaveLength(0)
    expect(peaks.durationMs).toBe(0)
  })

  it('treats a start before zero as zero', () => {
    const builder = new PeakBuilder()
    builder.add([steady(0.5, BUCKET)], -0.02, RATE)
    expect(builder.finish().values[0]).toBe(128)
  })
})
