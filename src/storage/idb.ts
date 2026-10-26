export const DB_NAME = 'justinvideo'
export const DB_VERSION = 1
export const PROJECTS = 'projects'
export const THUMBNAILS = 'thumbnails'

/** Opens the site's database, creating its stores the first time. */
export function openDatabase(factory: IDBFactory = indexedDB, name: string = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(THUMBNAILS)) db.createObjectStore(THUMBNAILS, { keyPath: 'id' })
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error ?? new Error('The database could not be opened'))
    open.onblocked = () => reject(new Error('The database is blocked by another tab'))
  })
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('A database request failed'))
  })
}

/** Resolves when the transaction has committed, which is when the data is safely stored. */
export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('A database transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('A database transaction was aborted'))
  })
}
