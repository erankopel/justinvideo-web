/**
 * How edit time maps to the screen. The playhead is fixed at the centre of the timeline and the edit scrolls under it,
 * so scrubbing is a drag, a split is always at the middle, and the pointer never has to aim at a thin line. pxPerMs is
 * the zoom. This is the Android app's viewport, in the same terms.
 */
export interface Viewport {
  readonly pxPerMs: number
}

export function viewport(pxPerMs: number): Viewport {
  if (!(pxPerMs > 0) || !Number.isFinite(pxPerMs)) throw new RangeError('The zoom must be positive')
  return { pxPerMs }
}

/** Where timeMs is drawn, given that playheadMs sits at centerPx. */
export const xOf = (view: Viewport, timeMs: number, playheadMs: number, centerPx: number): number =>
  centerPx + (timeMs - playheadMs) * view.pxPerMs

/** The time under a horizontal position. */
export const timeAt = (view: Viewport, x: number, playheadMs: number, centerPx: number): number =>
  playheadMs + Math.round((x - centerPx) / view.pxPerMs)

export interface ZoomLimits {
  readonly farthest: number
  readonly closest: number
}

/** The same zoom changed by scale, kept inside limits. */
export const zoomed = (view: Viewport, scale: number, limits: ZoomLimits): Viewport =>
  viewport(Math.min(Math.max(view.pxPerMs * scale, limits.farthest), limits.closest))

/** An edit shorter than this is still zoomed out as if it were this long, so a tiny clip is not stretched across the view. */
const MIN_FIT_MS = 1_000

/**
 * The most the view may zoom out and in. Zoomed all the way out the whole edit fits in 45 percent of the width, so with
 * the playhead at the start of the edit, which sits in the middle of the view, the whole edit is visible on one side of
 * it. Zoomed all the way in one frame is framePx wide, enough to tell neighbouring frames apart.
 */
export function zoomLimits(durationMs: number, widthPx: number, frameMs: number, framePx: number): ZoomLimits {
  if (!(widthPx > 0) || !(framePx > 0) || !(frameMs > 0)) throw new RangeError('The view and the frame must have a size')
  const closest = framePx / frameMs
  const farthest = Math.min((widthPx * 0.45) / Math.max(durationMs, MIN_FIT_MS), closest)
  return { farthest, closest }
}
