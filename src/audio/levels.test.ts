import { describe, expect, it } from 'vitest'
import { audioItem, audioMix } from '../engine/audio'
import { ITEM_LOOKAHEAD_MS, levelsAt, samePlayedSound, wantedItems } from './levels'

const song = audioItem({ id: 'a1', kind: 'music', file: 'media/song.mp3', displayName: 'Song', fileDurationMs: 60_000, startMs: 4_000, lengthMs: 10_000, trimStartMs: 2_000 })

describe('wantedItems', () => {
  const mix = audioMix([song])

  it('wants a piece from a little before it starts until it ends', () => {
    expect(wantedItems(mix, 4_000 - ITEM_LOOKAHEAD_MS - 1)).toEqual([])
    expect(wantedItems(mix, 4_000 - ITEM_LOOKAHEAD_MS)).toEqual([song])
    expect(wantedItems(mix, 13_999)).toEqual([song])
    expect(wantedItems(mix, 14_000)).toEqual([])
  })
})

describe('levelsAt', () => {
  it('is the clip volume of the recording, and nothing else for a plain edit', () => {
    expect(levelsAt(100, audioMix(), 500, 3_000)).toEqual({ clip: 1, items: [] })
    expect(levelsAt(50, audioMix(), 500, 3_000).clip).toBe(0.5)
    expect(levelsAt(0, audioMix(), 500, 3_000).clip).toBe(0)
    expect(levelsAt(200, audioMix(), 500, 3_000).clip).toBe(2)
  })

  it('puts a piece in its file where the playhead is in the piece, after the skipped start', () => {
    const [level] = levelsAt(100, audioMix([song]), 6_500, 20_000).items
    expect(level).toMatchObject({ inside: true, pieceMs: 2_500, fileMs: 4_500, gain: 1 })
  })

  it('keeps a piece that has not started waiting, silent, at its first moment', () => {
    const [level] = levelsAt(100, audioMix([song]), 3_000, 20_000).items
    expect(level).toMatchObject({ inside: false, pieceMs: 0, fileMs: 2_000, gain: 0 })
  })

  it('applies the volume and the fades of a piece', () => {
    const faded = { ...song, volumePercent: 150, fadeInMs: 2_000, fadeOutMs: 4_000 }
    const gainAt = (editMs: number): number | undefined => levelsAt(100, audioMix([faded]), editMs, 20_000).items[0]?.gain
    expect(gainAt(4_000)).toBe(0)
    expect(gainAt(5_000)).toBeCloseTo(0.75)
    expect(gainAt(6_000)).toBeCloseTo(1.5)
    expect(gainAt(10_000)).toBeCloseTo(1.5)
    expect(gainAt(12_000)).toBeCloseTo(0.75)
    expect(gainAt(13_999)).toBeCloseTo(0, 2)
  })

  it('applies the fades over the whole edit to the clip and to every piece', () => {
    const mix = audioMix([song], 1_000, 2_000)
    expect(levelsAt(100, mix, 0, 20_000).clip).toBe(0)
    expect(levelsAt(100, mix, 500, 20_000).clip).toBeCloseTo(0.5)
    expect(levelsAt(100, mix, 10_000, 20_000).clip).toBe(1)
    expect(levelsAt(100, mix, 19_000, 20_000).clip).toBeCloseTo(0.5)
    expect(levelsAt(100, mix, 6_000, 20_000).items[0]?.gain).toBe(1)
    const late = { ...song, startMs: 17_000, lengthMs: 3_000, trimStartMs: 0 }
    expect(levelsAt(100, audioMix([late], 0, 2_000), 19_000, 20_000).items[0]?.gain).toBeCloseTo(0.5)
  })

  it('multiplies a clip above the original loudness by the master fade', () => {
    expect(levelsAt(150, audioMix([], 1_000, 0), 500, 5_000).clip).toBeCloseTo(0.75)
  })
})

describe('samePlayedSound', () => {
  it('ignores what does not change the sound that is played', () => {
    expect(samePlayedSound(song, { ...song, startMs: 9_000, volumePercent: 30, fadeInMs: 500 })).toBe(true)
    expect(samePlayedSound(song, { ...song, trimStartMs: 2_500 })).toBe(false)
    expect(samePlayedSound(song, { ...song, lengthMs: 9_500 })).toBe(false)
    expect(samePlayedSound(song, { ...song, file: 'media/other.mp3' })).toBe(false)
  })
})
