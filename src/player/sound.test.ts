import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoundStage } from './sound'

class FakeNode {
  connected: unknown[] = []
  connect(node: unknown): unknown {
    this.connected.push(node)
    return node
  }
  disconnect(): void {
    this.connected = []
  }
}

class FakeGain extends FakeNode {
  readonly gain = { targets: [] as number[], setTargetAtTime: (level: number) => void this.gain.targets.push(level) }
}

class FakeAnalyser extends FakeNode {
  fftSize = 8
  constant = 0.5
  getFloatTimeDomainData(into: Float32Array): void {
    into.fill(this.constant)
  }
}

/** A context that starts suspended and runs once started, or never does. */
class FakeContext {
  state: 'suspended' | 'running' | 'closed'
  /** Whether the clock moves while the context runs: not so for a browser with no sound device that says it runs all the same. */
  clockMoves = true
  private time = 0
  get currentTime(): number {
    if (this.state === 'running' && this.clockMoves) this.time += 0.01
    return this.time
  }
  readonly destination = new FakeNode()
  readonly gains: FakeGain[] = []
  readonly analysers: FakeAnalyser[] = []
  readonly routed: unknown[] = []
  private listeners: (() => void)[] = []
  failRouting = false
  resumeCalls = 0

  constructor(
    initial: 'suspended' | 'running',
    private readonly startsOnResume: boolean,
  ) {
    this.state = initial
  }

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener)
  }
  createGain(): FakeGain {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }
  createAnalyser(): FakeAnalyser {
    const analyser = new FakeAnalyser()
    this.analysers.push(analyser)
    return analyser
  }
  createMediaElementSource(element: unknown): FakeNode {
    if (this.failRouting) throw new Error('already connected')
    this.routed.push(element)
    return new FakeNode()
  }
  resume(): Promise<void> {
    this.resumeCalls++
    if (!this.startsOnResume) return new Promise(() => undefined)
    this.state = 'running'
    this.listeners.forEach((listener) => listener())
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.state = 'closed'
    return Promise.resolve()
  }
}

const element = (): HTMLMediaElement => ({ volume: 1 }) as unknown as HTMLMediaElement
const asContext = (context: FakeContext): (() => AudioContext) => () => context as unknown as AudioContext

describe('SoundStage', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('plays at the elements own volume, never above full, until the graph runs', () => {
    const stage = new SoundStage(asContext(new FakeContext('suspended', true)))
    const video = element()
    const output = stage.output(video)
    output.set(0.5)
    expect(video.volume).toBe(0.5)
    output.set(2)
    expect(video.volume).toBe(1)
    output.set(-1)
    expect(video.volume).toBe(0)
    expect(stage.mode).toBe('elements')
    expect(stage.level()).toBeNull()
  })

  it('moves every element into the graph when it runs, and then sets the level there, above full too', async () => {
    const context = new FakeContext('suspended', true)
    const onMode = vi.fn()
    const stage = new SoundStage(asContext(context), onMode)
    const video = element()
    const output = stage.output(video)
    output.set(0.25)
    await stage.wake()
    expect(stage.mode).toBe('graph')
    expect(onMode).toHaveBeenCalledWith('graph')
    expect(context.routed).toEqual([video])
    expect(video.volume).toBe(1)
    const gain = context.gains.at(-1)
    expect(gain?.gain.targets.at(-1)).toBe(0.25)
    output.set(1.5)
    expect(gain?.gain.targets.at(-1)).toBe(1.5)
    expect(video.volume).toBe(1)
    // The same element is connected once only.
    output.set(1)
    expect(context.routed).toHaveLength(1)
  })

  it('connects an output that is made after the graph runs as soon as it has a level', async () => {
    const context = new FakeContext('running', true)
    const stage = new SoundStage(asContext(context))
    await stage.wake()
    const later = element()
    stage.output(later).set(2)
    expect(context.routed).toEqual([later])
    expect(context.gains.at(-1)?.gain.targets.at(-1)).toBe(2)
  })

  it('goes on at the elements volume when the browser does not let the graph run, and waits for it once only', async () => {
    const context = new FakeContext('suspended', false)
    const stage = new SoundStage(asContext(context))
    const video = element()
    const output = stage.output(video)
    const first = stage.wake()
    await vi.advanceTimersByTimeAsync(1_000)
    await first
    output.set(0.4)
    expect(stage.mode).toBe('elements')
    expect(video.volume).toBe(0.4)
    expect(context.routed).toEqual([])
    // The second press does not wait, and asks again.
    let done = false
    void stage.wake().then(() => (done = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
    expect(context.resumeCalls).toBe(2)
  })

  it('stays on the elements volume when the context says it runs but its clock does not move, and looks again at the next press', async () => {
    const context = new FakeContext('running', true)
    context.clockMoves = false
    const stage = new SoundStage(asContext(context))
    const video = element()
    const output = stage.output(video)
    const first = stage.wake()
    await vi.advanceTimersByTimeAsync(1_000)
    await first
    output.set(0.4)
    expect(stage.mode).toBe('elements')
    expect(video.volume).toBe(0.4)
    expect(context.routed).toEqual([])
    // The device came back: the clock moves, and the next press brings the sound into the graph.
    context.clockMoves = true
    await stage.wake()
    expect(stage.mode).toBe('graph')
    expect(context.routed).toEqual([video])
  })

  it('keeps an element on its own volume when it cannot be connected', async () => {
    const context = new FakeContext('running', true)
    context.failRouting = true
    const stage = new SoundStage(asContext(context))
    await stage.wake()
    const video = element()
    stage.output(video).set(0.6)
    expect(video.volume).toBe(0.6)
  })

  it('measures the level of what is heard', async () => {
    const context = new FakeContext('running', true)
    const stage = new SoundStage(asContext(context))
    await stage.wake()
    expect(stage.level()).toBeCloseTo(0.5)
  })

  it('survives a browser that has no Web Audio', async () => {
    const stage = new SoundStage(() => {
      throw new Error('not supported')
    })
    const video = element()
    stage.output(video).set(0.7)
    await stage.wake()
    expect(video.volume).toBe(0.7)
    expect(stage.mode).toBe('elements')
  })

  it('lets go of the context when it is disposed', async () => {
    const context = new FakeContext('running', true)
    const stage = new SoundStage(asContext(context))
    await stage.wake()
    stage.dispose()
    expect(context.state).toBe('closed')
    expect(stage.level()).toBeNull()
  })
})
