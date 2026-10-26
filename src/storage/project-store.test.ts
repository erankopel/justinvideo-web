import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { ProjectFormatError } from '../project/codec'
import { isSafeRelativePath } from '../engine'
import { extensionFor, newMediaPath } from '../import/paths'
import { PROJECT_FORMAT } from '../project/model'
import { testProject, testProjectWithHistory } from '../project/test-projects'
import { openDatabase, PROJECTS, requestResult, THUMBNAILS, transactionDone } from './idb'
import { MemoryMediaStore } from './media-store'
import { ProjectNotFoundError, type ProjectRecord, ProjectStore } from './project-store'

let db: IDBDatabase
let store: ProjectStore

beforeEach(async () => {
  db = await openDatabase(new IDBFactory())
  store = new ProjectStore(db)
})

async function record(id: string): Promise<ProjectRecord> {
  return requestResult<ProjectRecord>(db.transaction(PROJECTS).objectStore(PROJECTS).get(id))
}

async function overwrite(id: string, change: Partial<ProjectRecord>): Promise<void> {
  const current = await record(id)
  const transaction = db.transaction(PROJECTS, 'readwrite')
  transaction.objectStore(PROJECTS).put({ ...current, ...change })
  await transactionDone(transaction)
}

async function failureOf(id: string): Promise<unknown> {
  try {
    await store.load(id)
  } catch (error) {
    return error
  }
  throw new Error('Expected the load to fail')
}

