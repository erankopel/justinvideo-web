import { describe, expect, it } from 'vitest'
import { type Capability, chooseEncoding, videoBitrate } from './encoding'

const capable = (video: string[], audio: string[]): Capability => ({
  video: async (codec) => video.includes(codec),
  audio: async (codec) => audio.includes(codec),
})

const size = { width: 1280, height: 720 }

describe('chooseEncoding', () => {
  it('writes H.264 and AAC in an MP4 file where the browser can encode both', async () => {
    expect(await chooseEncoding(size, 30, true, capable(['avc', 'vp9'], ['aac', 'opus']))).toMatchObject({ container: 'mp4', video: 'avc', audio: 'aac', extension: 'mp4', mime: 'video/mp4' })
  })

  it('writes VP9 and Opus in a WebM file where H.264 or AAC is missing', async () => {
    expect(await chooseEncoding(size, 30, true, capable(['vp9'], ['opus']))).toMatchObject({ container: 'webm', video: 'vp9', audio: 'opus', extension: 'webm', mime: 'video/webm' })
    // H.264 without AAC, as in Firefox: the sound decides.
    expect(await chooseEncoding(size, 30, true, capable(['avc', 'vp9'], ['opus']))).toMatchObject({ container: 'webm', video: 'vp9', audio: 'opus' })
  })

  it('asks about AAC only once H.264 can be encoded, since asking may load an encoder for it', async () => {
    const asked: string[] = []
    const spy = (video: string[], audio: string[]): Capability => ({
      video: async (codec) => video.includes(codec),
      audio: async (codec) => {
        asked.push(codec)
        return audio.includes(codec)
      },
    })
    await chooseEncoding(size, 30, true, spy(['vp9'], ['aac', 'opus']))
    expect(asked).not.toContain('aac')
    asked.length = 0
    await chooseEncoding(size, 30, true, spy(['avc', 'vp9'], ['aac', 'opus']))
    expect(asked).toContain('aac')
    asked.length = 0
    // And never for an export with no sound.
    await chooseEncoding(size, 30, false, spy(['avc', 'vp9'], ['aac', 'opus']))
    expect(asked).toEqual([])
  })

  it('needs no audio encoder for an export with no sound', async () => {
    expect(await chooseEncoding(size, 30, false, capable(['avc'], []))).toMatchObject({ container: 'mp4', video: 'avc', audio: null })
    expect(await chooseEncoding(size, 30, false, capable(['vp9'], []))).toMatchObject({ container: 'webm', video: 'vp9', audio: null })
  })

  it('falls back to H.264 with Opus in an MP4 file when that is all there is', async () => {
    expect(await chooseEncoding(size, 30, true, capable(['avc'], ['opus']))).toMatchObject({ container: 'mp4', video: 'avc', audio: 'opus' })
  })

  it('is null when nothing can be encoded', async () => {
    expect(await chooseEncoding(size, 30, true, capable([], ['opus']))).toBeNull()
    expect(await chooseEncoding(size, 30, true, capable(['vp9'], []))).toBeNull()
  })
})

describe('videoBitrate', () => {
  it('is about a fifth of a bit per pixel per frame', () => {
    expect(videoBitrate(size, 30)).toBe(5_529_600)
    expect(videoBitrate({ width: 1920, height: 1080 }, 60)).toBe(24_883_200)
  })

  it('is never very small', () => {
    expect(videoBitrate({ width: 2, height: 2 }, 30)).toBe(500_000)
  })
})
