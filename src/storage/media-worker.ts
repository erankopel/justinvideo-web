/// <reference lib="webworker" />
// Copies a file into the origin private file system. It runs in a worker because only there may a file be written
// through a synchronous access handle, which works in every browser the site supports and keeps memory use flat.

export interface WriteRequest {
  readonly id: number
  readonly projectId: string
  readonly path: string
  readonly blob: Blob
}

export type WriteReply =
  | { readonly type: 'progress'; readonly id: number; readonly done: number; readonly total: number }
  | { readonly type: 'done'; readonly id: number }
  | { readonly type: 'error'; readonly id: number; readonly name: string; readonly message: string }

const PROGRESS_EVERY_BYTES = 4 * 1024 * 1024

async function write({ id, projectId, path, blob }: WriteRequest): Promise<void> {
  const parts = path.split('/')
  const fileName = parts[parts.length - 1] ?? ''
  let folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('projects', { create: true })
  folder = await folder.getDirectoryHandle(projectId, { create: true })
  for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create: true })
  const file = await folder.getFileHandle(fileName, { create: true })
  const handle = await file.createSyncAccessHandle()
  try {
    handle.truncate(0)
    const reader = blob.stream().getReader()
    let written = 0
    let reported = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      handle.write(value, { at: written })
      written += value.byteLength
      if (written - reported >= PROGRESS_EVERY_BYTES) {
        reported = written
        const reply: WriteReply = { type: 'progress', id, done: written, total: blob.size }
        self.postMessage(reply)
      }
    }
    handle.flush()
  } catch (error) {
    handle.close()
    await folder.removeEntry(fileName).catch(() => undefined)
    throw error
  }
  handle.close()
}

self.onmessage = (event: MessageEvent<WriteRequest>) => {
  const request = event.data
  write(request).then(
    () => self.postMessage({ type: 'done', id: request.id } satisfies WriteReply),
    (error: unknown) => {
      const name = error instanceof Error ? error.name : 'Error'
      const message = error instanceof Error ? error.message : String(error)
      self.postMessage({ type: 'error', id: request.id, name, message } satisfies WriteReply)
    },
  )
}