describe('the project store', () => {
  it('loads a saved project back identically', async () => {
    const project = testProjectWithHistory()
    await store.save(project)
    expect(await store.load(project.id)).toEqual(project)
  })

  it('keeps the copy before the last save', async () => {
    const first = testProject({ modifiedAtMs: 1 })
    const second = { ...first, modifiedAtMs: 2, name: 'Second' }
    await store.save(first)
    expect((await record(first.id)).previousJson).toBeNull()
    await store.save(second)
    const saved = await record(first.id)
    expect(saved.previousJson).not.toBeNull()
    expect(await store.load(first.id)).toEqual(second)
  })

  it('falls back to the save before a damaged file', async () => {
    const first = testProject({ modifiedAtMs: 1 })
    await store.save(first)
    await store.save({ ...first, modifiedAtMs: 2, name: 'Second' })
    await overwrite(first.id, { json: '{"format":1,"id":' })
    expect(await store.load(first.id)).toEqual(first)
  })

  it('does not let a damaged file push out the good copy when saving again', async () => {
    const first = testProject({ modifiedAtMs: 1 })
    await store.save(first)
    await store.save({ ...first, modifiedAtMs: 2 })
    await overwrite(first.id, { json: 'garbage' })
    await store.save({ ...first, modifiedAtMs: 3, name: 'Third' })
    const saved = await record(first.id)
    expect(saved.previousJson).not.toBe('garbage')
    expect(await store.load(first.id)).toMatchObject({ name: 'Third' })
  })

  it('has nothing to fall back to when there is no earlier copy', async () => {
    const project = testProject()
    await store.save(project)
    await overwrite(project.id, { json: 'garbage', previousJson: null })
    const error = await failureOf(project.id)
    expect(error).toBeInstanceOf(ProjectFormatError)
    expect((error as ProjectFormatError).problem).toBe('Corrupt')
  })

  it('reports the first problem when both copies are damaged', async () => {
    const project = testProject()
    await store.save(project)
    await store.save({ ...project, modifiedAtMs: 5 })
    await overwrite(project.id, { json: 'garbage', previousJson: 'more garbage' })
    expect(((await failureOf(project.id)) as ProjectFormatError).problem).toBe('Corrupt')
  })

  it('does not replace a newer format by the older copy', async () => {
    const project = testProject()
    await store.save(project)
    await store.save({ ...project, modifiedAtMs: 5 })
    await overwrite(project.id, { json: `{"format":${PROJECT_FORMAT + 1}}` })
    expect(((await failureOf(project.id)) as ProjectFormatError).problem).toBe('NewerFormat')
  })

  it('fails with a clear error for a project that is not there', async () => {
    expect(await failureOf('nope')).toBeInstanceOf(ProjectNotFoundError)
  })

  it('lists newest first and shows damaged projects instead of hiding them', async () => {
    await store.save(testProject({ id: 'old', modifiedAtMs: 1 }))
    await store.save(testProject({ id: 'new', modifiedAtMs: 9 }))
    await store.save(testProject({ id: 'broken' }))
    await overwrite('broken', { json: 'nope', previousJson: null })

    const entries = await store.list()
    const idOf = (e: (typeof entries)[number]): string => (e.kind === 'readable' ? e.project.id : e.id)
    expect(entries.map(idOf)).toEqual(['new', 'old', 'broken'])
    const last = entries.at(-1)
    expect(last?.kind === 'unreadable' && last.problem).toBe('Corrupt')
    expect(entries[0]?.kind).toBe('readable')
  })

  it('has no projects when empty', async () => {
    expect(await store.list()).toEqual([])
    expect(await store.ids()).toEqual([])
  })

  it('deletes a project with its picture, and deleting twice is fine', async () => {
    const project = testProject()
    await store.save(project)
    await store.saveThumbnail(project.id, new Blob(['jpeg'], { type: 'image/jpeg' }))
    expect(await store.thumbnail(project.id)).not.toBeNull()
    await store.delete(project.id)
    expect(await store.ids()).toEqual([])
    expect(await store.thumbnail(project.id)).toBeNull()
    await store.delete(project.id)
  })

  it('keeps the picture as bytes, with its type, and reads one that an earlier version kept as a Blob', async () => {
    await store.saveThumbnail('p1', new Blob(['jpeg'], { type: 'image/jpeg' }))
    const kept = await store.thumbnail('p1')
    expect(kept?.type).toBe('image/jpeg')
    expect(await kept?.text()).toBe('jpeg')
    const row = await requestResult<{ bytes?: ArrayBuffer; image?: Blob }>(db.transaction(THUMBNAILS).objectStore(THUMBNAILS).get('p1'))
    expect(row.bytes).toBeInstanceOf(ArrayBuffer)
    expect(row.image).toBeUndefined()

    const transaction = db.transaction(THUMBNAILS, 'readwrite')
    transaction.objectStore(THUMBNAILS).put({ id: 'p2', image: new Blob(['old'], { type: 'image/jpeg' }) })
    await transactionDone(transaction)
    expect(await (await store.thumbnail('p2'))?.text()).toBe('old')
  })
})

describe('where media is kept', () => {
  it('gives new paths that are relative, unique and keep only a safe extension', () => {
    const a = newMediaPath('MP4')
    const b = newMediaPath('MP4')
    expect(a.startsWith('media/') && a.endsWith('.mp4')).toBe(true)
    expect(a).not.toBe(b)
    expect(isSafeRelativePath(newMediaPath('../../evil'))).toBe(true)
    expect(newMediaPath('').endsWith('.mp4')).toBe(true)
  })

  it('takes the extension from the name, then the type, then a default', () => {
    expect(extensionFor({ name: 'Holiday.MOV', type: '' })).toBe('mov')
    expect(extensionFor({ name: 'noextension', type: 'video/webm' })).toBe('webm')
    expect(extensionFor({ name: 'noextension', type: '' })).toBe('mp4')
    expect(extensionFor({ name: 'a.b c!', type: '' })).toBe('bc')
  })

  it('clears the files of a project in memory', async () => {
    const media = new MemoryMediaStore()
    await media.write('p1', 'media/a.mp4', new Blob(['x']))
    await media.write('p2', 'media/b.mp4', new Blob(['y']))
    await media.removeProject('p1')
    expect(await media.projectIds()).toEqual(['p2'])
  })
})
