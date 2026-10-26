import { decodeProject, encodeProject, ProjectFormatError, type ProjectProblem } from '../project/codec'
import type { Project } from '../project/model'
import { PROJECTS, requestResult, THUMBNAILS, transactionDone } from './idb'

/** What is kept for one project: its file as text, and the copy from before the last save. */
export interface ProjectRecord {
  readonly id: string
  readonly json: string
  readonly previousJson: string | null
  readonly modifiedAtMs: number
}

/** One project in the list: either readable, or damaged with the reason. */
export type ProjectEntry =
  | { readonly kind: 'readable'; readonly project: Project }
  | { readonly kind: 'unreadable'; readonly id: string; readonly problem: ProjectProblem }

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`There is no project ${id}`)
  }
}

interface Attempt {
  readonly project: Project | null
  readonly failure: ProjectFormatError | null
}

function attempt(json: string | null): Attempt {
  if (json === null) return { project: null, failure: new ProjectFormatError('Corrupt', 'There is no copy') }
  try {
    return { project: decodeProject(json), failure: null }
  } catch (error) {
    if (error instanceof ProjectFormatError) return { project: null, failure: error }
    throw error
  }
}

/**
 * Projects in the browser's database, one record each: the project file as text and the previous good copy. A save
 * replaces both in one transaction, so a crash or a full disk cannot leave a half-written project, and a damaged file
 * falls back to the copy before it, as on Android. The videos themselves are in the media store.
 */
export class ProjectStore {
  /** The text of the last good file of each project this page has read or written. */
  private readonly lastGood = new Map<string, string>()

  constructor(private readonly db: IDBDatabase) {}

  async list(): Promise<ProjectEntry[]> {
    const records = await requestResult<ProjectRecord[]>(this.db.transaction(PROJECTS).objectStore(PROJECTS).getAll())
    const entries = records.map((record): ProjectEntry => {
      const result = resolveRecord(record)
      return result.project
        ? { kind: 'readable', project: result.project }
        : { kind: 'unreadable', id: record.id, problem: result.failure?.problem ?? 'Corrupt' }
    })
    const time = (entry: ProjectEntry): number => (entry.kind === 'readable' ? entry.project.modifiedAtMs : Number.NEGATIVE_INFINITY)
    const idOf = (entry: ProjectEntry): string => (entry.kind === 'readable' ? entry.project.id : entry.id)
    return entries.sort((a, b) => time(b) - time(a) || idOf(a).localeCompare(idOf(b)))
  }

  /** Reads a project, using the copy before the last save if the current file is damaged. */
  async load(id: string): Promise<Project> {
    const record = await requestResult<ProjectRecord | undefined>(this.db.transaction(PROJECTS).objectStore(PROJECTS).get(id))
    if (record === undefined) throw new ProjectNotFoundError(id)
    const result = resolveRecord(record)
    if (result.project) {
      // What was read is the last good file, which the next save keeps as the copy before it, without having to read it again.
      this.lastGood.set(id, encodeProject(result.project))
      return result.project
    }
    throw result.failure ?? new ProjectFormatError('Corrupt', 'The project file is not valid')
  }

  /**
   * Writes the project and keeps the file it replaces as the copy before it. The last good file is remembered, so a save
   * is one write that starts at once: an edit followed straight away by a reload or a closed tab is not lost for the time
   * it takes to read the old file first.
   */
  async save(project: Project): Promise<void> {
    const json = encodeProject(project)
    const transaction = this.db.transaction(PROJECTS, 'readwrite')
    const store = transaction.objectStore(PROJECTS)
    const done = transactionDone(transaction)
    const write = (previousJson: string | null): void => {
      const record: ProjectRecord = { id: project.id, json, previousJson, modifiedAtMs: project.modifiedAtMs }
      store.put(record)
    }
    const remembered = this.lastGood.get(project.id)
    if (remembered !== undefined) {
      write(remembered)
    } else {
      const existing = store.get(project.id)
      existing.onsuccess = () => {
        const before = existing.result as ProjectRecord | undefined
        // The copy kept is the last one that reads: a damaged current file must not push out the good one before it.
        write(before === undefined ? null : attempt(before.json).project ? before.json : before.previousJson)
      }
    }
    await done
    this.lastGood.set(project.id, json)
  }

  async delete(id: string): Promise<void> {
    const transaction = this.db.transaction([PROJECTS, THUMBNAILS], 'readwrite')
    transaction.objectStore(PROJECTS).delete(id)
    transaction.objectStore(THUMBNAILS).delete(id)
    await transactionDone(transaction)
    this.lastGood.delete(id)
  }

  async ids(): Promise<string[]> {
    const keys = await requestResult(this.db.transaction(PROJECTS).objectStore(PROJECTS).getAllKeys())
    return keys.map(String)
  }

  /**
   * Keeps the picture as its bytes, which every browser keeps in its database, where a Blob is not kept by all of them
   * (a WebKit without storage for Blobs refuses it). A picture for the list is small, so nothing is lost by it.
   */
  async saveThumbnail(id: string, image: Blob): Promise<void> {
    const bytes = await image.arrayBuffer()
    const transaction = this.db.transaction(THUMBNAILS, 'readwrite')
    transaction.objectStore(THUMBNAILS).put({ id, bytes, type: image.type })
    await transactionDone(transaction)
  }

  async thumbnail(id: string): Promise<Blob | null> {
    const row = await requestResult<{ bytes?: ArrayBuffer; type?: string; image?: Blob } | undefined>(this.db.transaction(THUMBNAILS).objectStore(THUMBNAILS).get(id))
    if (row?.bytes) return new Blob([row.bytes], { type: row.type ?? '' })
    // A picture that an earlier version kept as a Blob.
    return row?.image ?? null
  }
}

function resolveRecord(record: ProjectRecord): Attempt {
  const first = attempt(record.json)
  if (first.project) return first
  // A newer version's file is not damaged, so the older copy must not stand in for it.
  if (first.failure?.problem === 'NewerFormat') return first
  const second = attempt(record.previousJson)
  return second.project ? second : first
}
