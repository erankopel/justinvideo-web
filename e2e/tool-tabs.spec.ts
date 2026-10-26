import { expect, type Page, test } from '@playwright/test'
import { media, pick, positionMs } from './helpers'

/** The tabs of the tools, on a screen narrow enough to show them, follow the pattern of a tab list for the keyboard and for screen readers. */
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
})

const selected = (page: Page): Promise<string[]> =>
  page.locator('[role=tab]').evaluateAll((tabs) => tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').map((tab) => tab.getAttribute('data-testid') ?? ''))
const reachable = (page: Page): Promise<string[]> =>
  page.locator('[role=tab]').evaluateAll((tabs) => tabs.filter((tab) => (tab as HTMLElement).tabIndex === 0).map((tab) => tab.getAttribute('data-testid') ?? ''))
const focused = (page: Page): Promise<string | null> => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['testid'] ?? null)

async function openWithTabs(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('landscape.webm'), media('silent.webm')])
  await expect(page.locator('.timeline .clip')).toHaveCount(2)
  await expect(page.getByTestId('tab-edit')).toBeVisible()
}

test.describe('the tabs of the tools', () => {
  test('are a tab list: one tab is reached with the Tab key, the arrows, Home and End move between them and choose, and the picture does not step', async ({ page }) => {
    await openWithTabs(page)
    expect(await selected(page)).toEqual(['tab-edit'])
    expect(await reachable(page)).toEqual(['tab-edit'])
    await page.getByTestId('tab-edit').focus()
    const at = await positionMs(page)

    await page.keyboard.press('ArrowRight')
    expect(await selected(page)).toEqual(['tab-trim'])
    expect(await focused(page)).toBe('tab-trim')
    expect(await reachable(page)).toEqual(['tab-trim'])
    await expect(page.getByTestId('trim-start-here')).toBeVisible()
    await expect(page.getByTestId('split')).toBeHidden()

    await page.keyboard.press('End')
    expect(await selected(page)).toEqual(['tab-sound'])
    await page.keyboard.press('ArrowRight')
    expect(await selected(page), 'goes round from the last to the first').toEqual(['tab-edit'])
    await page.keyboard.press('ArrowLeft')
    expect(await selected(page), 'and back').toEqual(['tab-sound'])
    await page.keyboard.press('Home')
    expect(await selected(page)).toEqual(['tab-edit'])
    expect(await focused(page)).toBe('tab-edit')

    // The arrows were the tabs' own: the playhead has not moved a frame.
    expect(await positionMs(page)).toBe(at)
  })

  test('go the other way round in a page that reads from the right', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('justinvideo-language', 'he'))
    await openWithTabs(page)
    await page.getByTestId('tab-edit').focus()
    await page.keyboard.press('ArrowLeft')
    expect(await selected(page)).toEqual(['tab-trim'])
    await page.keyboard.press('ArrowRight')
    expect(await selected(page)).toEqual(['tab-edit'])
  })

  test('leave the arrow keys to the picture when the focus is not on them', async ({ page }) => {
    await openWithTabs(page)
    await page.getByTestId('timeline').focus().catch(() => undefined)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const before = await positionMs(page)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => positionMs(page)).toBeGreaterThan(before)
    expect(await selected(page)).toEqual(['tab-edit'])
  })
})

test.describe('a dialog and the keyboard', () => {
  test('takes the focus in, keeps it while Tab goes round, and gives it back to the button that was used to open it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    await pick(page, [media('landscape.webm')])
    await expect(page.locator('.timeline .clip')).toHaveCount(1)
    // The page behind a modal dialog cannot take the focus. Tab may leave the page for the browser's own parts, as it does in some
    // browsers after the last button, and then nothing in the page has the focus.
    const inDialog = (): Promise<boolean> =>
      page.evaluate(() => {
        const active = document.activeElement
        return active === null || active === document.body || active.closest('dialog[open]') !== null
      })
    // Opened with the keyboard, as a keyboard user does: a button that is pressed with the mouse gives up the focus by design.
    await page.getByTestId('add-text').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('text-field')).toBeVisible()
    // The first thing in the dialog has the focus.
    expect(await page.evaluate(() => document.activeElement?.closest('dialog[open]') !== null && document.activeElement?.closest('dialog[open]') !== undefined)).toBe(true)
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab')
      expect(await inDialog(), `after ${i + 1} presses of Tab`).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['testid'])).toBe('add-text')
  })
})
