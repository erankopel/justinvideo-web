import { BufferTarget, StreamTarget, type Target } from 'mediabunny'

/** Where an export is written while it is made, and how it is handed over when it is done. */
export interface ExportTarget {
  readonly target: Target
  /** How an MP4 file is laid out: its index at the start when the file is built in memory, at the end when it is written to disk as it goes. */
  readonly fastStart: false | 'in-memory'
  /** The finished file. Call after the output is finalized. */
  finish(): Promise<File>
  /** Throws what was written away, whether the export finished or not. */
  discard(): Promise<void>
  /** The name of the file in the private file system, when that is where it is kept, so it can be taken away from anywhere. */
  readonly tempName?: string
}

const FOLDER = 'exports'
/** A leftover file older than this was left by an export that was interrupted, such as a tab that was closed. */
const STALE_MS = 24 * 60 * 60 * 1000

/** Takes an export's file out of the private file system by its name, from the page or from a worker. */
export async function removeExportFile(tempName: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    const folder = await root.getDirectoryHandle(FOLDER)
    await folder.removeEntry(tempName)
  } catch {
    // It is not there: nothing is left to remove.
  }
}

/** Removes the files that interrupted exports left in the browser's private file system. */
export async function clearStaleExports(now = Date.now()): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    const folder = await root.getDirectoryHandle(FOLDER)
    for await (const [name, handle] of folder.entries()) {
      if (handle.kind !== 'file') continue
      const file = await (handle as FileSystemFileHandle).getFile()
      if (now - file.lastModified > STALE_MS) await folder.removeEntry(name).catch(() => undefined)
    }
  } catch {
    // There is no folder, or no private file system: nothing was left.
  }
}

/**
 * A place for the export's file, which is kept under tempName while it is made and handed over as fileName. It is written
 * to a file in the browser's private file system as it is made, so a long video is never held in memory; a browser that
 * cannot do that holds it in memory instead.
 */
export async function openTarget(tempName: string, fileName: string, mime: string): Promise<ExportTarget> {
  try {
    const root = await navigator.storage.getDirectory()
    const folder = await root.getDirectoryHandle(FOLDER, { create: true })
    const handle = await folder.getFileHandle(tempName, { create: true })
    const writable = await handle.createWritable()
    return {
      tempName,
      target: new StreamTarget(writable as unknown as WritableStream, { chunked: true }),
      fastStart: false,
      finish: async () => {
        const file = await handle.getFile()
        return new File([file], fileName, { type: mime })
      },
      discard: async () => {
        await writable.abort().catch(() => undefined)
        await folder.removeEntry(tempName).catch(() => undefined)
      },
    }
  } catch {
    const target = new BufferTarget()
    return {
      target,
      fastStart: 'in-memory',
      finish: async () => new File([target.buffer ?? new ArrayBuffer(0)], fileName, { type: mime }),
      discard: async () => undefined,
    }
  }
}
