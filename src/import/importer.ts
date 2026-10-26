import { applyProjectEdit, MAX_SOURCES, newProjectId, newSourceId, type Project, projectWithSource, type Source, startingProject } from '../project/model'
import { projectNameFor } from '../project/name'
import { hasRoomFor, type MediaStore, StorageFullError } from '../storage/media-store'
import type { ProjectStore } from '../storage/project-store'
import { ImportError, type ImportFailure } from './failure'
import { extensionFor, newMediaPath } from './paths'
import { makeThumbnail, probeVideo, type VideoProbe } from './probe'

export interface ImportDeps {
  readonly projects: ProjectStore
  readonly media: MediaStore
  readonly now: () => number
  readonly probe?: (file: File) => Promise<VideoProbe>
  readonly hasRoom?: (bytes: number) => Promise<boolean>
  readonly thumbnail?: (file: File, durationMs: number) => Promise<Blob | null>
}

export interface ImportProgress {
  readonly fileIndex: number
  readonly fileCount: number
  readonly name: string
  readonly done: number
  readonly total: number
}

export interface ImportOutcome {
  /** The project that holds what was imported, or null when nothing could be. */
  readonly project: Project | null
  readonly imported: number
  readonly failures: readonly { readonly name: string; readonly failure: ImportFailure }[]
}

/** Copies the videos into the browser's storage and puts them on the timeline, in the order given. */
export async function importVideos(
  deps: ImportDeps,
  files: readonly File[],
  options: { into?: Project; fallbackName: string; onProgress?: (progress: ImportProgress) => void },
): Promise<ImportOutcome> {
  return withImportLock(async () => {
    const probe = deps.probe ?? probeVideo
    const hasRoom = deps.hasRoom ?? hasRoomFor
    const thumbnail = deps.thumbnail ?? makeThumbnail
    const failures: { name: string; failure: ImportFailure }[] = []
    let project: Project | null = options.into ?? null
    let imported = 0

    for (const [fileIndex, file] of files.entries()) {
      const progress = (done: number, total: number): void =>
        options.onProgress?.({ fileIndex, fileCount: files.length, name: file.name, done, total })
      const startsProject = project === null
      const projectId = project?.id ?? newProjectId()
      let copiedTo: string | null = null
      try {
        const facts = await probe(file)
        if (!startsProject && (project?.sources.length ?? 0) >= MAX_SOURCES) throw new ImportError('TooManyRecordings')
        if (!(await hasRoom(file.size))) throw new ImportError('NoSpace')

        copiedTo = newMediaPath(extensionFor(file))
        try {
          await deps.media.write(projectId, copiedTo, file, progress)
        } catch (error) {
          throw new ImportError(error instanceof StorageFullError ? 'NoSpace' : 'Unreadable', { cause: error })
        }
        const source: Source = {
          id: newSourceId(),
          file: copiedTo,
          displayName: facts.displayName,
          durationMs: facts.durationMs,
          width: facts.width,
          height: facts.height,
          rotationDegrees: facts.rotationDegrees,
          hasAudio: facts.hasAudio,
        }

        const nowMs = deps.now()
        let next: Project
        if (project === null) {
          const started = startingProject(projectId, projectNameFor(facts.displayName, options.fallbackName), source, nowMs)
          if (started === null) throw new ImportError('Unusable')
          next = started
        } else {
          const withSource = projectWithSource(project, source)
          const step = applyProjectEdit(
            withSource,
            { type: 'insertSource', sourceId: source.id, sourceStartMs: 0, sourceEndMs: source.durationMs, atMs: withSource.edit.timeline.durationMs },
            nowMs,
          )
          if (step.result.kind !== 'changed') throw new ImportError('ProjectFull')
          next = step.project
        }
        try {
          await deps.projects.save(next)
        } catch (error) {
          throw new ImportError('NoSpace', { cause: error })
        }
        project = next
        imported++
        if (startsProject) {
          const image = await thumbnail(file, facts.durationMs).catch(() => null)
          if (image) await deps.projects.saveThumbnail(next.id, image).catch(() => undefined)
        }
      } catch (error) {
        // Leave nothing behind: a folder with no project is an interrupted import.
        if (copiedTo !== null) {
          if (startsProject) await deps.media.removeProject(projectId).catch(() => undefined)
          else await deps.media.remove(projectId, copiedTo).catch(() => undefined)
        }
        failures.push({ name: file.name, failure: error instanceof ImportError ? error.failure : 'Unreadable' })
      }
    }
    return { project, imported, failures }
  })
}

const IMPORT_LOCK = 'justinvideo-import'

/** Imports hold a shared lock, so that clearing leftovers (which takes it exclusively) never runs during one. */
function withImportLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks
  return locks ? (locks.request(IMPORT_LOCK, { mode: 'shared' }, work) as Promise<T>) : work()
}

/**
 * Removes the folders of imports that were interrupted before their project was saved, such as a tab closed in the
 * middle of a copy. Skipped while any tab is importing.
 */
export async function clearInterruptedImports(projects: ProjectStore, media: MediaStore): Promise<number> {
  const clear = async (): Promise<number> => {
    const known = new Set(await projects.ids())
    const strays = (await media.projectIds()).filter((id) => !known.has(id))
    for (const id of strays) await media.removeProject(id)
    return strays.length
  }
  const locks = globalThis.navigator?.locks
  if (!locks) return clear()
  const result = await locks.request(IMPORT_LOCK, { mode: 'exclusive', ifAvailable: true }, (lock) => (lock ? clear() : 0))
  return result ?? 0
}
