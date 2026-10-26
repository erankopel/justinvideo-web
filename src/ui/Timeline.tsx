import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { type Edge, frameMs, type Span } from '../engine'
import { type AudioItem, audioEndMs } from '../engine/audio'
import type { CaptionCue } from '../engine/text'
import { formatClock } from '../i18n'
import type { Waveforms } from '../audio/waveforms'
import type { Source } from '../project/model'
import type { Filmstrip } from '../timeline/filmstrip'
import { lanesOf } from '../timeline/lanes'
import type { RangeEdge, TimeSpan } from '../timeline/range'
import { rulerLabel, rulerStepMs, rulerTicks } from '../timeline/ruler'
import type { SnapPoint } from '../timeline/snap'
import { seenAspect, tilesOf, tileWidthPx } from '../timeline/tiles'
import { trimHandleAt } from '../timeline/trim'
import { timeAt, viewport, xOf, zoomLimits } from '../timeline/viewport'
import { useTranslation } from './context'
import { FilmStrip } from './FilmStrip'
import { ZoomInIcon, ZoomOutIcon } from './icons'
import { pictureScale } from './useFilmstrip'
import { WaveBar } from './WaveBar'

/**
 * The vertical measures of the timeline: the ruler, where the track starts, and the margin under the last row. A touch screen
 * held on its side has so little height that the picture and the tools share what the timeline leaves, so there the three are smaller.
 */
const METRICS = { regular: { ruler: 28, trackTop: 38, bottom: 14 }, compact: { ruler: 22, trackTop: 28, bottom: 6 } }
const TRACK_PX = 64
const TEXT_ROW_GAP_PX = 6
const TEXT_LANE_GAP_PX = 3
const TEXT_LANES = 2
const AUDIO_LANES = 2
/**
 * How tall a lane of titles is, and a lane of music, which is taller to leave room for the waveform. Where the screen is touched
 * the lanes are taller than a pointer needs, so that a finger lands on the lane it means and not on the next one.
 */
const LANE_PX = { pointer: { text: 16, audio: 24 }, touch: { text: 30, audio: 36 } }
const FRAME_PX = 24
const MIN_LABEL_PX = 72
/** How far a pointer must move before a press stops being a tap and becomes a drag. */
const SLOP_PX = 6
/** How long a press on a clip has to stay still before the clip is picked up to be moved. A press that moves sooner scrubs. */
const HOLD_MS = 400
const ZOOM_STEP = 1.5
/** How far outside an edge a pointer may come down and still grab it. */
const HANDLE_REACH_PX = 26

