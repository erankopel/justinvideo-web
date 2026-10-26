import {
  type Clip,
  clip,
  DEFAULT_FPS,
  EXPORT_FPS_CHOICES,
  frameMs,
  MAX_CLIPS,
  MAX_TIMELINE_MS,
  MAX_VOLUME_PERCENT,
  MIN_CLIP_MS,
  sourceEndMs,
  type Span,
  spans,
  type Timeline,
  timeline,
} from './timeline'
import { randomClipId } from './ids'

/**
 * Editing rules ported from CutRoom (cutroom/sequence.py, the linked actions with one source), applied to a timeline
 * of clips end to end. docs/EDIT-RULES.md lists what is shared and what differs. The rules are checked against
 * CutRoom's own results in edit-vectors.test.ts.
 *
 * Every edit is atomic: it returns a whole new timeline, or says why it was refused, and never leaves a half-changed
 * one. An edit that would change nothing is reported as such so it costs no undo step.
 */
export type Edge = 'start' | 'end'

export type EditOp =
  /** Cut the clip under timeMs in two. Does nothing at a clip boundary. */
  | { readonly type: 'split'; readonly timeMs: number }
  /** Remove the time from startMs to endMs and close the gap. */
  | { readonly type: 'removeRange'; readonly startMs: number; readonly endMs: number }
  /** Lift the range out, close the gap, and insert it so that it starts at toMs in the result. */
  | { readonly type: 'moveRange'; readonly startMs: number; readonly endMs: number; readonly toMs: number }
  /** Insert a copy of the range at toMs, pushing the footage after it later. */
  | { readonly type: 'duplicateRange'; readonly startMs: number; readonly endMs: number; readonly toMs: number }
  /** Insert part of a source recording at atMs, pushing the footage after it later. */
  | {
      readonly type: 'insertSource'
      readonly sourceId: string
      readonly sourceStartMs: number
      readonly sourceEndMs: number
      readonly atMs: number
    }
  /**
   * Drag one edge of the range startMs to endMs to timeMs. Moving it inward removes time and closes the gap; moving it
   * outward reveals more of the recording, and is only possible at the very end.
   */
  | {
      readonly type: 'trimEdge'
      readonly startMs: number
      readonly endMs: number
      readonly edge: Edge
      readonly timeMs: number
    }
  /**
   * Drag one edge of a single clip to timeMs, the way a handle on the timeline works. Inward it removes footage from
   * the clip and closes the gap, like trimEdge. Outward it reveals more of the recording, and the clips after it move
   * later: this timeline has no gap to fill, so unlike trimEdge it is never blocked by a neighbour. The clip keeps
   * its id, and its place on the timeline does not move: dragging the start edge outward lengthens the clip toward
   * the end.
   */
  | { readonly type: 'trimClip'; readonly clipId: string; readonly edge: Edge; readonly timeMs: number }
  /** Set how loud the sound of one clip is, in percent of the recording. Splits and copies keep it. */
  | { readonly type: 'setClipVolume'; readonly clipId: string; readonly volumePercent: number }

/** Why an edit was refused. The user-facing wording belongs to the UI. */
export type EditError =
  /** The time or range is not inside the edit. */
  | 'OutsideTimeline'
  /** A range must hold at least one output frame. */
  | 'TooShort'
  /** The edit would leave a piece shorter than one frame. */
  | 'FragmentTooShort'
  /** A destination is not between zero and the 24 hour limit. */
  | 'PlacementOutOfRange'
  /** The next clip is in the way of an edge that would grow. */
  | 'EdgeBlocked'
  /** The clip would reach past the end, or before the start, of its recording. */
  | 'BeyondSourceMedia'
  | 'UnknownSource'
  /** No clip has this id, for instance because it was removed while it was being dragged. */
  | 'UnknownClip'
  | 'TooManyClips'
  | 'TooLong'
  | 'DuplicateId'
  /** A clip's volume is not between 0 and the loudest allowed. */
  | 'VolumeOutOfRange'

export type EditResult =
  | { readonly kind: 'changed'; readonly timeline: Timeline }
  /** The edit is valid but would change nothing. */
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rejected'; readonly error: EditError }

/** What the rules need to know about the project around the timeline. */
export interface EditContext {
  readonly sourceDurationsMs: ReadonlyMap<string, number>
  readonly fps: number
  readonly newId: () => string
  readonly frameMs: number
}

export function editContext(
  sourceDurationsMs: ReadonlyMap<string, number>,
  options: { fps?: number; newId?: () => string } = {},
): EditContext {
  const fps = options.fps ?? DEFAULT_FPS
  if (!EXPORT_FPS_CHOICES.includes(fps)) throw new RangeError(`Unsupported frame rate: ${fps}`)
  return { sourceDurationsMs, fps, newId: options.newId ?? randomClipId, frameMs: frameMs(fps) }
}

