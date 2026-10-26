import { expect, type Page, test } from '@playwright/test'
import { audio, media, pick } from './helpers'

/**
 * A laptop's browser often leaves 600 to 650 pixels of height. A dialog is never taller than the window: it is laid out closer,
 * so that it fits whole in 650 pixels, and where it does not, it scrolls with its buttons kept in sight.
 */
const dialog = (page: Page) => page.locator('dialog[open]')

async function openTwo(page: Page, height: number): Promise<void> {
  await page.setViewportSize({ width: 1366, height })
  await page.goto('/')
  await pick(page, [media('landscape.webm'), media('silent.webm')])
  await expect(page.locator('.timeline .clip')).toHaveCount(2)
}

/** The dialog is inside the window, and the button that finishes it can be pressed without scrolling anything. */
async function expectWithinWindow(page: Page, height: number, button: string): Promise<void> {
  await expect(page.getByTestId(button)).toBeInViewport({ ratio: 1 })
  const box = await dialog(page).boundingBox()
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0)
  expect((box?.y ?? 0) + (box?.height ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(height)
}

const scrolls = (page: Page): Promise<boolean> => dialog(page).evaluate((element) => element.scrollHeight > element.clientHeight)

for (const height of [600, 650]) {
  test.describe(`in a window ${height} pixels high`, () => {
    test('the dialog of a title is in the window with its Save in sight, and its last choice can be reached', async ({ page }) => {
      await openTwo(page, height)
      await page.getByTestId('add-text').click()
      await expectWithinWindow(page, height, 'text-save')
      await page.getByTestId('text-field').fill('On a small screen')
      await page.getByTestId('text-size-large').check()
      await expect(page.getByTestId('text-size-large')).toBeChecked()
      await expectWithinWindow(page, height, 'text-save')
      await page.getByTestId('text-save').click()
      await expect(page.locator('.timeline .cue')).toHaveCount(1)
      // Opened again from its bar, with the choice that was made.
      await page.locator('.timeline .cue').first().click()
      await expectWithinWindow(page, height, 'text-save')
      await expect(page.getByTestId('text-size-large')).toBeChecked()
      if (height >= 650) expect(await scrolls(page)).toBe(false)
    })

    test('the dialog of a piece of music, and the others, are in the window with their buttons in sight', async ({ page }) => {
      await openTwo(page, height)
      const chooser = page.waitForEvent('filechooser')
      await page.getByTestId('add-music').click()
      await (await chooser).setFiles(audio('tone.wav'))
      await page.locator('.timeline .audio-bar').first().click()
      await expectWithinWindow(page, height, 'audio-save')
      if (height >= 650) expect(await scrolls(page)).toBe(false)
      await page.keyboard.press('Escape')
      await page.locator('.timeline .clip').first().click()
      await page.getByTestId('volume').click()
      await expectWithinWindow(page, height, 'clip-volume-save')
      await page.keyboard.press('Escape')
      await page.getByTestId('export').click()
      await expectWithinWindow(page, height, 'export-start')
      expect(await scrolls(page)).toBe(false)
    })
  })
}

test('a window that is tall enough shows the dialog as it was, without a scroll bar', async ({ page }) => {
  await openTwo(page, 900)
  await page.getByTestId('add-text').click()
  expect(await scrolls(page)).toBe(false)
  const box = await dialog(page).boundingBox()
  // The room that the title dialog has always taken when there is plenty: not the cramped layout of a short window.
  expect(box?.height ?? 0).toBeGreaterThan(690)
})
