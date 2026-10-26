import { AudioSampleSink, BlobSource, Input } from 'mediabunny'
import { AUDIO_FORMATS } from '../audio/files'
import { ExportError } from './failure'
import type { DecodedAudio } from './mix'
import type { AudioReader } from './mixer'

/**
 * Decodes a sound file with Mediabunny, a stretch at a time. The sound of a video file is read the same way, from its
 * audio track. A file that has no sound, or that this browser cannot decode, is a failure of the export. It reads audio
 * samples, not Web Audio buffers, so it works in a worker as well as in the page.
 */
export async function openAudioReader(file: Blob): Promise<AudioReader> {
  const input = new Input({ source: new BlobSource(file), formats: AUDIO_FORMATS })
  let sink: AudioSampleSink
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) throw new ExportError('DecoderFailed')
    sink = new AudioSampleSink(track)
  } catch (error) {
    input.dispose()
    throw error instanceof ExportError ? error : new ExportError('DecoderFailed', { cause: error })
  }
  let last: { from: number; to: number; audio: DecodedAudio } | null = null
  return {
    async read(fromS, toS) {
      if (last && fromS >= last.from && toS <= last.to) return last.audio
      let audio: DecodedAudio
      try {
        audio = await decodeRange(sink, fromS, toS)
      } catch (error) {
        throw new ExportError('DecoderFailed', { cause: error })
      }
      last = { from: fromS, to: toS, audio }
      return audio
    },
    close() {
      input.dispose()
    },
  }
}

/** The decoded samples from fromS to toS, laid end to end by their timestamps into one stretch of sound. */
async function decodeRange(sink: AudioSampleSink, fromS: number, toS: number): Promise<DecodedAudio> {
  const chunks: { channels: Float32Array[]; timestamp: number; duration: number; rate: number }[] = []
  for await (const sample of sink.samples(fromS, toS)) {
    try {
      // Whatever the decoder makes, the samples are taken as 32-bit floats, a channel at a time.
      const channels = Array.from({ length: sample.numberOfChannels }, (_, plane) => {
        const data = new Float32Array(sample.numberOfFrames)
        sample.copyTo(data, { planeIndex: plane, format: 'f32-planar' })
        return data
      })
      chunks.push({ channels, timestamp: sample.timestamp, duration: sample.duration, rate: sample.sampleRate })
    } finally {
      sample.close()
    }
  }
  const first = chunks[0]
  if (!first) return { channels: [new Float32Array(0)], startS: fromS, rate: 48_000 }
  const rate = first.rate
  const channelCount = first.channels.length
  const last = chunks[chunks.length - 1] ?? first
  const length = Math.ceil((last.timestamp + last.duration - first.timestamp) * rate) + 1
  const channels = Array.from({ length: channelCount }, () => new Float32Array(length))
  for (const chunk of chunks) {
    const at = Math.round((chunk.timestamp - first.timestamp) * rate)
    for (let c = 0; c < Math.min(channelCount, chunk.channels.length); c++) {
      const data = chunk.channels[c] ?? new Float32Array(0)
      channels[c]?.set(at + data.length <= length ? data : data.subarray(0, Math.max(0, length - at)), at)
    }
  }
  return { channels, startS: first.timestamp, rate }
}
