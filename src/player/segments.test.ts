import { describe, expect, it } from 'vitest'
import { clip, spans, timeline } from '../engine'
import { buildSegments, editTimeMs, locate, sourceTimeMs } from './segments'

const segmentsOf = (...clips: ReturnType<typeof clip>[]) => buildSegments(spans(timeline(clips)))

describe('the segments of an edit', () => {
  it('makes one segment of clips that continue each other, such as the halves of a split', () => {
    const result = segmentsOf(clip('a', 's1', 0, 2_000), clip('b', 's1', 2_000, 3_000))
    expect(result).toEqual([{ sourceId: 's1', sourceStartMs: 0, startMs: 0, endMs: 5_000, volumePercent: 100 }])
  })

  it('keeps clips apart that do not continue, or are of another recording, or differ in volume', () => {
    expect(segmentsOf(clip('a', 's1', 0, 2_000), clip('b', 's1', 2_001, 1_000))).toHaveLength(2)
    expect(segmentsOf(clip('a', 's1', 0, 2_000), clip('b', 's2', 2_000, 1_000))).toHaveLength(2)
    expect(segmentsOf(clip('a', 's1', 0, 2_000, 50), clip('b', 's1', 2_000, 1_000, 100))).toHaveLength(2)
    expect(segmentsOf(clip('a', 's1', 0, 2_000, 50), clip('b', 's1', 2_000, 1_000, 50))).toHaveLength(1)
  })

  it('joins a run of clips, and starts a new segment at the first jump', () => {
    const result = segmentsOf(clip('a', 's1', 0, 1_000), clip('b', 's1', 1_000, 1_000), clip('c', 's1', 5_000, 1_000), clip('d', 's1', 6_000, 1_000))
    expect(result.map((s) => [s.startMs, s.endMs, s.sourceStartMs])).toEqual([[0, 2_000, 0], [2_000, 4_000, 5_000]])
  })

  it('has none for an empty edit', () => {
    expect(buildSegments([])).toEqual([])
    expect(locate([], 0)).toBeNull()
  })
})

describe('finding a place in the edit', () => {
  const segments = segmentsOf(clip('a', 's1', 1_000, 2_000), clip('b', 's2', 500, 3_000))

  it('finds the segment under a time and the offset in it', () => {
    expect(locate(segments, 0)).toEqual({ index: 0, offsetMs: 0 })
    expect(locate(segments, 1_999)).toEqual({ index: 0, offsetMs: 1_999 })
    expect(locate(segments, 2_000)).toEqual({ index: 1, offsetMs: 0 })
    expect(locate(segments, 3_500)).toEqual({ index: 1, offsetMs: 1_500 })
  })

  it('keeps the end of the edit on its last frame, and a time before the start on the first', () => {
    expect(locate(segments, 5_000)).toEqual({ index: 1, offsetMs: 2_999 })
    expect(locate(segments, 99_000)).toEqual({ index: 1, offsetMs: 2_999 })
    expect(locate(segments, -50)).toEqual({ index: 0, offsetMs: 0 })
  })

  it('maps between edit time and recording time', () => {
    const second = segments[1]!
    expect(sourceTimeMs(second, 1_500)).toBe(2_000)
    expect(editTimeMs(second, 2_000)).toBe(3_500)
  })
})
