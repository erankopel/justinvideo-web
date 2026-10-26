import { levelsAt } from '../audio/levels'
import { type AudioItem, type AudioMix, EMPTY_MIX } from '../engine/audio'
import { ItemPlayer } from './items'
import { editTimeMs, locate, type Segment, sourceTimeMs } from './segments'
import { type Output, SoundStage } from './sound'

export interface PlayerEvents {
  /** Where the playhead is, in edit time. Called while playing, once per frame drawn, and after every seek. */
  position(ms: number): void
  playing(playing: boolean): void
  /** The picture played to the end of the edit and stopped. */
  ended(): void
  /** A recording could not be read or played by this browser. */
  failed(sourceId: string | null): void
  /** A piece of music or a voiceover could not be read or played by this browser. */
  itemFailed(itemId: string): void
}

/** What the player needs to play the sound laid under the edit. */
export interface PlayerSound {
  /** The file of a piece of music or a voiceover. */
  readonly itemFile: (item: AudioItem) => Promise<Blob>
}

interface Deck {
  readonly video: HTMLVideoElement
  /** How loud the deck's own sound is. */
  readonly out: Output
  sourceId: string | null
  /** The index of the segment that this deck has been made ready for, waiting to be swapped in when playback reaches it. */
  readyFor: number | null
  /** Operations on a deck run one after another, so a preload and a seek never fight over its time. */
  chain: Promise<unknown>
}

const SEEK_TIMEOUT_MS = 4_000
const FORCED_SEEK_TIMEOUT_MS = 400

/**
 * Plays an edit in two video elements. One shows the picture and, while it plays, the next segment is made ready in the
 * other, so a cut between pieces that do not continue each other is a swap and not a wait. Pieces that do continue each
 * other, such as the halves of a split, are one segment and play straight through. Every position this class takes or
 * gives is edit time, so the timeline never has to think in clips or recordings.
 *
 * The sound goes through a SoundStage: the sound of the clip under the playhead, and the music and voiceovers of the mix
 * (ItemPlayer), each at the level the gain envelopes give for that moment of the edit.
 */
export class EditPlayer {
  private readonly decks: readonly [Deck, Deck]
  private active = 0
  private segments: readonly Segment[] = []
  private durationMs = 0
  private segmentIndex = 0
  private position = 0
  private playing = false
  private frame = 0
  /** Raised by every seek, so that anything started for an older one can tell that it has been overtaken. */
  private token = 0
  private readonly urls = new Map<string, Promise<string>>()
  private disposed = false
  private mix: AudioMix = EMPTY_MIX
  private readonly stage: SoundStage
  private readonly items: ItemPlayer

  constructor(
    host: HTMLElement,
    private readonly files: (sourceId: string) => Promise<Blob>,
    private readonly events: PlayerEvents,
    sound: PlayerSound,
  ) {
    host.dataset['sound'] = 'elements'
    this.stage = new SoundStage(undefined, (mode) => {
      host.dataset['sound'] = mode
    })
    this.items = new ItemPlayer(this.stage, host, sound.itemFile, (id) => this.events.itemFailed(id))
    // For the tests: how loud what is heard is, which only a running Web Audio graph can say.
    Object.defineProperty(host, 'soundLevel', { value: () => this.stage.level(), configurable: true })
    const make = (): Deck => {
      const video = document.createElement('video')
      video.playsInline = true
      video.preload = 'auto'
      video.disablePictureInPicture = true
      video.setAttribute('aria-hidden', 'true')
      video.dataset['active'] = 'false'
      video.addEventListener('error', () => {
        const deck = this.decks.find((d) => d.video === video)
        if (deck?.sourceId) this.events.failed(deck.sourceId)
      })
      host.append(video)
      return { video, out: this.stage.output(video), sourceId: null, readyFor: null, chain: Promise.resolve() }
    }
    this.decks = [make(), make()]
  }

  /** The deck that shows the picture, and the one that waits behind it. */
  private get current(): Deck {
    return this.decks[this.active === 0 ? 0 : 1]
  }

  private get standby(): Deck {
    return this.decks[this.active === 0 ? 1 : 0]
  }

  get positionMs(): number {
    return this.position
  }

  get isPlaying(): boolean {
    return this.playing
  }

  /** The element that shows the picture now. */
  get shown(): HTMLVideoElement {
    return this.current.video
  }

