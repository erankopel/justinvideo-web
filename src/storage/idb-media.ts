import { requestResult, transactionDone } from './idb'
import { type MediaStore, StorageFullError, type StoredFile } from './media-store'

const DATABASE = 'justinvideo-media'
const VERSION = 1
const FILES = 'files'
const PIECES = 'pieces'
const BY_PROJECT = 'byProject'

/** How much of a file is kept in one piece when the browser cannot keep it whole. */
const PIECE_BYTES = 4 * 1024 * 1024

/** A file in a project's folder: where it belongs, and the file itself, whole or as a number of pieces. */
interface StoredRecord {
  /** The project's id and the path, which is unique. */
  readonly key: string
  readonly projectId: string
  readonly path: string
  readonly modifiedAtMs: number
  readonly type: string
  /** The file, kept whole as a Blob, which the browser holds on disk. Absent when it is kept in pieces. */
  readonly blob?: Blob
  /** How many pieces the file is kept in, when it is not kept whole. */
  readonly pieces?: number
}

interface Piece {
  readonly key: string
  readonly index: number
  readonly data: ArrayBuffer
}

function openMediaDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DATABASE, VERSION)
    open.onupgradeneeded = () => {
      const files = open.result.createObjectStore(FILES, { keyPath: 'key' })
      files.createIndex(BY_PROJECT, 'projectId')
      open.result.createObjectStore(PIECES, { keyPath: ['key', 'index'] })
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error ?? new Error('The database for the files could not be opened'))
    open.onblocked = () => reject(new Error('The database for the files is blocked by another tab'))
  })
}

const isQuota = (error: unknown): boolean => (error instanceof DOMException || error instanceof Error) && error.name === 'QuotaExceededError'

export interface IdbMediaOptions {
  /** Whether to try keeping a file whole as a Blob. False keeps every file in pieces, which is also what is done once a Blob has been refused. */
  readonly keepBlobs?: boolean
  readonly pieceBytes?: number
}

/**
 * The site's copies of videos and sound in the browser's database, for a browser that has no private file system to put
 * them in, as a Firefox private window has not. A file is kept as a Blob in a database of its own, which the browser holds
 * on disk, so a large video is not held in memory. A browser that will not keep a Blob there is given the file in pieces
 * instead, which has to be put together in memory to be read. It also works in a worker, which the export relies on.
 */