export interface TimelineProps {
  /** The clips as drawn, which during a trim are the edit as it would be if the pointer let go. */
  spans: readonly Span[]
  /** The clips as saved, which the gestures measure against. */
  committed: readonly Span[]
  /** The recordings, for the shape of the pictures on the clips. */
  sources: readonly Source[]
  /** Where the pictures on the clips come from. */
  film: Filmstrip
  /** Where the waveforms of the music and voiceovers come from. */
  waves: Waveforms
  positionMs: number
  fps: number
  selectedId: string | null
  /** Where each title and caption is on screen, in the edit's own time. They are drawn in a row under the clips. */
  cues: readonly CaptionCue[]
  onTapText: (textId: string) => void
  /** The pieces of music and voiceover, in the edit's own time. They are drawn in a row under the texts. */
  audio: readonly AudioItem[]
  onTapAudio: (audioId: string) => void
  /** The stretch chosen with the range tool, if any. */
  range: TimeSpan | null
  /** What a dragged edge has stuck to. */
  guide: SnapPoint | null
  /** The pointer started to drag, so playback should stop. */
  onScrubStart: () => void
  onScrub: (ms: number) => void
  onSelect: (clipId: string | null) => void
  /** A tap on the ruler moves the playhead there. */
  onSeek: (ms: number) => void
  /** An edge of the selected clip is being dragged to rawTimeMs. */
  onTrimDrag: (clipId: string, edge: Edge, rawTimeMs: number, pxPerMs: number) => void
  /** The drag ended: keep the trim, or (if the pointer was cancelled) drop it. */
  onTrimEnd: (keep: boolean) => void
  onRangeDrag: (edge: RangeEdge, rawTimeMs: number, pxPerMs: number) => void
  onRangeEnd: () => void
  /** A piece of music or voiceover is being dragged, and its start would now be at rawStartMs. */
  onPieceDrag: (audioId: string, rawStartMs: number, pxPerMs: number) => void
  /** The drag ended: keep the move, or (if it was cancelled) drop it. */
  onPieceDragEnd: (keep: boolean) => void
  /** The texts that are titles, which can be dragged. The others are captions of a recording, which follow their footage. */
  titleIds: ReadonlySet<string>
  /** A title is being dragged, and its start would now be at rawStartMs. */
  onTitleDrag: (textId: string, rawStartMs: number, pxPerMs: number) => void
  onTitleDragEnd: (keep: boolean) => void
  /** The piece or title being dragged, if any, which is drawn lifted. */
  movingId: string | null
  /** A clip that has been picked up is dragged, offsetMs from its place: its new place is asked for as the pointer moves. */
  onClipDrag: (clipId: string, offsetMs: number, pxPerMs: number) => void
  onClipDragEnd: (keep: boolean) => void
  /** The clip being dragged and how far it is from its place, which it is drawn at, lifted. */
  clipDrag: { id: string; offsetMs: number } | null
}

interface Latest {
  metrics: typeof METRICS.regular
  props: TimelineProps
  zoom: number
  limits: { farthest: number; closest: number }
  width: number
  setZoom: (zoom: number) => void
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

/** Whether the main way of pointing is a finger. */
const touchScreen = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/** Whether this is a touch screen held on its side, which has little height (the same words as the styles of the page use). */
const onItsSide = (): boolean => typeof matchMedia === 'function' && matchMedia('(orientation: landscape) and (max-height: 520px) and (pointer: coarse)').matches

/** Draws the component again when something it shows arrives from a source that reports it, at most once a frame. */
function useRedrawnBy(source: { subscribe(listener: () => void): () => void }): void {
  const [, setArrivals] = useState(0)
  useEffect(() => {
    let frame = 0
    const stop = source.subscribe(() => {
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0
          setArrivals((n) => n + 1)
        })
      }
    })
    return () => {
      stop()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [source])
}

/**
 * The edit as clips on one track, with the playhead fixed at the centre. Drag along it to scrub, pinch or use ctrl and
 * the wheel to zoom, click a clip to select it. Time runs left to right in every language, so the whole timeline is laid
 * out left to right. The clips are buttons, so a keyboard or a screen reader can select them too.
 */
