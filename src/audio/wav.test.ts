import { describe, expect, it } from 'vitest'
import { encodeWav, peakInt16, toInt16, toMono } from './wav'

const read = async (blob: Blob): Promise<DataView> => new DataView(await blob.arrayBuffer())
const ascii = (view: DataView, at: number, length: number): string => String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(at + i)))

describe('encodeWav', () => {
  it('writes a mono 16-bit PCM file with the right header', async () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 44_100)
    expect(wav.type).toBe('audio/wav')
    const view = await read(wav)
    expect(wav.size).toBe(44 + 8)
    expect(ascii(view, 0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + 8)
    expect(ascii(view, 8, 8)).toBe('WAVEfmt ')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(44_100)
    expect(view.getUint32(28, true)).toBe(88_200)
    expect(view.getUint16(34, true)).toBe(16)
    expect(ascii(view, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(8)
  })

  it('stores the samples, cutting those that are too loud', async () => {
    const view = await read(encodeWav(new Float32Array([0, 0.5, -0.5, 1, 3, -3]), 8_000))
    const samples = [0, 1, 2, 3, 4, 5].map((i) => view.getInt16(44 + i * 2, true))
    expect(samples).toEqual([0, 16384, -16384, 32767, 32767, -32767])
  })

  it('writes an empty file for no samples', async () => {
    const wav = encodeWav(new Float32Array(0), 44_100)
    expect(wav.size).toBe(44)
    expect((await read(wav)).getUint32(40, true)).toBe(0)
  })
})

describe('peakInt16', () => {
  it('is zero only for exact silence, even a very quiet sound counts', () => {
    expect(peakInt16(new Float32Array(100))).toBe(0)
    expect(peakInt16(new Float32Array([0, 0.00001, 0]))).toBe(0)
    expect(peakInt16(new Float32Array([0, 0.0001, 0]))).toBe(3)
    expect(peakInt16(new Float32Array([0, -0.5, 0.25]))).toBe(16384)
  })
})

describe('toInt16', () => {
  it('rounds and clamps', () => {
    expect(toInt16(1.5)).toBe(32767)
    expect(toInt16(-1.5)).toBe(-32767)
    expect(toInt16(0.5)).toBe(16384)
  })
})

describe('toMono', () => {
  it('keeps one channel and averages two', () => {
    const left = new Float32Array([1, 0, 0.5])
    expect(toMono([left])).toBe(left)
    expect(Array.from(toMono([left, new Float32Array([0, 1, 0.5])]))).toEqual([0.5, 0.5, 0.5])
    expect(toMono([]).length).toBe(0)
  })
})
