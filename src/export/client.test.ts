import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../project/model'
import { testProject } from '../project/test-projects'
import { ExportError } from './failure'
import type { FromWorker, ToWorker } from './protocol'
import { defaultExportSettings } from './settings'

const { exportProject, removeExportFile } = vi.hoisted(() => ({
  exportProject: vi.fn(),
  removeExportFile: vi.fn(async () => undefined),
}))
vi.mock('./runner', () => ({ exportProject }))
vi.mock('./target', () => ({ removeExportFile }))

const { runExport } = await import('./client')

/** A worker that does what the test says: it keeps what it was sent, and answers when told to. */
class FakeWorker {
  static all: FakeWorker[] = []
  static failToCreate = false
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  readonly sent: ToWorker[] = []
  terminated = false

  constructor() {
    if (FakeWorker.failToCreate) throw new Error('A worker cannot be made here')
    FakeWorker.all.push(this)
  }

  postMessage(message: ToWorker): void {
    this.sent.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  say(message: FromWorker): void {
    this.onmessage?.({ data: message } as MessageEvent<FromWorker>)
  }

  crash(message = 'The script failed'): void {
    this.onerror?.({ message, preventDefault: () => undefined } as unknown as ErrorEvent)
  }
}

const project: Project = testProject()
const settings = defaultExportSettings(project)
const file = { name: 'out.mp4' } as unknown as File
const files = { kind: 'files' as const, read: async () => file }
const finished = { file, fileName: 'out.mp4', width: 1280, height: 720, durationMs: 3000, frameCount: 75, container: 'mp4' as const }
const mainResult = { ...finished, discard: async () => undefined }

const options = (extra: object = {}) => ({ rightToLeft: false, ...extra })
const onlyWorker = (): FakeWorker => {
  const worker = FakeWorker.all[0]
  if (!worker) throw new Error('no worker was made')
  return worker
}

beforeEach(() => {
  FakeWorker.all = []
  FakeWorker.failToCreate = false
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('OffscreenCanvas', class {})
  exportProject.mockReset()
  exportProject.mockResolvedValue(mainResult)
  removeExportFile.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('runExport in a worker', () => {
  it('sends the job, says it is in a worker, passes progress on, and returns what the worker made', async () => {
    const onMode = vi.fn()
    const onProgress = vi.fn()
    const running = runExport(files, project, settings, options({ onMode, onProgress, rightToLeft: true, now: () => new Date(1_700_000_000_000) }))
    const worker = onlyWorker()
    expect(worker.sent).toEqual([{ type: 'start', project, settings, rightToLeft: true, storage: 'files', nowMs: 1_700_000_000_000 }])
    worker.say({ type: 'started' })
    worker.say({ type: 'progress', fraction: 0.25 })
    worker.say({ type: 'done', result: { ...finished, tempName: 'export-1.mp4' } })
    const result = await running
    expect(onMode).toHaveBeenCalledWith('worker')
    expect(onProgress).toHaveBeenCalledWith(0.25)
    expect(result).toMatchObject({ ...finished, tempName: 'export-1.mp4' })
    expect(worker.terminated).toBe(true)
    expect(exportProject).not.toHaveBeenCalled()
    // Discarding takes the file out of storage by its name.
    await result.discard()
    expect(removeExportFile).toHaveBeenCalledWith('export-1.mp4')
  })

  it('tells the worker where the files are: in the database when the browser has no private file system', async () => {
    const running = runExport({ ...files, kind: 'database' }, project, settings, options())
    expect(onlyWorker().sent).toMatchObject([{ type: 'start', storage: 'database' }])
    onlyWorker().say({ type: 'started' })
    onlyWorker().say({ type: 'done', result: finished })
    await running
  })

  it('makes an export in the page when the files are only in memory, which a worker cannot see', async () => {
    const onMode = vi.fn()
    await expect(runExport({ ...files, kind: 'memory' }, project, settings, options({ onMode }))).resolves.toBe(mainResult)
    expect(FakeWorker.all).toHaveLength(0)
    expect(onMode).toHaveBeenCalledWith('main')
  })

  it('has nothing to take out of storage for a file that was held in memory', async () => {
    const running = runExport(files, project, settings, options())
    onlyWorker().say({ type: 'started' })
    onlyWorker().say({ type: 'done', result: finished })
    const result = await running
    expect(result.tempName).toBeUndefined()
    await result.discard()
    expect(removeExportFile).not.toHaveBeenCalled()
  })

  it('fails with the reason the worker gives, once it has made progress', async () => {
    const running = runExport(files, project, settings, options())
    const worker = onlyWorker()
    worker.say({ type: 'started' })
    worker.say({ type: 'progress', fraction: 0.1 })
    worker.say({ type: 'failed', failure: 'EncoderFailed' })
    await expect(running).rejects.toMatchObject({ failure: 'EncoderFailed' })
    expect(worker.terminated).toBe(true)
    expect(exportProject).not.toHaveBeenCalled()
  })

  it('fails at once, without trying the page, for a reason the page would meet too', async () => {
    for (const failure of ['NothingToExport', 'SourceMissing', 'AudioMissing', 'NoSpace'] as const) {
      FakeWorker.all = []
      const running = runExport(files, project, settings, options())
      onlyWorker().say({ type: 'started' })
      onlyWorker().say({ type: 'failed', failure })
      await expect(running).rejects.toBeInstanceOf(ExportError)
      await expect(running).rejects.toMatchObject({ failure })
    }
    expect(exportProject).not.toHaveBeenCalled()
  })

  it('goes on in the page when the worker fails before it has made any progress with a failure that may be its own', async () => {
    for (const failure of ['EncoderFailed', 'DecoderFailed', 'Failed'] as const) {
      FakeWorker.all = []
      exportProject.mockClear()
      const onMode = vi.fn()
      const running = runExport(files, project, settings, options({ onMode }))
      onlyWorker().say({ type: 'started' })
      onlyWorker().say({ type: 'failed', failure })
      await expect(running).resolves.toBe(mainResult)
      expect(onMode.mock.calls.map((call) => call[0])).toEqual(['worker', 'main'])
      expect(exportProject).toHaveBeenCalledTimes(1)
    }
  })

  it('goes on in the page when the worker cannot start, and gives up on one that fails once it is under way', async () => {
    const early = runExport(files, project, settings, options())
    onlyWorker().crash('The script would not load')
    await expect(early).resolves.toBe(mainResult)

    FakeWorker.all = []
    exportProject.mockClear()
    const late = runExport(files, project, settings, options())
    onlyWorker().say({ type: 'started' })
    onlyWorker().say({ type: 'progress', fraction: 0.4 })
    onlyWorker().crash('The worker died')
    await expect(late).rejects.toMatchObject({ failure: 'Failed' })
    expect(exportProject).not.toHaveBeenCalled()
  })

  it('goes on in the page when no worker can be made, or the browser has no OffscreenCanvas, or no Worker', async () => {
    FakeWorker.failToCreate = true
    await expect(runExport(files, project, settings, options())).resolves.toBe(mainResult)
    FakeWorker.failToCreate = false

    vi.stubGlobal('OffscreenCanvas', undefined)
    const onMode = vi.fn()
    await expect(runExport(files, project, settings, options({ onMode }))).resolves.toBe(mainResult)
    expect(onMode).toHaveBeenCalledWith('main')
    expect(FakeWorker.all).toHaveLength(0)

    vi.stubGlobal('OffscreenCanvas', class {})
    vi.stubGlobal('Worker', undefined)
    await expect(runExport(files, project, settings, options())).resolves.toBe(mainResult)
  })

  it('tells the worker to stop when it is cancelled, and ends with an AbortError when the worker says it has', async () => {
    const abort = new AbortController()
    const running = runExport(files, project, settings, options({ signal: abort.signal }))
    const worker = onlyWorker()
    worker.say({ type: 'started' })
    abort.abort()
    expect(worker.sent.at(-1)).toEqual({ type: 'cancel' })
    worker.say({ type: 'cancelled' })
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
  })

  it('shuts down a worker that does not stop in time, and ends with an AbortError all the same', async () => {
    vi.useFakeTimers()
    const abort = new AbortController()
    const running = runExport(files, project, settings, options({ signal: abort.signal }))
    const outcome = running.then(
      () => 'finished',
      (error: unknown) => (error as Error).name,
    )
    const worker = onlyWorker()
    worker.say({ type: 'started' })
    abort.abort()
    await vi.advanceTimersByTimeAsync(7_000)
    expect(worker.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(worker.terminated).toBe(true)
    expect(await outcome).toBe('AbortError')
  })

  it('does not even make a worker for an export that was cancelled before it began', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(runExport(files, project, settings, options({ signal: abort.signal }))).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeWorker.all).toHaveLength(0)
    expect(exportProject).not.toHaveBeenCalled()
  })

  it('ignores what a worker says after it has been dealt with', async () => {
    const running = runExport(files, project, settings, options())
    const worker = onlyWorker()
    worker.say({ type: 'started' })
    worker.say({ type: 'done', result: finished })
    await running
    worker.say({ type: 'failed', failure: 'Failed' })
    worker.crash()
    expect(exportProject).not.toHaveBeenCalled()
  })
})
