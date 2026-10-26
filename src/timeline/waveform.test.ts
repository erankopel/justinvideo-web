import { describe, expect, it } from 'vitest'
import type { Peaks } from '../audio/peaks'
import { COLUMN_PITCH_PX, columnsOf } from './waveform'

/** Three seconds: quiet (0.2) for the first, loud (0.8) for the second, silent for the third. */
const steps: Peaks = (() => {
  const values = new Uint8Array(300)
  values.fill(51, 0, 100)
  values.fill(204, 100, 200)
  return { bucketMs: 10, values, durationMs: 3_000 }
})()

const item = { trimStartMs: 0, lengthMs: 3_000, volumePercent: 100, fadeInMs: 0, fadeOutMs: 0 }
// 100 px a second: a column is 30 ms, a second is 33 columns.
const layout = { itemLeft: 0, originX: 0, drawnWidth: 300, pxPerMs: 0.1 }
const near = (actual: number | undefined, expected: number): void => expect(actual ?? Number.NaN).toBeCloseTo(expected, 1)

describe('columnsOf', () => {
  it('shows the loudness along the piece, a column every three pixels', () => {
    const columns = columnsOf(steps, item, layout)
    expect(columns).toHaveLength(100)
    expect(columns.map((column) => column.x).slice(0, 4)).toEqual([0, 3, 6, 9])
    near(columns[5]?.level, 0.2)
    near(columns[50]?.level, 0.8)
    near(columns[90]?.level, 0)
  })

  it('scales with the volume of the piece, and never goes past full scale', () => {
    near(columnsOf(steps, { ...item, volumePercent: 50 }, layout)[50]?.level, 0.4)
    near(columnsOf(steps, { ...item, volumePercent: 150 }, layout)[5]?.level, 0.3)
    near(columnsOf(steps, { ...item, volumePercent: 150 }, layout)[50]?.level, 1)
    near(columnsOf(steps, { ...item, volumePercent: 0 }, layout)[50]?.level, 0)
  })

  it('starts where the piece starts in its file', () => {
    // Skipping the first second: the piece begins with the loud part, and the last second of it is the silence.
    const columns = columnsOf(steps, { ...item, trimStartMs: 1_000, lengthMs: 2_000 }, layout)
    near(columns[5]?.level, 0.8)
    near(columns[50]?.level, 0)
    expect(columns).toHaveLength(67)
  })

  it('follows the fades, counted from the start and the end of the piece', () => {
    const columns = columnsOf(steps, { ...item, trimStartMs: 1_000, lengthMs: 1_000, fadeInMs: 500, fadeOutMs: 500 }, { ...layout, drawnWidth: 100 })
    // The fade in is half way at 250 ms, which is column 8 (240 to 270 ms): the middle of it is 255 ms, 0.51 of the way.
    near(columns[8]?.level, 0.8 * (255 / 500))
    near(columns[0]?.level, 0.8 * (15 / 500))
    near(columns[16]?.level, 0.8)
    // The same going out: 745 ms is 255 ms before the end of the piece.
    near(columns[24]?.level, 0.8 * (255 / 500))
    expect((columns[columns.length - 1]?.level ?? 1) < 0.05).toBe(true)
  })

  it('takes the loudest bucket when a column covers many, as when zoomed far out', () => {
    const values = new Uint8Array(1_000)
    values[437] = 255
    const columns = columnsOf({ bucketMs: 10, values, durationMs: 10_000 }, { ...item, lengthMs: 10_000 }, { itemLeft: 0, originX: 0, drawnWidth: 100, pxPerMs: 0.01 })
    // 3 px is 300 ms here: the spike at 4.37 s is in the column from 4.2 to 4.5 s, which is column 14.
    const loud = columns.filter((column) => column.level > 0.9)
    expect(loud).toHaveLength(1)
    expect(loud[0]?.x).toBe(14 * COLUMN_PITCH_PX)
  })

  it('draws only the part that is near the view, with the columns where they are on the piece', () => {
    const whole = columnsOf(steps, item, layout)
    const part = columnsOf(steps, item, { ...layout, originX: 150, drawnWidth: 60 })
    expect(part.map((column) => column.level)).toEqual(whole.slice(50, 70).map((column) => column.level))
    expect(part.map((column) => column.x)).toEqual(Array.from({ length: 20 }, (_, i) => i * 3))
  })

  it('has nothing when the piece is out of the drawn part', () => {
    expect(columnsOf(steps, item, { ...layout, itemLeft: -50_000 })).toEqual([])
    expect(columnsOf(steps, item, { ...layout, itemLeft: 50_000 })).toEqual([])
  })

  it('has nothing for a sound with no levels, or a piece with no extent', () => {
    expect(columnsOf({ bucketMs: 10, values: new Uint8Array(0), durationMs: 0 }, item, layout)).toEqual([])
    expect(columnsOf(steps, { ...item, lengthMs: 0 }, layout)).toEqual([])
    expect(columnsOf(steps, item, { ...layout, pxPerMs: 0 })).toEqual([])
    expect(columnsOf(steps, item, { ...layout, drawnWidth: 0 })).toEqual([])
  })

  it('is silent past the end of the file, if a piece reaches there', () => {
    const columns = columnsOf(steps, { ...item, trimStartMs: 2_500, lengthMs: 2_000 }, layout)
    expect(columns.length).toBeGreaterThan(0)
    for (const column of columns) expect(column.level).toBe(0)
  })
})