/** Checks a clip list against every timeline rule. Returns the first problem, or null when it is valid. */
export function validateClips(context: EditContext, clips: readonly Clip[]): EditError | null {
  if (clips.reduce((sum, c) => sum + c.durationMs, 0) > MAX_TIMELINE_MS) return 'TooLong'
  if (clips.length > MAX_CLIPS) return 'TooManyClips'
  const seen = new Set<string>()
  for (const c of clips) {
    const sourceDuration = context.sourceDurationsMs.get(c.sourceId)
    if (sourceDuration === undefined) return 'UnknownSource'
    if (c.durationMs < MIN_CLIP_MS) return 'FragmentTooShort'
    if (c.sourceStartMs < 0 || sourceEndMs(c) > sourceDuration) return 'BeyondSourceMedia'
    if (seen.has(c.id)) return 'DuplicateId'
    seen.add(c.id)
    if (c.volumePercent < 0 || c.volumePercent > MAX_VOLUME_PERCENT) return 'VolumeOutOfRange'
  }
  return null
}

class Refusal extends Error {
  constructor(readonly error: EditError) {
    super(error)
  }
}

function refuse(error: EditError): never {
  throw new Refusal(error)
}

export function applyEdit(t: Timeline, op: EditOp, context: EditContext): EditResult {
  try {
    return applyOrThrow(t, op, context)
  } catch (refusal) {
    if (refusal instanceof Refusal) return { kind: 'rejected', error: refusal.error }
    throw refusal
  }
}

const UNCHANGED: EditResult = { kind: 'unchanged' }

function applyOrThrow(t: Timeline, op: EditOp, context: EditContext): EditResult {
  let clips: readonly Clip[]
  switch (op.type) {
    case 'split': {
      const result = split(t, op.timeMs, context)
      if (result === null) return UNCHANGED
      clips = result
      break
    }
    case 'removeRange':
      requireRange(t, op.startMs, op.endMs, context)
      clips = without(t, op.startMs, op.endMs, context)
      break
    case 'moveRange': {
      requireRange(t, op.startMs, op.endMs, context)
      requirePlacement(op.toMs)
      const length = op.endMs - op.startMs
      // A drop past the end lands at the end: dragging never adds black time.
      const at = Math.min(op.toMs, Math.max(0, t.durationMs - length))
      if (at === op.startMs) return UNCHANGED
      const block = slice(spans(t), op.startMs, op.endMs, false, context)
      clips = inserted(timeline(without(t, op.startMs, op.endMs, context)), block, at, context)
      break
    }
    case 'duplicateRange': {
      requireRange(t, op.startMs, op.endMs, context)
      requirePlacement(op.toMs)
      const block = slice(spans(t), op.startMs, op.endMs, true, context)
      clips = inserted(t, block, Math.min(op.toMs, t.durationMs), context)
      break
    }
    case 'insertSource': {
      const sourceDuration = context.sourceDurationsMs.get(op.sourceId)
      if (sourceDuration === undefined) refuse('UnknownSource')
      if (op.sourceStartMs < 0 || op.sourceEndMs > sourceDuration) refuse('BeyondSourceMedia')
      if (op.sourceEndMs - op.sourceStartMs < context.frameMs) refuse('TooShort')
      requirePlacement(op.atMs)
      const block = [clip(context.newId(), op.sourceId, op.sourceStartMs, op.sourceEndMs - op.sourceStartMs)]
      clips = inserted(t, block, Math.min(op.atMs, t.durationMs), context)
      break
    }
    case 'trimEdge': {
      const result = trimmed(t, op, context)
      if (result === null) return UNCHANGED
      clips = result
      break
    }
    case 'trimClip': {
      const result = trimmedClip(t, op, context)
      if (result === null) return UNCHANGED
      clips = result
      break
    }
    case 'setClipVolume': {
      if (op.volumePercent < 0 || op.volumePercent > MAX_VOLUME_PERCENT) refuse('VolumeOutOfRange')
      const target = t.clips.find((c) => c.id === op.clipId)
      if (target === undefined) refuse('UnknownClip')
      if (target.volumePercent === op.volumePercent) return UNCHANGED
      clips = t.clips.map((c) => (c.id === op.clipId ? { ...c, volumePercent: op.volumePercent } : c))
      break
    }
  }
  const problem = validateClips(context, clips)
  if (problem !== null) refuse(problem)
  return { kind: 'changed', timeline: timeline(clips) }
}

function requireRange(t: Timeline, startMs: number, endMs: number, context: EditContext): void {
  if (startMs < 0 || endMs > t.durationMs) refuse('OutsideTimeline')
  if (endMs - startMs < context.frameMs) refuse('TooShort')
}

