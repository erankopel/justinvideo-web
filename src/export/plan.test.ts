import { describe, expect, it } from 'vitest'
import { clip, editState, timeline } from '../engine'
import { audioItem, audioMix } from '../engine/audio'
import type { Project, Source } from '../project/model'
import { fileKey, isSilent, soundLayers } from './plan'
import { exportPieces } from './settings'

const source = (id: string, hasAudio = true): Source => ({ id, file: `media/${id}.webm`, displayName: id, durationMs: 60_000, width: 320, height: 180, rotationDegrees: 0, hasAudio })

const projectOf = (sources: Source[], clips: ReturnType<typeof clip>[], items: ReturnType<typeof audioItem>[] = []): Project => ({
  id: 'p',
  name: 'p',
  createdAtMs: 1,
  modifiedAtMs: 1,
  fps: 30,
  sources,
  edit: editState({ timeline: timeline(clips), mix: audioMix(items) }),
})

describe('soundLayers', () => {
  it('puts the sound of each piece where the piece is on the edit, at its clip volume', () => {
    const project = projectOf([source('s1'), source('s2')], [clip('a', 's1', 1_000, 2_000, 50), clip('b', 's2', 0, 1_500)])
    const layers = soundLayers(project, exportPieces(project.edit.timeline))
    expect(layers.map((l) => [fileKey(l.file), l.startMs, l.endMs, l.fileStartMs, l.envelope.gain])).toEqual([
      ['source:s1', 0, 2_000, 1_000, 0.5],
      ['source:s2', 2_000, 3_500, 0, 1],
    ])
  })

  it('has no layer for a recording without sound', () => {
    const project = projectOf([source('s1', false), source('s2')], [clip('a', 's1', 0, 1_000), clip('b', 's2', 0, 1_000)])
    const layers = soundLayers(project, exportPieces(project.edit.timeline))
    expect(layers.map((l) => [l.file.id, l.startMs])).toEqual([['s2', 1_000]])
  })

  it('adds the music and voiceovers that are heard before the edit ends, cut at its end, with their own fades', () => {
    const song = audioItem({ id: 'm1', kind: 'music', file: 'media/m.wav', displayName: 'Song', fileDurationMs: 60_000, startMs: 1_000, lengthMs: 30_000, trimStartMs: 4_000, volumePercent: 150, fadeInMs: 500, fadeOutMs: 2_000 })
    const late = audioItem({ id: 'm2', kind: 'music', file: 'media/n.wav', displayName: 'Late', fileDurationMs: 5_000, startMs: 3_000, lengthMs: 5_000 })
    const project = projectOf([source('s1')], [clip('a', 's1', 0, 3_000)], [song, late])
    const layers = soundLayers(project, exportPieces(project.edit.timeline))
    expect(layers.map((l) => fileKey(l.file))).toEqual(['source:s1', 'audio:m1'])
    const music = layers[1]!
    expect([music.startMs, music.endMs, music.fileStartMs]).toEqual([1_000, 3_000, 4_000])
    // Its fades count from its own start and end, so a fade out that falls past the edit's end is not heard.
    expect(music.envelope.gain).toBe(1.5)
    expect(music.envelope.fadeOutMs).toBe(2_000)
    expect(music.envelope.lengthMs).toBe(30_000)
  })

  it('shares a key between the pieces of one recording', () => {
    const project = projectOf([source('s1')], [clip('a', 's1', 0, 1_000), clip('b', 's1', 5_000, 1_000)])
    const layers = soundLayers(project, exportPieces(project.edit.timeline))
    expect(layers.map((l) => fileKey(l.file))).toEqual(['source:s1', 'source:s1'])
  })
})

describe('isSilent', () => {
  it('is true only for a constant zero', () => {
    const project = projectOf([source('s1')], [clip('a', 's1', 0, 1_000, 0), clip('b', 's1', 2_000, 1_000, 100)])
    const [muted, loud] = soundLayers(project, exportPieces(project.edit.timeline))
    expect(isSilent(muted!)).toBe(true)
    expect(isSilent(loud!)).toBe(false)
  })
})
