/** The part of a service worker registration that is used here, so that it can be stood in for in tests. */
export interface Registration {
  readonly waiting: ServiceWorker | null
  readonly installing: ServiceWorker | null
  addEventListener(type: 'updatefound', listener: () => void): void
}

export interface Container {
  readonly controller: ServiceWorker | null
  register(script: string): Promise<Registration>
  addEventListener(type: 'controllerchange', listener: () => void): void
}

type Listener = (ready: boolean) => void

/**
 * Registers the service worker that lets the site open without a connection, and tells whoever listens when a new version
 * of the site is waiting. The new version is not taken until apply() is called, which the person asks for, so that
 * nothing changes under a tab that is being used; once it has taken over, the page is loaded again. A tab that another
 * tab took the new version for is told the same way, and loads again when its person asks, because the files it still
 * needs may be gone.
 */
export class Offline {
  private waiting: ServiceWorker | null = null
  private applying = false
  private tookOver = false
  private reloading = false
  private readonly listeners = new Set<Listener>()

  constructor(
    private readonly container: Container | undefined = globalThis.navigator?.serviceWorker as unknown as Container | undefined,
    private readonly reload: () => void = () => location.reload(),
  ) {}

  /** Whether a new version is waiting to be taken, or has been taken by another tab. */
  get updateReady(): boolean {
    return this.waiting !== null || this.tookOver
  }

  start(script = '/sw.js'): void {
    const container = this.container
    if (!container) return
    const hadController = container.controller !== null
    container.addEventListener('controllerchange', () => {
      // The first worker to take charge of a page is not a change of version.
      if (!hadController) return
      this.tookOver = true
      if (this.applying) this.loadAgain()
      else this.ready(this.waiting)
    })
    container
      .register(script)
      .then(
        (registration) => {
          // Some contexts that do not let a service worker be registered answer with nothing, and not with a refusal.
          if (!registration) return
          // A version that was already waiting when the page loaded, as when the person came back after a release.
          if (registration.waiting && container.controller) this.ready(registration.waiting)
          registration.addEventListener('updatefound', () => {
            const installing = registration.installing
            if (!installing) return
            installing.addEventListener('statechange', () => {
              // The first installation is not an update: only a worker that comes while another one is in charge is.
              if (installing.state === 'installed' && container.controller) this.ready(installing)
            })
          })
        },
        () => undefined,
      )
      // Whatever goes wrong in telling of an update, the site works without it: it is not worth an unhandled rejection.
      .catch(() => undefined)
  }

  /** Takes the waiting version, and loads the page again when it has taken over. */
  apply(): void {
    this.applying = true
    if (this.tookOver) this.loadAgain()
    else this.waiting?.postMessage({ type: 'skip-waiting' })
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private ready(worker: ServiceWorker | null): void {
    this.waiting = worker
    for (const listener of this.listeners) listener(true)
  }

  private loadAgain(): void {
    if (this.reloading) return
    this.reloading = true
    this.reload()
  }
}
