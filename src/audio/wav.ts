/** The 16-bit value that a sample between -1 and 1 is stored as. Louder than the range is cut, not wrapped. */
export const toInt16 = (sample: number): number => {
  const level = Math.max(-1, Math.min(1, sample))
  return Math.sign(level) * Math.round(Math.abs(level) * 32767)
}

/** The loudest 16-bit sample, 0 for exact silence. A microphone that is blocked gives exact silence; a working one never does. */
export function peakInt16(samples: Float32Array): number {
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(toInt16(sample)))
  return peak
}

/** A mono 16-bit WAV file of the samples, which every browser can play and seek in exactly. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(bytes)
  const text = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, toInt16(samples[i] ?? 0), true)
  return new Blob([bytes], { type: 'audio/wav' })
}

/** One channel from several, by their average. */
export function toMono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0]
  if (!first) return new Float32Array(0)
  if (channels.length === 1) return first
  const mono = new Float32Array(first.length)
  for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0) / channels.length
  return mono
}