export function Timeline(props: TimelineProps) {
  const { t } = useTranslation()
  const surface = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [zoomValue, setZoomValue] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = surface.current
    if (!element) return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const frame = frameMs(props.fps)
  const committedDuration = props.committed[props.committed.length - 1]?.endMs ?? 0
  const drawnDuration = props.spans[props.spans.length - 1]?.endMs ?? 0
  const limits = width > 0 ? zoomLimits(committedDuration, width, frame, FRAME_PX) : { farthest: 0.0001, closest: 1 }
  // The first view shows the whole edit; after that the zoom is the person's, kept inside what the edit allows.
  const zoom = clamp(zoomValue ?? limits.farthest, limits.farthest, limits.closest)
  const view = viewport(zoom)
  const center = width / 2
  const position = props.positionMs

  const metrics = onItsSide() ? METRICS.compact : METRICS.regular
  const latest = useRef<Latest>({ metrics, props, zoom, limits, width, setZoom: setZoomValue })
  latest.current = { metrics, props, zoom, limits, width, setZoom: setZoomValue }

  // The pictures on the clips and the waveforms arrive one by one; the timeline is drawn again for them, at most once a frame.
  const { film, waves } = props
  useRedrawnBy(film)
  useRedrawnBy(waves)
  // The frames the clips in view need, the ones nearest the playhead first. They are told to the film after each drawing.
  const wantedFrames: { sourceId: string; timeMs: number; priority: number }[] = []
  useEffect(() => {
    film.want(wantedFrames.sort((a, b) => a.priority - b.priority))
  })
  const wantedWaves: { file: string; durationMs: number; priority: number }[] = []
  useEffect(() => {
    waves.want(wantedWaves.sort((a, b) => a.priority - b.priority))
  })

  useEffect(() => {
    const element = surface.current
    if (!element) return

    type Gesture =
      | { kind: 'scrub'; startX: number; startPosition: number; target: EventTarget | null; pastSlop: boolean; scrubbing: boolean }
      | { kind: 'trim'; clipId: string; edge: Edge; grab: number; zoom: number; playhead: number }
      | { kind: 'range'; edge: RangeEdge; grab: number; zoom: number; playhead: number }
      | { kind: 'clip'; id: string; zoom: number; startX: number; dragging: boolean }
      | { kind: 'piece'; what: 'audio' | 'title'; id: string; grab: number; zoom: number; playhead: number; startX: number; dragging: boolean }

    const pointers = new Map<number, { x: number; y: number }>()
    let gesture: Gesture | null = null
    let pinch: { distance: number; zoom: number } | null = null
    // A press on a clip that stays still for HOLD_MS picks the clip up; moving first, or letting go, ends the wait.
    let hold: ReturnType<typeof setTimeout> | null = null
    const endHold = (): void => {
      if (hold !== null) clearTimeout(hold)
      hold = null
    }

    const distance = (): number => {
      const [a, b] = [...pointers.values()]
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
    }

    /** The piece of music or voiceover, or the title, that an element is part of, and where it starts. */
    const grabbedAt = (target: Element): { what: 'audio' | 'title'; id: string; startMs: number } | null => {
      const props = latest.current.props
      const audioId = target.closest<HTMLElement>('[data-audio-id]')?.dataset['audioId']
      if (audioId) {
        const item = props.audio.find((piece) => piece.id === audioId)
        return item ? { what: 'audio', id: item.id, startMs: item.startMs } : null
      }
      const textId = target.closest<HTMLElement>('[data-text-id]')?.dataset['textId']
      if (textId && props.titleIds.has(textId)) {
        const cue = props.cues.find((c) => c.id === textId)
        return cue ? { what: 'title', id: cue.id, startMs: cue.startMs } : null
      }
      return null
    }

    // A press that is held on a touch screen is, to some browsers, a request for a menu: it is the pick-up of a clip here.
    let lastPointerType = 'mouse'
    const menu = (event: Event): void => {
      if (lastPointerType !== 'mouse') event.preventDefault()
    }

    const down = (event: PointerEvent): void => {
      lastPointerType = event.pointerType
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const now = latest.current
      if (gesture && gesture.kind !== 'scrub') return
      if (pointers.size === 0) {
        const box = element.getBoundingClientRect()
        const x = event.clientX - box.left
        const y = event.clientY - box.top
        const view = viewport(now.zoom)
        const middle = now.width / 2
        const playhead = now.props.positionMs
        // A handle of the range comes first: the pointer must start on it.
        const range = now.props.range
        if (range) {
          const startX = xOf(view, range.startMs, playhead, middle)
          const endX = xOf(view, range.endMs, playhead, middle)
          const toStart = Math.abs(x - startX)
          const toEnd = Math.abs(x - endX)
          const edge: RangeEdge | null = toStart <= HANDLE_REACH_PX && toStart <= toEnd ? 'start' : toEnd <= HANDLE_REACH_PX ? 'end' : null
          if (edge) {
            element.setPointerCapture(event.pointerId)
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
            gesture = { kind: 'range', edge, grab: (edge === 'start' ? startX : endX) - x, zoom: now.zoom, playhead }
            return
          }
        }
        // Then a handle of the selected clip, on the track: the grab reaches outside the clip, and a quarter of its width inside.
        const selected = now.props.committed.find((span) => span.clip.id === now.props.selectedId)
        if (selected && y > now.metrics.ruler && y < now.metrics.trackTop + TRACK_PX + 4) {
          const startX = xOf(view, selected.startMs, playhead, middle)
          const endX = xOf(view, selected.endMs, playhead, middle)
          const edge = trimHandleAt(x, startX, endX, HANDLE_REACH_PX)
          if (edge) {
            element.setPointerCapture(event.pointerId)
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
            gesture = { kind: 'trim', clipId: selected.clip.id, edge, grab: (edge === 'start' ? startX : endX) - x, zoom: now.zoom, playhead }
            return
          }
        }
      }
      // A piece of music or voiceover, or a title, is grabbed anywhere on it: a press that moves moves it, and one that does
      // not opens it. A caption of a recording is not: it follows its footage, so a press on it scrubs and a tap opens it.
      const grabbed = pointers.size === 0 && event.target instanceof Element ? grabbedAt(event.target) : null
      if (grabbed) {
        const box = element.getBoundingClientRect()
        const startX = xOf(viewport(now.zoom), grabbed.startMs, now.props.positionMs, now.width / 2)
        element.setPointerCapture(event.pointerId)
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
        gesture = { kind: 'piece', what: grabbed.what, id: grabbed.id, grab: startX - (event.clientX - box.left), zoom: now.zoom, playhead: now.props.positionMs, startX: event.clientX, dragging: false }
        return
      }
      element.setPointerCapture(event.pointerId)
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointers.size === 1) {
        gesture = { kind: 'scrub', startX: event.clientX, startPosition: now.props.positionMs, target: event.target, pastSlop: false, scrubbing: false }
        // Only if there is another clip to change places with.
        const clipId = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-clip-id]')?.dataset['clipId'] : undefined
        const pointerId = event.pointerId
        if (clipId && now.props.committed.length > 1) {
          hold = setTimeout(() => {
            hold = null
            const here = latest.current
            const at = pointers.get(pointerId)
            if (gesture?.kind !== 'scrub' || gesture.pastSlop || !at || !here.props.committed.some((span) => span.clip.id === clipId)) return
            // Picked up: the clip is selected and lifted where it is, and goes where the pointer goes from here.
            gesture = { kind: 'clip', id: clipId, zoom: here.zoom, startX: at.x, dragging: true }
            here.props.onSelect(clipId)
            here.props.onScrubStart()
            here.props.onClipDrag(clipId, 0, here.zoom)
          }, HOLD_MS)
        }
      } else if (pointers.size === 2 && gesture?.kind === 'scrub') {
        endHold()
        gesture.pastSlop = true
        pinch = { distance: distance(), zoom: now.zoom }
      }
    }

    const move = (event: PointerEvent): void => {
      if (!pointers.has(event.pointerId) || !gesture) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const now = latest.current
      if (gesture.kind === 'clip') {
        const dx = event.clientX - gesture.startX
        if (!gesture.dragging && Math.abs(dx) <= SLOP_PX) return
        if (!gesture.dragging) {
          gesture.dragging = true
          now.props.onScrubStart()
        }
        now.props.onClipDrag(gesture.id, dx / gesture.zoom, gesture.zoom)
        return
      }
      if (gesture.kind === 'piece') {
        if (!gesture.dragging && Math.abs(event.clientX - gesture.startX) <= SLOP_PX) return
        if (!gesture.dragging) {
          gesture.dragging = true
          now.props.onScrubStart()
        }
        const x = event.clientX - element.getBoundingClientRect().left
        const raw = timeAt(viewport(gesture.zoom), x + gesture.grab, gesture.playhead, now.width / 2)
        if (gesture.what === 'audio') now.props.onPieceDrag(gesture.id, raw, gesture.zoom)
        else now.props.onTitleDrag(gesture.id, raw, gesture.zoom)
        return
      }
      if (gesture.kind === 'trim' || gesture.kind === 'range') {
        const x = event.clientX - element.getBoundingClientRect().left
        const raw = timeAt(viewport(gesture.zoom), x + gesture.grab, gesture.playhead, now.width / 2)
        if (gesture.kind === 'trim') now.props.onTrimDrag(gesture.clipId, gesture.edge, raw, gesture.zoom)
        else now.props.onRangeDrag(gesture.edge, raw, gesture.zoom)
        return
      }
      if (pointers.size >= 2 && pinch) {
        if (pinch.distance > 0) now.setZoom(clamp(pinch.zoom * (distance() / pinch.distance), now.limits.farthest, now.limits.closest))
        return
      }
      const dx = event.clientX - gesture.startX
      if (!gesture.pastSlop && Math.abs(dx) > SLOP_PX) {
        gesture.pastSlop = true
        endHold()
      }
      if (!gesture.pastSlop) return
      if (!gesture.scrubbing) {
        gesture.scrubbing = true
        now.props.onScrubStart()
      }
      const duration = now.props.committed[now.props.committed.length - 1]?.endMs ?? 0
      now.props.onScrub(Math.round(clamp(gesture.startPosition - dx / now.zoom, 0, duration)))
    }

    const up = (event: PointerEvent): void => {
      endHold()
      if (!pointers.delete(event.pointerId) || !gesture) return
      const now = latest.current
      if (gesture.kind !== 'scrub') {
        const finished = gesture
        gesture = null
        if (finished.kind === 'trim') now.props.onTrimEnd(event.type !== 'pointercancel')
        else if (finished.kind === 'range') now.props.onRangeEnd()
        else if (finished.kind === 'clip') {
          if (finished.dragging) now.props.onClipDragEnd(event.type !== 'pointercancel')
          else if (event.type !== 'pointercancel') now.props.onSelect(finished.id)
        } else if (finished.dragging) (finished.what === 'audio' ? now.props.onPieceDragEnd : now.props.onTitleDragEnd)(event.type !== 'pointercancel')
        else if (event.type !== 'pointercancel') (finished.what === 'audio' ? now.props.onTapAudio : now.props.onTapText)(finished.id)
        return
      }
      if (pointers.size > 0) {
        // One of two fingers lifted: the other carries on as a drag from where it is.
        const [rest] = [...pointers.values()]
        if (rest) gesture = { ...gesture, startX: rest.x, startPosition: now.props.positionMs, scrubbing: false }
        pinch = null
        return
      }
      const finished = gesture
      gesture = null
      pinch = null
      if (event.type === 'pointercancel' || finished.pastSlop) return
      // A press that did not move is a tap: on the ruler it moves the playhead, elsewhere it selects the clip under it.
      const box = element.getBoundingClientRect()
      const duration = now.props.committed[now.props.committed.length - 1]?.endMs ?? 0
      if (event.clientY - box.top < now.metrics.ruler) {
        const time = timeAt(viewport(now.zoom), event.clientX - box.left, now.props.positionMs, now.width / 2)
        now.props.onSeek(clamp(time, 0, duration))
      } else {
        const text = finished.target instanceof Element ? finished.target.closest<HTMLElement>('[data-text-id]') : null
        const sound = finished.target instanceof Element ? finished.target.closest<HTMLElement>('[data-audio-id]') : null
        const clip = finished.target instanceof Element ? finished.target.closest<HTMLElement>('[data-clip-id]') : null
        if (text?.dataset['textId']) now.props.onTapText(text.dataset['textId'])
        else if (sound?.dataset['audioId']) now.props.onTapAudio(sound.dataset['audioId'])
        else now.props.onSelect(clip?.dataset['clipId'] ?? null)
      }
    }

    const wheel = (event: WheelEvent): void => {
      event.preventDefault()
      const now = latest.current
      if (event.ctrlKey) {
        // A trackpad pinch arrives as a wheel with ctrl held.
        now.setZoom(clamp(now.zoom * Math.exp(-event.deltaY * 0.01), now.limits.farthest, now.limits.closest))
        return
      }
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      const unit = event.deltaMode === 1 ? 16 : 1
      const duration = now.props.committed[now.props.committed.length - 1]?.endMs ?? 0
      now.props.onScrubStart()
      now.props.onScrub(Math.round(clamp(now.props.positionMs + (delta * unit) / now.zoom, 0, duration)))
    }

    // Escape lets go of a piece or title that is being dragged, leaving it where it was.
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || (gesture?.kind !== 'piece' && gesture?.kind !== 'clip')) return
      const cancelled = gesture
      gesture = null
      pointers.clear()
      if (!cancelled.dragging) return
      if (cancelled.kind === 'clip') latest.current.props.onClipDragEnd(false)
      else (cancelled.what === 'audio' ? latest.current.props.onPieceDragEnd : latest.current.props.onTitleDragEnd)(false)
    }
    document.addEventListener('keydown', key)
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
    element.addEventListener('contextmenu', menu)
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      endHold()
      document.removeEventListener('keydown', key)
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
      element.removeEventListener('contextmenu', menu)
      element.removeEventListener('wheel', wheel)
    }
  }, [])

  const from = timeAt(view, 0, position, center)
  const to = timeAt(view, width, position, center)
  const stepMs = rulerStepMs(zoom, MIN_LABEL_PX)
  const ticks = width > 0 ? rulerTicks(from, to, stepMs, drawnDuration) : []
  // Clips that are partly out of view are cut to a little beyond it, so no coordinate grows past what a browser can lay out.
  const room = 64
  const trackLeft = xOf(view, 0, position, center)
  const trackRight = xOf(view, drawnDuration, position, center)
  const sourceOrder = [...new Set(props.spans.map((span) => span.clip.sourceId))]
  const sourceById = new Map(props.sources.map((source) => [source.id, source]))
  const scale = pictureScale()
  const lanes = lanesOf(props.cues, (cue) => cue.startMs, (cue) => cue.endMs, TEXT_LANES)
  const audioLanes = lanesOf(props.audio, (item) => item.startMs, audioEndMs, AUDIO_LANES)
  const touch = touchScreen()
  const lane = touch ? LANE_PX.touch : LANE_PX.pointer
  // On a phone every pixel of height is the picture's, so a row has as many lanes as are in use; elsewhere it keeps both.
  const lanesUsed = (assigned: readonly number[], most: number): number => (touch ? assigned.reduce((used, at) => Math.max(used, at + 1), 1) : most)
  const textLanes = lanesUsed(lanes, TEXT_LANES)
  const audioLaneCount = lanesUsed(audioLanes, AUDIO_LANES)
  const textRowPx = lane.text * textLanes + TEXT_LANE_GAP_PX * (textLanes - 1)
  const audioRowPx = lane.audio * audioLaneCount + TEXT_LANE_GAP_PX * (audioLaneCount - 1)
  const textTop = metrics.trackTop + TRACK_PX + TEXT_ROW_GAP_PX
  const rowsBottom = props.cues.length > 0 ? textTop + textRowPx : metrics.trackTop + TRACK_PX
  const audioTop = rowsBottom + TEXT_ROW_GAP_PX
  const heightPx = (props.audio.length > 0 ? audioTop + audioRowPx : rowsBottom) + metrics.bottom
  const zoomBy = (scale: number): void => setZoomValue(clamp(zoom * scale, limits.farthest, limits.closest))

  return (
    <div class="timeline-block" dir="ltr">
      <div class="zoom">
        <button type="button" class="icon" aria-label={t('zoomOut')} title={t('zoomOut')} onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={zoom <= limits.farthest} data-testid="zoom-out">
          <ZoomOutIcon />
        </button>
        <button type="button" class="icon" aria-label={t('zoomIn')} title={t('zoomIn')} onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= limits.closest} data-testid="zoom-in">
          <ZoomInIcon />
        </button>
      </div>
      <div
        class="timeline"
        ref={surface}
        role="group"
        aria-label={t('timelineDescription', { n: props.spans.length })}
        style={{ height: `${heightPx}px`, '--ruler': `${metrics.ruler}px` }}
        data-testid="timeline"
        data-zoom={zoom}
        data-position={position}
      >
        <div class="ruler" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick.timeMs} class={tick.major ? 'tick major' : 'tick'} style={{ left: `${xOf(view, tick.timeMs, position, center)}px` }}>
              {rulerLabel(tick.timeMs, stepMs)}
            </span>
          ))}
        </div>
        <div class="extent" style={{ left: `${clamp(trackLeft, -room, width + room)}px`, width: `${Math.max(0, clamp(trackRight, -room, width + room) - clamp(trackLeft, -room, width + room))}px`, top: `${metrics.trackTop}px`, height: `${TRACK_PX}px` }} />
        {props.spans.map((span, index) => {
          // A clip that is being dragged is where the pointer has taken it; the others stay where they are.
          const dragged = props.clipDrag?.id === span.clip.id
          const shift = dragged ? (props.clipDrag?.offsetMs ?? 0) * zoom : 0
          const left = xOf(view, span.startMs, position, center) + shift
          const right = xOf(view, span.endMs, position, center) + shift
          if (right < -room || left > width + room) return null
          const shownLeft = clamp(left, -room, width + room)
          const shownRight = clamp(right, -room, width + room)
          const source = sourceById.get(span.clip.sourceId)
          const stripWidth = Math.max(2, shownRight - shownLeft - 2)
          const tiles = source
            ? tilesOf({
                clipLeft: left,
                originX: shownLeft + 1,
                drawnWidth: stripWidth,
                pxPerMs: zoom,
                tileWidth: tileWidthPx(seenAspect(source.width, source.height, source.rotationDegrees)),
                sourceStartMs: span.clip.sourceStartMs,
                durationMs: span.clip.durationMs,
              })
            : []
          for (const tile of tiles) {
            wantedFrames.push({ sourceId: span.clip.sourceId, timeMs: tile.timeMs, priority: Math.abs(shownLeft + 1 + tile.x + tile.width / 2 - center) })
          }
          return (
            <div
              key={span.clip.id}
              class={`clip s${sourceOrder.indexOf(span.clip.sourceId) % 3}${span.clip.id === props.selectedId ? ' selected' : ''}${dragged ? ' moving' : ''}`}
              role="button"
              tabIndex={0}
              aria-pressed={span.clip.id === props.selectedId}
              aria-label={t('clipDescription', { n: index + 1, from: formatClock(span.startMs), to: formatClock(span.endMs) })}
              data-clip-id={span.clip.id}
              data-source={span.clip.sourceId}
              style={{ left: `${shownLeft + 1}px`, width: `${Math.max(2, shownRight - shownLeft - 2)}px`, top: `${metrics.trackTop}px`, height: `${TRACK_PX}px` }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  props.onSelect(span.clip.id === props.selectedId ? null : span.clip.id)
                }
              }}
            >
              {tiles.length > 0 && <FilmStrip film={film} sourceId={span.clip.sourceId} tiles={tiles} width={stripWidth} scale={scale} />}
              <span class="label">
                {index + 1} · {formatClock(span.clip.durationMs)}
              </span>
              {span.clip.id === props.selectedId && (
                <>
                  <span class="handle start" data-testid="trim-start" title={t('trimStart')} aria-hidden="true" />
                  <span class="handle end" data-testid="trim-end" title={t('trimEnd')} aria-hidden="true" />
                </>
              )}
            </div>
          )
        })}
        {props.cues.map((cue, index) => {
          const left = xOf(view, cue.startMs, position, center)
          const right = xOf(view, cue.endMs, position, center)
          if (right < -room || left > width + room) return null
          const shownLeft = clamp(left, -room, width + room)
          const shownRight = clamp(right, -room, width + room)
          const first = cue.text.split('\n')[0] ?? ''
          return (
            <div
              key={`${cue.id}:${cue.startMs}`}
              class={`cue${props.titleIds.has(cue.id) ? ' movable' : ''}${cue.id === props.movingId ? ' moving' : ''}`}
              role="button"
              tabIndex={0}
              data-text-id={cue.id}
              data-start={cue.startMs}
              data-end={cue.endMs}
              aria-label={t('textCueDescription', { text: first, from: formatClock(cue.startMs), to: formatClock(cue.endMs) })}
              style={{ left: `${shownLeft + 1}px`, width: `${Math.max(12, shownRight - shownLeft - 2)}px`, top: `${textTop + (lanes[index] ?? 0) * (lane.text + TEXT_LANE_GAP_PX)}px`, height: `${lane.text}px`, lineHeight: `${lane.text}px` }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  props.onTapText(cue.id)
                }
              }}
            >
              <span dir="auto">{first}</span>
            </div>
          )
        })}
        {props.audio.map((item, index) => {
          const left = xOf(view, item.startMs, position, center)
          const right = xOf(view, audioEndMs(item), position, center)
          if (right < -room || left > width + room) return null
          const shownLeft = clamp(left, -room, width + room)
          const shownRight = clamp(right, -room, width + room)
          const kind = t(item.kind === 'music' ? 'audioKindMusic' : 'audioKindVoiceover')
          const barWidth = Math.max(12, shownRight - shownLeft - 2)
          const peaks = waves.get(item.file)
          wantedWaves.push({ file: item.file, durationMs: item.fileDurationMs, priority: Math.abs(shownLeft + 1 + barWidth / 2 - center) })
          return (
            <div
              key={item.id}
              class={`audio-bar ${item.kind}${item.id === props.movingId ? ' moving' : ''}`}
              role="button"
              tabIndex={0}
              data-audio-id={item.id}
              data-start={item.startMs}
              data-end={audioEndMs(item)}
              aria-label={t('audioCueDescription', { kind, name: item.displayName, from: formatClock(item.startMs), to: formatClock(audioEndMs(item)) })}
              style={{ left: `${shownLeft + 1}px`, width: `${barWidth}px`, top: `${audioTop + (audioLanes[index] ?? 0) * (lane.audio + TEXT_LANE_GAP_PX)}px`, height: `${lane.audio}px`, lineHeight: `${lane.audio}px` }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  props.onTapAudio(item.id)
                }
              }}
            >
              {peaks && <WaveBar peaks={peaks} item={item} itemLeft={left} originX={shownLeft + 1} width={barWidth} height={lane.audio} pxPerMs={zoom} scale={scale} />}
              <span dir="auto">{item.displayName}</span>
            </div>
          )
        })}
        {props.range && (
          <div
            class="range"
            data-testid="range"
            data-start={props.range.startMs}
            data-end={props.range.endMs}
            aria-hidden="true"
            style={{
              left: `${clamp(xOf(view, props.range.startMs, position, center), -room, width + room)}px`,
              width: `${Math.max(2, clamp(xOf(view, props.range.endMs, position, center), -room, width + room) - clamp(xOf(view, props.range.startMs, position, center), -room, width + room))}px`,
              top: `${metrics.ruler}px`,
            }}
          >
            <span class="range-handle start" title={t('rangeStart')} />
            <span class="range-handle end" title={t('rangeEnd')} />
          </div>
        )}
        {props.guide && <div class="guide" data-testid="guide" data-time={props.guide.timeMs} aria-hidden="true" style={{ left: `${xOf(view, props.guide.timeMs, position, center)}px` }} />}
        <div class="playhead" aria-hidden="true" />
      </div>
    </div>
  )
}
