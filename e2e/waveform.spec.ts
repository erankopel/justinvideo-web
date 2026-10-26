import { expect, type Page, test } from '@playwright/test'
import { audio, clearHistory, media, pick, positionMs, reloadSaved, seekTo, WEBKIT_CANNOT } from './helpers'

const clips = (page: Page) => page.locator('.timeline .clip')
const bars = (page: Page) => page.locator('.timeline .audio-bar')

/** Three seconds with no sound of their own, so that only what is laid under them is on the timeline's sound row. */
async function openSilent(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('silent.webm'), media('silent.webm'), media('silent.webm')])
  await expect(clips(page)).toHaveCount(3)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(3)
  await expect.poll(() => positionMs(page)).toBe(0)
}

async function addMusic(page: Page, file = audio('steps.wav')): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('add-music').click()
  await (await chooser).setFiles(file)
}

/** How tall each painted column of a piece's waveform is, in pixels, from the pixels of its canvas. */
async function waveHeights(page: Page, index = 0): Promise<number[]> {
  return page.evaluate((i) => {
    const canvas = document.querySelectorAll<HTMLCanvasElement>('.timeline .audio-bar canvas.wave')[i]
    const context = canvas?.getContext('2d')
    if (!canvas || !context || canvas.width === 0) return []
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
    const heights: number[] = []
    let previous = 0
    for (let x = 0; x < width; x++) {
      let painted = 0
      for (let y = 0; y < height; y++) if ((data[(y * width + x) * 4 + 3] ?? 0) > 0) painted++
      // A column is two pixels wide with a gap after it: it is counted at its first pixel.
      if (painted > 0 && previous === 0) heights.push(painted)
      previous = painted
    }
    return heights
  }, index)
}

/** Waits until the waveform of a piece is drawn, and returns its columns. */
async function drawn(page: Page, index = 0): Promise<number[]> {
  await expect.poll(async () => (await waveHeights(page, index)).length).toBeGreaterThan(30)
  return waveHeights(page, index)
}

/** The middle height of the columns between two fractions of the way along a piece. */
function between(heights: readonly number[], from: number, to: number): number {
  const part = heights.slice(Math.round(heights.length * from), Math.round(heights.length * to)).sort((a, b) => a - b)
  return part[Math.floor(part.length / 2)] ?? -1
}

const near = (actual: number, expected: number, tolerance = 1.5): void => {
  expect(Math.abs(actual - expected), `${actual} should be within ${tolerance} of ${expected}`).toBeLessThanOrEqual(tolerance)
}

// The canvas is 24 pixels high, and a column of full scale is 22 of them. The test sound is 0.2 for a second, 0.8 for
// a second, then silence, which are columns of about 4, 18 and 1 pixels.
const QUIET = 4.4
const LOUD = 17.6

