import { DEFAULT_VOLUME_PERCENT, type Timeline } from '../engine'
import type { Project, Source } from '../project/model'

/** The shape of the exported picture. */
export type ExportShape = 'vertical' | 'wide' | 'square'

/** What to do when the footage has another shape than the export: fill the frame and crop, or fit inside it with bars. */
export type ExportFraming = 'fill' | 'fit'

/** The export's size as the length of its short side in pixels. */
export type ExportQuality = 'p720' | 'p1080'

export const EXPORT_SHAPES: readonly ExportShape[] = ['vertical', 'wide', 'square']
export const EXPORT_QUALITIES: readonly ExportQuality[] = ['p720', 'p1080']
export const EXPORT_FRAMINGS: readonly ExportFraming[] = ['fill', 'fit']

const SHORT_SIDE: Readonly<Record<ExportQuality, number>> = { p720: 720, p1080: 1080 }

/** The frame rates an export offers. */
export const EXPORT_FRAME_RATES: readonly number[] = [30, 60]

export interface ExportSettings {
  readonly shape: ExportShape
  readonly quality: ExportQuality
  readonly framing: ExportFraming
  readonly fps: number
}

export function exportSettings(shape: ExportShape, quality: ExportQuality, framing: ExportFraming = 'fill', fps = 30): ExportSettings {
  if (!EXPORT_FRAME_RATES.includes(fps)) throw new RangeError(`Unsupported export frame rate: ${fps}`)
  return { shape, quality, framing, fps }
}

export interface OutputSize {
  readonly width: number
  readonly height: number
}

/** The picture's size in pixels. Both sides are even, as video encoders need. */
export function outputSize(settings: ExportSettings): OutputSize {
  const short = SHORT_SIDE[settings.quality]
  const long = Math.floor((short * 16) / 9)
  switch (settings.shape) {
    case 'vertical':
      return { width: short, height: long }
    case 'wide':
      return { width: long, height: short }
    case 'square':
      return { width: short, height: short }
  }
}

/** The width and height of a recording as it is shown, after the rotation its file asks for. */
export function shownSize(source: Source): OutputSize {
  const turned = source.rotationDegrees % 180 === 90
  return turned ? { width: source.height, height: source.width } : { width: source.width, height: source.height }
}

/**
 * The settings an export starts with: the shape of the first clip, the largest size that the footage can fill (a 720p
 * recording gains nothing from 1080p), filling the frame, and 30 frames per second.
 */
export function defaultExportSettings(project: Project): ExportSettings {
  const sources = project.edit.timeline.clips
    .map((clip) => project.sources.find((source) => source.id === clip.sourceId))
    .filter((source): source is Source => source !== undefined)
  const first = sources[0]
  const firstSize = first ? shownSize(first) : null
  const shape: ExportShape = !firstSize || firstSize.width > firstSize.height ? 'wide' : firstSize.width < firstSize.height ? 'vertical' : 'square'
  const largestShortSide = sources.reduce((largest, source) => {
    const size = shownSize(source)
    return Math.max(largest, Math.min(size.width, size.height))
  }, 0)
  return exportSettings(shape, largestShortSide >= SHORT_SIDE.p1080 ? 'p1080' : 'p720')
}

/** A part of one recording that the export keeps, from startMs up to endMs of that recording. */
export interface ExportPiece {
  readonly sourceId: string
  readonly startMs: number
  readonly endMs: number
  readonly volumePercent: number
}

export const pieceDurationMs = (piece: ExportPiece): number => piece.endMs - piece.startMs

/**
 * The edit as the parts of recordings to join. Clips that continue each other in the same recording, such as the two
 * halves of a split, become one piece: the export then plays through the join without cutting there, so no frame can be
 * lost or repeated at it. Clips of different volumes stay apart, as the volume belongs to a piece.
 */
export function exportPieces(timeline: Timeline): ExportPiece[] {
  const pieces: ExportPiece[] = []
  for (const clip of timeline.clips) {
    const end = clip.sourceStartMs + clip.durationMs
    const last = pieces[pieces.length - 1]
    if (last && last.sourceId === clip.sourceId && last.endMs === clip.sourceStartMs && last.volumePercent === clip.volumePercent) {
      pieces[pieces.length - 1] = { ...last, endMs: end }
    } else {
      pieces.push({ sourceId: clip.sourceId, startMs: clip.sourceStartMs, endMs: end, volumePercent: clip.volumePercent ?? DEFAULT_VOLUME_PERCENT })
    }
  }
  return pieces
}

/**
 * The frame rate to thin the picture down to, or null when no recording is faster than the export. Frames can be dropped
 * but not invented, so a 30 fps recording exported at 60 fps stays at 30.
 */
export function frameDropTarget(recordingRates: readonly number[], exportFps: number): number | null {
  return recordingRates.some((rate) => rate > exportFps * 1.02) ? exportFps : null
}

const AUDIO_BITS_PER_SECOND = 192_000

/**
 * A rough size of the finished file, to refuse an export early when storage is short. The encoder spends about a fifth of
 * a bit per pixel per frame.
 */
export function estimateExportBytes(durationMs: number, settings: ExportSettings): number {
  const size = outputSize(settings)
  const videoBitsPerSecond = Math.floor((size.width * size.height * settings.fps) / 5)
  return Math.floor((durationMs * (videoBitsPerSecond + AUDIO_BITS_PER_SECOND)) / 8 / 1000)
}

const FORBIDDEN_IN_FILE_NAMES = '/\\:*?"<>|'

const isDirectionMark = (code: number): boolean =>
  code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)

const isControl = (code: number): boolean => code < 0x20 || (code >= 0x7f && code <= 0x9f)

const trimDots = (text: string): string => text.replace(/^\.+|\.+$/g, '')

/** The file name of an export: the project's name with what file systems refuse removed, and the time. */
export function exportFileName(projectName: string, time: Date, extension: string): string {
  const kept = [...projectName].filter((char) => !FORBIDDEN_IN_FILE_NAMES.includes(char) && !isControl(char.codePointAt(0) ?? 0) && !isDirectionMark(char.codePointAt(0) ?? 0)).join('')
  const cleaned = trimDots(trimDots(kept.trim()).slice(0, 60).trim())
  const base = cleaned === '' ? 'JustInVideo' : cleaned
  const two = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${time.getFullYear()}${two(time.getMonth() + 1)}${two(time.getDate())}-${two(time.getHours())}${two(time.getMinutes())}${two(time.getSeconds())}`
  return `${base}-${stamp}.${extension}`
}
