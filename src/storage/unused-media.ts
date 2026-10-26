import type { Snapshot } from '../engine'
import type { Project } from '../project/model'
import type { MediaStore, StoredFile } from './media-store'

/** A file written this recently is left alone, whatever refers to it: it may belong to something that is still being made. */
export const RECENT_MS = 10 * 60_000

const filesOfSnapshot = (snapshot: Snapshot): string[] => snapshot.mix.items.map((item) => item.file)

/**
 * Every file in the project's folder that something can still bring back: the recordings, the music and voiceovers of the
 * edit as it is, and those of every step that Undo or Redo can go to. A file not in this set is one that no state of the
 * project refers to.
 */
export function referencedFiles(project: Project): Set<string> {
  const edit = project.edit
  return new Set([
    ...project.sources.map((source) => source.file),
    ...edit.mix.items.map((item) => item.file),
    ...edit.undoStack.flatMap(filesOfSnapshot),
    ...edit.redoStack.flatMap(filesOfSnapshot),
  ])
}

/** The files that nothing refers to and that were not written a moment ago, as paths. */
export function unusedFiles(project: Project, stored: readonly StoredFile[], nowMs: number): string[] {
  const used = referencedFiles(project)
  return stored.filter((file) => !used.has(file.path) && nowMs - file.modifiedAtMs > RECENT_MS).map((file) => file.path)
}

/**
 * Takes away what no state of the project can bring back: the sound of a piece that was removed and whose Undo has fallen
 * off the end of the history, a copy that a refused or interrupted import left. Returns what it removed. It must only run
 * in the tab that has the project, so that no other tab is in the middle of adding a file to it.
 */
export async function removeUnusedMedia(media: MediaStore, project: Project, nowMs: number): Promise<string[]> {
  const unused = unusedFiles(project, await media.list(project.id), nowMs)
  const removed: string[] = []
  for (const path of unused) {
    try {
      await media.remove(project.id, path)
      removed.push(path)
    } catch {
      // A file that cannot be removed now is tried again the next time the project is opened.
    }
  }
  return removed
}
