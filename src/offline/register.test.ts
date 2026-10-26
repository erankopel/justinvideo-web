import { describe, expect, it, vi } from 'vitest'
import { type Container, Offline, type Registration } from './register'

type Listener = () => void

/** A service worker that can be told to change state, and records what it was sent. */
class FakeWorker {
  state = 'installing'
  sent: unknown[] = []
  private readonly listeners: Listener[] = []
  postMessage(message: unknown): void {
    this.sent.push(message)
  }
  addEventListener(_type: string, listener: Listener): void {
    this.listeners.push(listener)
  }
  become(state: string): void {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }
}

class FakeRegistration {
  waiting: FakeWorker | null = null
  installing: FakeWorker | null = null
  private readonly listeners: Listener[] = []
  addEventListener(_type: string, listener: Listener): void {
    this.listeners.push(listener)
  }
  found(worker: FakeWorker): void {
    this.installing = worker
    this.listeners.forEach((listener) => listener())
  }
}

class FakeContainer {
  controller: object | null
  registered: string[] = []
  private readonly changed: Listener[] = []
  constructor(readonly registration: FakeRegistration, controlled: boolean) {
    this.controller = controlled ? {} : null
  }
  register(script: string): Promise<Registration> {
    this.registered.push(script)
    return Promise.resolve(this.registration as unknown as Registration)
  }
  addEventListener(_type: string, listener: Listener): void {
    this.changed.push(listener)
  }
  takeOver(): void {
    this.changed.forEach((listener) => listener())
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function make(controlled: boolean) {
  const registration = new FakeRegistration()
  const container = new FakeContainer(registration, controlled)
  const reload = vi.fn()
  const offline = new Offline(container as unknown as Container, reload)
  const heard: boolean[] = []
  offline.subscribe((ready) => heard.push(ready))
  return { registration, container, reload, offline, heard }
}

describe('Offline', () => {
  it('registers the worker, and does nothing where there is no service worker', async () => {
    const { container, offline } = make(false)
    offline.start()
    await settle()
    expect(container.registered).toEqual(['/sw.js'])
    expect(() => new Offline(undefined).start()).not.toThrow()
  })

  it('copes with a registration that answers with nothing, and with one that breaks, as a site that cannot have a worker is not troubled by it', async () => {
    const nothing = new FakeContainer(new FakeRegistration(), false)
    nothing.register = () => Promise.resolve(undefined as unknown as Registration)
    const first = new Offline(nothing as unknown as Container, vi.fn())
    expect(() => first.start()).not.toThrow()
    const breaking = new FakeContainer(new FakeRegistration(), true)
    breaking.register = () =>
      Promise.resolve({
        get waiting(): ServiceWorker | null {
          throw new Error('The registration is not what it was said to be')
        },
        installing: null,
        addEventListener: () => undefined,
      } as Registration)
    const second = new Offline(breaking as unknown as Container, vi.fn())
    expect(() => second.start()).not.toThrow()
    // A rejection that nothing handles fails the run, so settling is the check.
    await settle()
    await settle()
    expect(first.updateReady).toBe(false)
    expect(second.updateReady).toBe(false)
  })

  it('does not call the first installation an update', async () => {
    const { registration, offline, heard } = make(false)
    offline.start()
    await settle()
    const worker = new FakeWorker()
    registration.found(worker)
    worker.become('installed')
    expect(heard).toEqual([])
    expect(offline.updateReady).toBe(false)
  })

  it('says when a new version has installed while another is in charge', async () => {
    const { registration, offline, heard } = make(true)
    offline.start()
    await settle()
    const worker = new FakeWorker()
    registration.found(worker)
    worker.become('installing')
    expect(heard).toEqual([])
    worker.become('installed')
    expect(heard).toEqual([true])
    expect(offline.updateReady).toBe(true)
  })

  it('finds a version that was already waiting when the page opened', async () => {
    const { registration, offline, heard } = make(true)
    registration.waiting = new FakeWorker()
    offline.start()
    await settle()
    expect(heard).toEqual([true])
  })

  it('takes the new version only when asked, and then loads the page again, once', async () => {
    const { registration, container, reload, offline } = make(true)
    offline.start()
    await settle()
    const worker = new FakeWorker()
    registration.found(worker)
    worker.become('installed')
    expect(worker.sent).toEqual([])
    offline.apply()
    expect(worker.sent).toEqual([{ type: 'skip-waiting' }])
    expect(reload).not.toHaveBeenCalled()
    container.takeOver()
    container.takeOver()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('tells a tab that another tab took the new version for, and loads it again only when its person asks', async () => {
    const { registration, container, reload, offline, heard } = make(true)
    offline.start()
    await settle()
    const worker = new FakeWorker()
    registration.found(worker)
    worker.become('installed')
    container.takeOver()
    expect(reload).not.toHaveBeenCalled()
    expect(heard).toEqual([true, true])
    offline.apply()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(worker.sent).toEqual([])
  })

  it('does not reload for the worker that takes charge of a page for the first time', async () => {
    const { container, reload, offline } = make(false)
    offline.start()
    await settle()
    container.takeOver()
    expect(reload).not.toHaveBeenCalled()
  })
})
