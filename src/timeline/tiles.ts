/** The pictures on a clip: how wide each is and which moment of the recording it shows. Pure, so the choices are tested without a browser. */

/** The height of the strip of pictures on a clip, in CSS pixels. What is left of the clip's height keeps the recording's colour. */
export const STRIP_PX = 58
const MIN_TILE_PX = 24
const MAX_TILE_PX = 160
/** The finest spacing of the frames that are kept, in milliseconds. */
const FINEST_STEP_MS = 100

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

/** The width of one picture, in the shape of the recording as it is seen (turned upright). */
export function tileWidthPx(aspect: number): number {
  const shape = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9
  return clamp(Math.round(STRIP_PX * shape), MIN_TILE_PX, MAX_TILE_PX)
}

/**
 * The spacing of the frames that are decoded: the largest 100 ms times a power of two that does not outlast one tile.
 * Neighbouring tiles then show different frames, and the frames kept at one zoom are the ones the next zoom asks for again.
 */
export function frameStepMs(tileMs: number): number {
  if (!Number.isFinite(tileMs) || tileMs <= FINEST_STEP_MS) return FINEST_STEP_MS
  let step = FINEST_STEP_MS
  while (step * 2 <= tileMs) step *= 2
  return step
}

/** The shape of a recording as it is seen: width over height, after the rotation in its file. */
export function seenAspect(width: number, height: number, rotationDegrees: number): number {
  if (!(width > 0) || !(height > 0)) return 16 / 9
  return rotationDegrees % 180 === 0 ? width / height : height / width
}

export interface Tile {
  /** The left edge, in pixels from the left edge of what is drawn. */
  readonly x: number
  readonly width: number
  /** The moment of the recording that the tile shows, in milliseconds from its start. */
  readonly timeMs: number
}

export interface TileLayout {
  /** Where the clip starts, in pixels, on the same ruler as originX. It may be far outside the view. */
  readonly clipLeft: number
  /** Where the drawn part begins, and how wide it is. The drawn part is the part of the clip that is near the view. */
  readonly originX: number
  readonly drawnWidth: number
  readonly pxPerMs: number
  readonly tileWidth: number
  readonly sourceStartMs: number
  readonly durationMs: number
}

/**
 * The tiles that cover the drawn part of a clip. They are laid from the clip's own start, so they do not move over it when
 * the view moves, and each shows the frame at the middle of the part of it that lies on the clip, moved to the nearest of
 * the frames that are kept, but never outside the clip.
 */
export function tilesOf(layout: TileLayout): Tile[] {
  const { clipLeft, originX, drawnWidth, pxPerMs, tileWidth, sourceStartMs, durationMs } = layout
  if (!(pxPerMs > 0) || !(tileWidth > 0) || !(durationMs > 0) || !(drawnWidth > 0)) return []
  const tileMs = tileWidth / pxPerMs
  const step = frameStepMs(tileMs)
  const count = Math.ceil(durationMs / tileMs)
  const rawFirst = Math.floor((originX - clipLeft) / tileWidth)
  const rawLast = Math.ceil((originX + drawnWidth - clipLeft) / tileWidth) - 1
  if (rawLast < 0 || rawFirst > count - 1) return []
  const first = Math.max(rawFirst, 0)
  const last = Math.min(rawLast, count - 1)
  const sourceEndMs = sourceStartMs + durationMs
  const tiles: Tile[] = []
  for (let i = first; i <= last; i++) {
    const from = i * tileMs
    const to = Math.min((i + 1) * tileMs, durationMs)
    let timeMs = Math.round((sourceStartMs + (from + to) / 2) / step) * step
    if (timeMs > sourceEndMs - 1) timeMs -= step
    if (timeMs < sourceStartMs) timeMs = sourceStartMs
    const x = Math.round(clipLeft + i * tileWidth - originX)
    tiles.push({ x, width: Math.round(clipLeft + (i + 1) * tileWidth - originX) - x, timeMs })
  }
  return tiles
}
