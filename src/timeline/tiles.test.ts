import { describe, expect, it } from 'vitest'
import { frameStepMs, seenAspect, STRIP_PX, tilesOf, tileWidthPx } from './tiles'

describe('tileWidthPx', () => {
  it('follows the shape of the recording, within limits', () => {
    expect(tileWidthPx(16 / 9)).toBe(Math.round((STRIP_PX * 16) / 9))
    expect(tileWidthPx(1)).toBe(STRIP_PX)
    expect(tileWidthPx(9 / 16)).toBe(Math.round((STRIP_PX * 9) / 16))
    expect(tileWidthPx(0.1)).toBe(24)
    expect(tileWidthPx(10)).toBe(160)
  })

  it('takes a wide shape for one that is not a number', () => {
    expect(tileWidthPx(Number.NaN)).toBe(tileWidthPx(16 / 9))
    expect(tileWidthPx(0)).toBe(tileWidthPx(16 / 9))
  })
})

describe('seenAspect', () => {
  it('turns the shape with a quarter turn', () => {
    expect(seenAspect(320, 180, 0)).toBeCloseTo(16 / 9)
    expect(seenAspect(320, 180, 180)).toBeCloseTo(16 / 9)
    expect(seenAspect(320, 180, 90)).toBeCloseTo(9 / 16)
    expect(seenAspect(320, 180, 270)).toBeCloseTo(9 / 16)
    expect(seenAspect(0, 0, 0)).toBeCloseTo(16 / 9)
  })
})

describe('frameStepMs', () => {
  it('is the largest tenth of a second times a power of two that a tile outlasts', () => {
    expect(frameStepMs(0)).toBe(100)
    expect(frameStepMs(99)).toBe(100)
    expect(frameStepMs(100)).toBe(100)
    expect(frameStepMs(199)).toBe(100)
    expect(frameStepMs(200)).toBe(200)
    expect(frameStepMs(1_000)).toBe(800)
    expect(frameStepMs(1_600)).toBe(1_600)
    expect(frameStepMs(Number.NaN)).toBe(100)
  })
})

describe('tilesOf', () => {
  // A 10 s clip from 4 s into its recording, at 100 px a second, in tiles 100 px wide: one a second, so the frames kept
  // are 800 ms apart.
  const clip = { clipLeft: 0, originX: 0, drawnWidth: 1_000, pxPerMs: 0.1, tileWidth: 100, sourceStartMs: 4_000, durationMs: 10_000 }

  it('covers the clip from its start, each tile showing the middle of its stretch', () => {
    const tiles = tilesOf(clip)
    expect(tiles).toHaveLength(10)
    // The middle of the first second is 4.5 s, and the nearest kept frame is at 4.8 s; for the last, 13.5 s and 13.6 s.
    expect(tiles[0]).toEqual({ x: 0, width: 100, timeMs: 4_800 })
    expect(tiles[9]).toEqual({ x: 900, width: 100, timeMs: 13_600 })
    for (const tile of tiles) expect(tile.timeMs % 800).toBe(0)
    expect(tiles.map((tile) => tile.x)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900])
  })

  it('draws only the part that is near the view, and keeps the tiles where they are on the clip', () => {
    const whole = tilesOf(clip)
    const part = tilesOf({ ...clip, originX: 350, drawnWidth: 300 })
    expect(part.map((tile) => tile.timeMs)).toEqual(whole.slice(3, 7).map((tile) => tile.timeMs))
    expect(part.map((tile) => tile.x)).toEqual([-50, 50, 150, 250])
  })

  it('works for a clip that starts far outside the view', () => {
    // Over before the view: nothing of it is drawn. Ahead of the view: the same.
    expect(tilesOf({ ...clip, clipLeft: -50_000, originX: -64, drawnWidth: 1_128 })).toEqual([])
    expect(tilesOf({ ...clip, clipLeft: 50_000, originX: -64, drawnWidth: 1_128 })).toEqual([])
    // Half of it before the view: the tiles that are drawn start at the one that crosses the left edge and end with the clip.
    const near = tilesOf({ ...clip, clipLeft: -500, originX: -63, drawnWidth: 1_128 })
    expect(near[0]?.x).toBe(-37)
    const end = near[near.length - 1]
    expect((end?.x ?? 0) + (end?.width ?? 0)).toBe(563)
  })

  it('never shows a moment outside the clip', () => {
    // A short clip: the first tile is wider than the clip.
    const short = tilesOf({ ...clip, durationMs: 250, sourceStartMs: 1_030 })
    expect(short).toHaveLength(1)
    expect(short[0]?.timeMs).toBeGreaterThanOrEqual(1_030)
    expect(short[0]?.timeMs).toBeLessThanOrEqual(1_030 + 249)
    for (const sourceStartMs of [0, 17, 999, 1_234]) {
      for (const durationMs of [16, 40, 333, 2_000]) {
        for (const pxPerMs of [0.01, 0.1, 1, 5]) {
          for (const tile of tilesOf({ ...clip, sourceStartMs, durationMs, pxPerMs, drawnWidth: 100_000 })) {
            expect(tile.timeMs).toBeGreaterThanOrEqual(sourceStartMs)
            expect(tile.timeMs).toBeLessThanOrEqual(sourceStartMs + durationMs - 1)
          }
        }
      }
    }
  })

  it('asks for frames on the grid, so the same frames serve neighbouring zooms', () => {
    // Tiles of 400 ms: the grid is 200 ms.
    const tiles = tilesOf({ ...clip, pxPerMs: 0.25, sourceStartMs: 0, durationMs: 4_000, drawnWidth: 1_000 })
    for (const tile of tiles.slice(1, -1)) expect(tile.timeMs % 200).toBe(0)
  })

  it('has nothing to draw for a clip with no extent', () => {
    expect(tilesOf({ ...clip, durationMs: 0 })).toEqual([])
    expect(tilesOf({ ...clip, pxPerMs: 0 })).toEqual([])
    expect(tilesOf({ ...clip, drawnWidth: 0 })).toEqual([])
  })

  it('has tiles that meet with no gap or overlap, whatever the offset', () => {
    const tiles = tilesOf({ ...clip, clipLeft: 13.37, originX: 1.2 })
    for (let i = 1; i < tiles.length; i++) expect((tiles[i - 1]?.x ?? 0) + (tiles[i - 1]?.width ?? 0)).toBe(tiles[i]?.x)
  })
})