function requirePlacement(timeMs: number): void {
  if (timeMs < 0 || timeMs > MAX_TIMELINE_MS) refuse('PlacementOutOfRange')
}

function split(t: Timeline, timeMs: number, context: EditContext): Clip[] | null {
  if (timeMs < 0 || timeMs > t.durationMs) refuse('OutsideTimeline')
  const all = spans(t)
  if (!all.some((s) => s.startMs < timeMs && timeMs < s.endMs)) return null
  return [...slice(all, 0, timeMs, false, context), ...slice(all, timeMs, t.durationMs, false, context)]
}

/** Everything except [startMs, endMs), with the footage after it moved earlier. */
function without(t: Timeline, startMs: number, endMs: number, context: EditContext): Clip[] {
  const all = spans(t)
  return [...slice(all, 0, startMs, false, context), ...slice(all, endMs, t.durationMs, false, context)]
}

/** The timeline with block inserted at atMs, which must not be past the end. */
function inserted(t: Timeline, block: readonly Clip[], atMs: number, context: EditContext): Clip[] {
  const all = spans(t)
  return [...slice(all, 0, atMs, false, context), ...block, ...slice(all, atMs, t.durationMs, false, context)]
}

type TrimEdgeOp = Extract<EditOp, { type: 'trimEdge' }>
type TrimClipOp = Extract<EditOp, { type: 'trimClip' }>

function trimmed(t: Timeline, op: TrimEdgeOp, context: EditContext): Clip[] | null {
  requireRange(t, op.startMs, op.endMs, context)
  requirePlacement(op.timeMs)
  const atStart = op.edge === 'start'
  const boundary = atStart ? op.startMs : op.endMs
  if (op.timeMs === boundary) return null
  const newLength = atStart ? op.endMs - op.timeMs : op.timeMs - op.startMs
  if (newLength < context.frameMs) refuse('TooShort')

  const shortening = atStart ? op.timeMs > op.startMs : op.timeMs < op.endMs
  if (shortening) {
    return atStart ? without(t, op.startMs, op.timeMs, context) : without(t, op.timeMs, op.endMs, context)
  }

  const all = spans(t)
  const freeFrom = atStart ? op.timeMs : op.endMs
  const freeTo = atStart ? op.startMs : op.timeMs
  if (all.some((s) => s.startMs < freeTo && s.endMs > freeFrom)) refuse('EdgeBlocked')
  // The timeline has no gaps, so nothing can be free before a clip starts: only the end of the last clip can grow,
  // and the range then ends exactly where that clip ends.
  const last = all[all.length - 1]
  if (atStart || last === undefined || last.endMs !== op.endMs) throw new Error('Only the last clip can grow')
  return [...t.clips.slice(0, -1), { ...last.clip, durationMs: last.clip.durationMs + (op.timeMs - op.endMs) }]
}

function trimmedClip(t: Timeline, op: TrimClipOp, context: EditContext): Clip[] | null {
  requirePlacement(op.timeMs)
  const span = spans(t).find((s) => s.clip.id === op.clipId)
  if (span === undefined) refuse('UnknownClip')
  const atStart = op.edge === 'start'
  if (op.timeMs === (atStart ? span.startMs : span.endMs)) return null
  const newLength = atStart ? span.endMs - op.timeMs : op.timeMs - span.startMs
  if (newLength < context.frameMs) refuse('TooShort')
  const target = span.clip
  let changed: Clip
  if (atStart) {
    // Moving the start edge later drops footage from the front; moving it earlier reveals footage before it.
    const moved = op.timeMs - span.startMs
    changed = { ...target, sourceStartMs: target.sourceStartMs + moved, durationMs: target.durationMs - moved }
  } else {
    changed = { ...target, durationMs: newLength }
  }
  // The clips after it follow on their own, because their place comes from the lengths before them.
  return t.clips.map((c) => (c.id === target.id ? changed : c))
}

/**
 * The parts of the clips that lie inside [fromMs, toMs), in order. The first piece of a clip keeps the clip's id so a
 * selection survives; a piece cut from the middle or end of a clip gets a new one. Copies (duplicate) always get new
 * ids.
 */
function slice(all: readonly Span[], fromMs: number, toMs: number, duplicate: boolean, context: EditContext): Clip[] {
  const pieces: Clip[] = []
  for (const span of all) {
    const left = Math.max(fromMs, span.startMs)
    const right = Math.min(toMs, span.endMs)
    if (right <= left) continue
    pieces.push({
      ...span.clip,
      id: duplicate || left > span.startMs ? context.newId() : span.clip.id,
      sourceStartMs: span.clip.sourceStartMs + (left - span.startMs),
      durationMs: right - left,
    })
  }
  return pieces
}
