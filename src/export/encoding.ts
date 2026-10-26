import { canEncodeAudio, canEncodeVideo, type AudioCodec, type VideoCodec } from 'mediabunny'
import { AAC_PROBE, softwareAac } from './aac'
import type { OutputSize } from './settings'

export type Container = 'mp4' | 'webm'

/** How the export is written: the container and the two codecs, and the file's extension and type. */
export interface EncodingChoice {
  readonly container: Container
  readonly video: VideoCodec
  /** Null when the export has no sound. */
  readonly audio: AudioCodec | null
  readonly extension: string
  readonly mime: string
}

/** What this browser can encode, with the help of what the site can add to it. */
export interface Capability {
  video(codec: VideoCodec, size: OutputSize, bitrate: number): Promise<boolean>
  audio(codec: AudioCodec): Promise<boolean>
}

export const browserCapability: Capability = {
  video: (codec, size, bitrate) => canEncodeVideo(codec, { width: size.width, height: size.height, bitrate }).catch(() => false),
  audio: async (codec) => {
    if (await canEncodeAudio(codec, AAC_PROBE).catch(() => false)) return true
    // AAC is the one sound that a browser often cannot encode and that plays everywhere, so the site brings an encoder for it.
    return codec === 'aac' && softwareAac()
  },
}

/** The video bitrate of an export: about a fifth of a bit per pixel per frame, as in the app. */
export const videoBitrate = (size: OutputSize, fps: number): number => Math.max(500_000, Math.floor((size.width * size.height * fps) / 5))

export const AUDIO_BITRATE = 192_000

const mp4 = (video: VideoCodec, audio: AudioCodec | null): EncodingChoice => ({ container: 'mp4', video, audio, extension: 'mp4', mime: 'video/mp4' })
const webm = (video: VideoCodec, audio: AudioCodec | null): EncodingChoice => ({ container: 'webm', video, audio, extension: 'webm', mime: 'video/webm' })

/**
 * How to write the export in this browser: H.264 with AAC in an MP4 file, which plays everywhere, where the browser can
 * encode H.264 and either it or the site can encode AAC; else VP9 with Opus in a WebM file, which Chrome and Firefox can
 * always encode; else H.264 with Opus in an MP4 file. Null when none of these can be done at the chosen size. AAC is asked
 * about only once H.264 is known to work, because a browser without an AAC encoder is asked by loading one for it, which is
 * of no use to an export that cannot have H.264.
 */
export async function chooseEncoding(size: OutputSize, fps: number, withSound: boolean, can: Capability = browserCapability): Promise<EncodingChoice | null> {
  const bitrate = videoBitrate(size, fps)
  const [avc, vp9, opus] = await Promise.all([
    can.video('avc', size, bitrate),
    can.video('vp9', size, bitrate),
    withSound ? can.audio('opus') : Promise.resolve(false),
  ])
  const aac = withSound && avc ? await can.audio('aac') : false
  if (avc && (!withSound || aac)) return mp4('avc', withSound ? 'aac' : null)
  if (vp9 && (!withSound || opus)) return webm('vp9', withSound ? 'opus' : null)
  if (avc && opus) return mp4('avc', 'opus')
  return null
}
