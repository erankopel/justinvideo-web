import { AudioBufferSink, BlobSource, Input } from 'mediabunny'
import { AUDIO_FORMATS } from './files'

/** How long a stretch of sound each kept level covers: a hundredth of a second, a few pixels at the closest zoom. */
export const PEAK_BUCKET_MS = 10

/** How loud a sound is along its length: the loudest sample in each stretch, from 0 to 255 for silence to full scale. */
export interface Peaks {
  readonly bucketMs: number
  readonly values: Uint8Array
  /** How much of the file the levels reach, which is the length of the sound. */
  readonly durationMs: number
}

/**
 * Collects the loudest sample of every stretch from blocks of sound as they are decoded, so a long file is never held whole.
 * Blocks come with their start time and may arrive with gaps or overlaps; each sample goes where its time says.
 */
export class PeakBuilder {
  private values: Uint8Array
  private lastBucket = -1

  constructor(
    private readonly bucketMs: number = PEAK_BUCKET_MS,
    expectedMs = 0,
  ) {
    this.values = new Uint8Array(Math.max(16, Math.ceil(expectedMs / bucketMs) + 2))
  }

  /** Adds a block of sound: its channels, the second it starts at in the file, and its sample rate. */
  add(channels: readonly Float32Array[], startS: number, sampleRate: number): void {
    const length = channels.reduce((most, channel) => Math.max(most, channel.length), 0)
    if (length === 0 || !(sampleRate > 0)) return
    const samplesPerBucket = (sampleRate * this.bucketMs) / 1000
    const startSample = startS * sampleRate
    let from = 0
    while (from < length) {
      // The stretch this sample is in, and the last sample of this block that is still in it.
      const bucket = Math.max(0, Math.floor((startSample + from) / samplesPerBucket))
      const to = Math.min(length, Math.max(from + 1, Math.ceil((bucket + 1) * samplesPerBucket - startSample)))
      let peak = 0
      for (const channel of channels) {
        for (let k = from; k < Math.min(to, channel.length); k++) {
          const level = Math.abs(channel[k] ?? 0)
          if (level > peak) peak = level
        }
      }
      this.put(bucket, Math.round(Math.min(peak, 1) * 255))
      from = to
    }
  }

  private put(bucket: number, value: number): void {
    if (bucket >= this.values.length) {
      const grown = new Uint8Array(Math.max(bucket + 1, this.values.length * 2))
      grown.set(this.values)
      this.values = grown
    }
    if (value > (this.values[bucket] ?? 0)) this.values[bucket] = value
    if (bucket > this.lastBucket) this.lastBucket = bucket
  }

  /** The levels, cut to the stretch that was heard. */
  finish(): Peaks {
    const count = this.lastBucket + 1
    return { bucketMs: this.bucketMs, values: this.values.slice(0, count), durationMs: count * this.bucketMs }
  }
}

/**
 * Reads how loud a sound file is along its length, by decoding it a block at a time with Mediabunny. The sound of a video
 * file is read the same way. Throws when the file has no sound or cannot be decoded here, or when the signal is aborted,
 * which stops it at the next block, and lets the decoder finish what it has under way before it is closed.
 */
export async function readPeaks(file: Blob, expectedMs = 0, signal?: AbortSignal): Promise<Peaks> {
  const input = new Input({ source: new BlobSource(file), formats: AUDIO_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) throw new Error('The sound cannot be decoded here')
    const builder = new PeakBuilder(PEAK_BUCKET_MS, expectedMs)
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      if (signal?.aborted) throw new DOMException('The sound was no longer needed', 'AbortError')
      builder.add(
        Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)),
        timestamp,
        buffer.sampleRate,
      )
    }
    return builder.finish()
  } finally {
    input.dispose()
  }
}
