import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { IdbMediaStore } from './idb-media'
import { StorageFullError } from './media-store'

let factory: IDBFactory
let store: IdbMediaStore

beforeEach(() => {
  factory = new IDBFactory()
  store = new IdbMediaStore(factory)
})

const blob = (text: string, type = 'video/mp4'): Blob => new Blob([text], { type })

describe('IdbMediaStore', () => {
  it('keeps where the files are as the database', () => {
    expect(store.kind).toBe('database')
  })

  it('reads back what was written, with its name and type, and tells that it is all done', async () => {
    const progress: [number, number][] = []
    await store.write('p1', 'media/s1.mp4', blob('hello'), (done, total) => progress.push([done, total]))
    expect(progress).toEqual([[5, 5]])
    const file = await store.read('p1', 'media/s1.mp4')
    expect(file.name).toBe('s1.mp4')
    expect(file.type).toBe('video/mp4')
    expect(await file.text()).toBe('hello')
  })

  it('writes over a file that is there, and keeps the files of another project apart', async () => {
    await store.write('p1', 'media/s1.mp4', blob('one'))
    await store.write('p2', 'media/s1.mp4', blob('other'))
    await store.write('p1', 'media/s1.mp4', blob('two'))
    expect(await (await store.read('p1', 'media/s1.mp4')).text()).toBe('two')
    expect(await (await store.read('p2', 'media/s1.mp4')).text()).toBe('other')
  })

  it('says a file is not found the way the private file system does', async () => {
    await expect(store.read('p1', 'media/none.mp4')).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('lists the files of a project at every depth, with when they were written', async () => {
    const before = Date.now()
    await store.write('p1', 'media/s1.mp4', blob('a'))
    await store.write('p1', 'audio/a1.wav', blob('b', 'audio/wav'))
    await store.write('p2', 'media/s9.mp4', blob('c'))
    const listed = await store.list('p1')
    expect(listed.map((file) => file.path).sort()).toEqual(['audio/a1.wav', 'media/s1.mp4'])
    for (const file of listed) expect(file.modifiedAtMs).toBeGreaterThanOrEqual(before)
    expect(await store.list('nobody')).toEqual([])
  })

  it('reads a file with the time it was written as its last change', async () => {
    await store.write('p1', 'media/s1.mp4', blob('a'))
    const [listed] = await store.list('p1')
    expect((await store.read('p1', 'media/s1.mp4')).lastModified).toBe(listed?.modifiedAtMs)
  })

  it('removes one file, and is not troubled by one that is not there', async () => {
    await store.write('p1', 'media/s1.mp4', blob('a'))
    await store.write('p1', 'media/s2.mp4', blob('b'))
    await store.remove('p1', 'media/s1.mp4')
    await store.remove('p1', 'media/s1.mp4')
    expect((await store.list('p1')).map((file) => file.path)).toEqual(['media/s2.mp4'])
  })

  it('removes a whole project and nothing of another, and has the projects that have files', async () => {
    await store.write('p1', 'media/s1.mp4', blob('a'))
    await store.write('p1', 'audio/a1.wav', blob('b'))
    await store.write('p2', 'media/s9.mp4', blob('c'))
    await store.write('p3', 'media/s7.mp4', blob('d'))
    expect((await store.projectIds()).sort()).toEqual(['p1', 'p2', 'p3'])
    await store.removeProject('p1')
    await store.removeProject('p1')
    expect((await store.projectIds()).sort()).toEqual(['p2', 'p3'])
    expect(await store.list('p1')).toEqual([])
    expect(await (await store.read('p2', 'media/s9.mp4')).text()).toBe('c')
  })

  it('has no projects when nothing was written', async () => {
    expect(await store.projectIds()).toEqual([])
  })

  it('is seen by a second store on the same database, as a worker is', async () => {
    await store.write('p1', 'media/s1.mp4', blob('shared'))
    const worker = new IdbMediaStore(factory)
    expect(await (await worker.read('p1', 'media/s1.mp4')).text()).toBe('shared')
  })

})

/** A store that has the browser refuse to keep a Blob, with the error it gives, and counts how often it is asked to. */
class Refusing extends IdbMediaStore {
  attempts = 0
  constructor(
    factory: IDBFactory,
    private readonly refusal: string,
  ) {
    super(factory, { pieceBytes: 4 })
  }
  protected override async storeWhole(): Promise<void> {
    this.attempts++
    throw new DOMException('Refused for the test', this.refusal)
  }
}

/** How many pieces of files the database holds, which are not the files themselves. */
async function pieceCount(factory: IDBFactory): Promise<number> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open('justinvideo-media')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  const count = await new Promise<number>((resolve, reject) => {
    const request = database.transaction('pieces').objectStore('pieces').count()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  database.close()
  return count
}

describe('IdbMediaStore when the browser cannot keep a file whole', () => {
  it('says that the browser is full when it has no room, and keeps nothing of the file', async () => {
    const full = new Refusing(factory, 'QuotaExceededError')
    await expect(full.write('p1', 'media/s1.mp4', blob('abcdefghij'))).rejects.toBeInstanceOf(StorageFullError)
    expect(await full.list('p1')).toEqual([])
    expect(await pieceCount(factory)).toBe(0)
    expect(full.attempts).toBe(1)
  })

  it('keeps the file in pieces when the browser refuses a Blob for any other reason, and goes straight to pieces after that', async () => {
    const refusing = new Refusing(factory, 'UnknownError')
    const progress: [number, number][] = []
    await refusing.write('p1', 'media/s1.mp4', blob('abcdefghij'), (done, total) => progress.push([done, total]))
    expect(progress).toEqual([
      [4, 10],
      [8, 10],
      [10, 10],
    ])
    expect(await pieceCount(factory)).toBe(3)
    const file = await refusing.read('p1', 'media/s1.mp4')
    expect(file.name).toBe('s1.mp4')
    expect(file.type).toBe('video/mp4')
    expect(await file.text()).toBe('abcdefghij')
    await refusing.write('p1', 'media/s2.mp4', blob('xy'))
    expect(refusing.attempts).toBe(1)
    expect(await (await refusing.read('p1', 'media/s2.mp4')).text()).toBe('xy')
  })

  it('keeps an empty file, which is one piece of nothing', async () => {
    const pieces = new IdbMediaStore(factory, { keepBlobs: false, pieceBytes: 4 })
    await pieces.write('p1', 'media/empty.mp4', blob(''))
    expect((await pieces.read('p1', 'media/empty.mp4')).size).toBe(0)
    expect(await pieces.list('p1')).toHaveLength(1)
  })

  it('takes the pieces away with a file, with a project, and when a file is written over', async () => {
    const pieces = new IdbMediaStore(factory, { keepBlobs: false, pieceBytes: 4 })
    await pieces.write('p1', 'media/s1.mp4', blob('abcdefghij'))
    await pieces.write('p1', 'media/s2.mp4', blob('abcd'))
    await pieces.write('p2', 'media/s9.mp4', blob('abcdefgh'))
    expect(await pieceCount(factory)).toBe(6)
    await pieces.write('p1', 'media/s1.mp4', blob('abcde'))
    expect(await pieceCount(factory)).toBe(5)
    await pieces.remove('p1', 'media/s2.mp4')
    expect(await pieceCount(factory)).toBe(4)
    await pieces.removeProject('p1')
    expect(await pieceCount(factory)).toBe(2)
    expect(await (await pieces.read('p2', 'media/s9.mp4')).text()).toBe('abcdefgh')
  })

  it('keeps nothing of a file that could not be read all the way through', async () => {
    const pieces = new IdbMediaStore(factory, { keepBlobs: false, pieceBytes: 4 })
    let slices = 0
    class Flaky extends Blob {
      override slice(start?: number, end?: number, type?: string): Blob {
        if (++slices === 2) throw new Error('The file could not be read')
        return super.slice(start, end, type)
      }
    }
    await expect(pieces.write('p1', 'media/s1.mp4', new Flaky(['abcdefghij']))).rejects.toThrow('could not be read')
    expect(await pieces.list('p1')).toEqual([])
    expect(await pieceCount(factory)).toBe(0)
  })
})
