import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_SOURCES, newProjectId } from '../project/model'
import { openDatabase } from '../storage/idb'
import { type MediaStore, MemoryMediaStore, StorageFullError } from '../storage/media-store'
import { ProjectStore } from '../storage/project-store'
import { ImportError, type ImportFailure } from './failure'
import { clearInterruptedImports, type ImportDeps, importVideos } from './importer'
import type { VideoProbe } from './probe'

const file = (name: string, content = 'video'): File => new File([content], name, { type: 'video/mp4' })

const FACTS: VideoProbe = { displayName: 'x', durationMs: 5_000, width: 1920, height: 1080, rotationDegrees: 90, hasAudio: true }

let projects: ProjectStore
let media: MemoryMediaStore
let clock: number

function deps(overrides: Partial<ImportDeps> = {}): ImportDeps {
  return {
    projects,
    media,
    now: () => clock++,
    probe: async (f) => ({ ...FACTS, displayName: f.name }),
    hasRoom: async () => true,
    thumbnail: async () => new Blob(['jpeg']),
    ...overrides,
  }
}

const run = (files: File[], overrides: Partial<ImportDeps> = {}, into?: Awaited<ReturnType<ProjectStore['load']>>) =>
  importVideos(deps(overrides), files, { fallbackName: 'Untitled video', ...(into ? { into } : {}) })

beforeEach(async () => {
  projects = new ProjectStore(await openDatabase(new IDBFactory()))
  media = new MemoryMediaStore()
  clock = 1_000
})

