import { describe, expect, it } from 'vitest'
import { clip, type Edge, timeline } from '../engine'
import { defaultRange, rangeTarget, rangeWithin, timeSpan, type RangeEdge } from './range'
import { quantizeToFrame, snap, snapPoints, type SnapPoint, snapThresholdMs } from './snap'
import { trimHandleAt, trimTarget } from './trim'

describe('the points a drag sticks to', () => {
  const edit = timeline([clip('a', 'A', 0, 4_000), clip('b', 'A', 10_000, 3_000), clip('c', 'A', 20_000, 3_000)])

  it('are the edges of the edit, every clip edge and the playhead', () => {
    // The edit is 10 s long: clips of 4 s, 3 s and 3 s, so clip edges fall at 4 s and 7 s.
    expect(snapPoints(edit, 5_500)).toEqual([
      { timeMs: 0, kind: 'start' },
      { timeMs: 10_000, kind: 'end' },
      { timeMs: 4_000, kind: 'clipEdge' },
      { timeMs: 7_000, kind: 'clipEdge' },
      { timeMs: 5_500, kind: 'playhead' },
    ])
  })

  it('leave out a playhead outside the edit', () => {
    expect(snapPoints(edit, 99_999).filter((p) => p.kind === 'playhead')).toHaveLength(0)
    expect(snapPoints(edit, -1).filter((p) => p.kind === 'playhead')).toHaveLength(0)
  })

  it('leave out edges inside the ignored range', () => {
    const points = snapPoints(edit, 0, { startMs: 4_000, endMs: 7_000 })
    expect(points.filter((p) => p.kind === 'clipEdge')).toEqual([])
  })

  it('are chosen by the nearest within the threshold, the later one winning a tie', () => {
    const points: SnapPoint[] = [
      { timeMs: 1_000, kind: 'clipEdge' },
      { timeMs: 1_040, kind: 'clipEdge' },
      { timeMs: 2_000, kind: 'end' },
    ]
    expect(snap(1_010, points, 30)?.timeMs).toBe(1_000)
    expect(snap(1_020, points, 30)?.timeMs).toBe(1_040)
    expect(snap(1_500, points, 30)).toBeNull()
    expect(snap(2_030, points, 30)?.timeMs).toBe(2_000)
    expect(snap(2_031, points, 30)).toBeNull()
  })

  it('reach a few pixels, never more than half a second', () => {
    expect(snapThresholdMs(0.1, 8)).toBe(80)
    expect(snapThresholdMs(0.001, 8)).toBe(500)
    expect(snapThresholdMs(1, 8)).toBe(8)
  })

  it('let time fall on the nearest whole frame', () => {
    expect(quantizeToFrame(10, 30)).toBe(0)
    expect(quantizeToFrame(20, 30)).toBe(33)
    expect(quantizeToFrame(1_010, 30)).toBe(1_000)
    expect(quantizeToFrame(1_020, 60)).toBe(1_017)
    expect(quantizeToFrame(2_000, 25)).toBe(2_000)
  })
})

