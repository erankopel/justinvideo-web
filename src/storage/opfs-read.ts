import { StorageUnavailableError } from './media-store'

// Reading from the site's private file system needs nothing from the page, so it works in a worker too, which the export
// relies on. Writing stays in OpfsMediaStore.

const ROOT = 'projects'

export async function projectsDirectory(create: boolean): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) throw new StorageUnavailableError('files')
  try {
    return await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') throw new StorageUnavailableError('files')
    throw error
  }
}

export const isMissing = (error: unknown): boolean => error instanceof DOMException && error.name === 'NotFoundError'

/** Opens the folders of a path, one level at a time. The last part is the file name and is not opened. */
export async function folderOf(project: FileSystemDirectoryHandle, parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let folder = project
  for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create })
  return folder
}

/** A file of a project, from a path relative to its folder, such as media/s1.mp4. */
export async function readProjectFile(projectId: string, path: string): Promise<File> {
  const parts = path.split('/')
  const project = await (await projectsDirectory(false)).getDirectoryHandle(projectId)
  const folder = await folderOf(project, parts, false)
  const handle = await folder.getFileHandle(parts[parts.length - 1] ?? '')
  return handle.getFile()
}
