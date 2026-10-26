import { SEEK_TOLERANCE_MS, type ItemLevel, SYNC_TOLERANCE_MS, samePlayedSound } from '../audio/levels'
import type { AudioItem } from '../engine/audio'
import type { Output, SoundStage } from './sound'

interface Entry {
  item: AudioItem
  readonly element: HTMLAudioElement
  readonly output: Output
  readonly url: Promise<string>
  loaded: boolean
}

/**
 * Plays the music and voiceovers of an edit alongside its picture. Each piece that is playing or about to play has an
 * audio element of its own, made when the playhead comes near its start and released when it has passed, so only the
 * pieces near the playhead cost anything. update is called whenever the playhead moves, with where each piece should be
 * and how loud, and brings every element to that.
 */
export class ItemPlayer {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly stage: SoundStage,
    /** Where the audio elements are kept, hidden, so that they can be seen with the developer tools and by the tests. */
    private readonly host: HTMLElement,
    private readonly file: (item: AudioItem) => Promise<Blob>,
    private readonly failed: (itemId: string) => void,
  ) {}

  update(levels: readonly ItemLevel[], playing: boolean): void {
    const wanted = new Set(levels.map((level) => level.item.id))
    for (const [id, entry] of [...this.entries]) {
      const level = levels.find((l) => l.item.id === id)
      if (!wanted.has(id) || !level || !samePlayedSound(level.item, entry.item)) this.drop(id)
    }
    for (const level of levels) {
      const entry = this.entries.get(level.item.id) ?? this.make(level.item)
      entry.item = level.item
      const element = entry.element
      entry.output.set(level.gain)
      if (!entry.loaded) continue
      const targetS = level.fileMs / 1000
      const driftMs = Math.abs(element.currentTime * 1000 - level.fileMs)
      const pastEnd = element.currentTime * 1000 >= level.item.trimStartMs + level.item.lengthMs
      if (playing && level.inside && !pastEnd) {
        if (driftMs > SYNC_TOLERANCE_MS) element.currentTime = targetS
        if (element.paused) element.play().catch(() => undefined)
      } else {
        if (!element.paused) element.pause()
        if (driftMs > SEEK_TOLERANCE_MS && !pastEnd) element.currentTime = targetS
      }
    }
  }

  pause(): void {
    for (const entry of this.entries.values()) if (!entry.element.paused) entry.element.pause()
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.drop(id)
  }

  private make(item: AudioItem): Entry {
    const element = new Audio()
    element.preload = 'auto'
    element.setAttribute('aria-hidden', 'true')
    element.hidden = true
    element.dataset['item'] = item.id
    this.host.append(element)
    const output = this.stage.output(element)
    output.set(0)
    const url = this.file(item).then((blob) => URL.createObjectURL(blob))
    const entry: Entry = { item, element, output, url, loaded: false }
    element.addEventListener('error', () => this.failed(entry.item.id))
    url.then(
      (address) => {
        if (this.entries.get(item.id) !== entry) {
          URL.revokeObjectURL(address)
          return
        }
        element.src = address
        entry.loaded = true
      },
      () => this.failed(item.id),
    )
    this.entries.set(item.id, entry)
    return entry
  }

  private drop(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    entry.element.pause()
    entry.output.release()
    entry.element.removeAttribute('src')
    entry.element.load()
    entry.element.remove()
    void entry.url.then((address) => URL.revokeObjectURL(address), () => undefined)
  }
}
