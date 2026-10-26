import { useMemo, useRef, useState } from 'preact/hooks'
import { applyEdit, type Edge, type EditOp, type Span, type Timeline } from '../engine'
import { type AudioItem, type AudioOp, type AudioResult, audioEndMs } from '../engine/audio'
import { sameData } from '../engine/equal'
import { resolveCues, type TextItem, type TextOp, type TextResult } from '../engine/text'
import type { EditAction } from '../editing/actions'
import { projectContext, type Project } from '../project/model'
import { pieceTarget, titleTarget } from '../timeline/pieces'
import { clampedOffset, clipDropTarget } from '../timeline/reorder'
import { type RangeEdge, rangeTarget, type TimeSpan } from '../timeline/range'
import type { SnapPoint } from '../timeline/snap'
import { trimTarget } from '../timeline/trim'
import type { Notice } from './notice'

export interface DragInputs {
  project: Project
  clipSpans: readonly Span[]
  snapping: boolean
  range: TimeSpan | null
  setRange: (range: TimeSpan | null) => void
  /** Where the playhead is, and whether a voiceover is being recorded (the edit is left alone), as of this moment and not the last render. */
  positionRef: { readonly current: number }
  recordingRef: { readonly current: unknown }
  mixRef: { readonly current: Project['edit']['mix'] }
  /** Makes an edit as one undo step, and says whether it was made. */
  act: (action: EditAction | null) => boolean
  onText: (op: TextOp) => TextResult
  onAudio: (op: AudioOp) => AudioResult
  setNotice: (notice: Notice | null) => void
}

/**
 * The gestures that take a thing off its place and put it down somewhere else: trimming a clip by its edge, taking a clip past
 * its neighbours, moving a piece of music or a title, and dragging the ends of the range. While one goes on, what the edit would
 * be if it were let go is drawn (a draft, with a guide where it has stuck to something) and nothing is saved; letting go saves it as
 * one undo step, and a gesture that is cancelled leaves everything as it was. Letting go can come before the screen has caught up
 * with the last move, so what would be saved is kept in a ref as well.
 */
