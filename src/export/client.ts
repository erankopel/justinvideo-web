import type { Project } from '../project/model'
import { ExportError, type ExportFailure } from './failure'
import type { FromWorker, ToWorker } from './protocol'
import type { MediaStore } from '../storage/media-store'
import { type ExportOptions, exportProject, type ExportResult } from './runner'
import { removeExportFile } from './target'
import type { ExportSettings } from './settings'

/** Where an export was made: away from the page, in a worker, or in the page itself when no worker could be used. */
export type ExportMode = 'worker' | 'main'

export interface RunOptions extends ExportOptions {
  /** Told once which of the two the export is made in. */
  readonly onMode?: (mode: ExportMode) => void
}

/** How long a cancelled export has to stop by itself before the worker is shut down. */
const CANCEL_GRACE_MS = 8_000

/** The worker could not be made or could not begin: the export has not started, and can be made in the page instead. */
class WorkerUnavailable extends Error {}

/** Failures that may be only because the worker could not do what the page can, so that one that gets nowhere is tried in the page. */
const MAYBE_THE_WORKER: readonly ExportFailure[] = ['EncoderFailed', 'DecoderFailed', 'Failed']

const canUseWorker = (): boolean => typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'

/**
 * Exports a project, in a worker when the browser has what that needs, so the page is left free; otherwise in the page
 * itself, as it always could. A worker that cannot start, or that fails before it has made any progress, is given up on
 * and the export is made in the page, so the worker only ever adds a way for it to work.
 */
export async function runExport(files: Pick<MediaStore, 'read' | 'kind'>, project: Project, settings: ExportSettings, options: RunOptions): Promise<ExportResult> {
  // A worker reads the files from the browser's storage, so it can have none that are only in memory.
  if (canUseWorker() && files.kind !== 'memory') {
    try {
      return await exportInWorker(project, settings, options, files.kind)
    } catch (error) {
      if (!(error instanceof WorkerUnavailable)) throw error
    }
  }
  if (options.signal?.aborted) throw new DOMException('The export was cancelled', 'AbortError')
  options.onMode?.('main')
  return exportProject(files, project, settings, options)
}

function exportInWorker(project: Project, settings: ExportSettings, options: RunOptions, storage: 'files' | 'database'): Promise<ExportResult> {
  const { signal } = options
  if (signal?.aborted) return Promise.reject(new DOMException('The export was cancelled', 'AbortError'))
  return new Promise<ExportResult>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./export-worker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      reject(new WorkerUnavailable('No worker', { cause: error }))
      return
    }
    let started = false
    let progressed = false
    let settled = false
    let giveUp: ReturnType<typeof setTimeout> | null = null
    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      if (giveUp) clearTimeout(giveUp)
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      settle()
    }
    const cancelled = (): DOMException => new DOMException('The export was cancelled', 'AbortError')
    function onAbort(): void {
      worker.postMessage({ type: 'cancel' } satisfies ToWorker)
      // The worker stops at its next frame; one that does not is shut down, and what it left is cleared by the next export.
      giveUp = setTimeout(() => finish(() => reject(cancelled())), CANCEL_GRACE_MS)
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data
      switch (message.type) {
        case 'started':
          started = true
          options.onMode?.('worker')
          break
        case 'progress':
          progressed = true
          options.onProgress?.(message.fraction)
          break
        case 'done': {
          const { tempName, ...rest } = message.result
          finish(() =>
            resolve({
              ...rest,
              ...(tempName === undefined ? {} : { tempName }),
              discard: () => (tempName === undefined ? Promise.resolve() : removeExportFile(tempName)),
            }),
          )
          break
        }
        case 'failed':
          finish(() => reject(!progressed && MAYBE_THE_WORKER.includes(message.failure) ? new WorkerUnavailable(message.failure) : new ExportError(message.failure)))
          break
        case 'cancelled':
          finish(() => reject(cancelled()))
          break
      }
    }
    worker.onerror = (event) => {
      event.preventDefault()
      finish(() => reject(started && progressed ? new ExportError('Failed') : new WorkerUnavailable(event.message || 'The worker failed')))
    }
    worker.onmessageerror = () => finish(() => reject(new ExportError('Failed')))
    worker.postMessage({ type: 'start', project, settings, rightToLeft: options.rightToLeft, storage, nowMs: (options.now ?? (() => new Date()))().getTime() } satisfies ToWorker)
  })
}
