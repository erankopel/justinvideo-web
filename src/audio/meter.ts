/** The quietest sound the meter shows, in decibels below full scale. Anything under it is the bottom of the scale. */
export const FLOOR_DB = -60

/**
 * How loud a stretch of samples is, from 0 for silence to 1 for full scale, on a scale of decibels from FLOOR_DB, so that a
 * quiet voice moves the meter as a loud one does. It is the root mean square, which is what the ear follows, not the peak.
 */
export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) sum += sample * sample
  const rms = Math.sqrt(sum / samples.length)
  if (!(rms > 0)) return 0
  const decibels = 20 * Math.log10(rms)
  return Math.min(1, Math.max(0, (decibels - FLOOR_DB) / -FLOOR_DB))
}

/** How fast the bar falls back, as a part of the whole scale every second: it rises at once and falls at this rate. */
export const FALL_PER_SECOND = 1.2

/** What a meter shows, which follows a loud moment up at once and lets go of it a little slower, so that it can be read. */
export function smoothed(shown: number, level: number, elapsedMs: number): number {
  if (level >= shown) return level
  return Math.max(level, shown - (FALL_PER_SECOND * Math.max(elapsedMs, 0)) / 1000)
}

/** How long the audio engine is given to start running before the level is said to be unavailable here, in milliseconds. */
const START_GRACE_MS = 1500

/**
 * Measures how loud a microphone is, from the stream the browser gives for it, with the Web Audio analyser. Where the audio
 * engine does not run, which is so in a browser that has no sound device to run it on, there is no level: level() is null,
 * and the page says so, rather than showing a bar that is stuck at nothing.
 */
export class InputMeter {
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private samples: Float32Array<ArrayBuffer> | null = null
  private readonly openedAt = performance.now()
  private closed = false

  constructor(stream: MediaStream) {
    try {
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      context.createMediaStreamSource(stream).connect(analyser)
      this.context = context
      this.analyser = analyser
      this.samples = new Float32Array(analyser.fftSize)
      void context.resume().catch(() => undefined)
    } catch {
      this.close()
    }
  }

  /** The loudness of the last moment, from 0 to 1, or null when this browser cannot measure it. */
  level(): number | null {
    const { context, analyser, samples } = this
    if (this.closed || !context || !analyser || !samples) return null
    if (context.state !== 'running') return null
    analyser.getFloatTimeDomainData(samples)
    return levelOf(samples)
  }

  /** Whether the audio engine had its chance to start and did not, so that there is no level to wait for. */
  get unavailable(): boolean {
    if (this.closed || !this.context) return true
    return this.context.state !== 'running' && performance.now() - this.openedAt > START_GRACE_MS
  }

  close(): void {
    this.closed = true
    const context = this.context
    this.context = null
    this.analyser = null
    this.samples = null
    void context?.close().catch(() => undefined)
  }
}
