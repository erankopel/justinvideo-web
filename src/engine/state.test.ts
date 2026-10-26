import { describe, expect, it } from 'vitest'
import {
  applyToState,
  canRedo,
  canUndo,
  clip,
  editContext,
  editState,
  type EditState,
  HISTORY_LIMIT,
  redone,
  timeline,
  undone,
} from './index'

describe('the undo history', () => {
  const counter = { n: 0 }
  const context = editContext(new Map([['A', 100_000]]), { newId: () => `n${counter.n++}` })
  const initial = editState({ timeline: timeline([clip('one', 'A', 0, 60_000)]) })
  const split = (state: EditState, timeMs: number): EditState => applyToState(state, { type: 'split', timeMs }, context).state
  const must = <T>(value: T | null): T => {
    if (value === null) throw new Error('Expected a state')
    return value
  }

  it('makes an edit one undo step, and undo then redo restore the exact timeline', () => {
    const edited = split(initial, 10_000)
    expect(canUndo(edited)).toBe(true)
    expect(canRedo(edited)).toBe(false)
    const back = must(undone(edited))
    expect(back.timeline).toEqual(initial.timeline)
    expect(canRedo(back)).toBe(true)
    expect(must(redone(back)).timeline).toEqual(edited.timeline)
  })

  it('charges no step for a refused or unchanged edit, and keeps redo', () => {
    const back = must(undone(split(initial, 10_000)))
    const refused = applyToState(back, { type: 'split', timeMs: -5 }, context)
    expect(refused.result.kind).toBe('rejected')
    expect(refused.state).toBe(back)
    const unchanged = applyToState(back, { type: 'split', timeMs: 0 }, context)
    expect(unchanged.result).toEqual({ kind: 'unchanged' })
    expect(canRedo(unchanged.state)).toBe(true)
    expect(canUndo(unchanged.state)).toBe(false)
  })

  it('clears redo with a new edit', () => {
    const back = must(undone(split(initial, 10_000)))
    const next = split(back, 20_000)
    expect(canRedo(next)).toBe(false)
    expect(redone(next)).toBeNull()
  })

  it('reports nothing to undo or redo as null', () => {
    expect(undone(initial)).toBeNull()
    expect(redone(initial)).toBeNull()
  })

  it('keeps only the last twenty steps', () => {
    let state = initial
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) state = split(state, 1_000 * (i + 1))
    expect(state.undoStack.length).toBe(HISTORY_LIMIT)
    let back = state
    let steps = 0
    for (let next = undone(back); next !== null; next = undone(back)) {
      back = next
      steps++
    }
    expect(steps).toBe(HISTORY_LIMIT)
    // The oldest five edits are out of reach: the earliest timeline left still has them.
    expect(back.timeline.clips.length - 1).toBe(5)
    expect(back.redoStack.length).toBe(HISTORY_LIMIT)
  })
})
