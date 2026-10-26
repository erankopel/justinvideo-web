import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyToState, clip, editContext, editState, redone, timeline, spans, undone, type EditContext, type EditOp, type EditState } from './index'

/**
 * Replays the scenarios in edit-vectors.json, which scripts/generate_edit_vectors.py produced by running CutRoom's own
 * editing code. After every step the rules must give the same outcome and the same clips: where each starts and ends
 * on the edit clock and where in the recording it begins. The same file is replayed by the Android app's
 * EditVectorsTest, so the two ports are held to the same results.
 */
interface Step {
  readonly op: string
  readonly expect: { readonly status: string; readonly error?: string; readonly clips: number[][] }
  readonly [key: string]: unknown
}
interface Scenario {
  readonly name: string
  readonly fps: number
  readonly sourceMs: number
  readonly initial: number[][]
  readonly steps: Step[]
}

const vectors = JSON.parse(readFileSync(new URL('../../test-data/edit-vectors.json', import.meta.url), 'utf8')) as {
  scenarios: Scenario[]
}

interface Outcome {
  readonly state: EditState
  readonly status: string
  readonly error?: string
}

function run(state: EditState, step: Step, context: EditContext): Outcome {
  const num = (key: string): number => step[key] as number
  const str = (key: string): string => step[key] as string
  let op: EditOp
  switch (step.op) {
    case 'undo': {
      const back = undone(state)
      return back ? { state: back, status: 'changed' } : { state, status: 'rejected', error: 'NothingToUndo' }
    }
    case 'redo': {
      const forward = redone(state)
      return forward ? { state: forward, status: 'changed' } : { state, status: 'rejected', error: 'NothingToRedo' }
    }
    case 'split':
      op = { type: 'split', timeMs: num('timeMs') }
      break
    case 'remove':
      op = { type: 'removeRange', startMs: num('startMs'), endMs: num('endMs') }
      break
    case 'move':
      op = { type: 'moveRange', startMs: num('startMs'), endMs: num('endMs'), toMs: num('toMs') }
      break
    case 'duplicate':
      op = { type: 'duplicateRange', startMs: num('startMs'), endMs: num('endMs'), toMs: num('toMs') }
      break
    case 'insert':
      op = {
        type: 'insertSource',
        sourceId: str('sourceId'),
        sourceStartMs: num('sourceStartMs'),
        sourceEndMs: num('sourceEndMs'),
        atMs: num('atMs'),
      }
      break
    case 'trim':
      op = {
        type: 'trimEdge',
        startMs: num('startMs'),
        endMs: num('endMs'),
        edge: str('edge') === 'start' ? 'start' : 'end',
        timeMs: num('timeMs'),
      }
      break
    default:
      throw new Error(`Unknown step ${step.op}`)
  }
  const { state: next, result } = applyToState(state, op, context)
  return result.kind === 'rejected'
    ? { state: next, status: 'rejected', error: result.error }
    : { state: next, status: result.kind }
}

const clipsOf = (state: EditState): number[][] =>
  spans(state.timeline).map((s) => [s.startMs, s.endMs, s.clip.sourceStartMs])

describe('the vectors from CutRoom', () => {
  it('holds the scenarios the Android app replays', () => {
    expect(vectors.scenarios.length).toBe(49)
    expect(vectors.scenarios.reduce((sum, s) => sum + s.steps.length, 0)).toBe(123)
  })

  for (const scenario of vectors.scenarios) {
    it(scenario.name, () => {
      let counter = 0
      const context = editContext(new Map([['A', scenario.sourceMs]]), { fps: scenario.fps, newId: () => `n${counter++}` })
      let state = editState({
        timeline: timeline(scenario.initial.map(([start = 0, end = 0, sourceStart = 0]) => clip(`n${counter++}`, 'A', sourceStart, end - start))),
      })
      expect(clipsOf(state), 'starting clips').toEqual(scenario.initial)

      scenario.steps.forEach((step, index) => {
        const label = `step ${index + 1} (${step.op})`
        const { state: next, status, error } = run(state, step, context)
        expect(status, `${label}: outcome`).toBe(step.expect.status)
        if (status === 'rejected') expect(error, `${label}: reason`).toBe(step.expect.error)
        expect(clipsOf(next), `${label}: clips`).toEqual(step.expect.clips)
        const ids = next.timeline.clips.map((c) => c.id)
        expect(new Set(ids).size, `${label}: clip ids are unique`).toBe(ids.length)
        state = next
      })
    })
  }
})
