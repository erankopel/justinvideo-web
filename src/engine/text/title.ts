import { type OnOutput, onOutput } from './model'

/** How far one press of Earlier, Later, Shorter or Longer moves a title. */
export const TITLE_STEP_MS = 500

/** How long a new title is shown, unless the edit ends sooner. */
export const DEFAULT_TITLE_MS = 3000

/** The shortest a title can be made with the buttons. */
export const MIN_TITLE_MS = 500

const coerceIn = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

/** A new title of the usual length that starts at the playhead, or earlier when the edit ends too soon for it to fit. */
export function newTitleAt(playheadMs: number, durationMs: number): OnOutput {
  const length = Math.max(Math.min(DEFAULT_TITLE_MS, durationMs), 1)
  const start = coerceIn(playheadMs, 0, Math.max(durationMs - length, 0))
  return onOutput(start, start + length)
}

/** The title moved by deltaMs with its length kept, and kept inside the edit. */
export function movedTitle(title: OnOutput, deltaMs: number, durationMs: number): OnOutput {
  const length = Math.max(Math.min(title.endMs - title.startMs, durationMs), 1)
  const start = coerceIn(title.startMs + deltaMs, 0, Math.max(durationMs - length, 0))
  return onOutput(start, start + length)
}

/** The title made longer or shorter at its end by deltaMs, never shorter than MIN_TITLE_MS and never past the end of the edit. */
export function resizedTitle(title: OnOutput, deltaMs: number, durationMs: number): OnOutput {
  const start = coerceIn(title.startMs, 0, Math.max(durationMs - 1, 0))
  const room = Math.max(durationMs - start, 1)
  const length = coerceIn(title.endMs - title.startMs + deltaMs, Math.min(MIN_TITLE_MS, room), room)
  return onOutput(start, start + length)
}
