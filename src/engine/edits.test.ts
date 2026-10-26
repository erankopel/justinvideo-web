import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyEdit,
  clip,
  type Clip,
  editContext,
  type EditContext,
  type EditError,
  type EditOp,
  type EditResult,
  frameMs,
  MAX_CLIPS,
  MAX_TIMELINE_MS,
  MIN_CLIP_MS,
  spanAt,
  spans,
  timeline,
  timelineFromKept,
  type Timeline,
  validateClips,
} from './index'

const rejected = (error: EditError): EditResult => ({ kind: 'rejected', error })

describe('rules the CutRoom vectors cannot express', () => {
  let counter: number
  let context: EditContext
  let start: Timeline

  beforeEach(() => {
    counter = 0
    context = editContext(new Map([['A', 20_000], ['B', 5_000]]), { newId: () => `n${counter++}` })
    start = timeline([clip('one', 'A', 0, 4_000), clip('two', 'A', 10_000, 6_000)])
  })

  const edit = (t: Timeline, op: EditOp): Timeline => {
    const result = applyEdit(t, op, context)
    if (result.kind !== 'changed') throw new Error(`Expected a change, got ${JSON.stringify(result)}`)
    return result.timeline
  }
  const ids = (t: Timeline): string[] => t.clips.map((c) => c.id)

  it('rounds frame lengths up to whole milliseconds', () => {
    expect([24, 25, 30, 50, 60].map(frameMs)).toEqual([42, 40, 34, 20, 17])
    expect(MIN_CLIP_MS).toBe(17)
  })

  it('refuses a frame rate that is not offered', () => {
    expect(() => frameMs(29)).toThrow()
    expect(() => editContext(new Map(), { fps: 29 })).toThrow()
  })

  it('keeps the first piece id of a split and gives the second a new one', () => {
    expect(ids(edit(start, { type: 'split', timeMs: 1_000 }))).toEqual(['one', 'n0', 'two'])
  })

  it('keeps the id of the clip start in a removal and renames the tail of a clip it cut into', () => {
    // The first clip's start survives; the rest of the second clip begins mid-clip, so it is a new piece.
    expect(ids(edit(start, { type: 'removeRange', startMs: 2_000, endMs: 5_000 }))).toEqual(['one', 'n0'])
    // A clip left whole after the removed range keeps its id.
    expect(ids(edit(start, { type: 'removeRange', startMs: 0, endMs: 4_000 }))).toEqual(['two'])
  })

  it('keeps the id of a whole clip that is moved', () => {
    expect(ids(edit(start, { type: 'moveRange', startMs: 4_000, endMs: 10_000, toMs: 0 }))).toEqual(['two', 'one'])
  })

  it('gives copies new ids and lets the originals keep theirs', () => {
    const result = edit(start, { type: 'duplicateRange', startMs: 0, endMs: 4_000, toMs: 4_000 })
    expect(ids(result)).toEqual(['one', 'n0', 'two'])
    expect(result.clips[1]?.sourceStartMs).toBe(result.clips[0]?.sourceStartMs)
  })

  it('makes an inserted piece a new clip of the named source', () => {
    const result = edit(start, { type: 'insertSource', sourceId: 'B', sourceStartMs: 1_000, sourceEndMs: 3_000, atMs: 4_000 })
    expect(result.clips[1]).toEqual(clip('n0', 'B', 1_000, 2_000))
    expect(result.durationMs).toBe(12_000)
  })

  it('leaves the timeline as it was after a refused edit', () => {
    expect(applyEdit(start, { type: 'removeRange', startMs: 0, endMs: 100_000 }, context)).toEqual(rejected('OutsideTimeline'))
    expect(start.durationMs).toBe(10_000)
  })

  it('lands a drop or insert past the end at the end instead of leaving black time', () => {
    // CutRoom's own insert and duplicate modes would leave a gap here; this app has no gaps.
    const blank = (clips: readonly Clip[]): Clip[] => clips.map((c) => ({ ...c, id: '' }))
    const atEnd = edit(start, { type: 'duplicateRange', startMs: 0, endMs: 4_000, toMs: 10_000 })
    const far = edit(start, { type: 'duplicateRange', startMs: 0, endMs: 4_000, toMs: 50_000 })
    expect(blank(far.clips)).toEqual(blank(atEnd.clips))
    expect(atEnd.durationMs).toBe(14_000)
    const inserted = edit(start, { type: 'insertSource', sourceId: 'A', sourceStartMs: 0, sourceEndMs: 1_000, atMs: 3_600_000 })
    expect(inserted.durationMs).toBe(11_000)
    expect(inserted.clips.at(-1)?.durationMs).toBe(1_000)
  })

  it('enforces the clip limit', () => {
    const many = timeline(Array.from({ length: MAX_CLIPS }, (_, i) => clip(`c${i}`, 'A', i * 20, 20)))
    const result = applyEdit(many, { type: 'split', timeMs: 10 }, editContext(new Map([['A', 20_000]])))
    expect(result).toEqual(rejected('TooManyClips'))
  })

  it('enforces the twenty four hour limit', () => {
    const day = timeline([clip('long', 'A', 0, MAX_TIMELINE_MS)])
    const result = applyEdit(day, { type: 'duplicateRange', startMs: 0, endMs: 1_000, toMs: 0 }, editContext(new Map([['A', MAX_TIMELINE_MS]])))
    expect(result).toEqual(rejected('TooLong'))
  })

  it('refuses a repeated id from the generator instead of saving it', () => {
    const clashing = editContext(new Map([['A', 20_000]]), { newId: () => 'one' })
    expect(applyEdit(start, { type: 'split', timeMs: 1_000 }, clashing)).toEqual(rejected('DuplicateId'))
  })

  it('names the first problem in validation', () => {
    expect(validateClips(context, start.clips)).toBeNull()
    expect(validateClips(context, [clip('x', 'Z', 0, 1_000)])).toBe('UnknownSource')
    expect(validateClips(context, [clip('x', 'A', 0, 16)])).toBe('FragmentTooShort')
    expect(validateClips(context, [clip('x', 'A', 19_500, 1_000)])).toBe('BeyondSourceMedia')
    expect(validateClips(context, [clip('x', 'A', -1, 1_000)])).toBe('BeyondSourceMedia')
  })

  it('builds a timeline from kept ranges', () => {
    const built = timelineFromKept('A', [{ startMs: 0, endMs: 4_000 }, { startMs: 10_000, endMs: 16_000 }], () => `k${counter++}`)
    expect(built.clips).toEqual([clip('k0', 'A', 0, 4_000), clip('k1', 'A', 10_000, 6_000)])
    expect(spans(built).map((s) => [s.startMs, s.endMs])).toEqual([[0, 4_000], [4_000, 10_000]])
  })

  it('finds the clip under a time and nothing at the end', () => {
    expect(spanAt(start, 4_000)?.clip.id).toBe('two')
    expect(spanAt(start, 3_999)?.clip.id).toBe('one')
    expect(spanAt(start, 10_000)).toBeUndefined()
    expect(spanAt(start, 0)).not.toEqual(spanAt(start, 5_000))
  })
})

