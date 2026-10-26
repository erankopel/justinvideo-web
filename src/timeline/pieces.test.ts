import { describe, expect, it } from 'vitest'
import { audioItem, MIN_AUDIO_ITEM_MS } from '../engine/audio'
import { onOutput, textItem } from '../engine/text'
import { clip, timeline as makeTimeline } from '../engine'
import { type PieceDrag, pieceTarget, type TitleDrag, titleTarget } from './pieces'

// Three seconds in three clips of a second: cuts at 1000 and 2000.
const edit = makeTimeline([clip('a', 's', 0, 1_000), clip('b', 's', 0, 1_000), clip('c', 's', 0, 1_000)])
const piece = (startMs: number, lengthMs: number, id = 'p') =>
  audioItem({ id, kind: 'music', file: `${id}.wav`, displayName: id, fileDurationMs: 10_000, startMs, lengthMs })

const drag = (overrides: Partial<PieceDrag> & Pick<PieceDrag, 'rawStartMs'>): PieceDrag => ({
  item: piece(500, 800),
  others: [],
  timeline: edit,
  playheadMs: 1_500,
  snapping: true,
  // 0.1 px a millisecond: 8 px is 80 ms.
  pxPerMs: 0.1,
  ...overrides,
})

describe('pieceTarget', () => {
  it('puts the piece where the pointer puts it, in whole milliseconds, keeping its length and everything else', () => {
    const target = pieceTarget(drag({ rawStartMs: 612.4, snapping: false }))
    expect(target.item).toEqual({ ...piece(500, 800), startMs: 612 })
    expect(target.snappedTo).toBeNull()
  })

  it('hands back the very same piece when it has not moved', () => {
    const item = piece(500, 800)
    expect(pieceTarget(drag({ item, rawStartMs: 500, snapping: false })).item).toBe(item)
  })

  it('cannot go before the start of the edit', () => {
    expect(pieceTarget(drag({ rawStartMs: -2_000, snapping: false })).item.startMs).toBe(0)
  })

  it('cannot be lost past the end of the edit: a sliver of it stays inside', () => {
    expect(pieceTarget(drag({ rawStartMs: 50_000, snapping: false })).item.startMs).toBe(3_000 - MIN_AUDIO_ITEM_MS)
  })

  it('sticks its start to a cut that is near, and says what it stuck to', () => {
    const target = pieceTarget(drag({ rawStartMs: 1_040 }))
    expect(target.item.startMs).toBe(1_000)
    expect(target.snappedTo).toEqual({ timeMs: 1_000, kind: 'clipEdge' })
  })

  it('sticks its end to the playhead, moving the piece so that it ends there', () => {
    // The piece is 800 ms long: raw start 690 ends at 1490, 10 ms short of the playhead at 1500.
    const target = pieceTarget(drag({ rawStartMs: 690 }))
    expect(target.item.startMs).toBe(700)
    expect(target.snappedTo).toEqual({ timeMs: 1_500, kind: 'playhead' })
  })

  it('sticks to whichever of its start and its end is nearer', () => {
    // Start 1_030 is 30 from the cut at 1000; the end, 1_830, is 170 from the cut at 2000: the start wins.
    expect(pieceTarget(drag({ rawStartMs: 1_030 })).item.startMs).toBe(1_000)
    // Start 1_190 is 190 from the cut; the end, 1_990, is 10 from the cut at 2000: the end wins.
    const target = pieceTarget(drag({ rawStartMs: 1_190 }))
    expect(target.item.startMs).toBe(1_200)
    expect(target.snappedTo?.timeMs).toBe(2_000)
  })

  it('sticks to the starts and ends of the other pieces, and not to its own', () => {
    const other = { startMs: 2_100, endMs: 2_700 }
    const nearEnd = pieceTarget(drag({ rawStartMs: 1_320, others: [other] }))
    // End 2_120 is 20 from the other piece's start at 2100.
    expect(nearEnd.item.startMs).toBe(1_300)
    expect(nearEnd.snappedTo).toEqual({ timeMs: 2_100, kind: 'piece' })
    // Its own start and end (500 and 1300) are not points: dragging near them does not stick.
    const own = pieceTarget(drag({ rawStartMs: 440, playheadMs: 2_500 }))
    expect(own.item.startMs).toBe(440)
    expect(own.snappedTo).toBeNull()
  })

  it('does not stick when snapping is off, or when nothing is near', () => {
    expect(pieceTarget(drag({ rawStartMs: 1_040, snapping: false })).item.startMs).toBe(1_040)
    // Start 100 is 100 ms from the start of the edit, and the end, 900, is 100 ms from the cut: both beyond the 80 ms reach.
    expect(pieceTarget(drag({ rawStartMs: 100 })).snappedTo).toBeNull()
  })

  it('has a smaller reach when zoomed in, as the reach is in pixels', () => {
    // At 1 px a millisecond, 8 px is 8 ms: 40 ms from the cut is too far to stick.
    expect(pieceTarget(drag({ rawStartMs: 1_040, pxPerMs: 1 })).snappedTo).toBeNull()
    expect(pieceTarget(drag({ rawStartMs: 1_006, pxPerMs: 1 })).item.startMs).toBe(1_000)
  })

  it('lets a limit win over a snap, and drops the guide', () => {
    // A short piece dragged so that its start would stick to the end of the edit at 3000. That is past the latest start,
    // 2_900, so the limit wins and nothing is shown as stuck.
    const target = pieceTarget(drag({ item: piece(0, 200), rawStartMs: 2_995, playheadMs: 1_000 }))
    expect(target.item.startMs).toBe(2_900)
    expect(target.snappedTo).toBeNull()
  })
})

