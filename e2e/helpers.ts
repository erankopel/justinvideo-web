import { expect, type Page } from '@playwright/test'
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const media = (name: string): string => fileURLToPath(new URL(`../test-data/media/${name}`, import.meta.url))

/** Chooses videos in the page's file picker, as a person would, without opening a system dialog. */
export async function pick(page: Page, files: string | string[] | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.getByTestId('video-input').setInputFiles(files)
}

/**
 * What the page reads and changes of the site's stored files, in whichever place the site keeps them: the private file system,
 * or, where a browser has none (WebKit without one, a Firefox private window), the database of its own. A project's files are
 * found by their paths, such as p123/media/abc.webm.
 */
type StoredAction =
  | { readonly type: 'paths' }
  | { readonly type: 'facts'; readonly path: string }
  | { readonly type: 'damage'; readonly suffix: string }
  | { readonly type: 'removeMedia' }
  | { readonly type: 'plantStray' }

interface StoredResult {
  readonly paths?: string[]
  readonly size?: number
  readonly sha256?: string
  readonly changed?: number
}

async function stored(page: Page, action: StoredAction): Promise<StoredResult> {
  return page.evaluate(async (action): Promise<StoredResult> => {
    const hex = async (bytes: ArrayBuffer): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
    type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> }
    const entriesOf = (dir: FileSystemDirectoryHandle): AsyncIterable<[string, FileSystemHandle]> => (dir as unknown as Entries).entries()

    if (typeof navigator.storage?.getDirectory === 'function') {
      const root = await navigator.storage.getDirectory()
      async function walk(dir: FileSystemDirectoryHandle, prefix: string, visit: (path: string, handle: FileSystemHandle, parent: FileSystemDirectoryHandle) => Promise<void>): Promise<void> {
        try {
          for await (const [name, handle] of entriesOf(dir)) {
            await visit(prefix + name, handle, dir)
            if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`, visit)
          }
        } catch (error) {
          // The site clears leftovers while this reads: a folder that is gone by the time it is opened is simply not there.
          if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
        }
      }
      let projects: FileSystemDirectoryHandle | null = null
      try {
        projects = await root.getDirectoryHandle('projects')
      } catch {
        // Nothing has been written yet.
      }
      if (action.type === 'plantStray') {
        const folder = await root.getDirectoryHandle('projects', { create: true })
        await (await folder.getDirectoryHandle('pstray', { create: true })).getDirectoryHandle('media', { create: true })
        return {}
      }
      const out: string[] = []
      let changed = 0
      let result: StoredResult = {}
      if (projects) {
        await walk(projects, '', async (path, handle, parent) => {
          out.push(path)
          if (handle.kind !== 'file') return
          const file = handle as FileSystemFileHandle
          if (action.type === 'facts' && path === action.path) {
            const bytes = await (await file.getFile()).arrayBuffer()
            result = { size: bytes.byteLength, sha256: await hex(bytes) }
          }
          if (action.type === 'damage' && path.endsWith(action.suffix)) {
            const writable = await file.createWritable()
            await writable.write(new Uint8Array(2000).fill(7))
            await writable.close()
            changed++
          }
          if (action.type === 'removeMedia' && path.includes('/media/')) {
            await parent.removeEntry(path.split('/').pop() ?? '')
            changed++
          }
        })
      }
      return action.type === 'paths' ? { paths: out.sort() } : { ...result, changed }
    }

    // The database of files: one record for each file, whole as a Blob or in pieces.
    const open = (): Promise<IDBDatabase> =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('justinvideo-media', 1)
        request.onupgradeneeded = () => {
          const files = request.result.createObjectStore('files', { keyPath: 'key' })
          files.createIndex('byProject', 'projectId')
          request.result.createObjectStore('pieces', { keyPath: ['key', 'index'] })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const db = await open()
    const asPromise = <T,>(request: IDBRequest<T>): Promise<T> =>
      new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const finished = (transaction: IDBTransaction): Promise<void> =>
      new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    interface Row {
      key: string
      projectId: string
      path: string
      modifiedAtMs: number
      type: string
      blob?: Blob
      pieces?: number
    }
    const rows = (await asPromise(db.transaction('files').objectStore('files').getAll())) as Row[]
    const bytesOf = async (row: Row): Promise<ArrayBuffer> => {
      if (row.blob) return row.blob.arrayBuffer()
      const store = db.transaction('pieces').objectStore('pieces')
      const parts = await Promise.all(Array.from({ length: row.pieces ?? 0 }, (_, index) => asPromise(store.get([row.key, index]) as IDBRequest<{ data: ArrayBuffer }>)))
      return new Blob(parts.map((part) => part.data)).arrayBuffer()
    }
    if (action.type === 'plantStray') {
      const transaction = db.transaction('files', 'readwrite')
      transaction.objectStore('files').put({ key: 'pstray/media/stray.bin', projectId: 'pstray', path: 'media/stray.bin', modifiedAtMs: 0, type: '', pieces: 0 } satisfies Row)
      await finished(transaction)
      db.close()
      return {}
    }
    let result: StoredResult = {}
    let changed = 0
    for (const row of rows) {
      const path = `${row.projectId}/${row.path}`
      if (action.type === 'facts' && path === action.path) {
        const bytes = await bytesOf(row)
        result = { size: bytes.byteLength, sha256: await hex(bytes) }
      }
      const matches = (action.type === 'damage' && path.endsWith(action.suffix)) || (action.type === 'removeMedia' && path.includes('/media/'))
      if (!matches) continue
      const transaction = db.transaction(['files', 'pieces'], 'readwrite')
      for (let index = 0; index < (row.pieces ?? 0); index++) transaction.objectStore('pieces').delete([row.key, index])
      if (action.type === 'removeMedia') transaction.objectStore('files').delete(row.key)
      else {
        const { blob: _blob, ...rest } = row
        transaction.objectStore('files').put({ ...rest, pieces: 1 })
        transaction.objectStore('pieces').put({ key: row.key, index: 0, data: new Uint8Array(2000).fill(7).buffer })
      }
      await finished(transaction)
      changed++
    }
    db.close()
    if (action.type !== 'paths') return { ...result, changed }
    const out = new Set<string>()
    for (const row of rows) {
      const parts = `${row.projectId}/${row.path}`.split('/')
      for (let at = 1; at <= parts.length; at++) out.add(parts.slice(0, at).join('/'))
    }
    return { paths: [...out].sort() }
  }, action)
}

/**
 * Reloads the page. The WebKit of these tests used to stall in a reload now and then, for as long as it was let, until the editor
 * let go of its pictures when the page is left, so one that takes more than 20 seconds is still made again.
 */
export async function reload(page: Page): Promise<void> {
  try {
    await page.reload({ timeout: 20_000 })
  } catch (error) {
    if (!(error instanceof Error) || !/timeout/i.test(error.message)) throw error
    await page.reload()
  }
}

/** The names of the folders and files the site has stored, as paths such as p123/media/abc.webm. */
export async function storedPaths(page: Page): Promise<string[]> {
  return (await stored(page, { type: 'paths' })).paths ?? []
}

/** The size and SHA-256 of a stored file, by its path. */
export async function storedFacts(page: Page, path: string): Promise<{ size: number; sha256: string }> {
  const { size, sha256 } = await stored(page, { type: 'facts', path })
  return { size: size ?? -1, sha256: sha256 ?? '' }
}

/** Makes every stored file that ends so into 2000 bytes that are not that kind of file, as a damaged disk would. Returns how many. */
export async function damageStored(page: Page, suffix: string): Promise<number> {
  return (await stored(page, { type: 'damage', suffix })).changed ?? 0
}

/** Takes away every stored recording and piece of sound, leaving the projects. Returns how many. */
export async function removeStoredMedia(page: Page): Promise<number> {
  return (await stored(page, { type: 'removeMedia' })).changed ?? 0
}

/** Leaves a project's files behind that no project refers to, as an import that was interrupted does. Its path starts with pstray. */
export async function plantStray(page: Page): Promise<void> {
  await stored(page, { type: 'plantStray' })
}

/** Reads one stored project record from the database, or changes it, for the tests that damage a project on purpose. */
export async function editRecord(page: Page, change: { json?: string; previousJson?: string | null }): Promise<void> {
  await page.evaluate(
    (patch) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('justinvideo')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('projects', 'readwrite')
          const store = tx.objectStore('projects')
          const all = store.getAll()
          all.onsuccess = () => {
            for (const record of all.result) store.put({ ...record, ...patch })
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    change,
  )
}

export async function storedRecords(page: Page): Promise<{ id: string; json: string; previousJson: string | null }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('justinvideo')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction('projects').objectStore('projects').getAll()
          all.onsuccess = () => {
            db.close()
            resolve(all.result)
          }
        }
      }),
  )
}

export interface Frame {
  readonly ready: boolean
  /** The brightness of the picture's corner, 0 to 255. The test videos get brighter with every frame, so this names the frame. */
  readonly level: number
  readonly videoWidth: number
  readonly videoHeight: number
}

/** What the preview shows now: the brightness of a corner of the visible video, drawn to a canvas. */
export async function shownFrame(page: Page): Promise<Frame> {
  return page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('[data-testid=preview] video[data-active=true]')
    if (!video || video.readyState < 2) return { ready: false, level: -1, videoWidth: 0, videoHeight: 0 }
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No canvas')
    context.drawImage(video, 0, 0, 16, 16)
    const [r = 0, g = 0, b = 0] = context.getImageData(1, 1, 1, 1).data
    return { ready: true, level: 0.2126 * r + 0.7152 * g + 0.0722 * b, videoWidth: video.videoWidth, videoHeight: video.videoHeight }
  })
}

/** The brightness that the frame at a time has in a test video of the given length: 40 at the start, rising by 180 over the video. */
export const levelAt = (sourceMs: number, videoMs: number): number => 40 + (180 * sourceMs) / videoMs

/** Whether two brightnesses are within a couple of frames of each other (a frame of the 2 s test video is 3.6 levels). */
export const nearLevel = (actual: number, expected: number, tolerance = 9): boolean => Math.abs(actual - expected) <= tolerance

export async function positionMs(page: Page): Promise<number> {
  return Number(await page.getByTestId('preview').getAttribute('data-position-ms'))
}

/** Replaces the clips of the stored project, from source time ranges of its first video, and loads the page again. */
export async function setClips(page: Page, ranges: [number, number][]): Promise<void> {
  await page.evaluate(
    (spans) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('justinvideo')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('projects', 'readwrite')
          const store = tx.objectStore('projects')
          const all = store.getAll()
          all.onsuccess = () => {
            for (const record of all.result) {
              const project = JSON.parse(record.json)
              const source = project.sources[0].id
              project.timeline = spans.map(([from, to], i) => ({ id: `t${i}`, source, sourceStartMs: from, durationMs: to - from, volume: 100 }))
              project.undo = []
              project.redo = []
              store.put({ ...record, json: JSON.stringify(project), previousJson: null })
            }
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    ranges,
  )
  await reload(page)
}

/** Presses pause in the page itself the moment the playhead has passed a time, so that a slow test cannot miss the place. */
export async function pauseOncePast(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    (limit) =>
      new Promise<void>((resolve, reject) => {
        const started = performance.now()
        const check = (): void => {
          const preview = document.querySelector('[data-testid=preview]')
          const position = Number(preview?.getAttribute('data-position-ms'))
          if (position > limit) {
            document.querySelector<HTMLButtonElement>('[data-testid=play]')?.click()
            resolve()
          } else if (performance.now() - started > 8000) {
            reject(new Error(`The playhead never passed ${limit} ms: it is at ${position}`))
          } else {
            requestAnimationFrame(check)
          }
        }
        check()
      }),
    ms,
  )
  await page.waitForFunction(() => document.querySelector('[data-testid=preview]')?.getAttribute('data-playing') === 'false')
}

/** Forgets the undo and redo history of the stored project, and loads the page again, so a test starts with nothing to undo. */
export async function clearHistory(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('justinvideo')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('projects', 'readwrite')
          const store = tx.objectStore('projects')
          const all = store.getAll()
          all.onsuccess = () => {
            for (const record of all.result) {
              const project = JSON.parse(record.json)
              for (const key of ['undo', 'redo', 'undoTexts', 'redoTexts', 'undoMixes', 'redoMixes']) project[key] = []
              store.put({ ...record, json: JSON.stringify(project), previousJson: null })
            }
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
  await reload(page)
}

export interface Pixels {
  /** How many pixels of the caption picture are not clear. */
  readonly count: number
  /** The box round them, as fractions of the picture: 0 to 1. */
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/** What is drawn on the picture that the captions are painted on: how much, and where. */
export async function captionPixels(page: Page): Promise<Pixels> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.captions')
    const context = canvas?.getContext('2d')
    if (!canvas || !context || canvas.width === 0) return { count: 0, left: 0, right: 0, top: 0, bottom: 0 }
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
    let count = 0
    let left = width
    let right = 0
    let top = height
    let bottom = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((data[(y * width + x) * 4 + 3] ?? 0) > 0) {
          count++
          left = Math.min(left, x)
          right = Math.max(right, x)
          top = Math.min(top, y)
          bottom = Math.max(bottom, y)
        }
      }
    }
    return { count, left: left / width, right: (right + 1) / width, top: top / height, bottom: (bottom + 1) / height }
  })
}

export const subs = (name: string): string => fileURLToPath(new URL(`../test-data/subs/${name}`, import.meta.url))

/** Moves the playhead by tapping the ruler. */
export async function seekTo(page: Page, ms: number): Promise<void> {
  await page.getByTestId('timeline').scrollIntoViewIfNeeded()
  const box = await page.getByTestId('timeline').boundingBox()
  if (!box) throw new Error('no timeline')
  const zoom = Number(await page.getByTestId('timeline').getAttribute('data-zoom'))
  const position = Number(await page.getByTestId('timeline').getAttribute('data-position'))
  await page.mouse.click(box.x + box.width / 2 + (ms - position) * zoom, box.y + 10)
  await expect.poll(async () => Math.abs(Number(await page.getByTestId('preview').getAttribute('data-position-ms')) - ms)).toBeLessThan(40)
}

export const audio = (name: string): string => fileURLToPath(new URL(`../test-data/audio/${name}`, import.meta.url))

/** How the preview is heard: through the Web Audio graph, or at the volume of the elements, as the page says. */
export async function soundMode(page: Page): Promise<'graph' | 'elements'> {
  return (await page.getByTestId('preview').getAttribute('data-sound')) === 'graph' ? 'graph' : 'elements'
}

/** The volume of the video that is shown, which is where its sound is set when the graph is not running. */
export async function shownVolume(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector<HTMLVideoElement>('[data-testid=preview] video[data-active=true]')?.volume ?? -1)
}

export interface Heard {
  /** The middle of how loud the sound was while it played, as root mean square, 0 to 1. Null when the graph was not running. */
  readonly level: number | null
  /** Where the playhead was at the end of the listening. */
  readonly atMs: number
}

/** Plays from the playhead and listens for a moment, then pauses. The first moments are left out, while the sound starts. */
export async function heard(page: Page, listenMs = 150): Promise<Heard> {
  const result = await page.evaluate(async (listen) => {
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
    const preview = document.querySelector<HTMLElement & { soundLevel?: () => number | null }>('[data-testid=preview]')
    const play = document.querySelector<HTMLButtonElement>('[data-testid=play]')
    if (!preview || !play) throw new Error('No player')
    play.click()
    const started = performance.now()
    while (preview.getAttribute('data-playing') !== 'true' && performance.now() - started < 4000) await sleep(10)
    await sleep(120)
    const levels: number[] = []
    const listening = performance.now()
    while (performance.now() - listening < listen) {
      const level = preview.soundLevel?.()
      if (typeof level === 'number') levels.push(level)
      await sleep(15)
    }
    const atMs = Number(preview.getAttribute('data-position-ms'))
    play.click()
    levels.sort((a, b) => a - b)
    return { level: levels.length > 0 ? (levels[Math.floor(levels.length / 2)] ?? null) : null, atMs }
  }, listenMs)
  await page.waitForFunction(() => document.querySelector('[data-testid=preview]')?.getAttribute('data-playing') === 'false')
  return result
}

/**
 * Loads the page again once everything that was done on it has been written to the browser's storage. A person's reload
 * never comes in the same breath as the edit before it, but a test's can, and would then lose the edit.
 */
export async function reloadSaved(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const main = document.querySelector('main[data-saving]')
    return main === null || main.getAttribute('data-saving') === 'false'
  })
  await reload(page)
}

export interface FileFacts {
  readonly format: string
  readonly duration: number
  readonly video: { codec: string | null; width: number; height: number; packets: number; rate: number; duration: number } | null
  readonly audio: { codec: string | null; rate: number; channels: number; packets: number; duration: number } | null
}

/** Reads an exported file back with a demuxer, without decoding it: its length, size, codecs, and how many frames it holds. */
export async function inspectFile(path: string): Promise<FileFacts> {
  const input = new Input({ source: new BufferSource(new Uint8Array(readFileSync(path))), formats: ALL_FORMATS })
  const video = await input.getPrimaryVideoTrack()
  const audio = await input.getPrimaryAudioTrack()
  const videoStats = video ? await video.computePacketStats() : null
  const audioStats = audio ? await audio.computePacketStats() : null
  return {
    format: (await input.getFormat()).name,
    duration: await input.computeDuration(),
    video: video && videoStats ? { codec: await video.getCodec(), width: await video.getCodedWidth(), height: await video.getCodedHeight(), packets: videoStats.packetCount, rate: videoStats.averagePacketRate, duration: await video.computeDuration() } : null,
    audio: audio && audioStats ? { codec: await audio.getCodec(), rate: await audio.getSampleRate(), channels: await audio.getNumberOfChannels(), packets: audioStats.packetCount, duration: await audio.computeDuration() } : null,
  }
}

export interface ExportChoices {
  readonly shape?: 'vertical' | 'wide' | 'square'
  readonly quality?: 'p720' | 'p1080'
  readonly framing?: 'fill' | 'fit'
  readonly fps?: 30 | 60
}

export interface Exported {
  readonly path: string
  readonly fileName: string
  /** The address of the finished file in the page, while the dialog is still open. */
  readonly href: string
}

/** Opens the export dialog, makes the choices, exports, and downloads the file, as a person would. The dialog stays open. */
export async function exportVideo(page: Page, choices: ExportChoices = {}): Promise<Exported> {
  await page.getByTestId('export').click()
  if (choices.shape) await page.getByTestId(`export-shape-${choices.shape}`).check()
  if (choices.quality) await page.getByTestId(`export-quality-${choices.quality}`).check()
  if (choices.framing) await page.getByTestId(`export-framing-${choices.framing}`).check()
  if (choices.fps) await page.getByTestId(`export-fps-${choices.fps}`).check()
  await page.getByTestId('export-start').click()
  const link = page.getByTestId('export-download')
  await expect(link).toBeVisible({ timeout: 90_000 })
  const href = (await link.getAttribute('href')) ?? ''
  const fileName = (await link.getAttribute('download')) ?? ''
  const download = page.waitForEvent('download')
  await link.click()
  const path = await (await download).path()
  return { path, fileName, href }
}

export interface PageRead {
  /** The brightness of the picture's corner at each time asked, 0 to 255, or -1 where the video had no frame. */
  readonly levels: number[]
  /** How much of the picture is within the box of each rectangle asked for that is bright, 0 to 1. */
  readonly bright: number[]
  /** The root mean square of the left channel over each stretch asked for, 0 to 1. */
  readonly sound: number[]
}

/**
 * Decodes the exported file in the page, as a viewer's browser would: a video element for the pictures and the browser's
 * own decoder for the sound. Where a decoder cannot read the file, the answers are -1.
 */
export async function readBack(
  page: Page,
  href: string,
  ask: { times?: number[]; boxes?: { time: number; x: number; y: number; width: number; height: number }[]; sound?: [number, number][] },
): Promise<PageRead> {
  return page.evaluate(
    async ({ href: address, times = [], boxes = [], sound = [] }) => {
      const video = document.createElement('video')
      video.muted = true
      video.preload = 'auto'
      video.src = address
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadeddata', () => resolve(), { once: true })
        video.addEventListener('error', () => reject(new Error('The exported video could not be decoded')), { once: true })
      })
      const seek = (time: number): Promise<void> =>
        new Promise((resolve) => {
          const done = (): void => {
            video.removeEventListener('seeked', done)
            resolve()
          }
          video.addEventListener('seeked', done)
          video.currentTime = time
          setTimeout(done, 3000)
        })
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('No canvas')
      const levels: number[] = []
      for (const time of times) {
        await seek(time)
        context.drawImage(video, 0, 0)
        const [r = 0, g = 0, b = 0] = context.getImageData(2, 2, 1, 1).data
        levels.push(0.2126 * r + 0.7152 * g + 0.0722 * b)
      }
      const bright: number[] = []
      for (const box of boxes) {
        await seek(box.time)
        context.drawImage(video, 0, 0)
        const data = context.getImageData(box.x, box.y, box.width, box.height).data
        let count = 0
        for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 0) > 200 && (data[i + 1] ?? 0) > 200 && (data[i + 2] ?? 0) > 200) count++
        bright.push(count / (data.length / 4))
      }
      const rms: number[] = []
      if (sound.length > 0) {
        const bytes = await (await fetch(address)).arrayBuffer()
        let decoded: AudioBuffer | null = null
        try {
          decoded = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(bytes)
        } catch {
          decoded = null
        }
        for (const [from, to] of sound) {
          if (!decoded) {
            rms.push(-1)
            continue
          }
          const data = decoded.getChannelData(0)
          const start = Math.floor(from * decoded.sampleRate)
          const end = Math.min(data.length, Math.floor(to * decoded.sampleRate))
          let sum = 0
          for (let i = start; i < end; i++) sum += (data[i] ?? 0) ** 2
          rms.push(end > start ? Math.sqrt(sum / (end - start)) : 0)
        }
      }
      return { levels, bright, sound: rms }
    },
    { href, ...ask },
  )
}

export interface Stub {
  readonly id: string
  readonly label: string
}

export interface MicrophoneOptions {
  /** Whether the names are known from the start, as after the browser has been allowed to use a microphone; else from the first time one is asked for. */
  readonly namesKnown?: boolean
  /** How loud each microphone is, as the amplitude of a tone from 0 to 1, by code. A microphone not listed has the sound of the made-up one of the browser. */
  readonly tones?: Readonly<Record<string, number>>
  /** The error to refuse every request for a microphone with, by its name. */
  readonly refuseWith?: string
}

/**
 * Gives the page the microphones in the list, in place of what the browser knows (the made-up microphones of the tests are one
 * or two), and notes what the page asks for. The sound is the made-up microphone's, unless a microphone has a tone, which is a
 * steady one of that amplitude, so that how loud it is is known. window.mics.open is the number of tracks of microphones that
 * were given out and have not been stopped.
 */
export async function withMicrophones(page: Page, microphones: Stub[], options: MicrophoneOptions = {}): Promise<void> {
  await page.addInitScript(
    ({ microphones, namesKnown, tones, refuseWith }) => {
      const state = { devices: microphones, namesKnown, asked: [] as string[], open: 0 }
      ;(window as unknown as { mics: typeof state }).mics = state
      const devices = navigator.mediaDevices
      const real = devices.getUserMedia.bind(devices)
      Object.defineProperty(devices, 'enumerateDevices', {
        configurable: true,
        value: async () => state.devices.map((d) => ({ deviceId: d.id, label: state.namesKnown ? d.label : '', kind: 'audioinput', groupId: d.id, toJSON: () => ({}) })),
      })
      Object.defineProperty(devices, 'getUserMedia', {
        configurable: true,
        value: async (constraints: MediaStreamConstraints) => {
          state.asked.push(JSON.stringify(constraints))
          if (refuseWith) throw new DOMException('Refused for the test', refuseWith)
          const audio = constraints.audio
          const exact = typeof audio === 'object' ? audio.deviceId : undefined
          const wanted = exact && typeof exact === 'object' && 'exact' in exact ? String(exact.exact) : null
          if (wanted !== null && !state.devices.some((d) => d.id === wanted)) throw new DOMException('That microphone is not there', 'OverconstrainedError')
          state.namesKnown = true
          const tone = tones[wanted ?? state.devices[0]?.id ?? '']
          let stream: MediaStream
          if (tone === undefined) {
            stream = await real({ audio: true })
          } else {
            const context = new AudioContext()
            const oscillator = context.createOscillator()
            const gain = context.createGain()
            const destination = context.createMediaStreamDestination()
            gain.gain.value = tone
            oscillator.connect(gain).connect(destination)
            oscillator.start()
            void context.resume()
            stream = destination.stream
          }
          for (const track of stream.getAudioTracks()) {
            state.open++
            const stop = track.stop.bind(track)
            let stopped = false
            track.stop = () => {
              if (!stopped) state.open--
              stopped = true
              stop()
            }
          }
          return stream
        },
      })
    },
    { microphones, namesKnown: options.namesKnown ?? true, tones: options.tones ?? {}, refuseWith: options.refuseWith ?? '' },
  )
}

export const asked = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { mics: { asked: string[] } }).mics.asked)

/** How many tracks of microphones that were given out are still running. */
export const openMicrophones = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { mics: { open: number } }).mics.open)

export const unplug = (page: Page, id: string): Promise<void> =>
  page.evaluate((gone) => {
    const state = (window as unknown as { mics: { devices: { id: string }[] } }).mics
    state.devices = state.devices.filter((d) => d.id !== gone)
  }, id)

/** Why a test does not run in the WebKit of these tests, which is a build of Safari's engine for Linux with less in it than Safari has. */
export const WEBKIT_CANNOT = {
  encode: 'The WebKit of these tests crashes the page when asked about a video encoder, so it cannot export',
  record: 'The WebKit of these tests has no MediaRecorder, so it cannot record a voiceover or list microphones',
  offline: 'The WebKit of these tests fails to reload a page offline when a service worker answers it',
  hear: 'The WebKit of these tests gives no sound from the WebM of a video element, so there is nothing to measure',
  graphPlace: 'In the WebKit of these tests an audio element that is connected to the Web Audio graph reports a place more than a second ahead of the one it was sent to, so how it keeps step with the picture is measured there without the graph',
  largeFiles: 'The WebKit of these tests keeps files in the database, and the copy of a file of that size is not what a visitor has',
  split: 'The WebKit of these tests decodes behind its clock, so after playing across a cut it cannot be asked for an exact frame',
} as const
