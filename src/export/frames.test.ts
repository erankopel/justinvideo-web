import { describe, expect, it } from 'vitest'
import { FrameRetimer } from './frames'

/** The 25 fps frames of a recording from timestamp 0, as [timestamp, duration]. */
const frames = (count: number, fps: number, from = 0): [number, number][] => Array.from({ length: count }, (_, i) => [from + i / fps, 1 / fps])

const placeAll = (retimer: FrameRetimer, list: [number, number][]) => list.map(([t, d]) => retimer.place(t, d)).filter((p) => p !== null)

describe('FrameRetimer', () => {
  it('keeps every frame of a piece that starts the recording, at its own spacing', () => {
    const placed = placeAll(new FrameRetimer(0, 2, 0), frames(50, 25))
    expect(placed).toHaveLength(50)
    expect(placed[0]).toEqual({ timestamp: 0, duration: 0.04 })
    expect(placed[49]?.timestamp).toBeCloseTo(1.96, 6)
    expect(placed[49]?.duration).toBeCloseTo(0.04, 6)
  })

  it('moves a later piece to where it goes on the export clock', () => {
    const placed = placeAll(new FrameRetimer(10, 11, 4), frames(25, 25, 10))
    expect(placed).toHaveLength(25)
    expect(placed[0]?.timestamp).toBe(4)
    expect(placed[24]?.timestamp).toBeCloseTo(4.96, 6)
  })

  it('shows the frame that was on screen at the start of the piece, from the start of the piece', () => {
    // The frames are every 0.04 s; the piece starts at 0.05, in the middle of the frame at 0.04.
    const placed = placeAll(new FrameRetimer(0.05, 0.25, 1), frames(8, 25, 0.04))
    expect(placed[0]?.timestamp).toBe(1)
    expect(placed[0]?.duration).toBeCloseTo(0.03, 6)
    expect(placed[1]?.timestamp).toBeCloseTo(1 + (0.08 - 0.05), 6)
  })

  it('cuts the last frame off where the piece ends and drops frames after it', () => {
    const placed = placeAll(new FrameRetimer(0, 0.1, 0), frames(5, 25))
    expect(placed).toHaveLength(3)
    expect(placed[2]?.timestamp).toBeCloseTo(0.08, 6)
    expect(placed[2]?.duration).toBeCloseTo(0.02, 6)
  })

  it('leaves no gap and no overlap between one piece and the next', () => {
    const a = placeAll(new FrameRetimer(0, 1, 0), frames(30, 30))
    const b = placeAll(new FrameRetimer(5, 6, 1), frames(30, 30, 5))
    const last = a[a.length - 1]!
    expect(last.timestamp + last.duration).toBeCloseTo(1, 6)
    expect(b[0]?.timestamp).toBe(1)
  })

  it('puts the first frame at the start of the piece even when the recording starts a little later', () => {
    const placed = placeAll(new FrameRetimer(0, 1, 0), frames(10, 30, 0.1))
    expect(placed[0]?.timestamp).toBe(0)
  })

  it('thins a faster recording to the export rate, taking every other frame from 60 to 30', () => {
    const placed = placeAll(new FrameRetimer(0, 1, 0, 30), frames(60, 60))
    expect(placed).toHaveLength(30)
    expect(placed[1]?.timestamp).toBeCloseTo(1 / 30, 6)
    expect(placed.every((p) => Math.abs(p.duration - 1 / 30) < 1e-9)).toBe(true)
  })

  it('does not drop frames that jitter a little, and drops none from a slower recording', () => {
    const jittered = frames(30, 30).map(([t, d], i): [number, number] => [t + (i % 2 === 0 ? 0 : -0.0015), d])
    expect(placeAll(new FrameRetimer(0, 1, 0, 30), jittered)).toHaveLength(30)
    expect(placeAll(new FrameRetimer(0, 1, 0, 60), frames(30, 30))).toHaveLength(30)
  })

  it('gives a frame with no duration a short one rather than none', () => {
    expect(new FrameRetimer(0, 1, 0).place(0, 0)?.duration).toBeGreaterThan(0)
  })
})