describe('importing a video', () => {
  it('makes a project that plays the whole video, with its copy stored under the project', async () => {
    const outcome = await run([file('holiday.mp4', 'abc')])
    expect(outcome.failures).toEqual([])
    const project = outcome.project
    if (!project) throw new Error('Expected a project')
    expect(project.name).toBe('holiday')
    expect(project.sources).toHaveLength(1)
    const source = project.sources[0]!
    expect(source).toMatchObject({ displayName: 'holiday.mp4', durationMs: 5_000, width: 1920, height: 1080, rotationDegrees: 90, hasAudio: true })
    expect(source.file).toMatch(/^media\/[0-9a-f]{16}\.mp4$/)
    expect(project.edit.timeline.clips).toHaveLength(1)
    expect(project.edit.timeline.durationMs).toBe(5_000)
    expect(await media.read(project.id, source.file).then((f) => f.text())).toBe('abc')
    expect(await projects.load(project.id)).toEqual(project)
    expect(await projects.thumbnail(project.id)).not.toBeNull()
  })

  it('names a project from a file called only by digits with the fallback', async () => {
    expect((await run([file('564.mp4')])).project?.name).toBe('Untitled video')
  })

  it('puts several videos in one project, in the order given', async () => {
    const outcome = await run([file('one.mp4'), file('two.mp4'), file('three.mp4')])
    const project = outcome.project
    expect(outcome.imported).toBe(3)
    expect(project?.name).toBe('one')
    expect(project?.sources.map((s) => s.displayName)).toEqual(['one.mp4', 'two.mp4', 'three.mp4'])
    expect(project?.edit.timeline.clips.map((c) => c.sourceId)).toEqual(project?.sources.map((s) => s.id))
    expect(project?.edit.timeline.durationMs).toBe(15_000)
    // Each video after the first is an undoable edit.
    expect(project?.edit.undoStack).toHaveLength(2)
    expect((await media.projectIds())).toEqual([project?.id])
  })

  it('adds videos to an existing project at the end', async () => {
    const first = (await run([file('one.mp4')])).project
    if (!first) throw new Error('Expected a project')
    const outcome = await run([file('two.mp4')], {}, first)
    expect(outcome.project?.id).toBe(first.id)
    expect(outcome.project?.edit.timeline.clips).toHaveLength(2)
    expect(outcome.project?.edit.timeline.clips[1]?.sourceId).toBe(outcome.project?.sources[1]?.id)
    expect(outcome.project?.name).toBe('one')
  })

  it('skips a file that is refused, tells why, and carries on with the rest', async () => {
    const refuse = async (f: File): Promise<VideoProbe> => {
      if (f.name === 'bad.txt') throw new ImportError('NotVideo')
      if (f.name === 'odd.mov') throw new ImportError('UnsupportedFormat')
      return { ...FACTS, displayName: f.name }
    }
    const outcome = await run([file('bad.txt'), file('odd.mov'), file('good.mp4'), file('also.mp4')], { probe: refuse })
    expect(outcome.failures).toEqual([
      { name: 'bad.txt', failure: 'NotVideo' },
      { name: 'odd.mov', failure: 'UnsupportedFormat' },
    ])
    expect(outcome.project?.name).toBe('good')
    expect(outcome.project?.sources).toHaveLength(2)
    expect(outcome.imported).toBe(2)
  })

  it('makes no project when nothing can be imported, and leaves nothing behind', async () => {
    const outcome = await run([file('bad.txt')], { probe: async () => { throw new ImportError('NotVideo') } })
    expect(outcome.project).toBeNull()
    expect(await projects.ids()).toEqual([])
    expect(await media.projectIds()).toEqual([])
  })

  it('refuses a copy that will not fit before it starts', async () => {
    const outcome = await run([file('big.mp4')], { hasRoom: async () => false })
    expect(outcome.failures).toEqual([{ name: 'big.mp4', failure: 'NoSpace' }])
    expect(await media.projectIds()).toEqual([])
  })

  it('removes a half-written copy when the browser runs out of room during it', async () => {
    const full: MediaStore = {
      kind: 'memory',
      write: async () => { throw new StorageFullError() },
      read: media.read.bind(media),
      remove: media.remove.bind(media),
      removeProject: media.removeProject.bind(media),
      projectIds: media.projectIds.bind(media),
      list: media.list.bind(media),
    }
    const outcome = await run([file('big.mp4')], { media: full })
    expect(outcome.failures).toEqual([{ name: 'big.mp4', failure: 'NoSpace' }])
    expect(await projects.ids()).toEqual([])
  })

  it('removes the copy of a video that could not be saved into the project', async () => {
    const first = (await run([file('one.mp4')])).project
    if (!first) throw new Error('Expected a project')
    const failing = new ProjectStore(await openDatabase(new IDBFactory()))
    failing.save = async () => { throw new Error('quota') }
    const outcome = await run([file('two.mp4')], { projects: failing }, first)
    expect(outcome.failures).toEqual([{ name: 'two.mp4', failure: 'NoSpace' }])
    expect([...media.files.keys()].filter((k) => k.startsWith(`${first.id}/`))).toHaveLength(1)
  })

  it('refuses a video that would make the project too long or too full', async () => {
    const long: VideoProbe = { ...FACTS, durationMs: 24 * 60 * 60 * 1000 }
    const first = (await run([file('day.mp4')], { probe: async () => long })).project
    if (!first) throw new Error('Expected a project')
    const outcome = await run([file('more.mp4')], {}, first)
    expect(outcome.failures).toEqual([{ name: 'more.mp4', failure: 'ProjectFull' satisfies ImportFailure }])
    expect(outcome.project).toBe(first)
  })

  it('holds at most fifty recordings in a project', async () => {
    const many = Array.from({ length: MAX_SOURCES + 1 }, (_, i) => file(`v${i}.mp4`))
    const outcome = await run(many)
    expect(outcome.project?.sources).toHaveLength(MAX_SOURCES)
    expect(outcome.failures).toEqual([{ name: `v${MAX_SOURCES}.mp4`, failure: 'TooManyRecordings' }])
  })

  it('does not fail an import over a missing picture', async () => {
    const outcome = await run([file('one.mp4')], { thumbnail: async () => { throw new Error('no frame') } })
    expect(outcome.project).not.toBeNull()
    expect(outcome.failures).toEqual([])
    expect(await projects.thumbnail(outcome.project!.id)).toBeNull()
  })

  it('reports progress of each copy', async () => {
    const seen: string[] = []
    await importVideos(deps(), [file('one.mp4'), file('two.mp4')], {
      fallbackName: 'x',
      onProgress: (p) => seen.push(`${p.fileIndex + 1}/${p.fileCount} ${p.name} ${p.done}/${p.total}`),
    })
    expect(seen).toEqual(['1/2 one.mp4 5/5', '2/2 two.mp4 5/5'])
  })
})

describe('clearing interrupted imports', () => {
  it('removes the folders that have no project and leaves the others', async () => {
    const kept = (await run([file('one.mp4')])).project
    await media.write(newProjectId(), 'media/half.mp4', new Blob(['half']))
    await media.write(newProjectId(), 'media/other.mp4', new Blob(['half']))
    expect(await clearInterruptedImports(projects, media)).toBe(2)
    expect(await media.projectIds()).toEqual([kept?.id])
    expect(await clearInterruptedImports(projects, media)).toBe(0)
  })
})
