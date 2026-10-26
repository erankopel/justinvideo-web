/** The browser has no room left for what was being written. */
export class StorageFullError extends Error {
  constructor() {
    super('There is not enough storage')
  }
}

/** Where the copies are kept: the private file system, the database (where the browser has no private file system), or memory (tests). */
export type MediaStoreKind = 'files' | 'database' | 'memory'

/** The browser does not offer the storage the site needs, for instance in a private window. */
export class StorageUnavailableError extends Error {
  constructor(readonly reason: 'database' | 'files') {
    super(`Storage is not available: ${reason}`)
  }
}

/** A file in a project's folder, and when it was last written, in milliseconds. */
export interface StoredFile {
  readonly path: string
  readonly modifiedAtMs: number
}

/**
 * The site's own copies of videos and sound, under each project's folder. A path is relative to the project, such as
 * media/s1.mp4, and has been checked by the project file's rules (no dots, no leading slash).
 */
export interface MediaStore {
  readonly kind: MediaStoreKind
  /** Copies blob to the path, reporting how many bytes are done. Removes what it wrote if it fails. */
  write(projectId: string, path: string, blob: Blob, onProgress?: (done: number, total: number) => void): Promise<void>
  read(projectId: string, path: string): Promise<File>
  remove(projectId: string, path: string): Promise<void>
  removeProject(projectId: string): Promise<void>
  /** The projects that have a folder, so one left behind by an interrupted import can be cleared. */
  projectIds(): Promise<string[]>
  /** The files in a project's folder, at every depth. A project with no folder has none. */
  list(projectId: string): Promise<StoredFile[]>
}

/** Room for a copy of a file, counting a margin for the rest, when the browser says how much it has. */
export async function hasRoomFor(bytes: number, margin = 32 * 1024 * 1024): Promise<boolean> {
  try {
    const { usage, quota } = (await navigator.storage?.estimate?.()) ?? {}
    if (usage === undefined || quota === undefined) return true
    return quota - usage >= bytes + margin
  } catch {
    return true
  }
}

const PERSISTENCE_ASKED = 'justinvideo-persistence-asked'

/**
 * Asks the browser to keep the site's data when space runs short, which it may refuse. Chrome decides by itself, and
 * Firefox shows the person a prompt that stays open until it is answered, so the answer is never waited for, and the
 * question is asked once only.
 */
export function requestPersistence(): void {
  try {
    if (!navigator.storage?.persist || localStorage.getItem(PERSISTENCE_ASKED)) return
    localStorage.setItem(PERSISTENCE_ASKED, '1')
    void navigator.storage.persist().catch(() => undefined)
  } catch {
    // The browser decides; the site works either way.
  }
}

/** A store that keeps files in memory, for tests. */
export class MemoryMediaStore implements MediaStore {
  readonly kind = 'memory'
  readonly files = new Map<string, Blob>()
  /** When each file was written, for the tests to set. A file with no entry was written at 0. */
  readonly modified = new Map<string, number>()

  private key(projectId: string, path: string): string {
    return `${projectId}/${path}`
  }

  async write(projectId: string, path: string, blob: Blob, onProgress?: (done: number, total: number) => void): Promise<void> {
    this.files.set(this.key(projectId, path), blob)
    onProgress?.(blob.size, blob.size)
  }

  async read(projectId: string, path: string): Promise<File> {
    const blob = this.files.get(this.key(projectId, path))
    if (!blob) throw new Error('No such file')
    return new File([blob], path.split('/').pop() ?? path, { type: blob.type })
  }

  async remove(projectId: string, path: string): Promise<void> {
    this.files.delete(this.key(projectId, path))
  }

  async removeProject(projectId: string): Promise<void> {
    for (const key of [...this.files.keys()]) if (key.startsWith(`${projectId}/`)) this.files.delete(key)
  }

  async projectIds(): Promise<string[]> {
    return [...new Set([...this.files.keys()].map((key) => key.split('/')[0] ?? ''))]
  }

  async list(projectId: string): Promise<StoredFile[]> {
    return [...this.files.keys()]
      .filter((key) => key.startsWith(`${projectId}/`))
      .map((key) => ({ path: key.slice(projectId.length + 1), modifiedAtMs: this.modified.get(key) ?? 0 }))
  }
}