describe('trimming a clip by dragging its edge', () => {
  // a: 0 to 4 s from 2 s; b: 4 to 7 s from 8 s; c: 7 to 10 s from 14 s. The recording is 20 s long.
  const edit = timeline([clip('a', 'A', 2_000, 4_000), clip('b', 'A', 8_000, 3_000), clip('c', 'A', 14_000, 3_000)])
  const target = (id: string, edge: Edge, raw: number, snapping = false, playhead = 0) =>
    trimTarget(edit, id, edge, raw, 20_000, 30, snapping, 0.1, playhead)

  it('falls on a whole frame when free', () => {
    // 6.020 s is 180.6 frames at 30 fps: the nearest whole frame, 181, is at 6033 ms.
    const result = target('b', 'end', 6_020)
    expect(result?.op).toEqual({ type: 'trimClip', clipId: 'b', edge: 'end', timeMs: 6_033 })
    expect(result?.snappedTo).toBeNull()
  })

  it('sticks to a nearby point when snapping is on', () => {
    // At 0.1 px per ms, 8 px is 80 ms. The playhead at 3.9 s is 50 ms from the drag.
    const result = target('a', 'end', 3_950, true, 3_900)
    expect(result?.op.timeMs).toBe(3_900)
    expect(result?.snappedTo).toEqual({ timeMs: 3_900, kind: 'playhead' })
  })

  it('does not stick when snapping is off', () => {
    // 3.950 s is 118.5 frames, which rounds up to frame 119 at 3967 ms.
    const result = target('a', 'end', 3_950, false, 3_900)
    expect(result?.op.timeMs).toBe(3_967)
    expect(result?.snappedTo).toBeNull()
  })

  it('is not pulled by the trimmed clip’s own edges', () => {
    const result = target('a', 'end', 4_030, true, 9_000)
    expect(result?.snappedTo).toBeNull()
    expect(result?.op.timeMs).toBe(4_033)
  })

  it('treats the start and the end of the edit as magnets', () => {
    const toStart = target('a', 'start', 40, true, 8_000)
    expect(toStart?.snappedTo).toEqual({ timeMs: 0, kind: 'start' })
    expect(toStart?.op.timeMs).toBe(0)
    const toEnd = target('c', 'end', 10_020, true, 15_000)
    expect(toEnd?.snappedTo).toEqual({ timeMs: 10_000, kind: 'end' })
    expect(toEnd?.op.timeMs).toBe(10_000)
  })

  it('is held by the limits of the recording', () => {
    // c uses 14 s to 17 s of the 20 s recording, so its end can go at most 3 s later, to 13 s.
    expect(target('c', 'end', 14_000)?.op.timeMs).toBe(13_000)
    // a starts 2 s into its recording, but sits at 0 on the timeline, so its start edge is held at 0.
    expect(target('a', 'start', -1_500)?.op.timeMs).toBe(0)
  })

  it('keeps at least one frame', () => {
    expect(target('b', 'end', 4_010)?.op.timeMs).toBe(4_034)
    expect(target('b', 'start', 6_990)?.op.timeMs).toBe(6_966)
  })

  it('drops a snap that a limit moved', () => {
    const result = target('b', 'end', 40, true)
    expect(result?.op.timeMs).toBe(4_034)
    expect(result?.snappedTo).toBeNull()
  })

  it('gives nothing for a clip that is not on the timeline', () => {
    expect(target('zzz', 'end', 1_000)).toBeNull()
  })
})

describe('grabbing the edge of a clip', () => {
  const reach = 68

  it('takes a pointer on the edge', () => {
    expect(trimHandleAt(100, 100, 900, reach)).toBe('start')
    expect(trimHandleAt(900, 100, 900, reach)).toBe('end')
  })

  it('reaches the full distance outside the clip', () => {
    expect(trimHandleAt(40, 100, 900, reach)).toBe('start')
    expect(trimHandleAt(960, 100, 900, reach)).toBe('end')
    expect(trimHandleAt(30, 100, 900, reach)).toBeNull()
    expect(trimHandleAt(970, 100, 900, reach)).toBeNull()
  })

  it('lets a wide clip be grabbed as far inside as the reach', () => {
    expect(trimHandleAt(160, 100, 900, reach)).toBe('start')
    expect(trimHandleAt(170, 100, 900, reach)).toBeNull()
    expect(trimHandleAt(840, 100, 900, reach)).toBe('end')
    expect(trimHandleAt(830, 100, 900, reach)).toBeNull()
  })

  it('lets a narrow clip be grabbed only a quarter of its width inside, so its middle still scrubs', () => {
    expect(trimHandleAt(145, 100, 300, reach)).toBe('start')
    expect(trimHandleAt(160, 100, 300, reach)).toBeNull()
    expect(trimHandleAt(200, 100, 300, reach)).toBeNull()
    expect(trimHandleAt(255, 100, 300, reach)).toBe('end')
    expect(trimHandleAt(240, 100, 300, reach)).toBeNull()
  })

  it('lets a very narrow clip be grabbed from outside its edges', () => {
    expect(trimHandleAt(60, 100, 120, reach)).toBe('start')
    expect(trimHandleAt(160, 100, 120, reach)).toBe('end')
    expect(trimHandleAt(110, 100, 120, reach)).toBeNull()
  })
})

