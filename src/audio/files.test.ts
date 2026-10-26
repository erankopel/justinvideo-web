import { describe, expect, it } from 'vitest'
import { MAX_TIMELINE_MS } from '../engine'
import { validateMix, audioMix } from '../engine/audio'
import { MemoryMediaStore, StorageFullError } from '../storage/media-store'
import { AudioImportError, musicItem, prepareMusic, removeAudioFile, voiceoverItem } from './files'

const stored = { id: 'a1', file: 'media/x.wav', displayName: 'x.wav', fileDurationMs: 8_000 }

describe('musicItem', () => {
  it('plays the whole file from where it is put', () => {
    expect(musicItem(stored, 3_000)).toMatchObject({ kind: 'music', startMs: 3_000, lengthMs: 8_000, trimStartMs: 0, volumePercent: 100, fadeInMs: 0, fadeOutMs: 0 })
  })

  it('stops at the longest possible edit and keeps a name within the limit', () => {
    const item = musicItem({ ...stored, displayName: 'n'.repeat(500), fileDurationMs: 5_000 }, MAX_TIMELINE_MS - 2_000)
    expect(item.lengthMs).toBe(2_000)
    expect(item.displayName).toHaveLength(200)
    expect(validateMix(audioMix([item]))).toBeNull()
  })
})

describe('voiceoverItem', () => {
  it('ends where the edit ends, when the recording runs past it', () => {
    expect(voiceoverItem({ ...stored, fileDurationMs: 6_000 }, 4_000, 8_000)).toMatchObject({ kind: 'voiceover', startMs: 4_000, lengthMs: 4_000 })
  })

  it('keeps all of a recording that fits, and never less than the shortest piece', () => {
    expect(voiceoverItem({ ...stored, fileDurationMs: 2_000 }, 1_000, 8_000).lengthMs).toBe(2_000)
    expect(voiceoverItem({ ...stored, fileDurationMs: 2_000 }, 8_000, 8_000).lengthMs).toBe(100)
  })
})

describe('prepareMusic', () => {
  const file = new File(['sound'], 'Song.MP3', { type: 'audio/mpeg' })
  const probe = async () => ({ displayName: 'Song.MP3', durationMs: 5_000 })

  it('copies the file into the project and makes the piece', async () => {
    const media = new MemoryMediaStore()
    const item = await prepareMusic({ media, probe, hasRoom: async () => true }, 'p1', file, 1_000)
    expect(item).toMatchObject({ kind: 'music', displayName: 'Song.MP3', fileDurationMs: 5_000, startMs: 1_000, lengthMs: 5_000 })
    expect(item.file).toMatch(/^media\/[0-9a-f]+\.mp3$/)
    expect(await (await media.read('p1', item.file)).text()).toBe('sound')
  })

  it('refuses before copying when the browser has no room', async () => {
    const media = new MemoryMediaStore()
    await expect(prepareMusic({ media, probe, hasRoom: async () => false }, 'p1', file, 0)).rejects.toMatchObject({ failure: 'NoSpace' })
    expect(media.files.size).toBe(0)
  })

  it('says why a file was refused, and copies nothing', async () => {
    const media = new MemoryMediaStore()
    const notAudio = async (): Promise<never> => {
      throw new AudioImportError('NotAudio')
    }
    await expect(prepareMusic({ media, probe: notAudio, hasRoom: async () => true }, 'p1', file, 0)).rejects.toMatchObject({ failure: 'NotAudio' })
    expect(media.files.size).toBe(0)
  })

  it('reports a copy that ran out of space', async () => {
    const media = new MemoryMediaStore()
    media.write = async () => {
      throw new StorageFullError()
    }
    await expect(prepareMusic({ media, probe, hasRoom: async () => true }, 'p1', file, 0)).rejects.toMatchObject({ failure: 'NoSpace' })
  })
})

describe('removeAudioFile', () => {
  it('takes the copy away, and does not mind one that is already gone', async () => {
    const media = new MemoryMediaStore()
    await media.write('p1', 'media/a.wav', new Blob(['x']))
    await removeAudioFile(media, 'p1', 'media/a.wav')
    expect(media.files.size).toBe(0)
    await expect(removeAudioFile(media, 'p1', 'media/a.wav')).resolves.toBeUndefined()
  })
})