const title = (startMs: number, endMs: number) => ({ ...textItem('t1', 'Hello', onOutput(startMs, endMs)), placement: onOutput(startMs, endMs) })

const dragTitle = (overrides: Partial<TitleDrag> & Pick<TitleDrag, 'rawStartMs'>): TitleDrag => ({
  item: title(500, 1_500),
  others: [],
  timeline: edit,
  playheadMs: 2_500,
  snapping: true,
  pxPerMs: 0.1,
  ...overrides,
})

describe('titleTarget', () => {
  it('puts the title where the pointer puts it, keeping its length and its text', () => {
    const target = titleTarget(dragTitle({ rawStartMs: 700.4, snapping: false }))
    expect(target.item.placement).toEqual(onOutput(700, 1_700))
    expect(target.item.text).toBe('Hello')
    expect(target.snappedTo).toBeNull()
  })

  it('hands back the very same title when it has not moved', () => {
    const item = title(500, 1_500)
    expect(titleTarget(dragTitle({ item, rawStartMs: 500, snapping: false })).item).toBe(item)
  })

  it('keeps the whole title inside the edit: not before its start, and not pulled past its end', () => {
    expect(titleTarget(dragTitle({ rawStartMs: -900, snapping: false })).item.placement).toEqual(onOutput(0, 1_000))
    expect(titleTarget(dragTitle({ rawStartMs: 50_000, snapping: false })).item.placement).toEqual(onOutput(2_000, 3_000))
  })

  it('cannot move a title that is as long as the edit or longer, and leaves it exactly as it is', () => {
    const item = title(0, 9_000)
    const target = titleTarget(dragTitle({ item, rawStartMs: 400, snapping: false }))
    expect(target.item).toBe(item)
    expect(titleTarget(dragTitle({ item: title(0, 3_000), rawStartMs: 400, snapping: false })).item.placement).toEqual(onOutput(0, 3_000))
  })

  it('sticks its start to a cut, and its end to the end of another title or caption', () => {
    const byStart = titleTarget(dragTitle({ rawStartMs: 1_040 }))
    expect(byStart.item.placement).toEqual(onOutput(1_000, 2_000))
    expect(byStart.snappedTo).toEqual({ timeMs: 1_000, kind: 'clipEdge' })
    // The title is a second long: raw start 1_450 ends at 2_450, 50 ms short of a caption that begins at 2_500, which is also the playhead.
    const byEnd = titleTarget(dragTitle({ rawStartMs: 1_450, others: [{ startMs: 2_520, endMs: 2_900 }], playheadMs: 0 }))
    expect(byEnd.item.placement).toEqual(onOutput(1_520, 2_520))
    expect(byEnd.snappedTo).toEqual({ timeMs: 2_520, kind: 'piece' })
  })

  it('lets a limit win over a snap, and drops the guide', () => {
    // The end would stick to the end of the edit at 3000 and the start to 2000: both are the limit, which is kept.
    const target = titleTarget(dragTitle({ rawStartMs: 2_030, playheadMs: 0 }))
    expect(target.item.placement).toEqual(onOutput(2_000, 3_000))
    // Dragged past the latest start, with the start sticking to a point beyond it, the limit wins.
    const limited = titleTarget(dragTitle({ rawStartMs: 2_090, others: [{ startMs: 2_110, endMs: 2_400 }], playheadMs: 0 }))
    expect(limited.item.placement).toEqual(onOutput(2_000, 3_000))
    expect(limited.snappedTo).toBeNull()
  })
})