describe('the range tool', () => {
  // A 10 s edit: clips of 4 s and 6 s.
  const edit = timeline([clip('a', 'A', 0, 4_000), clip('b', 'A', 10_000, 6_000)])
  const range = timeSpan(2_000, 5_000)
  const drag = (edge: RangeEdge, raw: number, snapping = false, playhead = 0) => rangeTarget(edit, range, edge, raw, 30, snapping, 0.1, playhead)

  it('must end after it starts', () => {
    expect(() => timeSpan(5, 5)).toThrow(RangeError)
    expect(() => timeSpan(5, 4)).toThrow(RangeError)
  })

  it('starts as two seconds from the playhead, moved back from the end of the edit', () => {
    expect(defaultRange(edit, 1_000, 30)).toEqual(timeSpan(1_000, 3_000))
    expect(defaultRange(edit, 9_500, 30)).toEqual(timeSpan(8_000, 10_000))
  })

  it('covers the whole of a short edit', () => {
    expect(defaultRange(timeline([clip('a', 'A', 0, 800)]), 500, 30)).toEqual(timeSpan(0, 800))
  })

  it('has no default for an empty edit or one shorter than a frame', () => {
    expect(defaultRange(timeline(), 0, 30)).toBeNull()
    expect(defaultRange(timeline([clip('a', 'A', 0, 20)]), 0, 30)).toBeNull()
  })

  it('has edges that fall on a whole frame', () => {
    expect(drag('end', 6_020).range).toEqual(timeSpan(2_000, 6_033))
    expect(drag('start', 1_000).range).toEqual(timeSpan(1_000, 5_000))
  })

  it('has edges that stick to a clip edge, the start or the end of the edit', () => {
    const toClip = drag('end', 4_030, true)
    expect(toClip.snappedTo).toEqual({ timeMs: 4_000, kind: 'clipEdge' })
    expect(toClip.range).toEqual(timeSpan(2_000, 4_000))
    const toEnd = drag('end', 9_970, true)
    expect(toEnd.snappedTo).toEqual({ timeMs: 10_000, kind: 'end' })
    const toStart = drag('start', 40, true, 8_000)
    expect(toStart.snappedTo).toEqual({ timeMs: 0, kind: 'start' })
    expect(toStart.range.startMs).toBe(0)
  })

  it('keeps at least one frame and stays inside the edit', () => {
    // The start cannot pass the end, and the end cannot pass the start: one frame (34 ms at 30 fps) remains.
    expect(drag('start', 6_000).range).toEqual(timeSpan(4_966, 5_000))
    expect(drag('end', 1_000).range).toEqual(timeSpan(2_000, 2_034))
    expect(drag('start', -500).range.startMs).toBe(0)
    expect(drag('end', 12_000).range.endMs).toBe(10_000)
  })

  it('drops a snap that a limit moved', () => {
    const result = drag('end', 40, true)
    expect(result.range.endMs).toBe(2_034)
    expect(result.snappedTo).toBeNull()
  })

  it('is cut down when the edit gets shorter', () => {
    expect(rangeWithin(timeSpan(2_000, 5_000), 4_000, 30)).toEqual(timeSpan(2_000, 4_000))
    expect(rangeWithin(timeSpan(2_000, 5_000), 10_000, 30)).toEqual(timeSpan(2_000, 5_000))
    expect(rangeWithin(timeSpan(2_000, 5_000), 2_010, 30)).toBeNull()
    expect(rangeWithin(timeSpan(2_000, 5_000), 1_000, 30)).toBeNull()
  })
})
