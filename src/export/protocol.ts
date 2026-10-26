import type { Project } from '../project/model'
import type { MediaStoreKind } from '../storage/media-store'
import type { ExportFailure } from './failure'
import type { ExportSettings } from './settings'

// What the page and the export worker say to each other. Everything in a message is plain data, which is copied, and a
// finished file, which is handed over without being copied.

/** The page tells the worker to make an export, or to stop the one it is making. */
export type ToWorker =
  | {
      readonly type: 'start'
      /** The project as it was when the export began: the edit can go on meanwhile. */
      readonly project: Project
      readonly settings: ExportSettings
      readonly rightToLeft: boolean
      /** Where the project's files are, so that the worker reads them from the same place as the page. */
      readonly storage: Exclude<MediaStoreKind, 'memory'>
      /** The time the file name is made from. */
      readonly nowMs: number
    }
  | { readonly type: 'cancel' }

/** A finished export, as the worker hands it over. */
export interface Finished {
  readonly file: File
  readonly fileName: string
  readonly width: number
  readonly height: number
  readonly durationMs: number
  readonly frameCount: number
  readonly container: 'mp4' | 'webm'
  /** Where the file is kept in the private file system, to be taken away when it is not wanted; absent when it is held in memory. */
  readonly tempName?: string
}

export type FromWorker =
  /** The worker got the job and has begun. A worker that cannot even do that is told from one that failed. */
  | { readonly type: 'started' }
  /** From 0 to 1, how much is done. */
  | { readonly type: 'progress'; readonly fraction: number }
  | { readonly type: 'done'; readonly result: Finished }
  | { readonly type: 'failed'; readonly failure: ExportFailure }
  /** The export stopped because it was asked to. Nothing is kept. */
  | { readonly type: 'cancelled' }

/** How many steps the progress is told in: a message for each tenth of a percent at most, not one for each frame. */
export const PROGRESS_STEPS = 1000
