import { clearInterruptedImports } from './import/importer'
import type { MediaStore } from './storage/media-store'
import { IdbMediaStore } from './storage/idb-media'
import { checkStorage, OpfsMediaStore } from './storage/opfs'
import { openDatabase } from './storage/idb'
import { ProjectStore } from './storage/project-store'
import { missingFeatures } from './support'

/** What the screens need from the browser: where projects and videos are kept, and the clock. */
export interface Services {
  readonly projects: ProjectStore
  readonly media: MediaStore
  readonly now: () => number
}

export type Blocked = 'database' | 'browser'

export type StartResult = { readonly services: Services } | { readonly blocked: Blocked }

/**
 * Opens the browser's storage, or says that the browser lacks what the editor needs or that it is not allowing the site a
 * database. The videos go in the private file system; a browser that has none for the site, as a Firefox private window
 * has not, keeps them in the database instead.
 */
export async function startServices(): Promise<StartResult> {
  if (missingFeatures().length > 0) return { blocked: 'browser' }
  const blocked = await checkStorage()
  if (blocked === 'database') return { blocked }
  const media = blocked === 'files' ? new IdbMediaStore() : new OpfsMediaStore()
  const services: Services = { projects: new ProjectStore(await openDatabase()), media, now: () => Date.now() }
  // Leftovers of an import that a closed tab interrupted. Not worth waiting for, or failing over.
  void clearInterruptedImports(services.projects, services.media).catch(() => undefined)
  return { services }
}