  /** Gives the player a new edit. Playback stops, and the picture goes to positionMs of the new edit, or to where it was. */
  setEdit(segments: readonly Segment[], durationMs: number, positionMs: number = this.position): void {
    this.segments = segments
    this.durationMs = durationMs
    this.decks.forEach((deck) => (deck.readyFor = null))
    this.stop()
    if (segments.length === 0) {
      this.position = 0
      this.events.position(0)
      return
    }
    void this.seek(Math.min(Math.max(positionMs, 0), durationMs))
  }

  /** Lets go of a jump that is on its way, so that its arrival does not move the playhead: something else is about to put it somewhere. */
  supersede(): void {
    this.token++
  }

  /** Gives the player the music, the voiceovers and the fades of the edit. They are heard from the playhead on. */
  setMix(mix: AudioMix): void {
    this.mix = mix
    this.applyLevels()
  }

  /** Moves the playhead. If the picture was playing it keeps playing from there. */
  async seek(editMs: number, force = false): Promise<void> {
    if (this.disposed) return
    const token = ++this.token
    this.cancelFrame()
    const target = locate(this.segments, editMs)
    const segment = target ? this.segments[target.index] : undefined
    if (!target || !segment) return
    const wanted = Math.min(Math.max(editMs, 0), this.durationMs)
    // The playhead is at the new place from now on, not when the picture gets there: Play pressed while the picture is
    // still on its way, which on a slow machine or with a long recording takes a while, must start from the place the
    // person sees, and not from where the playhead was before.
    this.position = wanted
    // Another deck is used when this one shows something else, so the picture does not go black while a recording loads.
    const deck = this.deckFor(segment.sourceId)
    try {
      await this.run(deck, async () => {
        if (token === this.token) await this.prepare(deck, segment.sourceId, sourceTimeMs(segment, target.offsetMs), force)
      })
    } catch {
      if (token === this.token) {
        this.stop()
        this.events.failed(segment.sourceId)
      }
      return
    }
    if (token !== this.token || this.disposed) return
    this.segmentIndex = target.index
    this.position = wanted
    this.show(deck)
    this.events.position(wanted)
    if (this.playing) this.resume()
    else this.preloadNext()
  }

  /** Starts playing. At the end of the edit it plays from the start. */
  play(): void {
    if (this.segments.length === 0 || this.disposed) return
    if (this.position >= this.durationMs - 1) this.position = 0
    this.setPlaying(true)
    // This is the moment the browser lets the sound start; the picture waits a moment for it, once, and no longer when it never does.
    void this.stage.wake().then(() => {
      if (this.playing) void this.seek(this.position)
    })
  }

  pause(): void {
    this.stop()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelFrame()
    this.items.dispose()
    for (const deck of this.decks) {
      deck.out.release()
      deck.video.pause()
      deck.video.removeAttribute('src')
      deck.video.load()
      deck.video.remove()
    }
    for (const url of this.urls.values()) void url.then((address) => URL.revokeObjectURL(address))
    this.urls.clear()
    this.stage.dispose()
  }

  // ---- inside ----

  private stop(): void {
    const wasPlaying = this.playing
    this.cancelFrame()
    for (const deck of this.decks) deck.video.pause()
    this.setPlaying(false)
    this.items.pause()
    this.applyLevels()
    // The picture is taken to the frame at the playhead, and not left on the one the browser last painted: some browsers, WebKit
    // among them, leave on the screen a frame from a while before the one the picture stopped on, and say a clock that runs
    // ahead of the frames it has shown. Asking for the frame again, from the playhead, makes the picture and the playhead agree.
    if (wasPlaying) void this.seek(this.position, true)
  }

  private setPlaying(playing: boolean): void {
    if (this.playing === playing) return
    this.playing = playing
    this.events.playing(playing)
  }