export function useDragEdits({ project, clipSpans, snapping, range, setRange, positionRef, recordingRef, mixRef, act, onText, onAudio, setNotice }: DragInputs) {
  const edit = project.edit
  const fps = project.fps
  // While an edge is dragged the edit as it would be on release is drawn, and nothing is saved yet.
  const [draft, setDraft] = useState<Timeline | null>(null)
  const [guide, setGuide] = useState<SnapPoint | null>(null)
  const pendingTrim = useRef<EditOp | null>(null)
  // While a piece of music or voiceover is dragged, it is drawn where it would land; nothing is saved until it is let go.
  const [pieceDraft, setPieceDraft] = useState<AudioItem | null>(null)
  const pendingPiece = useRef<AudioItem | null>(null)
  // The selected clip while it is dragged: how far it is from its place, and the move that letting go would make.
  const [clipDrag, setClipDrag] = useState<{ id: string; offsetMs: number } | null>(null)
  const pendingClipMove = useRef<EditAction | null>(null)
  // A title that is being dragged is shown where it would land, in the timeline and on the picture.
  const [titleDraft, setTitleDraft] = useState<TextItem | null>(null)
  const pendingTitle = useRef<TextItem | null>(null)
  // Where each title and caption is on screen.
  const shownTexts = useMemo(() => (titleDraft ? edit.texts.map((text) => (text.id === titleDraft.id ? titleDraft : text)) : edit.texts), [edit.texts, titleDraft])
  const cues = useMemo(() => resolveCues(edit.timeline, shownTexts), [edit.timeline, shownTexts])
  const titleIds = useMemo(() => new Set(edit.texts.filter((text) => text.placement.type === 'onOutput').map((text) => text.id)), [edit.texts])

  const trimDrag = (clipId: string, edge: Edge, rawTimeMs: number, pxPerMs: number): void => {
    if (recordingRef.current) return
    const clip = edit.timeline.clips.find((c) => c.id === clipId)
    const source = clip && project.sources.find((s) => s.id === clip.sourceId)
    if (!clip || !source) return
    const target = trimTarget(edit.timeline, clipId, edge, rawTimeMs, source.durationMs, fps, snapping, pxPerMs, positionRef.current)
    if (!target) return
    const result = applyEdit(edit.timeline, target.op, projectContext(project))
    setDraft(result.kind === 'changed' ? result.timeline : null)
    pendingTrim.current = result.kind === 'changed' ? target.op : null
    setGuide(target.snappedTo)
  }
  const trimEnd = (keep: boolean): void => {
    const op = pendingTrim.current
    pendingTrim.current = null
    setDraft(null)
    setGuide(null)
    if (keep && op) act({ op })
  }

  const clipDragMove = (clipId: string, rawOffsetMs: number): void => {
    if (recordingRef.current) return
    const offsetMs = clampedOffset(clipSpans, clipId, rawOffsetMs)
    const drop = clipDropTarget(clipSpans, clipId, offsetMs)
    pendingClipMove.current = drop?.action ?? null
    setClipDrag({ id: clipId, offsetMs })
    setGuide(drop ? { timeMs: drop.boundaryMs, kind: 'clipEdge' } : null)
  }
  const clipDragEnd = (keep: boolean): void => {
    const action = pendingClipMove.current
    pendingClipMove.current = null
    setClipDrag(null)
    setGuide(null)
    if (keep && action) act(action)
  }

  const rangeDrag = (edge: RangeEdge, rawTimeMs: number, pxPerMs: number): void => {
    if (!range || recordingRef.current) return
    const target = rangeTarget(edit.timeline, range, edge, rawTimeMs, fps, snapping, pxPerMs, positionRef.current)
    setRange(target.range)
    setGuide(target.snappedTo)
  }

  const pieceDrag = (id: string, rawStartMs: number, pxPerMs: number): void => {
    if (recordingRef.current) return
    const item = mixRef.current.items.find((piece) => piece.id === id)
    if (!item) return
    // It sticks to the other pieces and to the titles and captions.
    const others = [
      ...mixRef.current.items.filter((piece) => piece.id !== id).map((piece) => ({ startMs: piece.startMs, endMs: audioEndMs(piece) })),
      ...cues.map((cue) => ({ startMs: cue.startMs, endMs: cue.endMs })),
    ]
    const target = pieceTarget({ item, rawStartMs, others, timeline: edit.timeline, playheadMs: positionRef.current, snapping, pxPerMs })
    pendingPiece.current = target.item
    setPieceDraft(target.item)
    setGuide(target.snappedTo)
  }
  const pieceDragEnd = (keep: boolean): void => {
    const moved = pendingPiece.current
    pendingPiece.current = null
    setPieceDraft(null)
    setGuide(null)
    const original = moved && mixRef.current.items.find((piece) => piece.id === moved.id)
    if (!keep || !moved || !original || original.startMs === moved.startMs) return
    if (onAudio({ type: 'replace', item: moved }).kind === 'rejected') setNotice({ key: 'audioRefused' })
    else setNotice(null)
  }

  const titleDrag = (id: string, rawStartMs: number, pxPerMs: number): void => {
    if (recordingRef.current) return
    const item = edit.texts.find((text) => text.id === id)
    if (!item || item.placement.type !== 'onOutput') return
    // It sticks to the pieces of music and voiceover, and to the other titles and captions.
    const others = [
      ...mixRef.current.items.map((piece) => ({ startMs: piece.startMs, endMs: audioEndMs(piece) })),
      ...cues.filter((cue) => cue.id !== id).map((cue) => ({ startMs: cue.startMs, endMs: cue.endMs })),
    ]
    const target = titleTarget({ item: { ...item, placement: item.placement }, rawStartMs, others, timeline: edit.timeline, playheadMs: positionRef.current, snapping, pxPerMs })
    pendingTitle.current = target.item
    setTitleDraft(target.item)
    setGuide(target.snappedTo)
  }
  const titleDragEnd = (keep: boolean): void => {
    const moved = pendingTitle.current
    pendingTitle.current = null
    setTitleDraft(null)
    setGuide(null)
    const original = moved && edit.texts.find((text) => text.id === moved.id)
    if (!keep || !moved || !original || sameData(original.placement, moved.placement)) return
    if (onText({ type: 'replace', item: moved }).kind === 'rejected') setNotice({ key: 'textRefused' })
    else setNotice(null)
  }

  return {
    /** The edit as it would be if an edge being trimmed were let go, or null. */
    draft,
    /** What a dragged edge or piece has stuck to. */
    guide,
    clearGuide: () => setGuide(null),
    clipDrag,
    pieceDraft,
    titleDraft,
    /** Where each title and caption is on screen, with a title that is being dragged where it would land. */
    cues,
    /** The texts that are titles, which can be dragged. */
    titleIds,
    trimDrag,
    trimEnd,
    clipDragMove,
    clipDragEnd,
    rangeDrag,
    pieceDrag,
    pieceDragEnd,
    titleDrag,
    titleDragEnd,
  }
}
