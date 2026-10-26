import { type MediaStore, StorageFullError, type StoredFile } from './media-store'
import type { WriteReply, WriteRequest } from './media-worker'
import { folderOf, isMissing, projectsDirectory, readProjectFile } from './opfs-read'

/**
 * The site's copies of videos in the browser's origin private file system, which no other site can see and the person
 * cannot browse. Writing is done in a worker with a synchronous access handle, the one way that Chrome, Firefox and
 * Safari all allow a large file to be written without holding it in memory.
 */
export class OpfsMediaStore implements MediaStore {
  readonly kind = 'files'
  private worker: Worker | null = null
  private readonly pending = new Map<number, { resolve: () => void; reject: (error: Error) => void; progress?: (done: number, total: number) => void }>()
  private nextId = 1

  private workerInstance(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./media-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WriteReply>) => {
      const reply = event.data
      const waiting = this.pending.get(reply.id)
      if (!waiting) return
      if (reply.type === 'progress') {
        waiting.progress?.(reply.done, reply.total)
        return
      }
      this.pending.delete(reply.id)
      if (reply.type === 'done') waiting.resolve()
      else waiting.reject(reply.name === 'QuotaExceededError' ? new StorageFullError() : new Error(`${reply.name}: ${reply.message}`))
    }
    worker.onerror = (event) => {
      for (const waiting of this.pending.values()) waiting.reject(new Error(event.message || 'The copy failed'))
      this.pending.clear()
      this.worker = null
    }
    this.worker = worker
    return worker
  }

  write(projectId: string, path: string, blob: Blob, onProgress?: (done: number, total: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject, ...(onProgress ? { progress: onProgress } : {}) })
      const request: WriteRequest = { id, projectId, path, blob }
      try {
        this.workerInstance().postMessage(request)
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  read(projectId: string, path: string): Promise<File> {
    return readProjectFile(projectId, path)
  }

  async remove(projectId: string, path: string): Promise<void> {
    const parts = path.split('/')
    try {
      const project = await (await projectsDirectory(false)).getDirectoryHandle(projectId)
      const folder = await folderOf(project, parts, false)
      await folder.removeEntry(parts[parts.length - 1] ?? '')
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }

  async removeProject(projectId: string): Promise<void> {
    try {
      await (await projectsDirectory(false)).removeEntry(projectId, { recursive: true })
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }

  async list(projectId: string): Promise<StoredFile[]> {
    const found: StoredFile[] = []
    const walk = async (folder: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, handle] of folder.entries()) {
        if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`)
        else found.push({ path: prefix + name, modifiedAtMs: (await (handle as FileSystemFileHandle).getFile()).lastModified })
      }
    }
    try {
      await walk(await (await projectsDirectory(false)).getDirectoryHandle(projectId), '')
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    return found
  }

  async projectIds(): Promise<string[]> {
    let root: FileSystemDirectoryHandle
    try {
      root = await projectsDirectory(false)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const names: string[] = []
    for await (const [name, handle] of root.entries()) if (handle.kind === 'directory') names.push(name)
    return names
  }
}

/** Null when the browser lets the site store its data, or what is missing. */
export async function checkStorage(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<'database' | 'files' | null> {
  if (!factory) return 'database'
  try {
    await new Promise<void>((resolve, reject) => {
      const probe = factory.open('justinvideo-probe')
      probe.onsuccess = () => {
        probe.result.close()
        factory.deleteDatabase('justinvideo-probe')
        resolve()
      }
      probe.onerror = () => reject(probe.error)
    })
  } catch {
    return 'database'
  }
  try {
    await projectsDirectory(true)
  } catch {
    return 'files'
  }
  return null
}
