import type { Peaks } from './peaks'

/** What is wanted of a sound file: where it is in the project, and roughly how long it plays, to size the levels at once. */
export interface WantedWave {
  readonly file: string
  readonly durationMs: number
}

/** Reads the levels of one file. It should stop, with an error, when the signal is aborted. */
export type ReadLevels = (file: string, durationMs: number, signal: AbortSignal) => Promise<Peaks>

/**
 * How loud each sound file of a project is along its length, for the waveforms on the timeline. A file is read once, a
 * block at a time, one file at a time, and the levels are kept: they are a few kilobytes for every minute of sound. What
 * is wanted is told with want, which replaces what was wanted before. A waveform is something to look at and never worth
 * an error: a file that cannot be read is left without one.
 */
export class Waveforms {
  private readonly peaks = new Map<string, Peaks>()
  private readonly failed = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private wanted: WantedWave[] = []
  private running = false
  private disposed = false
  private count = 0
  private readonly cancelled = new AbortController()

  constructor(private readonly read: ReadLevels) {}

  /** Counts every file that has been read, so that what is drawn from the levels can tell that it is out of date. */
  get revision(): number {
    return this.count
  }

  get(file: string): Peaks | undefined {
    return this.peaks.get(file)
  }

  /** Tells which files are wanted now, the most wanted first. */
  want(files: readonly WantedWave[]): void {
    if (this.disposed) return
    const seen = new Set<string>()
    this.wanted = files.filter((wave) => {
      if (seen.has(wave.file) || this.peaks.has(wave.file) || this.failed.has(wave.file)) return false
      seen.add(wave.file)
      return true
    })
    if (this.wanted.length > 0 && !this.running) {
      this.running = true
      void this.run()
    }
  }

  /** Calls back whenever the levels of a file have arrived. Returns the way to stop. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Lets go of everything, and tells the file being read that it is no longer needed. */
  dispose(): void {
    this.disposed = true
    this.cancelled.abort()
    this.wanted = []
    this.listeners.clear()
    this.peaks.clear()
  }

  private async run(): Promise<void> {
    try {
      for (let next = this.wanted.shift(); next && !this.disposed; next = this.wanted.shift()) {
        if (this.peaks.has(next.file) || this.failed.has(next.file)) continue
        try {
          const levels = await this.read(next.file, next.durationMs, this.cancelled.signal)
          if (this.disposed) return
          this.peaks.set(next.file, levels)
          this.count++
          for (const listener of [...this.listeners]) listener()
        } catch {
          if (this.disposed) return
          this.failed.add(next.file)
        }
      }
    } finally {
      this.running = false
    }
  }
}
