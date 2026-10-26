/**
 * The lane each bar is drawn in, in the order the bars are given. Bars are placed by their start, and a bar that does not
 * overlap the one before it in a lane shares that lane, so a title over a caption gets two. When more than laneCount
 * overlap, the extra ones go to the lane that frees up first and are drawn over what is there.
 */
export function lanesOf<T>(bars: readonly T[], startMs: (bar: T) => number, endMs: (bar: T) => number, laneCount = 2): number[] {
  const laneEnds = new Array<number>(laneCount).fill(Number.NEGATIVE_INFINITY)
  const lanes = new Array<number>(bars.length).fill(0)
  const order = bars.map((_, index) => index).sort((a, b) => startMs(bars[a] as T) - startMs(bars[b] as T))
  for (const index of order) {
    const bar = bars[index] as T
    let lane = laneEnds.findIndex((end) => end <= startMs(bar))
    if (lane < 0) lane = laneEnds.reduce((best, end, i) => (end < (laneEnds[best] ?? 0) ? i : best), 0)
    laneEnds[lane] = Math.max(laneEnds[lane] ?? Number.NEGATIVE_INFINITY, endMs(bar))
    lanes[index] = lane
  }
  return lanes
}
