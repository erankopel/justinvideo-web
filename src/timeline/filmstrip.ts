import { BlobSource, CanvasSink, Input } from 'mediabunny'
import { VIDEO_FORMATS } from '../import/formats'

/** A decoded frame, already scaled to the height of the strip. */
export type Picture = HTMLCanvasElement | OffscreenCanvas

/** One recording opened for reading single frames. */
export interface FrameReader {
  /** The frame showing at a moment of the recording, or null when there is none that early. */
  frameAt(timeMs: number): Promise<Picture | null>
  close(): void
}

export type OpenReader = (sourceId: string) => Promise<FrameReader>

/** Opens a recording from its file, with its frames made upright and scaled to the strip's height. */
export function readerFromFiles(read: (sourceId: string) => Promise<File>, heightPx: number): OpenReader {
  return async (sourceId) => {
    const input = new Input({ source: new BlobSource(await read(sourceId)), formats: VIDEO_FORMATS })
    try {
      const track = await input.getPrimaryVideoTrack()
      if (!track || !(await track.canDecode())) throw new Error('The recording cannot be decoded here')
      const sink = new CanvasSink(track, { height: heightPx })
      return {
        frameAt: async (timeMs) => (await sink.getCanvas(timeMs / 1000))?.canvas ?? null,
        close: () => input.dispose(),
      }
    } catch (error) {
      input.dispose()
      throw error
    }
  }
}

export interface WantedFrame {
  readonly sourceId: string
  readonly timeMs: number
}

export interface FilmstripOptions {
  /** How many frames are kept. A frame is a small picture, so this is a few megabytes. */
  readonly capacity?: number
  /** How long recordings stay open after the last frame was read, so that the next scroll does not open them again. */
  readonly lingerMs?: number
}

/** After this many frames in a row that cannot be decoded, a recording is given up on. */
const GIVE_UP_AFTER = 3

const keyOf = (sourceId: string, timeMs: number): string => `${sourceId}@${timeMs}`

/**
 * The small pictures shown on the clips. What is wanted is told with want, which replaces what was wanted before, so
 * while the view is dragged only the frames of the last place are read, one at a time and the first of the list first.
 * Frames are kept, the longest unused one leaving first, and are read again if asked for after that. A picture is
 * something to look at and never worth an error: a recording that cannot be read is left without pictures.
 */
export class Filmstrip {
  private readonly frames = new Map<string, { sourceId: string; timeMs: number; picture: Picture }>()
  private readonly listeners = new Set<() => void>()
  private readonly readers = new Map<string, Promise<FrameReader | null>>()
  private readonly missing = new Set<string>()
  private readonly givenUp = new Set<string>()
  private readonly errors = new Map<string, number>()
  private wanted: WantedFrame[] = []
  private running = false
  private disposed = false
  private lingering: ReturnType<typeof setTimeout> | null = null
  private count = 0
  private readonly capacity: number
  private readonly lingerMs: number

  constructor(
    private readonly open: OpenReader,
    options: FilmstripOptions = {},
  ) {
    this.capacity = options.capacity ?? 400
    this.lingerMs = options.lingerMs ?? 10_000
  }

  /** Counts every picture that arrives, so that what is drawn from the frames can tell that it is out of date. */
  get revision(): number {
    return this.count
  }

  /** The frame kept for a moment, if there is one. Looking at it counts as using it. */
  get(sourceId: string, timeMs: number): Picture | undefined {
    const key = keyOf(sourceId, timeMs)
    const found = this.frames.get(key)
    if (!found) return undefined
    this.frames.delete(key)
    this.frames.set(key, found)
    return found.picture
  }

  /** The kept frame of a recording that is nearest a moment, within a distance: a stand-in until the right one is read. */
  nearest(sourceId: string, timeMs: number, withinMs: number): Picture | undefined {
    let best: Picture | undefined
    let bestDistance = withinMs
    for (const frame of this.frames.values()) {
      if (frame.sourceId !== sourceId) continue
      const distance = Math.abs(frame.timeMs - timeMs)
      if (distance <= bestDistance) {
        best = frame.picture
        bestDistance = distance
      }
    }
    return best
  }

  /** Tells which frames are wanted now, the most wanted first. Whatever was wanted before and is not here is let go. */
  want(frames: readonly WantedFrame[]): void {
    if (this.disposed) return
    const seen = new Set<string>()
    this.wanted = frames.filter((frame) => {
      const key = keyOf(frame.sourceId, frame.timeMs)
      if (seen.has(key) || this.frames.has(key) || this.missing.has(key) || this.givenUp.has(frame.sourceId)) return false
      seen.add(key)
      return true
    })
    if (this.wanted.length > 0 && !this.running) {
      this.running = true
      if (this.lingering) clearTimeout(this.lingering)
      this.lingering = null
      void this.run()
    }
  }

  /** Calls back whenever a picture has arrived. Returns the way to stop. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Lets go of everything. A recording is never closed while a frame is being decoded from it, which a browser's decoder
   * does not always survive (Firefox's takes the page down with it): the read that is under way finishes, and then the
   * recordings are closed.
   */
  dispose(): void {
    this.disposed = true
    this.wanted = []
    this.listeners.clear()
    if (this.lingering) clearTimeout(this.lingering)
    this.lingering = null
    this.frames.clear()
    if (!this.running) this.closeReaders()
  }

  private async run(): Promise<void> {
    try {
      for (let next = this.wanted.shift(); next && !this.disposed; next = this.wanted.shift()) {
        const key = keyOf(next.sourceId, next.timeMs)
        if (this.frames.has(key) || this.givenUp.has(next.sourceId)) continue
        const reader = await this.readerOf(next.sourceId)
        if (this.disposed) return
        if (!reader) continue
        try {
          const picture = await reader.frameAt(next.timeMs)
          if (this.disposed) return
          this.errors.delete(next.sourceId)
          if (picture) this.keep(next.sourceId, next.timeMs, picture)
          else this.missing.add(key)
        } catch {
          if (this.disposed) return
          this.missing.add(key)
          const errors = (this.errors.get(next.sourceId) ?? 0) + 1
          this.errors.set(next.sourceId, errors)
          if (errors >= GIVE_UP_AFTER) this.giveUp(next.sourceId)
        }
      }
    } finally {
      this.running = false
      if (this.disposed) this.closeReaders()
      else this.lingering = setTimeout(() => this.closeReaders(), this.lingerMs)
    }
  }

  private readerOf(sourceId: string): Promise<FrameReader | null> {
    let reader = this.readers.get(sourceId)
    if (!reader) {
      reader = this.open(sourceId).catch(() => {
        this.giveUp(sourceId)
        return null
      })
      this.readers.set(sourceId, reader)
    }
    return reader
  }

  private giveUp(sourceId: string): void {
    this.givenUp.add(sourceId)
    const reader = this.readers.get(sourceId)
    this.readers.delete(sourceId)
    void reader?.then((r) => r?.close())
  }

  private closeReaders(): void {
    const open = [...this.readers.values()]
    this.readers.clear()
    for (const reader of open) void reader.then((r) => r?.close())
  }

  private keep(sourceId: string, timeMs: number, picture: Picture): void {
    this.frames.set(keyOf(sourceId, timeMs), { sourceId, timeMs, picture })
    while (this.frames.size > this.capacity) {
      const oldest = this.frames.keys().next()
      if (oldest.done) break
      this.frames.delete(oldest.value)
    }
    this.count++
    for (const listener of [...this.listeners]) listener()
  }
}
