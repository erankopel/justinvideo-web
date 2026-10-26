import { describe, expect, it } from 'vitest'
import { clip, spans, timeline } from '../engine'
import { applyProjectEdit } from '../project/model'
import { testProject } from '../project/test-projects'
import { timeSpan } from '../timeline/range'
import { duplicateClipAction, moveEarlierAction, moveLaterAction, refusalText, removeClipAction, removeRangeAction, splitAction, trimToPlayheadAction } from './actions'
import type { EditAction } from './actions'


// Three clips: 4 s, 6 s and 3 s from a 20 s recording.
const project = (() => {
  const base = testProject()
  return { ...base, edit: { ...base.edit, timeline: timeline([clip('one', 's1', 0, 4_000), clip('two', 's1', 10_000, 6_000), clip('three', 's1', 17_000, 3_000)]) } }
})()
const edit = spans(project.edit.timeline)

const run = (action: EditAction | null) => {
  if (!action) throw new Error('no action')
  let n = 0
  return applyProjectEdit(project, action.op, 1, () => `n${n++}`)
}
const ids = (result: ReturnType<typeof run>) => result.project.edit.timeline.clips.map((c) => c.id)

describe('the editing actions', () => {
  it('split cuts the clip under the playhead and keeps the playhead where it is', () => {
    const action = splitAction(1_000)
    expect(action.playheadAfter).toBeUndefined()
    expect(ids(run(action))).toEqual(['one', 'n0', 'two', 'three'])
  })

  it('remove clip takes the clip out, puts the playhead where it was and clears the selection', () => {
    const action = removeClipAction(edit[1]!)
    expect(action).toMatchObject({ playheadAfter: 4_000, clearSelection: true })
    expect(ids(run(action))).toEqual(['one', 'three'])
  })

  it('duplicate clip puts a copy after it and the playhead at the end of the copy’s original', () => {
    const action = duplicateClipAction(edit[0]!)
    expect(action).toMatchObject({ playheadAfter: 4_000, clearSelection: true })
    const result = run(action)
    expect(result.project.edit.timeline.clips).toHaveLength(4)
    expect(result.project.edit.timeline.durationMs).toBe(17_000)
  })

  it('move earlier swaps a clip with the one before it, and the first clip cannot move earlier', () => {
    const action = moveEarlierAction(edit, 1)
    expect(action).toMatchObject({ playheadAfter: 0 })
    expect(ids(run(action))).toEqual(['two', 'one', 'three'])
    expect(moveEarlierAction(edit, 0)).toBeNull()
  })

  it('move later swaps a clip with the one after it, and the last clip cannot move later', () => {
    const action = moveLaterAction(edit, 0)
    expect(action).toMatchObject({ playheadAfter: 6_000 })
    expect(ids(run(action))).toEqual(['two', 'one', 'three'])
    expect(moveLaterAction(edit, 2)).toBeNull()
  })

  it('remove range takes out the stretch and puts the playhead at its start', () => {
    const action = removeRangeAction(timeSpan(2_000, 5_000))
    expect(action).toMatchObject({ playheadAfter: 2_000, clearSelection: true })
    expect(run(action).project.edit.timeline.durationMs).toBe(10_000)
  })
})

describe('trim to the playhead', () => {
  const trim = (index: number, edge: 'start' | 'end', playheadMs: number) =>
    trimToPlayheadAction(project.edit.timeline, edit[index]!, edge, playheadMs, 20_000, 30)
  const clipsAfter = (action: ReturnType<typeof trim>) => run(action).project.edit.timeline.clips.map((c) => [c.id, c.sourceStartMs, c.durationMs])

  it('brings the start of the clip to the playhead, takes the footage before it away, and puts the playhead at the clip’s start', () => {
    const action = trim(1, 'start', 6_000)
    expect(action?.playheadAfter).toBe(4_000)
    expect(clipsAfter(action)).toEqual([['one', 0, 4_000], ['two', 12_000, 4_000], ['three', 17_000, 3_000]])
  })

  it('brings the end of the clip to the playhead, and leaves the playhead where it is', () => {
    const action = trim(1, 'end', 7_000)
    expect(action?.playheadAfter).toBeUndefined()
    expect(clipsAfter(action)).toEqual([['one', 0, 4_000], ['two', 10_000, 3_000], ['three', 17_000, 3_000]])
  })

  it('falls on a whole frame, as a dragged edge does', () => {
    const action = trim(1, 'end', 7_010)
    expect(action?.op).toMatchObject({ type: 'trimClip', edge: 'end', timeMs: 7_000 })
  })

  it('does nothing, and says so, when the edge is already at the playhead', () => {
    const result = run(trim(1, 'start', 4_000))
    expect(result.result.kind).toBe('unchanged')
    expect(refusalText(result.result)).toBe('nothingChanged')
  })

  it('reveals more of the recording when the playhead is outside the clip, within what the recording has', () => {
    expect(clipsAfter(trim(1, 'start', 3_000))).toEqual([['one', 0, 4_000], ['two', 9_000, 7_000], ['three', 17_000, 3_000]])
    // The third clip already ends where its recording does: there is no more to reveal.
    const none = run(trim(2, 'end', 15_000))
    expect(none.result.kind).toBe('unchanged')
  })

  it('keeps a frame at least of the clip, whatever the playhead says', () => {
    const action = trim(1, 'start', 12_000)
    expect(action?.op).toMatchObject({ edge: 'start', timeMs: 10_000 - 34 })
    expect(clipsAfter(action)[1]?.[2]).toBe(34)
  })

  it('is null for a clip that is not on the timeline', () => {
    const stranger = { ...edit[1]!, clip: { ...edit[1]!.clip, id: 'nobody' } }
    expect(trimToPlayheadAction(project.edit.timeline, stranger, 'start', 6_000, 20_000, 30)).toBeNull()
  })
})

describe('why an edit did nothing', () => {
  it('has no words for an edit that was made', () => {
    expect(refusalText({ kind: 'changed', timeline: timeline() })).toBeNull()
  })

  it('says there was nothing to change', () => {
    expect(refusalText({ kind: 'unchanged' })).toBe('nothingChanged')
  })

  it('has words for every reason', () => {
    const reasons = ['OutsideTimeline', 'TooShort', 'FragmentTooShort', 'PlacementOutOfRange', 'EdgeBlocked', 'BeyondSourceMedia', 'TooManyClips', 'TooLong', 'DuplicateId', 'UnknownClip', 'UnknownSource', 'VolumeOutOfRange'] as const
    const keys = reasons.map((error) => refusalText({ kind: 'rejected', error }))
    expect(keys).toEqual(['refusedOutside', 'refusedTooShort', 'refusedFragment', 'refusedPlacement', 'refusedBlocked', 'refusedBeyond', 'refusedTooMany', 'refusedTooLong', 'refusedOther', 'refusedOther', 'refusedOther', 'refusedOther'])
  })

  it('splitting on a cut changes nothing, and outside the edit is refused', () => {
    expect(applyProjectEdit(project, splitAction(4_000).op, 1).result).toEqual({ kind: 'unchanged' })
    expect(refusalText(applyProjectEdit(project, splitAction(99_000).op, 1).result)).toBe('refusedOutside')
  })
})
