import { describe, expect, it } from 'vitest'
import { clip, editState, timeline } from '../engine'
import type { Project, Source } from '../project/model'
import { defaultExportSettings, estimateExportBytes, exportFileName, exportPieces, exportSettings, EXPORT_QUALITIES, EXPORT_SHAPES, frameDropTarget, outputSize, pieceDurationMs } from './settings'

const source = (id: string, width: number, height: number, rotationDegrees = 0): Source => ({
  id,
  file: `media/${id}.mp4`,
  displayName: `${id}.mp4`,
  durationMs: 60_000,
  width,
  height,
  rotationDegrees,
  hasAudio: true,
})

const project = (sources: Source[], ...clips: ReturnType<typeof clip>[]): Project => ({
  id: 'p1',
  name: 'Test',
  createdAtMs: 1,
  modifiedAtMs: 1,
  fps: 30,
  sources,
  edit: editState({ timeline: timeline(clips) }),
})

describe('output size', () => {
  it('is fixed by the shape and the short side', () => {
    expect(outputSize(exportSettings('vertical', 'p1080'))).toEqual({ width: 1080, height: 1920 })
    expect(outputSize(exportSettings('wide', 'p720'))).toEqual({ width: 1280, height: 720 })
    expect(outputSize(exportSettings('wide', 'p1080'))).toEqual({ width: 1920, height: 1080 })
    expect(outputSize(exportSettings('square', 'p720'))).toEqual({ width: 720, height: 720 })
  })

  it('has even sides for every shape and size', () => {
    for (const shape of EXPORT_SHAPES) {
      for (const quality of EXPORT_QUALITIES) {
        const size = outputSize(exportSettings(shape, quality))
        expect(size.width % 2).toBe(0)
        expect(size.height % 2).toBe(0)
      }
    }
  })

  it('accepts only the offered frame rates', () => {
    expect(() => exportSettings('wide', 'p720', 'fill', 24)).toThrow(RangeError)
    expect(exportSettings('wide', 'p720', 'fill', 60).fps).toBe(60)
  })
})

describe('defaultExportSettings', () => {
  it('follows the shape of the first clip after its rotation', () => {
    const landscape = source('l', 1920, 1080)
    const portrait = source('p', 1080, 1920)
    // A phone video stored as landscape frames with a 90 degree flag is shown upright.
    const flagged = source('f', 1920, 1080, 90)
    const square = source('q', 1000, 1000)
    expect(defaultExportSettings(project([landscape], clip('a', 'l', 0, 1000))).shape).toBe('wide')
    expect(defaultExportSettings(project([portrait], clip('a', 'p', 0, 1000))).shape).toBe('vertical')
    expect(defaultExportSettings(project([flagged], clip('a', 'f', 0, 1000))).shape).toBe('vertical')
    expect(defaultExportSettings(project([square], clip('a', 'q', 0, 1000))).shape).toBe('square')
    // Only the first clip decides.
    expect(defaultExportSettings(project([landscape, portrait], clip('a', 'l', 0, 1000), clip('b', 'p', 0, 1000))).shape).toBe('wide')
  })

  it('is wide at 720 and 30 frames for an empty edit', () => {
    expect(defaultExportSettings(project([]))).toEqual({ shape: 'wide', quality: 'p720', framing: 'fill', fps: 30 })
  })

  it('is the largest size the footage can fill, counting only sources a clip uses', () => {
    const hd = source('h', 1280, 720)
    const fullHd = source('u', 1920, 1080)
    expect(defaultExportSettings(project([hd], clip('a', 'h', 0, 1000))).quality).toBe('p720')
    expect(defaultExportSettings(project([fullHd], clip('a', 'u', 0, 1000))).quality).toBe('p1080')
    expect(defaultExportSettings(project([hd, fullHd], clip('a', 'h', 0, 1000))).quality).toBe('p720')
  })
})