test.describe('the waveform of a piece of music', () => {
  test('shows how loud the sound is along its length', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await expect(bars(page)).toHaveCount(1)
    const heights = await drawn(page)
    // Each third of the piece is a second of the sound, so the middle of each is clear of the changes.
    near(between(heights, 0.1, 0.23), QUIET)
    near(between(heights, 0.43, 0.56), LOUD)
    near(between(heights, 0.76, 0.9), 1, 0.5)
    // The name is still there to read.
    await expect(bars(page).first().locator('[dir=auto]')).toHaveText('steps.wav')
  })

  test('follows the volume of the piece, and stops at full scale', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await drawn(page)
    await bars(page).first().click()
    await page.getByTestId('audio-volume-preset-50').click()
    await page.getByTestId('audio-save').click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect.poll(async () => between(await waveHeights(page), 0.43, 0.56)).toBeLessThan(LOUD - 4)
    let heights = await waveHeights(page)
    near(between(heights, 0.43, 0.56), LOUD / 2)
    near(between(heights, 0.1, 0.23), QUIET / 2)

    await bars(page).first().click()
    await page.getByTestId('audio-volume-preset-150').click()
    await page.getByTestId('audio-save').click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect.poll(async () => between(await waveHeights(page), 0.43, 0.56)).toBeGreaterThan(LOUD)
    heights = await waveHeights(page)
    // 0.8 times 1.5 is past full scale: the column is as tall as the canvas allows.
    near(between(heights, 0.43, 0.56), 22)
    near(between(heights, 0.1, 0.23), QUIET * 1.5)
  })

  test('starts where the piece starts in its file, and follows its fade in', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await drawn(page)
    await bars(page).first().click()
    // A piece as long as its file has nothing to skip, so it is made a second shorter first; then the first second of the
    // sound, the quiet one, is skipped, and the piece fades in over a second.
    await page.getByTestId('audio-shorter').click()
    await page.getByTestId('audio-shorter').click()
    await page.getByTestId('audio-skip-more').click()
    await page.getByTestId('audio-skip-more').click()
    await expect(page.getByTestId('audio-lasts')).toContainText('2.0')
    await expect(page.getByTestId('audio-skips')).toContainText('1.0')
    await page.getByTestId('audio-fadein-longer').click()
    await page.getByTestId('audio-fadein-longer').click()
    await page.getByTestId('audio-save').click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect.poll(async () => between(await waveHeights(page), 0.02, 0.06)).toBeLessThan(6)
    const heights = await waveHeights(page)
    // The piece is the last two seconds of the sound now: the loud one, then silence. Its first half-second rises.
    const count = heights.length
    expect(heights[0] ?? 99).toBeLessThanOrEqual(2)
    const rising = heights.slice(0, Math.round(count * 0.5))
    expect(rising.length).toBeGreaterThan(20)
    for (let i = 5; i < rising.length; i++) expect(rising[i] ?? 0).toBeGreaterThanOrEqual((rising[i - 5] ?? 0) - 1)
    near(between(heights, 0.3, 0.45), LOUD * 0.75, 3)
    near(between(heights, 0.8, 0.95), 1, 0.5)
  })

  test('is drawn again when the project is opened again', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await drawn(page)
    await reloadSaved(page)
    await expect(bars(page)).toHaveCount(1)
    const heights = await drawn(page)
    near(between(heights, 0.43, 0.56), LOUD)
  })

  test('is there for a recorded voiceover as well', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', WEBKIT_CANNOT.record)
    await openSilent(page)
    await seekTo(page, 2_200)
    await page.getByTestId('record').click()
    await expect(page.getByTestId('recording')).toBeVisible()
    await expect(bars(page)).toHaveCount(1, { timeout: 8_000 })
    await expect(bars(page).first()).toHaveClass(/voiceover/)
    const heights = await drawn(page)
    expect(heights.length).toBeGreaterThan(30)
  })

  test('is not in the way of deleting: the page is not taken down when a project is deleted while its sound is being read', async ({ page, browserName }) => {
    // As for the pictures: tried many times, in the browsers that could take the page down.
    test.skip(browserName === 'chromium', 'Only the other browsers took the page down')
    test.setTimeout(180_000)
    let crashes = 0
    page.on('crash', () => crashes++)
    await page.goto('/')
    for (let i = 0; i < 12; i++) {
      await pick(page, media('landscape.webm'))
      await expect(clips(page)).toHaveCount(1)
      await addMusic(page)
      await expect(bars(page)).toHaveCount(1)
      await page.getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
      await expect(page).toHaveURL(/#\/$/)
      await expect(page.getByText('No projects yet')).toBeVisible()
    }
    expect(crashes).toBe(0)
  })

  test('does not get in the way: the piece can still be tapped, and the picture goes on playing', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await drawn(page)
    await bars(page).first().click()
    await expect(page.getByRole('dialog')).toContainText('Edit music')
    await page.getByTestId('audio-cancel').click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Space')
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'true')
    await expect.poll(() => positionMs(page)).toBeGreaterThan(300)
  })
})
