/// <reference lib="webworker" />
// Makes an export away from the page, so that decoding, drawing, mixing and encoding do not take time from what the person
// is doing: the page stays as quick as it was. It reads the project's files from where the page keeps them, the private file
// system or the database, writes the finished video to a file in the private file system when there is one, and hands the
// page the file when it is done.
import { IdbMediaStore } from '../storage/idb-media'
import { readProjectFile } from '../storage/opfs-read'
import { failureOf, isCancelled } from './failure'
import { type FromWorker, PROGRESS_STEPS, type ToWorker } from './protocol'
import { exportProject } from './runner'

const send = (message: FromWorker): void => self.postMessage(message)

let running: AbortController | null = null

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data
  if (message.type === 'cancel') {
    running?.abort()
    return
  }
  // One export for the life of a worker: the page makes a new worker for the next.
  if (running) return
  const abort = new AbortController()
  running = abort
  send({ type: 'started' })
  let reported = -1
  const read = message.storage === 'database' ? new IdbMediaStore().read.bind(new IdbMediaStore()) : readProjectFile
  exportProject({ read }, message.project, message.settings, {
    signal: abort.signal,
    rightToLeft: message.rightToLeft,
    now: () => new Date(message.nowMs),
    onProgress: (fraction) => {
      const step = Math.floor(fraction * PROGRESS_STEPS)
      if (step === reported) return
      reported = step
      send({ type: 'progress', fraction })
    },
  }).then(
    (result) =>
      send({
        type: 'done',
        result: {
          file: result.file,
          fileName: result.fileName,
          width: result.width,
          height: result.height,
          durationMs: result.durationMs,
          frameCount: result.frameCount,
          container: result.container,
          ...(result.tempName === undefined ? {} : { tempName: result.tempName }),
        },
      }),
    (error: unknown) => send(isCancelled(error) ? { type: 'cancelled' } : { type: 'failed', failure: failureOf(error) }),
  )
}
