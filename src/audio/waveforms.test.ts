import { describe, expect, it, vi } from 'vitest'
import type { Peaks } from './peaks'
import { Waveforms } from './waveforms'

const levels = (label: number): Peaks => ({ bucketMs: 10, values: new Uint8Array([label]), durationMs: 10 })

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('Waveforms', () => {
  it('reads each file once, in the order of the list, and keeps what it read', async () => {
    const read = vi.fn(async (file: string, _durationMs: number, _signal: AbortSignal) => levels(file.length))
    const waves = new Waveforms(read)
    const changed = vi.fn()
    waves.subscribe(changed)
    waves.want([
      { file: 'a.wav', durationMs: 1000 },
      { file: 'bb.wav', durationMs: 2000 },
      { file: 'a.wav', durationMs: 1000 },
    ])
    await settle()
    expect(read.mock.calls.map((call) => call[0])).toEqual(['a.wav', 'bb.wav'])
    expect(read.mock.calls[1]?.[1]).toBe(2000)
    expect(waves.get('a.wav')?.values[0]).toBe(5)
    expect(waves.get('bb.wav')?.values[0]).toBe(6)
    expect(waves.get('c.wav')).toBeUndefined()
    expect(changed).toHaveBeenCalledTimes(2)
    expect(waves.revision).toBe(2)
    waves.want([{ file: 'a.wav', durationMs: 1000 }])
    await settle()
    expect(read).toHaveBeenCalledTimes(2)
    waves.dispose()
  })

  it('reads one file at a time, and lets go of what a later call no longer wants', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const read = vi.fn(async (file: string, _durationMs: number, _signal: AbortSignal) => {
      if (file === 'a') await gate
      return levels(1)
    })
    const waves = new Waveforms(read)
    waves.want(['a', 'b', 'c'].map((file) => ({ file, durationMs: 1 })))
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    waves.want(['d', 'c'].map((file) => ({ file, durationMs: 1 })))
    release()
    await settle()
    expect(read.mock.calls.map((call) => call[0])).toEqual(['a', 'd', 'c'])
    expect(waves.get('b')).toBeUndefined()
    waves.dispose()
  })

  it('leaves a file that cannot be read without a waveform, never asks for it again, and carries on', async () => {
    const read = vi.fn(async (file: string, _durationMs: number, _signal: AbortSignal) => {
      if (file === 'bad') throw new Error('cannot decode')
      return levels(1)
    })
    const waves = new Waveforms(read)
    waves.want(['bad', 'good'].map((file) => ({ file, durationMs: 1 })))
    await settle()
    waves.want(['bad'].map((file) => ({ file, durationMs: 1 })))
    await settle()
    expect(read.mock.calls.map((call) => call[0])).toEqual(['bad', 'good'])
    expect(waves.get('bad')).toBeUndefined()
    expect(waves.get('good')).toBeDefined()
    waves.dispose()
  })

  it('tells the file being read, when it is disposed, that it is no longer needed', async () => {
    let signal: AbortSignal | undefined
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const read = vi.fn(async (_file: string, _durationMs: number, given: AbortSignal) => {
      signal = given
      await gate
      return levels(1)
    })
    const waves = new Waveforms(read)
    const changed = vi.fn()
    waves.subscribe(changed)
    waves.want([{ file: 'a', durationMs: 1 }])
    await settle()
    expect(signal?.aborted).toBe(false)
    waves.dispose()
    expect(signal?.aborted).toBe(true)
    release()
    await settle()
    expect(changed).not.toHaveBeenCalled()
    expect(waves.get('a')).toBeUndefined()
  })

  it('does nothing after it is disposed', async () => {
    const read = vi.fn(async (_file: string, _durationMs: number, _signal: AbortSignal) => levels(1))
    const waves = new Waveforms(read)
    const changed = vi.fn()
    waves.subscribe(changed)
    waves.want([{ file: 'a', durationMs: 1 }])
    waves.dispose()
    await settle()
    waves.want([{ file: 'b', durationMs: 1 }])
    await settle()
    expect(changed).not.toHaveBeenCalled()
    expect(waves.get('a')).toBeUndefined()
    expect(read.mock.calls.map((call) => call[0])).not.toContain('b')
  })
})
