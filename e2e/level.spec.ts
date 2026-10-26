import { expect, type Page, test } from '@playwright/test'
import { clearHistory, media, openMicrophones, pick, positionMs, withMicrophones, WEBKIT_CANNOT } from './helpers'

test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_CANNOT.record)

const clips = (page: Page) => page.locator('.timeline .clip')
const bars = (page: Page) => page.locator('.timeline .audio-bar')

/** Three microphones that are steady tones of known loudness: a sine of amplitude 0.5 is 9 dB under full scale, one of 0.01 is 43 dB under. */
const TONES = { 'mic-loud': 0.5, 'mic-quiet': 0.01, 'mic-silent': 0 }
/** Tones come from the audio engine, which only Chromium runs where there is no sound device: elsewhere the microphones give the made-up sound of the browser. */
const tonesFor = (browserName: string): typeof TONES | Record<string, never> => (browserName === 'chromium' ? TONES : {})
const THREE = [
  { id: 'mic-loud', label: 'Loud one' },
  { id: 'mic-quiet', label: 'Quiet one' },
  { id: 'mic-silent', label: 'Silent one' },
]

/** Three seconds with no sound of their own. */
async function openSilent(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('silent.webm'), media('silent.webm'), media('silent.webm')])
  await expect(clips(page)).toHaveCount(3)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(3)
  await expect.poll(() => positionMs(page)).toBe(0)
}

const level = async (page: Page, testId: string): Promise<number> => Number(await page.getByTestId(testId).getAttribute('data-level'))

/**
 * Waits until the bar holds between two levels for a third of a second. One reading is not enough: after another microphone
 * is chosen the bar is still falling from the last one, and reads nothing for a moment while the new one is opened, and a
 * fall crosses any range in less time than this takes.
 */
async function holdsBetween(page: Page, testId: string, min: number, max: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const readings: number[] = []
        for (let i = 0; i < 4; i++) {
          readings.push(await level(page, testId))
          await page.waitForTimeout(100)
        }
        return readings.every((reading) => reading >= min && reading <= max)
      },
      { timeout: 10_000 },
    )
    .toBe(true)
}

/** Opens the dialog and starts the test on the nth microphone. */
async function startTest(page: Page, index: number): Promise<void> {
  await page.getByTestId('microphone').click()
  await page.getByTestId(`microphone-${index}`).check()
  await page.getByTestId('microphone-test').click()
  await expect(page.getByTestId('microphone-level')).toBeVisible()
}

