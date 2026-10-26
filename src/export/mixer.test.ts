import { describe, expect, it } from 'vitest'
import { GainEnvelope } from '../engine/audio'
import { type DecodedAudio, EXPORT_RATE } from './mix'
import { type AudioReader, frameCountOf, mixBlocks } from './mixer'
import { type SoundLayer } from './plan'

const unity = new GainEnvelope(1)

/** A reader over a made-up file: a steady value, or a tone, that records what it was asked for. */
class FakeReader implements AudioReader {
  reads: [number, number][] = []
  closed = false
  constructor(private readonly value: number, readonly rate = EXPORT_RATE) {}
  async read(fromS: number, toS: number): Promise<DecodedAudio> {
    this.reads.push([fromS, toS])
    const length = Math.ceil((toS - fromS) * this.rate) + 2
    return { channels: [new Float32Array(length).fill(this.value)], startS: fromS, rate: this.rate }
  }
  close(): void {
    this.closed = true
  }
}

const layerOf = (id: string, over: Partial<SoundLayer> = {}): SoundLayer => ({
  file: { kind: 'source', id },
  startMs: 0,
  endMs: 3000,
  fileStartMs: 0,
  envelope: unity,
  ...over,
})

async function collect(blocks: AsyncGenerator<{ startFrame: number; left: Float32Array; right: Float32Array }>): Promise<{ startFrame: number; left: Float32Array }[]> {
  const out: { startFrame: number; left: Float32Array }[] = []
  for await (const block of blocks) out.push({ startFrame: block.startFrame, left: block.left })
  return out
}

describe('mixBlocks', () => {
  it('covers the whole edit in blocks of a second, the last one shorter', async () => {
    const reader = new FakeReader(0.5)
    const blocks = await collect(mixBlocks({ layers: [layerOf('a', { endMs: 2500 })], master: unity, durationMs: 2500, openReader: async () => reader }))
    expect(blocks.map((b) => [b.startFrame, b.left.length])).toEqual([[0, 48_000], [48_000, 48_000], [96_000, 24_000]])
    expect(blocks[0]?.left[10]).toBeCloseTo(0.5, 6)
    expect(frameCountOf(2500)).toBe(120_000)
  })

  it('opens a file once for all of its layers, reads only what each block needs, and closes it after its last layer', async () => {
    const readers: FakeReader[] = []
    const layers = [layerOf('a', { endMs: 1000 }), layerOf('a', { startMs: 1000, endMs: 2000, fileStartMs: 5000 })]
    await collect(mixBlocks({ layers, master: unity, durationMs: 3000, openReader: async () => (readers.push(new FakeReader(0.1)), readers[0]!) }))
    expect(readers).toHaveLength(1)
    const reads = readers[0]!.reads
    expect(reads).toHaveLength(2)
    // The first layer reads its first second; the second reads from 5 s of the file, a second long.
    expect(reads[0]?.[0]).toBe(0)
    expect(reads[0]?.[1]).toBeCloseTo(1.05, 6)
    expect(reads[1]?.[0]).toBeCloseTo(4.95, 6)
    expect(reads[1]?.[1]).toBeCloseTo(6.05, 6)
    expect(readers[0]?.closed).toBe(true)
  })

  it('never reads the file of a layer that adds nothing, or that is not playing yet', async () => {
    const quiet = new FakeReader(0.9)
    const late = new FakeReader(0.9)
    const layers = [layerOf('q', { envelope: new GainEnvelope(0) }), layerOf('l', { startMs: 5000, endMs: 6000 })]
    const opened: string[] = []
    await collect(mixBlocks({
      layers,
      master: unity,
      durationMs: 3000,
      openReader: async (layer) => (opened.push(layer.file.id), layer.file.id === 'q' ? quiet : late),
    }))
    expect(opened).toEqual([])
    expect(quiet.reads).toEqual([])
  })

  it('applies the layer envelope and the fades over the whole edit', async () => {
    const reader = new FakeReader(0.8)
    const layers = [layerOf('a', { envelope: new GainEnvelope(0.5) })]
    const blocks = await collect(mixBlocks({ layers, master: new GainEnvelope(1, 1000, 0, 3000), durationMs: 3000, openReader: async () => reader }))
    expect(blocks[0]?.left[0]).toBeCloseTo(0, 6)
    expect(blocks[0]?.left[24_000]).toBeCloseTo(0.2, 3)
    expect(blocks[1]?.left[0]).toBeCloseTo(0.4, 3)
  })

  it('stops when it is cancelled, and lets go of its files', async () => {
    const reader = new FakeReader(0.5)
    const controller = new AbortController()
    const blocks = mixBlocks({ layers: [layerOf('a')], master: unity, durationMs: 3000, openReader: async () => reader, signal: controller.signal })
    await blocks.next()
    controller.abort()
    await expect(blocks.next()).rejects.toMatchObject({ name: 'AbortError' })
    expect(reader.closed).toBe(true)
  })

  it('is silence for an edit with no sound layers', async () => {
    const blocks = await collect(mixBlocks({ layers: [], master: unity, durationMs: 1000, openReader: async () => new FakeReader(0) }))
    expect(blocks).toHaveLength(1)
    expect(Math.max(...blocks[0]!.left)).toBe(0)
  })
})