describe('exportPieces', () => {
  it('joins clips that continue each other in the same recording', () => {
    const pieces = exportPieces(timeline([clip('a', 's1', 0, 3_000), clip('b', 's1', 3_000, 3_000)]))
    expect(pieces).toEqual([{ sourceId: 's1', startMs: 0, endMs: 6_000, volumePercent: 100 }])
  })

  it('keeps two pieces for a gap in the recording', () => {
    const pieces = exportPieces(timeline([clip('a', 's1', 0, 1_500), clip('b', 's1', 3_500, 2_500)]))
    expect(pieces.map((p) => [p.startMs, p.endMs])).toEqual([[0, 1_500], [3_500, 6_000]])
  })

  it('keeps clips of different recordings, out of order, or of different volumes apart', () => {
    expect(exportPieces(timeline([clip('a', 's1', 0, 1_000), clip('b', 's2', 1_000, 1_000)]))).toHaveLength(2)
    const reordered = exportPieces(timeline([clip('b', 's1', 3_000, 3_000), clip('a', 's1', 0, 3_000)]))
    expect(reordered.map((p) => [p.startMs, p.endMs])).toEqual([[3_000, 6_000], [0, 3_000]])
    expect(exportPieces(timeline([clip('a', 's1', 0, 3_000, 50), clip('b', 's1', 3_000, 3_000, 100)]))).toHaveLength(2)
    expect(exportPieces(timeline([clip('a', 's1', 0, 3_000, 50), clip('b', 's1', 3_000, 3_000, 50)]))).toHaveLength(1)
  })

  it('joins a three way split into one piece', () => {
    const pieces = exportPieces(timeline([clip('a', 's1', 0, 1_000), clip('b', 's1', 1_000, 2_000), clip('c', 's1', 3_000, 500)]))
    expect(pieces).toHaveLength(1)
    expect(pieceDurationMs(pieces[0]!)).toBe(3_500)
  })

  it('has no pieces for an empty edit', () => {
    expect(exportPieces(timeline([]))).toEqual([])
  })
})

describe('frameDropTarget', () => {
  it('only drops frames when a recording is faster than the export', () => {
    expect(frameDropTarget([30, 29.97], 30)).toBeNull()
    expect(frameDropTarget([30.02], 30)).toBeNull()
    expect(frameDropTarget([30, 60], 30)).toBe(30)
    expect(frameDropTarget([30, 60], 60)).toBeNull()
    expect(frameDropTarget([120], 60)).toBe(60)
    expect(frameDropTarget([], 30)).toBeNull()
  })
})

describe('estimateExportBytes', () => {
  it('grows with length, size and frame rate', () => {
    const hd = exportSettings('wide', 'p720')
    const tenSeconds = estimateExportBytes(10_000, hd)
    expect(tenSeconds).toBeGreaterThanOrEqual(5_000_000)
    expect(tenSeconds).toBeLessThanOrEqual(9_000_000)
    expect(estimateExportBytes(20_000, hd)).toBe(tenSeconds * 2)
    expect(estimateExportBytes(10_000, exportSettings('wide', 'p1080'))).toBeGreaterThan(tenSeconds * 2)
    expect(estimateExportBytes(10_000, exportSettings('wide', 'p720', 'fill', 60))).toBeGreaterThan(tenSeconds)
  })
})

describe('exportFileName', () => {
  const time = new Date(2026, 9, 23, 9, 5, 7)

  it('is the project name and the time', () => {
    expect(exportFileName('Holiday', time, 'mp4')).toBe('Holiday-20261023-090507.mp4')
    expect(exportFileName('חופשה', time, 'webm')).toBe('חופשה-20261023-090507.webm')
  })

  it('removes what a file system refuses', () => {
    const t = new Date(2026, 0, 2, 3, 4, 5)
    expect(exportFileName('a/b\\:*?"<>|', t, 'mp4')).toBe('ab-20260102-030405.mp4')
    expect(exportFileName('a b..', t, 'mp4')).toBe('a b-20260102-030405.mp4')
    // Direction marks that a name may carry for display are not part of a file name.
    const marked = [0x202d, 0x74, 0x72, 0x69, 0x70, 0x202c, 0x2067, 0x31, 0x2069].map((c) => String.fromCodePoint(c)).join('')
    expect(exportFileName(marked, t, 'mp4')).toBe('trip1-20260102-030405.mp4')
  })

  it('falls back to the app name when nothing is left', () => {
    const t = new Date(2026, 0, 2, 3, 4, 5)
    expect(exportFileName('  /// ', t, 'mp4')).toBe('JustInVideo-20260102-030405.mp4')
    expect(exportFileName('', t, 'mp4')).toBe('JustInVideo-20260102-030405.mp4')
  })

  it('shortens a very long name', () => {
    const name = exportFileName('x'.repeat(500), new Date(2026, 0, 2, 3, 4, 5), 'mp4')
    expect(name.length).toBeLessThan(90)
    expect(name.endsWith('.mp4')).toBe(true)
  })
})