  private cancelFrame(): void {
    cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  private deckFor(sourceId: string): Deck {
    if (this.current.sourceId === sourceId) return this.current
    return this.standby
  }

  private run<T>(deck: Deck, operation: () => Promise<T>): Promise<T> {
    const next = deck.chain.then(operation, operation)
    deck.chain = next.catch(() => undefined)
    return next
  }

  private urlFor(sourceId: string): Promise<string> {
    let url = this.urls.get(sourceId)
    if (!url) {
      url = this.files(sourceId).then((blob) => URL.createObjectURL(blob))
      this.urls.set(sourceId, url)
      url.catch(() => this.urls.delete(sourceId))
    }
    return url
  }

  /** Makes a deck hold the recording and show the frame at sourceMs, paused. */
  private async prepare(deck: Deck, sourceId: string, sourceMs: number, force = false): Promise<void> {
    const video = deck.video
    const loading = deck.sourceId !== sourceId
    if (loading) {
      const url = await this.urlFor(sourceId)
      deck.sourceId = sourceId
      deck.readyFor = null
      video.src = url
      await waitFor(video, 'loadedmetadata')
    }
    // A video that was only just loaded is seeked even to the time it is at: Firefox shows a frame a little way in at first.
    await seekVideo(video, sourceMs / 1000, loading || force)
  }

  private show(deck: Deck): void {
    this.active = deck === this.decks[0] ? 0 : 1
    for (const d of this.decks) {
      const on = d === deck
      d.video.dataset['active'] = String(on)
      if (!on) d.video.pause()
    }
    this.applyLevels()
  }

  /** Brings the sound of the clip under the playhead, and of the music and voiceovers, to where the playhead is. */
  private applyLevels(): void {
    if (this.disposed) return
    const levels = levelsAt(this.segments[this.segmentIndex]?.volumePercent ?? 100, this.mix, this.position, this.durationMs)
    this.current.out.set(levels.clip)
    this.standby.out.set(0)
    this.items.update(levels.items, this.playing)
  }

  private resume(): void {
    this.current.video.play().catch(() => {
      // The browser refused to start the picture, for instance because nobody had touched the page yet.
      this.stop()
    })
    this.cancelFrame()
    this.frame = requestAnimationFrame(this.tick)
    this.preloadNext()
  }

  private readonly tick = (): void => {
    if (!this.playing || this.disposed) return
    const segment = this.segments[this.segmentIndex]
    const video = this.current.video
    if (!segment) return
    const editMs = editTimeMs(segment, video.currentTime * 1000)
    if (editMs >= segment.endMs - 1 || video.ended) {
      this.crossBoundary()
      return
    }
    this.position = Math.max(editMs, segment.startMs)
    this.applyLevels()
    this.events.position(this.position)
    this.frame = requestAnimationFrame(this.tick)
  }

  private crossBoundary(): void {
    const next = this.segments[this.segmentIndex + 1]
    if (!next) {
      this.cancelFrame()
      this.current.video.pause()
      this.position = this.durationMs
      this.events.position(this.durationMs)
      this.setPlaying(false)
      this.events.ended()
      // The last frame is asked for again, and not taken to be where the video says it is: a browser that has painted an
      // earlier one can say it has run to the end.
      void this.seek(this.durationMs, true)
      return
    }
    const other = this.standby
    if (other.readyFor === this.segmentIndex + 1 && other.sourceId === next.sourceId) {
      // The next picture is waiting, showing its first frame: swap and play.
      this.segmentIndex++
      this.position = next.startMs
      other.readyFor = null
      other.video.play().catch(() => this.stop())
      this.show(other)
      this.events.position(this.position)
      this.frame = requestAnimationFrame(this.tick)
      this.preloadNext()
    } else {
      // Not ready yet: take the slow way, which waits for the recording and then goes on playing.
      void this.seek(next.startMs)
    }
  }

  /** Makes the other deck ready for the segment after this one, so that reaching it is a swap. */
  private preloadNext(): void {
    const index = this.segmentIndex + 1
    const next = this.segments[index]
    if (!next) return
    const other = this.standby
    if (other.readyFor === index && other.sourceId === next.sourceId) return
    other.readyFor = null
    const token = this.token
    this.run(other, async () => {
      if (token !== this.token || other === this.current) return
      await this.prepare(other, next.sourceId, next.sourceStartMs)
      if (token === this.token && other !== this.decks[this.active]) other.readyFor = index
    }).catch(() => undefined)
  }
}

function waitFor(video: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (): void => {
      video.removeEventListener(event, done)
      video.removeEventListener('error', failed)
      resolve()
    }
    const failed = (): void => {
      video.removeEventListener(event, done)
      video.removeEventListener('error', failed)
      reject(new Error('The video could not be loaded'))
    }
    video.addEventListener(event, done)
    video.addEventListener('error', failed)
  })
}

/** Moves a video to a time and resolves when the frame there is ready to show. force seeks even to the time it is at. */
function seekVideo(video: HTMLVideoElement, seconds: number, force = false): Promise<void> {
  const target = Number.isFinite(video.duration) ? Math.min(seconds, video.duration) : seconds
  const there = video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - target) < 0.001
  if (there && !force) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      video.removeEventListener('seeked', finish)
      resolve()
    }
    // A seek to where the video already is may not report that it is done, so a forced one waits only a moment.
    const timer = setTimeout(finish, there ? FORCED_SEEK_TIMEOUT_MS : SEEK_TIMEOUT_MS)
    video.addEventListener('seeked', finish)
    video.currentTime = target
  })
}