describe('the edit behind a trim handle', () => {
  const context = editContext(new Map([['A', 20_000]]), { newId: (() => { let n = 0; return () => `n${n++}` })() })

  // Three clips of 4 s, 3 s and 3 s from different places in a 20 s recording.
  const start = timeline([clip('a', 'A', 2_000, 4_000), clip('b', 'A', 8_000, 3_000), clip('c', 'A', 14_000, 3_000)])

  const trim = (id: string, edge: 'start' | 'end', timeMs: number, t: Timeline = start): EditResult =>
    applyEdit(t, { type: 'trimClip', clipId: id, edge, timeMs }, context)

  const trimmed = (id: string, edge: 'start' | 'end', timeMs: number): Timeline => {
    const result = trim(id, edge, timeMs)
    if (result.kind !== 'changed') throw new Error(`Expected a change, got ${JSON.stringify(result)}`)
    return result.timeline
  }

  const geometry = (t: Timeline): number[][] => spans(t).map((s) => [s.startMs, s.endMs, s.clip.sourceStartMs])

  it('shortens the clip and closes the gap when the end moves inward', () => {
    const result = trimmed('a', 'end', 3_000)
    expect(geometry(result)).toEqual([[0, 3_000, 2_000], [3_000, 6_000, 8_000], [6_000, 9_000, 14_000]])
    expect(result.clips.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('drops footage from the front and keeps the clip place when the start moves inward', () => {
    // The second clip starts at 4 s. Moving its start to 5 s drops its first second.
    const result = trimmed('b', 'start', 5_000)
    expect(geometry(result)).toEqual([[0, 4_000, 2_000], [4_000, 6_000, 9_000], [6_000, 9_000, 14_000]])
    expect(result.clips.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('reveals footage and pushes the later clips on when the end moves outward', () => {
    const result = trimmed('a', 'end', 6_000)
    // a was 0 to 4 s; two more seconds of its recording follow, so the others move two seconds later.
    expect(geometry(result)).toEqual([[0, 6_000, 2_000], [6_000, 9_000, 8_000], [9_000, 12_000, 14_000]])
    expect(result.durationMs).toBe(12_000)
  })

  it('reveals earlier footage without moving the clip start when the start moves outward', () => {
    // b starts at 4 s on the timeline and at 8 s in its recording. Dragging its start 1.5 s earlier reveals
    // 1.5 s before 8 s, and the clip grows toward the end.
    const result = trimmed('b', 'start', 2_500)
    expect(geometry(result)).toEqual([[0, 4_000, 2_000], [4_000, 8_500, 6_500], [8_500, 11_500, 14_000]])
  })

  it('keeps the clip id whichever edge moves', () => {
    for (const edge of ['start', 'end'] as const) {
      for (const time of [4_500, 6_500]) {
        const result = trim('b', edge, time)
        if (result.kind === 'changed') expect(result.timeline.clips.map((c) => c.id)).toEqual(['a', 'b', 'c'])
      }
    }
  })

  it('refuses to reveal more than the recording holds, at both ends', () => {
    // c reaches 17 s of a 20 s recording, so only 3 s remain after it.
    expect(trim('c', 'end', 14_000)).toEqual(rejected('BeyondSourceMedia'))
    expect(trim('c', 'end', 13_000).kind).toBe('changed')
    // y sits at 4 s on the timeline but starts only 1 s into its recording, so its start edge cannot be dragged
    // more than 1 s earlier, to 3 s.
    const tight = timeline([clip('x', 'A', 1_000, 4_000), clip('y', 'A', 1_000, 4_000)])
    expect(trim('y', 'start', 2_000, tight)).toEqual(rejected('BeyondSourceMedia'))
    expect(trim('y', 'start', 3_000, tight).kind).toBe('changed')
  })

  it('cannot trim a clip below one frame', () => {
    expect(trim('a', 'end', 10)).toEqual(rejected('TooShort'))
    expect(trim('a', 'start', 3_990)).toEqual(rejected('TooShort'))
    expect(trim('a', 'end', frameMs(30)).kind).toBe('changed')
  })

  it('does nothing for a drag to where the edge already is, and refuses unknown places', () => {
    expect(trim('a', 'end', 4_000)).toEqual({ kind: 'unchanged' })
    expect(trim('b', 'start', 4_000)).toEqual({ kind: 'unchanged' })
    expect(trim('a', 'end', -1)).toEqual(rejected('PlacementOutOfRange'))
    expect(trim('a', 'end', MAX_TIMELINE_MS + 1)).toEqual(rejected('PlacementOutOfRange'))
    expect(trim('zzz', 'end', 1_000)).toEqual(rejected('UnknownClip'))
  })

  it('gives the same clips as the trim edge of CutRoom on the range of the clip, inward', () => {
    // The shared rule: shortening a clip removes the time from its edge to the new edge and closes the gap.
    const cases: [string, 'start' | 'end', number][] = [
      ['a', 'end', 2_500], ['a', 'start', 1_500],
      ['b', 'end', 6_000], ['b', 'start', 6_000],
      ['c', 'end', 8_000], ['c', 'start', 9_000],
    ]
    for (const [id, edge, time] of cases) {
      const span = spans(start).find((s) => s.clip.id === id)
      if (!span) throw new Error('missing span')
      const viaClip = trimmed(id, edge, time)
      const viaEdge = applyEdit(start, { type: 'trimEdge', startMs: span.startMs, endMs: span.endMs, edge, timeMs: time }, context)
      if (viaEdge.kind !== 'changed') throw new Error('Expected a change')
      expect(geometry(viaClip), `${id} ${edge} ${time}`).toEqual(geometry(viaEdge.timeline))
    }
  })
})

describe('the volume of a clip', () => {
  const context = editContext(new Map([['s1', 20_000]]), { fps: 30, newId: () => 'new' })
  const base = timeline([clip('a', 's1', 0, 4_000), clip('b', 's1', 10_000, 6_000)])
  const changed = (result: EditResult): Timeline => {
    if (result.kind !== 'changed') throw new Error(`Expected a change, got ${JSON.stringify(result)}`)
    return result.timeline
  }
  const setVolume = (t: Timeline, clipId: string, volumePercent: number): EditResult =>
    applyEdit(t, { type: 'setClipVolume', clipId, volumePercent }, context)

  it('is set for that clip only', () => {
    expect(changed(setVolume(base, 'b', 40)).clips.map((c) => c.volumePercent)).toEqual([100, 40])
  })

  it('changes nothing when the volume is the same', () => {
    expect(setVolume(base, 'a', 100)).toEqual({ kind: 'unchanged' })
  })

  it('is refused for an unknown clip', () => {
    expect(setVolume(base, 'zzz', 50)).toEqual(rejected('UnknownClip'))
  })

  it('is refused outside zero to two hundred', () => {
    expect(setVolume(base, 'a', 201)).toEqual(rejected('VolumeOutOfRange'))
    expect(setVolume(base, 'a', -1)).toEqual(rejected('VolumeOutOfRange'))
  })

  it('allows the limits themselves', () => {
    expect(changed(setVolume(base, 'a', 0)).clips[0]?.volumePercent).toBe(0)
    expect(changed(setVolume(base, 'a', 200)).clips[0]?.volumePercent).toBe(200)
  })

  it('stays with both halves of a split clip', () => {
    const quiet = changed(setVolume(base, 'a', 30))
    const split = changed(applyEdit(quiet, { type: 'split', timeMs: 1_500 }, context))
    expect(split.clips.map((c) => c.volumePercent)).toEqual([30, 30, 100])
  })

  it('stays with a copy of the clip it came from', () => {
    const quiet = changed(setVolume(base, 'b', 25))
    const copied = changed(applyEdit(quiet, { type: 'duplicateRange', startMs: 4_000, endMs: 10_000, toMs: 10_000 }, context))
    expect(copied.clips.map((c) => c.volumePercent)).toEqual([100, 25, 25])
  })

  it('stays through a move and a trim', () => {
    const quiet = changed(setVolume(base, 'a', 60))
    const moved = changed(applyEdit(quiet, { type: 'moveRange', startMs: 0, endMs: 4_000, toMs: 6_000 }, context))
    expect(moved.clips.at(-1)?.volumePercent).toBe(60)
    const trimmedClip = changed(applyEdit(moved, { type: 'trimClip', clipId: 'a', edge: 'end', timeMs: 9_000 }, context))
    expect(trimmedClip.clips.at(-1)?.volumePercent).toBe(60)
  })

  it('starts a newly inserted recording at full volume', () => {
    const inserted = changed(applyEdit(base, { type: 'insertSource', sourceId: 's1', sourceStartMs: 0, sourceEndMs: 2_000, atMs: 0 }, context))
    expect(inserted.clips[0]?.volumePercent).toBe(100)
  })
})
