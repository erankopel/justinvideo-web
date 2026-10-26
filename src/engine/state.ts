import type { AudioMix } from './audio/model'
import { EMPTY_MIX } from './audio/model'
import { applyEdit, type EditContext, type EditOp, type EditResult } from './edits'
import { sameData } from './equal'
import type { TextItem } from './text/model'
import { HISTORY_LIMIT, type Timeline, timeline } from './timeline'

/** One step of the history: the clips, the texts and the music and voiceover as they were. */
export interface Snapshot {
  readonly timeline: Timeline
  readonly texts: readonly TextItem[]
  readonly mix: AudioMix
}

/**
 * The timeline, the titles and captions, and the music and voiceover, with their undo and redo history. Like CutRoom,
 * one edit is one undo step, an edit that is refused or changes nothing costs no step and leaves redo alone, a new
 * edit clears redo, and only the last HISTORY_LIMIT steps are kept. A step holds the clips, the texts and the audio
 * together, so undo brings back all of them. The state is immutable, so every step is a cheap reference to what was
 * there before.
 */
export interface EditState {
  readonly timeline: Timeline
  readonly undoStack: readonly Snapshot[]
  readonly redoStack: readonly Snapshot[]
  readonly texts: readonly TextItem[]
  readonly mix: AudioMix
}

export function editState(initial: Partial<Pick<EditState, 'timeline' | 'texts' | 'mix'>> = {}): EditState {
  return {
    timeline: initial.timeline ?? timeline(),
    undoStack: [],
    redoStack: [],
    texts: initial.texts ?? [],
    mix: initial.mix ?? EMPTY_MIX,
  }
}

export const canUndo = (state: EditState): boolean => state.undoStack.length > 0
export const canRedo = (state: EditState): boolean => state.redoStack.length > 0

const snapshotOf = (state: EditState): Snapshot => ({ timeline: state.timeline, texts: state.texts, mix: state.mix })

const takeLast = <T>(items: readonly T[], count: number): T[] => items.slice(Math.max(items.length - count, 0))

/** What happened, and the state afterwards: the same state unless the edit changed the timeline. */
export interface Step {
  readonly state: EditState
  readonly result: EditResult
}

export function applyToState(state: EditState, op: EditOp, context: EditContext): Step {
  const result = applyEdit(state.timeline, op, context)
  if (result.kind !== 'changed') return { state, result }
  const next: EditState = {
    timeline: result.timeline,
    undoStack: takeLast([...state.undoStack, snapshotOf(state)], HISTORY_LIMIT),
    redoStack: [],
    texts: state.texts,
    mix: state.mix,
  }
  return { state: next, result }
}

/** The state after the texts are changed to newTexts, as one undo step. */
export function withTexts(state: EditState, newTexts: readonly TextItem[]): EditState {
  if (sameData(newTexts, state.texts)) return state
  return {
    timeline: state.timeline,
    undoStack: takeLast([...state.undoStack, snapshotOf(state)], HISTORY_LIMIT),
    redoStack: [],
    texts: newTexts,
    mix: state.mix,
  }
}

/** The state after the music, the voiceovers or the master fades are changed to newMix, as one undo step. */
export function withMix(state: EditState, newMix: AudioMix): EditState {
  if (sameData(newMix, state.mix)) return state
  return {
    timeline: state.timeline,
    undoStack: takeLast([...state.undoStack, snapshotOf(state)], HISTORY_LIMIT),
    redoStack: [],
    texts: state.texts,
    mix: newMix,
  }
}

/** Goes back one step, or returns null when there is nothing to undo. */
export function undone(state: EditState): EditState | null {
  const back = state.undoStack[state.undoStack.length - 1]
  if (back === undefined) return null
  return {
    timeline: back.timeline,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: takeLast([...state.redoStack, snapshotOf(state)], HISTORY_LIMIT),
    texts: back.texts,
    mix: back.mix,
  }
}

/** Goes forward one step, or returns null when there is nothing to redo. */
export function redone(state: EditState): EditState | null {
  const forward = state.redoStack[state.redoStack.length - 1]
  if (forward === undefined) return null
  return {
    timeline: forward.timeline,
    undoStack: takeLast([...state.undoStack, snapshotOf(state)], HISTORY_LIMIT),
    redoStack: state.redoStack.slice(0, -1),
    texts: forward.texts,
    mix: forward.mix,
  }
}
