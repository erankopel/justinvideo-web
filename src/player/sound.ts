/** One sound that the stage sets the loudness of. 1 is as loud as the file is; above 1 is louder, which only the graph can do. */
export interface Output {
  set(level: number): void
  /** The sound is no longer needed: its place in the graph is given up. */
  release(): void
}

/** Through what the sound is heard: the Web Audio graph, which can be louder than the file, or the elements' own volume. */
export type SoundMode = 'graph' | 'elements'

/** How long the first press of Play waits for the browser to let Web Audio run, before the picture goes on without it. */
const START_WAIT_MS = 150

/** How quickly a gain follows a new level, in seconds, so that a fade or a jump does not click. */
const GAIN_SMOOTHING_S = 0.01

/** How long the clock of a context that says it runs is watched for a sign that it does. */
const CLOCK_WATCH_MS = 120

const clamp01 = (level: number): number => Math.min(1, Math.max(0, level))

const delay = (ms: number): Promise<false> => new Promise((resolve) => setTimeout(() => resolve(false), ms))

/**
 * Whether the clock of the context moves. A browser with no sound device to run it on can say that a context is running
 * while nothing is processed, and sound sent into it is lost, so a graph is only used once the clock is seen to move.
 */
async function clockMoves(context: AudioContext): Promise<boolean> {
  const start = context.currentTime
  const deadline = performance.now() + CLOCK_WATCH_MS
  while (context.currentTime <= start) {
    if (performance.now() >= deadline) return false
    await delay(10)
  }
  return true
}

/**
 * Where the sound of the preview is heard. With Web Audio running, each video and each piece of music goes through a gain
 * node whose level comes from the same envelopes as the export, so a clip set above 100 percent is louder here too and the
 * fades are smooth. Web Audio only runs after the person has touched the page, and in a browser with no sound device it
 * may never run; the sound is then played at the elements' own volume, which cannot go above the file's. An element is
 * only ever connected to the graph once it is running, because one that is connected to a graph that is not running goes
 * silent, and in some browsers stops.
 */
export class SoundStage {
  private context: AudioContext | null = null
  private tap: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private failedToStart = false
  /** Whether the clock of the context has been seen to move: null before it was looked at, and looked at again after a no. */
  private clockRuns: boolean | null = null
  private readonly outputs = new Set<MediaOutput>()
  private disposed = false

  constructor(
    private readonly create: () => AudioContext = () => new AudioContext(),
    private readonly onMode: (mode: SoundMode) => void = () => undefined,
  ) {}

  get mode(): SoundMode {
    return this.tap ? 'graph' : 'elements'
  }

  /** A way to set the loudness of an element's sound. */
  output(element: HTMLMediaElement): Output {
    const output = new MediaOutput(this, element)
    this.outputs.add(output)
    return output
  }

  /** Called when the person presses Play: the one moment the browser lets the graph start. Never fails. */
  async wake(): Promise<void> {
    if (this.disposed) return
    if (!this.context) {
      try {
        this.context = this.create()
      } catch {
        return
      }
      this.context.addEventListener('statechange', () => void this.changed())
    }
    const context = this.context
    if (context.state !== 'running') {
      const resumed = context.resume().then(
        () => true,
        () => false,
      )
      // Once the browser has not let it start, the next presses do not wait: it joins the sound when it does start.
      if (this.failedToStart) void resumed
      else if (!(await Promise.race([resumed, delay(START_WAIT_MS)]))) this.failedToStart = true
    }
    await this.changed()
  }

  /** How loud the sound being played is, as the root mean square of the last moment, or null when the graph is not running. */
  level(): number | null {
    if (!this.analyser) return null
    const samples = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(samples)
    let sum = 0
    for (const sample of samples) sum += sample * sample
    return Math.sqrt(sum / samples.length)
  }

  dispose(): void {
    this.disposed = true
    this.outputs.clear()
    this.tap = null
    this.analyser = null
    void this.context?.close().catch(() => undefined)
    this.context = null
  }

  // ---- for the outputs ----

  /** The context and the node to connect to, once the graph is running. */
  get graph(): { context: AudioContext; destination: AudioNode } | null {
    return this.context && this.tap ? { context: this.context, destination: this.tap } : null
  }

  forget(output: MediaOutput): void {
    this.outputs.delete(output)
  }

  private async changed(): Promise<void> {
    const context = this.context
    if (!context || this.disposed || this.tap || context.state !== 'running') return
    if (this.clockRuns !== true) this.clockRuns = await clockMoves(context)
    if (!this.clockRuns || this.disposed || this.tap || context.state !== 'running') return
    this.failedToStart = false
    this.tap = context.createGain()
    this.analyser = context.createAnalyser()
    this.tap.connect(this.analyser)
    this.analyser.connect(context.destination)
    for (const output of this.outputs) output.apply()
    this.onMode('graph')
  }
}

/** The loudness of one element: its own volume until the graph runs, a gain node after. */
class MediaOutput implements Output {
  private gain: GainNode | null = null
  private source: MediaElementAudioSourceNode | null = null
  private level = 1

  constructor(
    private readonly stage: SoundStage,
    private readonly element: HTMLMediaElement,
  ) {}

  set(level: number): void {
    this.level = level
    this.apply()
  }

  apply(): void {
    const graph = this.stage.graph
    if (graph && !this.gain) {
      try {
        this.source = graph.context.createMediaElementSource(this.element)
        this.gain = graph.context.createGain()
        this.source.connect(this.gain)
        this.gain.connect(graph.destination)
        // The graph now sets the loudness: the element is left at full.
        this.element.volume = 1
      } catch {
        // The element cannot be connected, so it stays on its own volume.
        this.source = null
        this.gain = null
      }
    }
    if (graph && this.gain) this.gain.gain.setTargetAtTime(Math.max(0, this.level), graph.context.currentTime, GAIN_SMOOTHING_S)
    else this.element.volume = clamp01(this.level)
  }

  release(): void {
    this.stage.forget(this)
    this.source?.disconnect()
    this.gain?.disconnect()
  }
}
