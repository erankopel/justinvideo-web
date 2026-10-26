import { expect, type Page, test } from '@playwright/test'
import { media, pick, removeStoredMedia, WEBKIT_CANNOT } from './helpers'

test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_CANNOT.encode)
test.describe.configure({ timeout: 120_000 })

async function openOne(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, media('landscape.webm'))
  await expect(page.locator('.timeline .clip')).toHaveCount(1)
}

/** Makes the export and waits for it to be done, without downloading it. */
async function exportUntilDone(page: Page): Promise<void> {
  await page.getByTestId('export').click()
  await page.getByTestId('export-start').click()
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 90_000 })
}

/** A share sheet that the page can be told about: it says it can take files, and records what it was handed. Run in the page, so it holds nothing of this file. */
function shareSheet(outcome: string): void {
  const sheet = window as unknown as { shared?: { name: string; size: number; type: string; title: string } }
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: async (data: { files: File[]; title: string }) => {
      if (outcome === 'cancelled') throw new DOMException('The person left the share sheet', 'AbortError')
      if (outcome === 'refused') throw new DOMException('Not allowed', 'NotAllowedError')
      const [file] = data.files
      sheet.shared = { name: file?.name ?? '', size: file?.size ?? 0, type: file?.type ?? '', title: data.title }
    },
  })
}

test.describe('sharing the exported video', () => {
  test('is offered where the browser can share files, and hands the video, as it was named, to the share sheet', async ({ page }) => {
    await page.addInitScript(shareSheet, 'shared')
    await openOne(page)
    await exportUntilDone(page)
    await page.getByTestId('export-share').click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { shared?: unknown }).shared)).toMatchObject({ size: expect.any(Number), title: expect.stringMatching(/\.(mp4|webm)$/) })
    const handed = await page.evaluate(() => (window as unknown as { shared: { name: string; size: number; type: string; title: string } }).shared)
    expect(handed.size).toBeGreaterThan(1_000)
    expect(handed.name).toBe(handed.title)
    expect(handed.type).toMatch(/^video\/(mp4|webm)$/)
    // The download is still there, as it was.
    await expect(page.getByTestId('export-download')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('is not taken as a failure when the person leaves the share sheet, and is when the browser refuses it', async ({ page }) => {
    await page.addInitScript(shareSheet, 'cancelled')
    await openOne(page)
    await exportUntilDone(page)
    await page.getByTestId('export-share').click()
    await page.waitForTimeout(300)
    await expect(page.getByRole('alert')).toHaveCount(0)

    const refusing = await page.context().newPage()
    await refusing.addInitScript(shareSheet, 'refused')
    await openOne(refusing)
    await exportUntilDone(refusing)
    await refusing.getByTestId('export-share').click()
    await expect(refusing.getByRole('alert')).toContainText('could not be shared')
    await expect(refusing.getByTestId('export-download')).toBeVisible()
  })

  test('is not offered where the browser cannot share files', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    })
    await openOne(page)
    await exportUntilDone(page)
    await expect(page.getByTestId('export-download')).toBeVisible()
    await expect(page.getByTestId('export-share')).toHaveCount(0)
  })
})

test.describe('the details of a failed export', () => {
  test('can be copied, to paste into a message, and tell how the project and the browser are, and no name of a file', async ({ page, browserName, context }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openOne(page)
    expect(await removeStoredMedia(page)).toBeGreaterThan(0)
    await page.getByTestId('export').click()
    await page.getByTestId('export-start').click()
    await expect(page.getByTestId('export-failed')).toBeVisible({ timeout: 60_000 })
    await page.getByTestId('export-copy').click()
    await expect(page.getByTestId('export-copy-note')).toBeVisible()
    // Where the browser lets the page copy, the text is on the clipboard, which only Chromium lets a test read; where it does not, it
    // is shown to be copied by hand.
    const shown = await page.getByTestId('export-details').count()
    if (shown === 0 && browserName !== 'chromium') {
      await expect(page.getByTestId('export-copy-note')).toContainText('justinvideo@medicom.vip')
      return
    }
    const text = shown === 0 ? await page.evaluate(() => navigator.clipboard.readText()) : await page.getByTestId('export-details').inputValue()
    expect(text).toContain('JustInVideo export problem')
    expect(text).toContain('Problem: SourceMissing')
    expect(text).toContain('Project: 1 clips')
    expect(text).toContain('Browser: ')
    expect(text).not.toContain('landscape')
    if (shown === 0) await expect(page.getByTestId('export-copy-note')).toContainText('justinvideo@medicom.vip')
  })

  test('are shown to be copied by hand where the browser will not let the page copy', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new DOMException('No', 'NotAllowedError')) }, configurable: true })
    })
    await openOne(page)
    expect(await removeStoredMedia(page)).toBeGreaterThan(0)
    await page.getByTestId('export').click()
    await page.getByTestId('export-start').click()
    await expect(page.getByTestId('export-failed')).toBeVisible({ timeout: 60_000 })
    await page.getByTestId('export-copy').click()
    await expect(page.getByTestId('export-copy-note')).toContainText('copy it yourself')
    await expect(page.getByTestId('export-details')).toHaveValue(/Problem: SourceMissing/)
  })
})
