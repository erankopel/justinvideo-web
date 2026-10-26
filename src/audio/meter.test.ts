import { afterEach, describe, expect, it, vi } from 'vitest'
import { FALL_PER_SECOND, FLOOR_DB, InputMeter, levelOf, smoothed } from './meter'

const sine = (amplitude: number, length = 1024): Float32Array => Float32Array.from({ length }, (_, i) => amplitude * Math.sin((2 * Math.PI * 440 * i) / 48_000))

describe('levelOf', () => {
  it('is nothing for silence, and for nothing', () => {
    expect(levelOf(new Float32Array(1024))).toBe(0)
    expect(levelOf(new Float32Array(0))).toBe(0)
  })

  it('is near the top for a full scale tone, and follows the decibels down', () => {
    // A sine of full scale has a root mean square of 0.707, which is 3 dB below full scale.
    expect(levelOf(sine(1, 4800))).toBeCloseTo((-3.01 - FLOOR_DB) / -FLOOR_DB, 2)
    // Each 20 dB less is a third of the scale less.
    expect(levelOf(sine(0.1, 4800))).toBeCloseTo((-23.01 - FLOOR_DB) / -FLOOR_DB, 2)
    expect(levelOf(sine(0.01, 4800))).toBeCloseTo((-43.01 - FLOOR_DB) / -FLOOR_DB, 2)
  })

  it('is the bottom of the scale for what is too quiet to show, and never goes past the top', () => {
    expect(levelOf(sine(0.0001, 4800))).toBe(0)
    expect(levelOf(new Float32Array(100).fill(5))).toBe(1)
  })

  it('measures a steady value as loud as its size, since every sample counts', () => {
    expect(levelOf(new Float32Array(100).fill(0.5))).toBeCloseTo((20 * Math.log10(0.5) - FLOOR_DB) / -FLOOR_DB, 5)
  })
})

describe('smoothed', () => {
  it('rises at once to a louder moment', () => {
    expect(smoothed(0.2, 0.9, 16)).toBe(0.9)
  })

  it('falls back at a steady rate, and not past the level that there is', () => {
    expect(smoothed(0.9, 0.1, 100)).toBeCloseTo(0.9 - FALL_PER_SECOND * 0.1, 5)
    expect(smoothed(0.5, 0.45, 1000)).toBe(0.45)
    expect(smoothed(0.9, 0.9, 16)).toBe(0.9)
  })

  it('does not move backwards in time', () => {
    expect(smoothed(0.8, 0.1, -50)).toBe(0.8)
  })
})

/** An audio engine that is in the state the test says, and whose analyser gives the samples the test says. */
function engine(state: 'running' | 'suspended', samples: Float32Array = sine(0.5)): { closed: boolean } {
  const record = { closed: false }
  class FakeContext {
    state = state
    createAnalyser(): { fftSize: number; getFloatTimeDomainData(into: Float32Array): void } {
      return {
        fftSize: 1024,
        getFloatTimeDomainData: (into) => into.set(samples.subarray(0, into.length)),
      }
    }
    createMediaStreamSource(): { connect(): void } {
      return { connect: () => undefined }
    }
    async resume(): Promise<void> {}
    async close(): Promise<void> {
      record.closed = true
    }
  }
  vi.stubGlobal('AudioContext', FakeContext)
  return record
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('InputMeter', () => {
  const stream = {} as MediaStream

  it('measures the sound that the audio engine hears', () => {
    engine('running')
    const meter = new InputMeter(stream)
    expect(meter.level()).toBeCloseTo(levelOf(sine(0.5)), 5)
    expect(meter.unavailable).toBe(false)
  })

  it('has no level where the audio engine does not run, and says so once it has had its chance', () => {
    vi.useFakeTimers()
    engine('suspended')
    const meter = new InputMeter(stream)
    expect(meter.level()).toBeNull()
    // Not yet: the engine may still be starting.
    expect(meter.unavailable).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(meter.unavailable).toBe(true)
  })

  it('has no level, and is unavailable, where there is no audio engine at all', () => {
    vi.stubGlobal('AudioContext', undefined)
    const meter = new InputMeter(stream)
    expect(meter.level()).toBeNull()
    expect(meter.unavailable).toBe(true)
  })

  it('lets go of the audio engine when it is closed, and has no level after', () => {
    const record = engine('running')
    const meter = new InputMeter(stream)
    meter.close()
    expect(record.closed).toBe(true)
    expect(meter.level()).toBeNull()
    expect(meter.unavailable).toBe(true)
  })
})
