import { ALL_FORMATS, AudioSample, AudioSampleSource, BufferSource, BufferTarget, canEncodeAudio, Input, Mp4OutputFormat, Output } from 'mediabunny'
import { describe, expect, it } from 'vitest'
import { AAC_PROBE, softwareAac } from './aac'

/** One second of a 440 Hz tone at half scale, stereo, in blocks of 1024 frames. */
function* tone(seconds: number): Generator<AudioSample> {
  const rate = AAC_PROBE.sampleRate
  const block = 1024
  for (let start = 0; start < seconds * rate; start += block) {
    const frames = Math.min(block, seconds * rate - start)
    const data = new Float32Array(frames * 2)
    for (let i = 0; i < frames; i++) {
      const value = 0.5 * Math.sin((2 * Math.PI * 440 * (start + i)) / rate)
      data[i] = value
      data[frames + i] = value
    }
    yield new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: rate, timestamp: start / rate })
  }
}

describe('the AAC encoder that the site brings', () => {
  it('is loaded, and then Mediabunny can encode AAC where there is no browser to do it', async () => {
    expect(await canEncodeAudio('aac', AAC_PROBE)).toBe(false)
    expect(await softwareAac()).toBe(true)
    expect(await canEncodeAudio('aac', AAC_PROBE)).toBe(true)
    // Asked again, it is the same answer and nothing is loaded twice.
    expect(await softwareAac()).toBe(true)
  }, 30_000)

  it('writes an AAC track into an MP4 file that reads back with the length and the format that was asked for', async () => {
    expect(await softwareAac()).toBe(true)
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
    const source = new AudioSampleSource({ codec: 'aac', bitrate: AAC_PROBE.bitrate })
    output.addAudioTrack(source)
    await output.start()
    for (const sample of tone(2)) {
      await source.add(sample)
      sample.close()
    }
    await output.finalize()
    const bytes = output.target.buffer
    expect(bytes).not.toBeNull()
    const input = new Input({ source: new BufferSource(bytes as ArrayBuffer), formats: ALL_FORMATS })
    const track = await input.getPrimaryAudioTrack()
    expect(track?.codec).toBe('aac')
    expect(track?.numberOfChannels).toBe(2)
    expect(track?.sampleRate).toBe(48_000)
    const duration = await input.computeDuration()
    expect(duration).toBeGreaterThan(1.9)
    expect(duration).toBeLessThan(2.1)
    // About one packet in 21 milliseconds: 2 s of AAC at 1024 samples a frame is 94 of them.
    const stats = await track?.computePacketStats()
    expect(stats?.packetCount).toBeGreaterThan(90)
    expect(stats?.packetCount).toBeLessThan(100)
    // Not silent: 192 kbit/s of a tone is not a few hundred bytes.
    expect(stats?.averageBitrate).toBeGreaterThan(50_000)
  }, 60_000)
})
