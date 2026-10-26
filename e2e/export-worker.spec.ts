import { expect, type Page, test } from '@playwright/test'
import { clearHistory, exportVideo, inspectFile, levelAt, media, nearLevel, pick, positionMs, readBack, setClips, WEBKIT_CANNOT } from './helpers'

test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_CANNOT.encode)

test.describe.configure({ timeout: 90_000 })

const clips = (page: Page) => page.locator('.timeline .clip')

/** The steady tone of landscape.webm is 0.3 at its peak, which is 0.212 as root mean square. */
const LANDSCAPE_RMS = 0.3 / Math.SQRT2

async function openTwo(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('landscape.webm'), media('silent.webm')])
  await expect(clips(page)).toHaveCount(2)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(2)
  await expect.poll(() => positionMs(page)).toBe(0)
}

/** A project of landscape.webm, cut into fourteen clips of two seconds: an export long enough to be stopped part way. */
async function openLong(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, media('landscape.webm'))
  await expect(clips(page)).toHaveCount(1)
  await expect(page.locator('main[data-saving=false]')).toBeVisible()
  await setClips(page, Array.from({ length: 14 }, () => [0, 2000] as [number, number]))
  await expect(clips(page)).toHaveCount(14)
}

/** The files left in the site's private file system for exports that were not handed over. */
async function leftovers(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const names: string[] = []
    try {
      const folder = await root.getDirectoryHandle('exports')
      for await (const [name] of (folder as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) names.push(name)
    } catch {
      // No folder, no files.
    }
    return names
  })
}

/** Checks the finished file of openTwo's export: its length, every frame, its sound, and what the frames and the sound are. */
async function expectTheExportOfTwo(page: Page, exported: Awaited<ReturnType<typeof exportVideo>>): Promise<void> {
  const facts = await inspectFile(exported.path)
  expect(facts.video).toMatchObject({ width: 1280, height: 720 })
  // Two seconds and one second at 25 frames: every frame, none repeated or lost.
  expect(facts.video?.packets).toBe(75)
  expect(facts.duration).toBeGreaterThan(2.95)
  expect(facts.duration).toBeLessThan(3.06)
  expect(facts.audio).toMatchObject({ rate: 48_000, channels: 2 })
  const read = await readBack(page, exported.href, { times: [0.3, 1.7], sound: [[0.2, 1.8], [2.2, 2.9]] })
  expect(nearLevel(read.levels[0] ?? -1, levelAt(300, 2000), 14)).toBe(true)
  expect(nearLevel(read.levels[1] ?? -1, levelAt(1700, 2000), 14)).toBe(true)
  expect(read.sound[0]).toBeGreaterThan(LANDSCAPE_RMS * 0.8)
  expect(read.sound[0]).toBeLessThan(LANDSCAPE_RMS * 1.2)
  expect(read.sound[1]).toBeLessThan(0.01)
}

test.describe('the export in a worker', () => {
  test('is made away from the page, and the file is as it should be', async ({ page }) => {
    await openTwo(page)
    const exported = await exportVideo(page)
    await expect(page.getByTestId('export-done')).toHaveAttribute('data-mode', 'worker')
    await expectTheExportOfTwo(page, exported)
  })

  test('says that it is made in a worker while it runs', async ({ page }) => {
    await openLong(page)
    await page.getByTestId('export').click()
    await page.getByTestId('export-start').click()
    await expect(page.getByTestId('export-running')).toHaveAttribute('data-mode', 'worker')
    await page.getByTestId('export-cancel').click()
    await expect(page.getByTestId('export-start')).toBeVisible()
  })

  test('leaves nothing in the browser’s storage once the dialog is closed', async ({ page }) => {
    await openTwo(page)
    await exportVideo(page)
    await expect.poll(() => leftovers(page)).toHaveLength(1)
    await page.getByTestId('export-close').click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect.poll(() => leftovers(page)).toEqual([])
  })

  test('is stopped by Cancel the instant it begins, every time, and leaves nothing', async ({ page }) => {
    await openLong(page)
    // A cancel that comes while the export is still getting ready arrives before anything is listening for it: it has to be
    // looked for. Tried a number of times, as how long the worker takes to begin is not the same each time.
    for (let round = 0; round < 6; round++) {
      await page.getByTestId('export').click()
      await page.getByTestId('export-start').click()
      await expect(page.getByTestId('export-progress')).toBeVisible()
      await page.getByTestId('export-cancel').click()
      await expect(page.getByTestId('export-start'), `round ${round}`).toBeVisible()
      await page.getByTestId('export-cancel').click()
      await expect(page.getByRole('dialog')).toBeHidden()
    }
    await expect.poll(() => leftovers(page)).toEqual([])
  })
})

test.describe('the export in the page, where a worker cannot be used', () => {
  test('is made when the browser has no OffscreenCanvas, and the file is the same as the worker makes', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas
    })
    await openTwo(page)
    const exported = await exportVideo(page)
    await expect(page.getByTestId('export-done')).toHaveAttribute('data-mode', 'main')
    await expectTheExportOfTwo(page, exported)
  })

  test('is stopped by Cancel while the files are still being read, which comes before anything listens for it', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas
    })
    await openLong(page)
    // Every read of a file takes most of a second, so that Cancel is certain to come while the export is getting ready.
    await page.evaluate(() => {
      const handle = FileSystemFileHandle.prototype
      const getFile = handle.getFile
      handle.getFile = async function (this: FileSystemFileHandle) {
        await new Promise((resolve) => setTimeout(resolve, 700))
        return getFile.call(this)
      }
    })
    await page.getByTestId('export').click()
    await page.getByTestId('export-start').click()
    await expect(page.getByTestId('export-progress')).toBeVisible()
    await page.getByTestId('export-cancel').click()
    await expect(page.getByTestId('export-start')).toBeVisible()
    await expect.poll(() => leftovers(page)).toEqual([])
    await expect(page.getByTestId('export-download')).toHaveCount(0)
  })
})

test.describe('the export when the worker cannot start', () => {
  // With the site's own service worker out of the way, the request for the export worker's script can be refused.
  test.use({ serviceWorkers: 'block' })

  test('goes on in the page, and the file is the same', async ({ page }) => {
    await page.route('**/assets/export-worker-*.js', (route) => route.abort())
    await openTwo(page)
    const exported = await exportVideo(page)
    await expect(page.getByTestId('export-done')).toHaveAttribute('data-mode', 'main')
    await expectTheExportOfTwo(page, exported)
  })
})
