import { clip, editState, timeline } from '../engine'
import { applyProjectEdit, type Project, type Source, undoProject } from './model'

export const testSource = (overrides: Partial<Source> & { id?: string } = {}): Source => {
  const id = overrides.id ?? 's1'
  return {
    id,
    file: `media/${id}.mp4`,
    displayName: 'clip.mp4',
    durationMs: 20_000,
    width: 1280,
    height: 720,
    rotationDegrees: 0,
    hasAudio: true,
    ...overrides,
  }
}

/** A project of two clips from one 20 s recording, 4 s and 6 s long. */
export const testProject = (overrides: { id?: string; modifiedAtMs?: number; name?: string } = {}): Project => ({
  id: overrides.id ?? 'p1',
  name: overrides.name ?? 'Holiday',
  createdAtMs: 500,
  modifiedAtMs: overrides.modifiedAtMs ?? 1_000,
  fps: 30,
  sources: [testSource()],
  edit: editState({ timeline: timeline([clip('one', 's1', 0, 4_000), clip('two', 's1', 10_000, 6_000)]) }),
})

/** The same project after a few edits and an undo, so there is history to save. */
export function testProjectWithHistory(): Project {
  let counter = 0
  const newId = (): string => `n${counter++}`
  const split = applyProjectEdit(testProject(), { type: 'split', timeMs: 2_000 }, 2_000, newId).project
  const removed = applyProjectEdit(split, { type: 'removeRange', startMs: 1_000, endMs: 3_000 }, 3_000, newId).project
  const back = undoProject(removed, 4_000)
  if (!back) throw new Error('The test project has nothing to undo')
  return back
}
