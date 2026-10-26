import { describe, expect, it } from 'vitest'
import { clip, editState, timeline } from '../engine'
import { audioItem, audioMix } from '../engine/audio'
import { applyProjectAudio, type Project, type Source } from '../project/model'
import { MemoryMediaStore } from './media-store'
import { RECENT_MS, referencedFiles, removeUnusedMedia, unusedFiles } from './unused-media'

const source = (id: string): Source => ({ id, file: `media/${id}.webm`, displayName: id, durationMs: 5_000, width: 320, height: 180, rotationDegrees: 0, hasAudio: true })
const song = (id: string) => audioItem({ id, kind: 'music', file: `media/${id}.wav`, displayName: id, fileDurationMs: 4_000, startMs: 0, lengthMs: 2_000 })

const base: Project = {
  id: 'p1',
  name: 'p',
  createdAtMs: 1,
  modifiedAtMs: 1,
  fps: 30,
  sources: [source('s1'), source('s2')],
  edit: editState({ timeline: timeline([clip('c1', 's1', 0, 1_000)]) }),
}

const NOW = 10_000_000
const OLD = NOW - RECENT_MS - 1

/** The project after adding and then removing a piece of music, as the person would do it. */
function withRemovedSong(project: Project): Project {
  const added = applyProjectAudio(project, { type: 'add', item: song('m1') }, 2).project
  return applyProjectAudio(added, { type: 'remove', id: 'm1' }, 3).project
}

describe('referencedFiles', () => {
  it('holds the recordings, even those no clip uses, and the music of the edit', () => {
    const project = applyProjectAudio(base, { type: 'add', item: song('m1') }, 2).project
    expect([...referencedFiles(project)].sort()).toEqual(['media/m1.wav', 'media/s1.webm', 'media/s2.webm'])
  })

  it('holds what Undo and Redo can bring back', () => {
    const removed = withRemovedSong(base)
    expect(removed.edit.mix.items).toHaveLength(0)
    expect(referencedFiles(removed).has('media/m1.wav')).toBe(true)
    // Undone, the piece is back, and the step after it is in the redo history: still held.
    const undone = { ...removed, edit: { ...removed.edit, mix: audioMix([song('m1')]), undoStack: removed.edit.undoStack.slice(0, 1), redoStack: removed.edit.undoStack.slice(1) } }
    expect(referencedFiles(undone).has('media/m1.wav')).toBe(true)
  })

  it('lets go of a piece once nothing can bring it back', () => {
    const forgotten = { ...withRemovedSong(base), edit: { ...withRemovedSong(base).edit, undoStack: [], redoStack: [] } }
    expect(referencedFiles(forgotten).has('media/m1.wav')).toBe(false)
  })
})

describe('unusedFiles', () => {
  const stored = [
    { path: 'media/s1.webm', modifiedAtMs: OLD },
    { path: 'media/old-leftover.wav', modifiedAtMs: OLD },
    { path: 'media/just-written.wav', modifiedAtMs: NOW - 1_000 },
  ]

  it('is what nothing refers to and was not written a moment ago', () => {
    expect(unusedFiles(base, stored, NOW)).toEqual(['media/old-leftover.wav'])
  })

  it('leaves a recent file alone, until it is old enough', () => {
    expect(unusedFiles(base, stored, NOW + RECENT_MS)).toEqual(['media/old-leftover.wav', 'media/just-written.wav'])
  })
})

describe('removeUnusedMedia', () => {
  it('removes the unused files and keeps every referenced one', async () => {
    const media = new MemoryMediaStore()
    for (const path of ['media/s1.webm', 'media/s2.webm', 'media/m-gone.wav', 'media/m-gone-too.wav']) {
      await media.write('p1', path, new Blob(['x']))
      media.modified.set(`p1/${path}`, OLD)
    }
    await media.write('p2', 'media/other.wav', new Blob(['x']))
    const removed = await removeUnusedMedia(media, base, NOW)
    expect(removed.sort()).toEqual(['media/m-gone-too.wav', 'media/m-gone.wav'])
    expect((await media.list('p1')).map((file) => file.path).sort()).toEqual(['media/s1.webm', 'media/s2.webm'])
    // Another project's folder is not touched.
    expect((await media.list('p2')).map((file) => file.path)).toEqual(['media/other.wav'])
  })

  it('carries on past a file that cannot be removed', async () => {
    const media = new MemoryMediaStore()
    for (const path of ['media/a.wav', 'media/b.wav']) {
      await media.write('p1', path, new Blob(['x']))
      media.modified.set(`p1/${path}`, OLD)
    }
    const real = media.remove.bind(media)
    media.remove = async (project, path) => {
      if (path === 'media/a.wav') throw new Error('busy')
      return real(project, path)
    }
    expect(await removeUnusedMedia(media, base, NOW)).toEqual(['media/b.wav'])
  })
})
