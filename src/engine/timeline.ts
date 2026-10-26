import { randomClipId } from './ids'

/** The longest edit accepted, so every time fits comfortably in a number and in the UI. */
export const MAX_TIMELINE_MS = 24 * 60 * 60 * 1000

/** The most clips one timeline may hold. */
export const MAX_CLIPS = 500

/** How many steps of undo, and of redo, are kept. */
export const HISTORY_LIMIT = 20

export const DEFAULT_FPS = 30

/** How loud a clip's own sound is, in percent of the recording: 100 leaves it as it is, 0 silences it. */
export const DEFAULT_VOLUME_PERCENT = 100

/** The loudest a clip or a piece of audio may be made, in percent. */
export const MAX_VOLUME_PERCENT = 200

/** The frame rates an export may use. */
export const EXPORT_FPS_CHOICES: readonly number[] = [24, 25, 30, 50, 60]

/** One output frame in milliseconds, rounded up so a range of this length always holds a whole frame. */
export function frameMs(fps: number): number {
  if (!EXPORT_FPS_CHOICES.includes(fps)) throw new RangeError(`Unsupported frame rate: ${fps}`)
  return Math.ceil(1000 / fps)
}

/**
 * The shortest clip that may be stored: one frame at the fastest export rate. A clip must survive a later switch from
 * 60 to 30 fps, so it is judged against the fastest rate, not the project's current one.
 */
export const MIN_CLIP_MS: number = frameMs(Math.max(...EXPORT_FPS_CHOICES))

/**
 * A piece of one source video placed on the timeline. Where it sits on the edit clock is not stored: it follows from
 * the clips before it, so clips can never overlap or leave a gap.
 */
export interface Clip {
  readonly id: string
  readonly sourceId: string
  readonly sourceStartMs: number
  readonly durationMs: number
  readonly volumePercent: number
}

export function clip(
  id: string,
  sourceId: string,
  sourceStartMs: number,
  durationMs: number,
  volumePercent: number = DEFAULT_VOLUME_PERCENT,
): Clip {
  return { id, sourceId, sourceStartMs, durationMs, volumePercent }
}

export const sourceEndMs = (c: Clip): number => c.sourceStartMs + c.durationMs

/** A clip together with where it starts on the edit clock. */
export interface Span {
  readonly clip: Clip
  readonly startMs: number
  readonly endMs: number
}

/**
 * The edited video: clips end to end on one track. The timeline is the edit clock; each clip also has a source
 * position inside its recording. Source recordings are never changed.
 */
export interface Timeline {
  readonly clips: readonly Clip[]
  readonly durationMs: number
}

export function timeline(clips: readonly Clip[] = []): Timeline {
  return { clips, durationMs: clips.reduce((sum, c) => sum + c.durationMs, 0) }
}

export function spans(t: Timeline): Span[] {
  let cursor = 0
  return t.clips.map((c) => {
    const span: Span = { clip: c, startMs: cursor, endMs: cursor + c.durationMs }
    cursor = span.endMs
    return span
  })
}

export function spanAt(t: Timeline, timeMs: number): Span | undefined {
  return spans(t).find((s) => s.startMs <= timeMs && timeMs < s.endMs)
}

/** A timeline that plays the given parts of one source in order, such as a draft's kept ranges. */
export function timelineFromKept(
  sourceId: string,
  kept: readonly { startMs: number; endMs: number }[],
  newId: () => string = randomClipId,
): Timeline {
  return timeline(kept.map((range) => clip(newId(), sourceId, range.startMs, range.endMs - range.startMs)))
}
