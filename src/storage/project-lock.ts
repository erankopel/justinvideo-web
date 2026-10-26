/** The name of the lock that says which tab of this browser has a project. */
const lockName = (id: string): string => `justinvideo-project-${id}`

/** A project's lock, held until it is released. */
export interface HeldLock {
  release(): void
}

const nothingToHold: HeldLock = { release: () => undefined }

/**
 * Takes the lock of a project, so that only one tab of this browser changes it at a time: two tabs that each keep their own
 * copy and save it would overwrite each other's changes. Resolves to null when another tab has it, or, with steal set, takes
 * it from that tab, which is then told through its onLost. A browser without Web Locks gives no protection and says it has
 * the lock.
 */
export function holdProjectLock(id: string, options: { steal?: boolean; onLost?: () => void } = {}): Promise<HeldLock | null> {
  const locks = globalThis.navigator?.locks
  if (!locks) return Promise.resolve(nothingToHold)
  return new Promise((resolve) => {
    const request = locks.request(lockName(id), options.steal ? { mode: 'exclusive', steal: true } : { mode: 'exclusive', ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null)
        return undefined
      }
      // The lock is held for as long as this promise is waiting.
      return new Promise<void>((release) => resolve({ release: () => release() }))
    })
    request.catch((error: unknown) => {
      // A lock that is taken away makes the request of the tab that had it fail with an abort.
      if (error instanceof DOMException && error.name === 'AbortError') options.onLost?.()
    })
  })
}

/** Does the work while holding the project's lock, or says 'busy' without doing it when another tab has the project. */
export async function withProjectLock<T>(id: string, work: () => Promise<T>): Promise<T | 'busy'> {
  const held = await holdProjectLock(id)
  if (!held) return 'busy'
  try {
    return await work()
  } finally {
    held.release()
  }
}