export class IdbMediaStore implements MediaStore {
  readonly kind = 'database'
  private opened: Promise<IDBDatabase> | null = null
  private keepBlobs: boolean
  private readonly pieceBytes: number

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    options: IdbMediaOptions = {},
  ) {
    this.keepBlobs = options.keepBlobs ?? true
    this.pieceBytes = options.pieceBytes ?? PIECE_BYTES
  }

  private database(): Promise<IDBDatabase> {
    this.opened ??= openMediaDatabase(this.factory).catch((error: unknown) => {
      this.opened = null
      throw error
    })
    return this.opened
  }

  async write(projectId: string, path: string, blob: Blob, onProgress?: (done: number, total: number) => void): Promise<void> {
    const key = `${projectId}/${path}`
    const database = await this.database()
    await this.remove(projectId, path)
    const record = { key, projectId, path, modifiedAtMs: Date.now(), type: blob.type }
    try {
      if (this.keepBlobs) {
        try {
          await this.storeWhole(database, record, blob)
          onProgress?.(blob.size, blob.size)
          return
        } catch (error) {
          if (isQuota(error)) throw error
          // This browser does not keep a Blob in its database: the file is kept in pieces, here and from now on.
          this.keepBlobs = false
        }
      }
      await this.writeInPieces(database, record, blob, onProgress)
    } catch (error) {
      await this.remove(projectId, path).catch(() => undefined)
      throw isQuota(error) ? new StorageFullError() : error
    }
  }

  /** Keeps the file whole, as a Blob. */
  protected async storeWhole(database: IDBDatabase, record: Omit<StoredRecord, 'blob' | 'pieces'>, blob: Blob): Promise<void> {
    const transaction = database.transaction(FILES, 'readwrite')
    transaction.objectStore(FILES).put({ ...record, blob } satisfies StoredRecord)
    await transactionDone(transaction)
  }

  private async writeInPieces(database: IDBDatabase, record: Omit<StoredRecord, 'blob' | 'pieces'>, blob: Blob, onProgress?: (done: number, total: number) => void): Promise<void> {
    const count = Math.max(1, Math.ceil(blob.size / this.pieceBytes))
    let begun = 0
    try {
      for (let index = 0; index < count; index++) {
        begun = index + 1
        const data = await blob.slice(index * this.pieceBytes, (index + 1) * this.pieceBytes).arrayBuffer()
        const transaction = database.transaction(PIECES, 'readwrite')
        transaction.objectStore(PIECES).put({ key: record.key, index, data } satisfies Piece)
        await transactionDone(transaction)
        onProgress?.(Math.min((index + 1) * this.pieceBytes, blob.size), blob.size)
      }
      // The record is written last, so that a file is not there until all of it is.
      const transaction = database.transaction(FILES, 'readwrite')
      transaction.objectStore(FILES).put({ ...record, pieces: count } satisfies StoredRecord)
      await transactionDone(transaction)
    } catch (error) {
      // No record points to the pieces that were written, so nothing else would take them away.
      const transaction = database.transaction(PIECES, 'readwrite')
      for (let index = 0; index < begun; index++) transaction.objectStore(PIECES).delete([record.key, index])
      await transactionDone(transaction).catch(() => undefined)
      throw error
    }
  }

  async read(projectId: string, path: string): Promise<File> {
    const database = await this.database()
    const record = (await requestResult(database.transaction(FILES).objectStore(FILES).get(`${projectId}/${path}`))) as StoredRecord | undefined
    if (!record) throw new DOMException('No such file', 'NotFoundError')
    const name = path.split('/').pop() ?? path
    const options = { type: record.type, lastModified: record.modifiedAtMs }
    if (record.blob) return new File([record.blob], name, options)
    const store = database.transaction(PIECES).objectStore(PIECES)
    const parts = await Promise.all(Array.from({ length: record.pieces ?? 0 }, (_, index) => requestResult(store.get([record.key, index]) as IDBRequest<Piece>)))
    return new File(
      parts.map((part) => part.data),
      name,
      options,
    )
  }

  async remove(projectId: string, path: string): Promise<void> {
    const database = await this.database()
    await this.removeKeys(database, [`${projectId}/${path}`])
  }

  /** Takes the files with these keys away, with their pieces. */
  private async removeKeys(database: IDBDatabase, keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return
    const transaction = database.transaction([FILES, PIECES], 'readwrite')
    const files = transaction.objectStore(FILES)
    const pieces = transaction.objectStore(PIECES)
    for (const key of keys) {
      const record = (await requestResult(files.get(key))) as StoredRecord | undefined
      for (let index = 0; index < (record?.pieces ?? 0); index++) pieces.delete([key, index])
      files.delete(key)
    }
    await transactionDone(transaction)
  }

  async removeProject(projectId: string): Promise<void> {
    const database = await this.database()
    const keys = await requestResult(database.transaction(FILES).objectStore(FILES).index(BY_PROJECT).getAllKeys(projectId))
    await this.removeKeys(database, keys.map(String))
  }

  async projectIds(): Promise<string[]> {
    const database = await this.database()
    const ids: string[] = []
    await new Promise<void>((resolve, reject) => {
      const cursor = database.transaction(FILES).objectStore(FILES).index(BY_PROJECT).openKeyCursor(null, 'nextunique')
      cursor.onsuccess = () => {
        const at = cursor.result
        if (!at) return resolve()
        ids.push(String(at.key))
        at.continue()
      }
      cursor.onerror = () => reject(cursor.error ?? new Error('The files could not be listed'))
    })
    return ids
  }

  async list(projectId: string): Promise<StoredFile[]> {
    const database = await this.database()
    const records = (await requestResult(database.transaction(FILES).objectStore(FILES).index(BY_PROJECT).getAll(projectId))) as StoredRecord[]
    return records.map((record) => ({ path: record.path, modifiedAtMs: record.modifiedAtMs }))
  }
}
