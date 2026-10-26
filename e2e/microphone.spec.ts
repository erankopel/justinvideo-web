import { expect, type Page, test } from '@playwright/test'
import { asked, clearHistory, media, pick, positionMs, reloadSaved, seekTo, unplug, withMicrophones, WEBKIT_CANNOT } from './helpers'

test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_CANNOT.record)

const clips = (page: Page) => page.locator('.timeline .clip')
const bars = (page: Page) => page.locator('.timeline .audio-bar')
const notice = (page: Page) => page.getByTestId('notice')

const TWO = [
  { id: 'mic-desk', label: 'Desk microphone' },
  { id: 'mic-headset', label: 'Headset' },
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

/** Opens the dialog, chooses the nth microphone (or the default when index is null), and saves. */
async function choose(page: Page, index: number | null): Promise<void> {
  await page.getByTestId('microphone').click()
  await page.getByTestId(index === null ? 'microphone-default' : `microphone-${index}`).check()
  await page.getByTestId('microphone-save').click()
  await expect(page.getByRole('dialog')).toBeHidden()
}

/** Records from a second in until the edit ends, which stops it, and waits for the voiceover to be laid down. */
async function recordToTheEnd(page: Page): Promise<void> {
  await seekTo(page, 1_500)
  await page.getByTestId('record').click()
  await expect(page.getByTestId('recording')).toBeVisible()
  await expect(bars(page)).toHaveCount(1, { timeout: 15_000 })
}

test.describe('the microphone', () => {
  test('is listed by name, and the voiceover is recorded from exactly the one that is chosen', async ({ page }) => {
    await withMicrophones(page, TWO)
    await openSilent(page)
    await page.getByTestId('microphone').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Choose a microphone')
    await expect(page.getByTestId('microphone-default')).toBeChecked()
    await expect(dialog).toContainText('Desk microphone')
    await expect(dialog).toContainText('Headset')
    await expect(page.getByTestId('microphone-allow')).toHaveCount(0)
    await page.getByTestId('microphone-1').check()
    await page.getByTestId('microphone-save').click()
    await expect(dialog).toBeHidden()

    await recordToTheEnd(page)
    expect(await asked(page)).toEqual(['{"audio":{"deviceId":{"exact":"mic-headset"}}}'])
    await expect(bars(page).first()).toHaveClass(/voiceover/)
  })

  test('records from the default microphone when none has been chosen', async ({ page }) => {
    await withMicrophones(page, TWO)
    await openSilent(page)
    await recordToTheEnd(page)
    expect(await asked(page)).toEqual(['{"audio":true}'])
  })

  test('is remembered in this browser: after a reload it is still the one chosen, and the default can be chosen again', async ({ page }) => {
    await withMicrophones(page, TWO)
    await openSilent(page)
    await choose(page, 0)
    expect(await page.evaluate(() => localStorage.getItem('justinvideo-microphone'))).toBe('mic-desk')
    await reloadSaved(page)
    await expect(clips(page)).toHaveCount(3)
    await page.getByTestId('microphone').click()
    await expect(page.getByTestId('microphone-0')).toBeChecked()
    await page.getByTestId('microphone-cancel').click()
    await choose(page, null)
    expect(await page.evaluate(() => localStorage.getItem('justinvideo-microphone'))).toBeNull()
  })

  test('is changed only by Save: Cancel leaves the choice where it was', async ({ page }) => {
    await withMicrophones(page, TWO)
    await openSilent(page)
    await page.getByTestId('microphone').click()
    await page.getByTestId('microphone-1').check()
    await page.getByTestId('microphone-cancel').click()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem('justinvideo-microphone'))).toBeNull()
    await page.getByTestId('microphone').click()
    await expect(page.getByTestId('microphone-default')).toBeChecked()
  })

  test('has numbers for names until the browser has been allowed to use a microphone, and a button that asks', async ({ page }) => {
    await withMicrophones(page, TWO, { namesKnown: false })
    await openSilent(page)
    await page.getByTestId('microphone').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Microphone 1')
    await expect(dialog).toContainText('Microphone 2')
    await expect(dialog).not.toContainText('Headset')
    await expect(dialog).toContainText('only after it has been allowed')
    await page.getByTestId('microphone-allow').click()
    await expect(dialog).toContainText('Desk microphone')
    await expect(dialog).toContainText('Headset')
    await expect(page.getByTestId('microphone-allow')).toHaveCount(0)
  })

  test('says so when the browser finds no microphone', async ({ page }) => {
    await withMicrophones(page, [])
    await openSilent(page)
    await page.getByTestId('microphone').click()
    await expect(page.getByTestId('microphone-none')).toBeVisible()
    await expect(page.getByTestId('microphone-default')).toBeChecked()
  })

  test('follows a microphone that is plugged in or out while the dialog is open', async ({ page }) => {
    await withMicrophones(page, TWO)
    await openSilent(page)
    await page.getByTestId('microphone').click()
    await expect(page.getByRole('dialog')).toContainText('Headset')
    await page.evaluate(() => {
      const state = (window as unknown as { mics: { devices: { id: string; label: string }[] } }).mics
      state.devices = [...state.devices, { id: 'mic-usb', label: 'USB microphone' }]
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
    })
    await expect(page.getByRole('dialog')).toContainText('USB microphone')
  })

  test('is made up for by the default when the one chosen has been unplugged, and the person is told', async ({ page }) => {
    await withMicrophones(page, TWO)
    await openSilent(page)
    await choose(page, 1)
    await unplug(page, 'mic-headset')
    await seekTo(page, 1_000)
    await page.getByTestId('record').click()
    await expect(page.getByTestId('recording')).toBeVisible()
    await expect(notice(page)).toContainText('not connected, so the default one is used')
    // It asked for the headset, which was not there, and then for the default.
    expect(await asked(page)).toEqual(['{"audio":{"deviceId":{"exact":"mic-headset"}}}', '{"audio":true}'])
    await expect(bars(page)).toHaveCount(1, { timeout: 15_000 })
    // The choice is kept, for when it is plugged in again.
    expect(await page.evaluate(() => localStorage.getItem('justinvideo-microphone'))).toBe('mic-headset')
  })

  test('shows a microphone that was chosen and is not connected as the default, and cannot be changed while recording', async ({ page }) => {
    await withMicrophones(page, TWO)
    await page.addInitScript(() => localStorage.setItem('justinvideo-microphone', 'mic-gone'))
    await openSilent(page)
    await page.getByTestId('microphone').click()
    await expect(page.getByTestId('microphone-default')).toBeChecked()
    await page.getByTestId('microphone-cancel').click()
    await seekTo(page, 1_000)
    await page.getByTestId('record').click()
    await expect(page.getByTestId('recording')).toBeVisible()
    await expect(page.getByTestId('microphone')).toBeDisabled()
    await expect(bars(page)).toHaveCount(1, { timeout: 15_000 })
    await expect(page.getByTestId('microphone')).toBeEnabled()
  })

  test('is in the language of the site: Hebrew, right to left', async ({ page }) => {
    await withMicrophones(page, TWO)
    await openSilent(page)
    await page.getByRole('button', { name: 'עברית' }).click()
    await page.getByTestId('microphone').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('בחירת מיקרופון')
    await expect(dialog).toContainText('מיקרופון ברירת המחדל של הדפדפן')
    await expect(dialog).toContainText('Desk microphone')
  })
})

test.describe('the made-up microphone of the browser, with nothing stubbed', () => {
  test('is listed, and can be chosen and used', async ({ page }) => {
    await openSilent(page)
    await page.getByTestId('microphone').click()
    await expect(page.getByTestId('microphone-0')).toBeVisible()
    await page.getByTestId('microphone-0').check()
    await page.getByTestId('microphone-save').click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await recordToTheEnd(page)
    await expect(bars(page).first()).toHaveClass(/voiceover/)
  })
})
