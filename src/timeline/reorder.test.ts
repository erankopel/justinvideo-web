import { describe, expect, it } from 'vitest'
import { clip, spans, timeline } from '../engine'
import { applyProjectEdit } from '../project/model'
import { testProject } from '../project/test-projects'
import { clampedOffset, clipDropTarget } from './reorder'

// Three clips: 4 s, 6 s and 3 s, which are at 0 to 4 s, 4 to 10 s and 10 to 13 s.
const project = (() => {
  const base = testProject()
  return { ...base, edit: { ...base.edit, timeline: timeline([clip('one', 's1', 0, 4_000), clip('two', 's1', 10_000, 6_000), clip('three', 's1', 17_000, 3_000)]) } }
})()
const edit = spans(project.edit.timeline)

/** The order of the clips after the drop, and where the dragged one then begins. */
function drop(clipId: string, offsetMs: number): { order: string[]; begins: number; playhead: number | undefined; boundary: number } | null {
  const target = clipDropTarget(edit, clipId, offsetMs)
  if (!target) return null
  const result = applyProjectEdit(project, target.action.op, 1, () => 'new')
  const after = spans(result.project.edit.timeline)
  return {
    order: after.map((s) => s.clip.id),
    begins: after.find((s) => s.clip.id === clipId)?.startMs ?? -1,
    playhead: target.action.playheadAfter,
    boundary: target.boundaryMs,
  }
}

describe('clipDropTarget', () => {
  it('does nothing while the clip has not passed the middle of a neighbour', () => {
    expect(clipDropTarget(edit, 'one', 0)).toBeNull()
    // The front of the first clip is at 4 s; the middle of the second is at 7 s.
    expect(clipDropTarget(edit, 'one', 2_900)).toBeNull()
    expect(clipDropTarget(edit, 'three', -2_900)).toBeNull()
    expect(clipDropTarget(edit, 'two', 1_400)).toBeNull()
    expect(clipDropTarget(edit, 'two', -1_900)).toBeNull()
  })

  it('moves a clip later past the clip after it once its front edge is beyond the middle of that clip', () => {
    expect(drop('one', 3_100)).toEqual({ order: ['two', 'one', 'three'], begins: 6_000, playhead: 6_000, boundary: 10_000 })
    expect(drop('two', 1_600)).toEqual({ order: ['one', 'three', 'two'], begins: 7_000, playhead: 7_000, boundary: 13_000 })
  })

  it('moves a clip earlier past the clip before it once its back edge is before the middle of that clip', () => {
    expect(drop('three', -3_100)).toEqual({ order: ['one', 'three', 'two'], begins: 4_000, playhead: 4_000, boundary: 4_000 })
    expect(drop('two', -2_100)).toEqual({ order: ['two', 'one', 'three'], begins: 0, playhead: 0, boundary: 0 })
  })

  it('passes several clips in one drag', () => {
    // The front of the first clip is at 4 s; it is past the middle of the second (7 s) at once, and past the middle of the third (11.5 s) after 7.5 s.
    expect(drop('one', 6_500)?.order).toEqual(['two', 'one', 'three'])
    expect(drop('one', 7_600)).toEqual({ order: ['two', 'three', 'one'], begins: 9_000, playhead: 9_000, boundary: 13_000 })
    expect(drop('three', -9_000)).toEqual({ order: ['three', 'one', 'two'], begins: 0, playhead: 0, boundary: 0 })
  })

  it('needs half the neighbour to be covered, so a long clip passes a short one as quickly as a short one passes it', () => {
    // The long clip (6 s) passes the short one (3 s) after 1.5 s; the short one passes the long one after 3 s.
    expect(clipDropTarget(edit, 'two', 1_501)).not.toBeNull()
    expect(clipDropTarget(edit, 'two', 1_499)).toBeNull()
    expect(clipDropTarget(edit, 'three', -3_001)).not.toBeNull()
    expect(clipDropTarget(edit, 'three', -2_999)).toBeNull()
  })

  it('takes a drag past either end as a drop at that end', () => {
    expect(drop('one', 100_000)?.order).toEqual(['two', 'three', 'one'])
    expect(drop('three', -100_000)?.order).toEqual(['three', 'one', 'two'])
  })

  it('has nothing to move for a clip that is not there, or when it is the only one', () => {
    expect(clipDropTarget(edit, 'missing', 5_000)).toBeNull()
    expect(clipDropTarget(edit.slice(0, 1), 'one', 5_000)).toBeNull()
    expect(clipDropTarget([], 'one', 5_000)).toBeNull()
  })

  it('is the edit that the Later and Earlier buttons make, to the same place', () => {
    const later = clipDropTarget(edit, 'one', 3_100)?.action.op
    expect(later).toEqual({ type: 'moveRange', startMs: 0, endMs: 4_000, toMs: 6_000 })
    const earlier = clipDropTarget(edit, 'three', -3_100)?.action.op
    expect(earlier).toEqual({ type: 'moveRange', startMs: 10_000, endMs: 13_000, toMs: 4_000 })
  })
})

describe('clampedOffset', () => {
  it('keeps the clip inside the edit', () => {
    expect(clampedOffset(edit, 'two', 0)).toBe(0)
    expect(clampedOffset(edit, 'two', 2_000)).toBe(2_000)
    expect(clampedOffset(edit, 'two', 50_000)).toBe(3_000)
    expect(clampedOffset(edit, 'two', -50_000)).toBe(-4_000)
    expect(clampedOffset(edit, 'missing', 50)).toBe(0)
  })
})
