import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { media, pick, storedFacts, storedPaths, WEBKIT_CANNOT } from './helpers'

/**
 * A recording of a few hundred megabytes: the video is a small one with a long tail of padding after its last element, which a
 * player skips, so the file is as big as a long phone video is on disk and the import has to copy it as one does.
 */
const PADDING_BYTES = 300 * 1024 * 1024

test.describe('a large recording', () => {
  test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_CANNOT.largeFiles)
  test.describe.configure({ timeout: 180_000 })
  const folder = mkdtempSync(join(tmpdir(), 'large-'))
  const path = join(folder, 'long-holiday.webm')
  test.beforeAll(() => {
    const video = readFileSync(media('landscape.webm'))
    const file = Buffer.alloc(video.length + PADDING_BYTES)
    video.copy(file)
    writeFileSync(path, file)
  })
  test.afterAll(() => rmSync(folder, { recursive: true, force: true }))

  test('is copied into the browser whole, with progress shown, and the page stays alive while it is', async ({ page }) => {
    await page.goto('/')
    // The page's own frames keep being drawn while the copy goes on, as it is made in a worker.
    await page.evaluate(() => {
      const beat = { frames: 0, longest: 0, last: performance.now() }
      ;(window as unknown as { beat: typeof beat }).beat = beat
      const tick = (now: number): void => {
        beat.frames++
        beat.longest = Math.max(beat.longest, now - beat.last)
        beat.last = now
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await pick(page, path)
    await expect(page.locator('.timeline .clip')).toHaveCount(1, { timeout: 150_000 })
    // Read the beat before the stored file is checked: that check hashes all of it in the page, which stops the page by itself.
    const beat = await page.evaluate(() => (window as unknown as { beat: { frames: number; longest: number } }).beat)
    expect(beat.frames).toBeGreaterThan(20)
    // No stop of the page for as long as a second while a third of a gigabyte was being copied.
    expect(beat.longest).toBeLessThan(1_000)
    const copy = (await storedPaths(page)).find((name) => /\/media\/[0-9a-f]+\.webm$/.test(name))
    expect(copy, 'a copy of the recording is kept').toBeDefined()
    expect((await storedFacts(page, copy ?? '')).size).toBe(statSync(path).size)
  })
})
