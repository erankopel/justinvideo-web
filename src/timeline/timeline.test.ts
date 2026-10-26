import { describe, expect, it } from 'vitest'
import { clip, spans, timeline } from '../engine'
import { rulerLabel, rulerStepMs, rulerTicks } from './ruler'
import { cutEdges, frameIndexOf, nextCut, previousCut, steppedFrame } from './transport'
import { timeAt, viewport, xOf, zoomed, zoomLimits } from './viewport'

describe('the viewport', () => {
  it('draws the time under the playhead at the centre', () => {
    const view = viewport(0.1)
    expect(xOf(view, 3_000, 3_000, 500)).toBeCloseTo(500, 3)
    expect(xOf(view, 4_000, 3_000, 500)).toBeCloseTo(600, 3)
    expect(xOf(view, 2_000, 3_000, 500)).toBeCloseTo(400, 3)
  })

  it('maps a position back to the same time', () => {
    const view = viewport(0.25)
    for (const time of [0, 1, 999, 12_345]) expect(timeAt(view, xOf(view, time, 5_000, 360), 5_000, 360)).toBe(time)
  })

  it('keeps the zoom inside the limits', () => {
    const limits = zoomLimits(60_000, 1_000, 34, 40)
    // Out: the minute fits in 450 px, 45 percent of the width. In: a frame is 40 px.
    expect(limits.farthest).toBeCloseTo(450 / 60_000, 9)
    expect(limits.closest).toBeCloseTo(40 / 34, 9)
    expect(zoomed(viewport(0.5), 0.00001, limits).pxPerMs).toBeCloseTo(limits.farthest, 9)
    expect(zoomed(viewport(0.5), 1_000, limits).pxPerMs).toBeCloseTo(limits.closest, 9)
    expect(zoomed(viewport(0.5), 1.5, limits).pxPerMs).toBeCloseTo(0.75, 9)
  })

  it('does not stretch a very short edit across the view', () => {
    expect(zoomLimits(100, 1_000, 34, 40).farthest).toBeCloseTo(450 / 1_000, 9)
  })

  it('never lets the farthest zoom pass the closest', () => {
    const limits = zoomLimits(1_000, 100_000, 34, 20)
    expect(limits.farthest).toBeLessThanOrEqual(limits.closest)
  })

  it('refuses bad zooms', () => {
    expect(() => viewport(0)).toThrow(RangeError)
    expect(() => viewport(Number.NaN)).toThrow(RangeError)
    expect(() => zoomLimits(1_000, 0, 34, 40)).toThrow(RangeError)
  })
})

describe('the ruler', () => {
  it('grows its step as the view zooms out', () => {
    expect(rulerStepMs(100, 80)).toBe(1)
    expect(rulerStepMs(0.2, 80)).toBe(500)
    expect(rulerStepMs(0.1, 80)).toBe(1_000)
    expect(rulerStepMs(0.002, 80)).toBe(60_000)
    expect(rulerStepMs(0.0000001, 80)).toBe(3_600_000)
  })

  it('puts ticks at multiples of the step, every fifth major', () => {
    const ticks = rulerTicks(1_500, 6_500, 1_000, 10_000)
    expect(ticks.map((t) => t.timeMs)).toEqual([2_000, 3_000, 4_000, 5_000, 6_000])
    expect(ticks.map((t) => t.major)).toEqual([false, false, false, true, false])
  })

  it('stops at the end of the edit and never goes below zero', () => {
    expect(rulerTicks(-5_000, 99_000, 1_000, 3_000).map((t) => t.timeMs)).toEqual([0, 1_000, 2_000, 3_000])
    expect(rulerTicks(5_000, 9_000, 1_000, 3_000)).toEqual([])
  })

  it('refuses a zero step', () => {
    expect(() => rulerTicks(0, 1_000, 0, 1_000)).toThrow(RangeError)
  })

  it('shows fractions only when the step is under a second', () => {
    expect(rulerLabel(5_000, 1_000)).toBe('0:05')
    expect(rulerLabel(65_000, 5_000)).toBe('1:05')
    expect(rulerLabel(1_500, 500)).toBe('0:01.5')
    expect(rulerLabel(1_200, 100)).toBe('0:01.2')
    expect(rulerLabel(1_250, 50)).toBe('0:01.25')
    expect(rulerLabel(1_002, 2)).toBe('0:01.002')
    expect(rulerLabel(10, 1)).toBe('0:00.010')
  })
})

describe('moving the playhead', () => {
  const edit = spans(timeline([clip('a', 's1', 0, 4_000), clip('b', 's1', 9_000, 6_000)]))
  const edges = cutEdges(edit, 10_000)

  it('knows where the cuts are', () => {
    expect(edges).toEqual([0, 4_000, 10_000])
  })

  it('goes to the previous and the next cut', () => {
    expect(previousCut(edges, 5_000)).toBe(4_000)
    expect(previousCut(edges, 4_000)).toBe(0)
    expect(previousCut(edges, 0)).toBe(0)
    expect(nextCut(edges, 0, 10_000)).toBe(4_000)
    expect(nextCut(edges, 4_000, 10_000)).toBe(10_000)
    expect(nextCut(edges, 10_000, 10_000)).toBe(10_000)
  })

  it('steps a frame at a time and stays inside the edit', () => {
    expect(steppedFrame(0, 30, 1, 10_000)).toBe(33)
    expect(steppedFrame(33, 30, 1, 10_000)).toBe(67)
    expect(steppedFrame(33, 30, -1, 10_000)).toBe(0)
    expect(steppedFrame(0, 30, -1, 10_000)).toBe(0)
    expect(steppedFrame(10_000, 30, 1, 10_000)).toBe(10_000)
    expect(frameIndexOf(1_000, 30)).toBe(30)
  })
})
