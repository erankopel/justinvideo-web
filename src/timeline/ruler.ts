import { formatClock } from '../i18n'

export interface Tick {
  readonly timeMs: number
  readonly major: boolean
}

const STEPS_MS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000,
]

/** The smallest step that keeps neighbouring labelled ticks at least minLabelPx apart. */
export const rulerStepMs = (pxPerMs: number, minLabelPx: number): number =>
  STEPS_MS.find((step) => step * pxPerMs >= minLabelPx) ?? (STEPS_MS[STEPS_MS.length - 1] as number)

/**
 * The ticks between fromMs and toMs. Every tick is a multiple of the step; those that are also a multiple of five steps
 * are major, which the ruler draws taller. Ticks run from zero up and stop at limitMs.
 */
export function rulerTicks(fromMs: number, toMs: number, stepMs: number, limitMs: number): Tick[] {
  if (!(stepMs > 0)) throw new RangeError('The step must be positive')
  const ticks: Tick[] = []
  const last = Math.min(toMs, limitMs)
  for (let time = Math.floor(Math.max(fromMs, 0) / stepMs) * stepMs; time <= last; time += stepMs) {
    if (time >= fromMs) ticks.push({ timeMs: time, major: Math.floor(time / stepMs) % 5 === 0 })
  }
  return ticks
}

/** A label for a tick: m:ss, with as many fractions of a second as the step needs. */
export function rulerLabel(timeMs: number, stepMs: number): string {
  if (stepMs >= 1_000) return formatClock(timeMs)
  const digits = stepMs >= 100 ? 1 : stepMs >= 10 ? 2 : 3
  return `${formatClock(timeMs)}.${String(timeMs % 1_000).padStart(3, '0').slice(0, digits)}`
}