test.describe('the level of the microphone', () => {
  test('is not measured until the test is asked for: opening the list does not open the microphone', async ({ page, browserName }) => {
    await withMicrophones(page, THREE, { tones: tonesFor(browserName) })
    await openSilent(page)
    await page.getByTestId('microphone').click()
    await expect(page.getByTestId('microphone-0')).toBeVisible()
    await expect(page.getByTestId('microphone-test')).toHaveText('Test the microphone')
    await expect(page.getByTestId('microphone-level')).toHaveCount(0)
    expect(await openMicrophones(page)).toBe(0)
  })

  test('never stays waiting: it shows a level, or says that this browser cannot', async ({ page, browserName }) => {
    await withMicrophones(page, THREE, { tones: tonesFor(browserName) })
    await openSilent(page)
    await startTest(page, 0)
    const meter = page.getByTestId('microphone-level')
    await expect(meter).not.toHaveAttribute('data-state', 'waiting', { timeout: 10_000 })
    const state = await meter.getAttribute('data-state')
    expect(['measuring', 'unavailable']).toContain(state)
    // Where it cannot measure, the note is there, and the bar is empty, not frozen at some level.
    if (state === 'unavailable') {
      await expect(page.getByTestId('microphone-level-unavailable')).toBeVisible()
      expect(await level(page, 'microphone-level')).toBe(0)
    } else {
      await expect(page.getByTestId('microphone-level-unavailable')).toHaveCount(0)
    }
  })

  test('shows how loud the chosen microphone is, and follows the choice while it runs', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Only Chromium runs the audio engine here, without a sound device')
    await withMicrophones(page, THREE, { tones: tonesFor(browserName) })
    await openSilent(page)
    await startTest(page, 0)
    const meter = page.getByTestId('microphone-level')
    await expect(meter).toHaveAttribute('data-state', 'measuring')
    // 9 dB under full scale is 85 on the scale that starts at 60 dB under.
    await holdsBetween(page, 'microphone-level', 75, 95)
    await expect(meter).toHaveAttribute('aria-valuenow', /^\d+$/)

    await page.getByTestId('microphone-1').check()
    // 43 dB under full scale is 28.
    await holdsBetween(page, 'microphone-level', 15, 40)

    // A microphone that makes no sound reads nothing, and is measured all the same: this is not the unavailable state.
    await page.getByTestId('microphone-2').check()
    await holdsBetween(page, 'microphone-level', 0, 0)
    await expect(meter).toHaveAttribute('data-state', 'measuring')
    await expect(page.getByTestId('microphone-level-unavailable')).toHaveCount(0)
  })

  test('lets go of the microphone when the test is stopped, when the choice moves on, and when the dialog is left', async ({ page, browserName }) => {
    await withMicrophones(page, THREE, { tones: tonesFor(browserName) })
    await openSilent(page)
    await startTest(page, 0)
    await expect.poll(() => openMicrophones(page)).toBe(1)
    // Choosing another microphone is one open, one closed: never two.
    await page.getByTestId('microphone-1').check()
    await expect.poll(() => openMicrophones(page)).toBe(1)
    await page.getByTestId('microphone-test').click()
    await expect(page.getByTestId('microphone-test')).toHaveText('Test the microphone')
    await expect(page.getByTestId('microphone-level')).toHaveCount(0)
    await expect.poll(() => openMicrophones(page)).toBe(0)

    await page.getByTestId('microphone-test').click()
    await expect(page.getByTestId('microphone-level')).toBeVisible()
    await expect.poll(() => openMicrophones(page)).toBe(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect.poll(() => openMicrophones(page)).toBe(0)
  })

  test('is not kept by the test: saving a choice made while testing keeps the choice and nothing else', async ({ page, browserName }) => {
    await withMicrophones(page, THREE, { tones: tonesFor(browserName) })
    await openSilent(page)
    await startTest(page, 1)
    await page.getByTestId('microphone-save').click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect.poll(() => openMicrophones(page)).toBe(0)
    await expect(bars(page)).toHaveCount(0)
    await page.getByTestId('microphone').click()
    await expect(page.getByTestId('microphone-1')).toBeChecked()
    await expect(page.getByTestId('microphone-level')).toHaveCount(0)
  })

  test('says so when the microphone is refused, and the test ends', async ({ page, browserName }) => {
    await withMicrophones(page, THREE, { tones: tonesFor(browserName), refuseWith: 'NotAllowedError' })
    await openSilent(page)
    await page.getByTestId('microphone').click()
    await page.getByTestId('microphone-test').click()
    await expect(page.getByRole('alert')).toContainText('allow this site to use the microphone')
    await expect(page.getByTestId('microphone-test')).toHaveText('Test the microphone')
    await expect(page.getByTestId('microphone-level')).toHaveCount(0)
  })

  test('says so when the microphone cannot be used, and the test ends', async ({ page, browserName }) => {
    await withMicrophones(page, THREE, { tones: tonesFor(browserName), refuseWith: 'NotReadableError' })
    await openSilent(page)
    await page.getByTestId('microphone').click()
    await page.getByTestId('microphone-test').click()
    await expect(page.getByRole('alert')).toContainText('could not be used')
    await expect(page.getByTestId('microphone-level')).toHaveCount(0)
  })

  test('is shown while recording, with the time, and goes when the voiceover is laid down', async ({ page, browserName }) => {
    await withMicrophones(page, THREE, { tones: tonesFor(browserName) })
    await openSilent(page)
    // From the start, so that the recording runs three seconds: longer than the audio engine is given to start.
    await page.getByTestId('record').click()
    await expect(page.getByTestId('recording')).toBeVisible()
    const meter = page.getByTestId('recording-level')
    await expect(meter).toBeVisible()
    await expect(meter).not.toHaveAttribute('data-state', 'waiting', { timeout: 10_000 })
    if (browserName === 'chromium') {
      await expect(meter).toHaveAttribute('data-state', 'measuring')
      await holdsBetween(page, 'recording-level', 75, 95)
    } else {
      expect(['measuring', 'unavailable']).toContain(await meter.getAttribute('data-state'))
    }
    // Recording goes on the same, whether or not there is a level to show.
    await expect(bars(page)).toHaveCount(1, { timeout: 15_000 })
    await expect(page.getByTestId('recording-level')).toHaveCount(0)
    await expect.poll(() => openMicrophones(page)).toBe(0)
  })
})
