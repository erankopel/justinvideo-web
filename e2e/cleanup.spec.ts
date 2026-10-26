import { expect, type Page, test } from '@playwright/test'
import { audio, clearHistory, media, pick, reloadSaved, storedFacts, storedPaths } from './helpers'

const clips = (page: Page) => page.locator('.timeline .clip')
const bars = (page: Page) => page.locator('.timeline .audio-bar')
const sounds = async (page: Page): Promise<string[]> => (await storedPaths(page)).filter((path) => path.endsWith('.wav'))

async function addMusic(page: Page): Promise<void> {
  const before = await bars(page).count()
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('add-music').click()
  await (await chooser).setFiles(audio('tone.wav'))
  await expect(bars(page)).toHaveCount(before + 1)
}

async function removeMusic(page: Page, index: number): Promise<void> {
  const before = await bars(page).count()
  await bars(page).nth(index).click()
  await page.getByTestId('audio-delete').click()
  await expect(bars(page)).toHaveCount(before - 1)
}

/** Opens the project again as it will be some time from now, when what was written a moment ago is no longer recent. */
async function later(page: Page): Promise<void> {
  await page.clock.setFixedTime(Date.now() + 30 * 60_000)
  await reloadSaved(page)
  await expect(clips(page)).toHaveCount(1)
}

async function openOne(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, media('landscape.webm'))
  await expect(clips(page)).toHaveCount(1)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(1)
}

test.describe('files that nothing can bring back', () => {
  test('are taken away when the project is opened, and what is in use stays', async ({ page }) => {
    await openOne(page)
    await addMusic(page)
    await addMusic(page)
    await removeMusic(page, 0)
    await expect.poll(async () => (await sounds(page)).length).toBe(2)
    // No history: nothing can bring the removed piece back.
    await clearHistory(page)
    await expect(bars(page)).toHaveCount(1)
    // A moment later it is recent, and left alone.
    expect(await sounds(page)).toHaveLength(2)
    await later(page)
    await expect.poll(async () => (await sounds(page)).length).toBe(1)
    // The piece that is in use still has its file, and the video is untouched.
    await expect(bars(page)).toHaveCount(1)
    expect((await storedPaths(page)).filter((path) => path.endsWith('.webm'))).toHaveLength(1)
    await bars(page).first().click()
    await expect(page.getByTestId('audio-name')).toContainText('tone.wav')
    await page.getByTestId('audio-cancel').click()
  })

  test('are kept while Undo can bring them back, and the sound plays when it does', async ({ page }, info) => {
    await openOne(page)
    await addMusic(page)
    await removeMusic(page, 0)
    await later(page)
    expect(await sounds(page)).toHaveLength(1)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(bars(page)).toHaveCount(1)
    await page.getByTestId('play').click()
    await page.waitForTimeout(500)
    await page.getByTestId('play').click()
    // A browser with no sound device, as the one that runs these tests in Firefox, cannot play an audio element at all.
    if (info.project.name !== 'firefox') await expect(page.getByTestId('notice')).toHaveText('')
    const sound = (await sounds(page))[0]
    expect(sound).toBeDefined()
    const size = (await storedFacts(page, sound ?? '')).size
    expect(size).toBeGreaterThan(200_000)
  })
})
