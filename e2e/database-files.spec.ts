import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { exportVideo, inspectFile, media, pick, reloadSaved, shownFrame, storedFacts, storedPaths, storedRecords } from './helpers'

/**
 * A browser with no private file system for the site, as a Firefox private window is and as the WebKit of these tests is, keeps
 * the videos in the database instead. Where the browser has one, it is taken away from the page, so that the same is seen in
 * every browser.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator.storage, 'getDirectory', { value: undefined, configurable: true })
    } catch {
      // There is no storage manager to take it from: there is no private file system.
    }
  })
})

const clips = (page: Page) => page.locator('.timeline .clip')
const copyIn = (paths: string[]): string | undefined => paths.find((path) => /^p[0-9a-f]+\/media\/[0-9a-f]+\.webm$/.test(path))

test.describe('without a private file system', () => {
  test('opens the site, and keeps the video in the database, byte for byte', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('No projects yet')).toBeVisible()
    expect(await page.evaluate(() => typeof navigator.storage?.getDirectory)).toBe('undefined')
    await pick(page, media('landscape.webm'))
    await expect(page.getByRole('heading', { level: 1 })).toContainText('landscape')
    const paths = await storedPaths(page)
    const copy = copyIn(paths)
    expect(copy, paths.join(', ')).toBeDefined()
    const facts = await storedFacts(page, copy ?? '')
    expect(facts.size).toBe(readFileSync(media('landscape.webm')).length)
    expect(facts.sha256).toBe(createHash('sha256').update(readFileSync(media('landscape.webm'))).digest('hex'))
  })

  test('plays the video from there, and still does after a reload', async ({ page }) => {
    await page.goto('/')
    await pick(page, media('landscape.webm'))
    await expect(clips(page)).toHaveCount(1)
    await expect.poll(async () => (await shownFrame(page)).ready, { timeout: 15_000 }).toBe(true)
    expect((await shownFrame(page)).videoWidth).toBe(320)
    await reloadSaved(page)
    await expect(clips(page)).toHaveCount(1)
    await expect.poll(async () => (await shownFrame(page)).ready, { timeout: 15_000 }).toBe(true)
    expect((await shownFrame(page)).videoWidth).toBe(320)
  })

  test('takes the files away with the project', async ({ page }) => {
    await page.goto('/')
    await pick(page, media('landscape.webm'))
    await expect(page.getByRole('heading', { level: 1 })).toContainText('landscape')
    expect((await storedPaths(page)).length).toBeGreaterThan(0)
    await page.getByRole('link', { name: /Projects/ }).click()
    await page.getByRole('button', { name: /Delete/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('No projects yet')).toBeVisible()
    expect(await storedPaths(page)).toEqual([])
    expect(await storedRecords(page)).toEqual([])
  })

  test('exports the project, reading the video from the database in the worker', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'The WebKit of these tests crashes when asked about a video encoder, so it cannot export')
    test.setTimeout(90_000)
    await page.goto('/')
    await pick(page, media('landscape.webm'))
    await expect(clips(page)).toHaveCount(1)
    const exported = await exportVideo(page)
    await expect(page.getByTestId('export-done')).toHaveAttribute('data-mode', 'worker')
    const facts = await inspectFile(exported.path)
    expect(facts.video).toMatchObject({ width: 1280, height: 720, packets: 50 })
    expect(facts.audio).toMatchObject({ rate: 48_000 })
  })
})
