import { expect, type Page, test } from '@playwright/test'
import { captionPixels, clearHistory, media, pick, reloadSaved, seekTo, setClips, subs } from './helpers'

const bars = (page: Page) => page.locator('.timeline .cue')
const clips = (page: Page) => page.locator('.timeline .clip')

/** Opens a project of landscape.webm (2 s) followed by silent.webm (1 s), with nothing to undo. */
async function openTwo(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('landscape.webm'), media('silent.webm')])
  await expect(clips(page)).toHaveCount(2)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(2)
  await expect.poll(() => page.getByTestId('preview').getAttribute('data-position-ms')).toBe('0')
}

async function addTitle(page: Page, text: string): Promise<void> {
  await page.getByTestId('add-text').click()
  await page.getByTestId('text-field').fill(text)
  await page.getByTestId('text-save').click()
  await expect(page.getByRole('dialog')).toBeHidden()
}

test.describe('a title', () => {
  test('is made in a dialog, shows on the picture and on the timeline, and is one undo step', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('add-text').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('New text')
    await expect(page.getByTestId('text-save')).toBeDisabled()
    await page.getByTestId('text-field').fill('Hello world')
    await expect(dialog).toContainText('11 / 500')
    await page.getByTestId('text-save').click()

    await expect(bars(page)).toHaveCount(1)
    await expect(page.getByRole('button', { name: /^Text Hello world, from 0:00 to 0:03/ })).toBeVisible()
    await expect(page.getByTestId('caption-text')).toHaveText('Hello world')
    await expect.poll(async () => (await captionPixels(page)).count).toBeGreaterThan(500)

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(bars(page)).toHaveCount(0)
    await expect(page.getByTestId('caption-text')).toHaveText('')
    await expect.poll(async () => (await captionPixels(page)).count).toBe(0)
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect(bars(page)).toHaveCount(1)
  })

  test('shows only while it is on, for as long as it was set to last', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('add-text').click()
    await page.getByTestId('text-field').fill('Short')
    for (let i = 0; i < 4; i++) await page.getByTestId('text-shorter').click()
    await expect(page.getByTestId('text-lasts')).toContainText('0:01.0')
    await page.getByTestId('text-save').click()
    await expect(page.getByRole('button', { name: /^Text Short, from 0:00 to 0:01/ })).toBeVisible()
    await expect(page.getByTestId('caption-text')).toHaveText('Short')
    await seekTo(page, 2_000)
    await expect(page.getByTestId('caption-text')).toHaveText('')
    await expect.poll(async () => (await captionPixels(page)).count).toBe(0)
  })

  test('is moved and lengthened in half seconds, and kept inside the edit', async ({ page }) => {
    await openTwo(page)
    await clips(page).nth(0).click()
    await page.getByTestId('duplicate').click()
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:05:00')
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await expect(page.getByTestId('timecode')).toContainText('00:00:01:00 /')
    await page.getByTestId('add-text').click()
    await expect(page.getByTestId('text-starts')).toContainText('0:01.0')
    await expect(page.getByTestId('text-lasts')).toContainText('0:03.0')
    await page.getByTestId('text-later').click()
    await expect(page.getByTestId('text-starts')).toContainText('0:01.5')
    await page.getByTestId('text-longer').click()
    await page.getByTestId('text-longer').click()
    // 1.5 s to 4.5 s, then 5 s is the end of the edit: it cannot be longer than that.
    await expect(page.getByTestId('text-lasts')).toContainText('0:03.5')
    await page.getByTestId('text-field').fill('Moved')
    await page.getByTestId('text-save').click()
    await expect(bars(page).first()).toHaveAttribute('data-start', '1500')
    await expect(bars(page).first()).toHaveAttribute('data-end', '5000')
  })

  test('is put at the top, the middle or the bottom of the picture', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('add-text').click()
    await page.getByTestId('text-field').fill('Where am I')
    await page.getByTestId('text-position-top').check()
    await page.getByTestId('text-save').click()
    await expect.poll(async () => (await captionPixels(page)).bottom).toBeGreaterThan(0)
    expect((await captionPixels(page)).bottom).toBeLessThan(0.35)

    await bars(page).first().click()
    await page.getByTestId('text-position-bottom').check()
    await page.getByTestId('text-save').click()
    await expect.poll(async () => (await captionPixels(page)).top).toBeGreaterThan(0.6)

    await bars(page).first().click()
    await page.getByTestId('text-position-middle').check()
    await page.getByTestId('text-save').click()
    await expect.poll(async () => {
      const { top, bottom } = await captionPixels(page)
      return (top + bottom) / 2
    }).toBeCloseTo(0.5, 1)
  })

  test('has a size, and the picture gets more of it for a larger one', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('add-text').click()
    await page.getByTestId('text-field').fill('Size')
    await page.getByTestId('text-size-small').check()
    await page.getByTestId('text-save').click()
    await expect.poll(async () => (await captionPixels(page)).count).toBeGreaterThan(0)
    const small = await captionPixels(page)
    await bars(page).first().click()
    await page.getByTestId('text-size-large').check()
    await page.getByTestId('text-save').click()
    await expect.poll(async () => (await captionPixels(page)).count).toBeGreaterThan(small.count * 2)
  })

  test('can be opened from its bar, changed, and deleted, and each is an undo step', async ({ page }) => {
    await openTwo(page)
    await addTitle(page, 'Original')
    await bars(page).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Edit text')
    await expect(page.getByTestId('text-field')).toHaveValue('Original')
    await page.getByTestId('text-field').fill('Changed')
    await page.getByTestId('text-save').click()
    await expect(page.getByRole('button', { name: /^Text Changed/ })).toBeVisible()

    await bars(page).first().click()
    await page.getByTestId('text-delete').click()
    await expect(bars(page)).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(page.getByRole('button', { name: /^Text Changed/ })).toBeVisible()
    await page.keyboard.press('Control+z')
    await expect(page.getByRole('button', { name: /^Text Original/ })).toBeVisible()
  })

  test('remembers the choices made for it', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('add-text').click()
    await page.getByTestId('text-field').fill('Looks')
    await page.getByTestId('text-direction-rtl').check()
    await page.getByTestId('text-position-top').check()
    await page.getByTestId('text-size-large').check()
    await page.getByTestId('text-save').click()
    await expect(bars(page)).toHaveCount(1)
    await reloadSaved(page)
    await bars(page).first().click()
    await expect(page.getByTestId('text-direction-rtl')).toBeChecked()
    await expect(page.getByTestId('text-position-top')).toBeChecked()
    await expect(page.getByTestId('text-size-large')).toBeChecked()
  })

  test('leaves every key to the field while it is being typed in', async ({ page }) => {
    await openTwo(page)
    await clips(page).nth(0).click()
    await seekTo(page, 500)
    await page.getByTestId('add-text').click()
    const field = page.getByTestId('text-field')
    await expect(field).toBeFocused()
    await field.pressSequentially('sss')
    await expect(field).toHaveValue('sss')
    // S would split the clip, Home would move the playhead, Delete would remove the selected clip: here they are for the text.
    await page.keyboard.press('Home')
    await page.keyboard.press('Delete')
    await expect(field).toHaveValue('ss')
    await page.getByTestId('text-cancel').click()
    await expect(clips(page)).toHaveCount(2)
    await expect(page.getByTestId('preview')).not.toHaveAttribute('data-position-ms', '0')
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('is not saved by Cancel', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('add-text').click()
    await page.getByTestId('text-field').fill('Never saved')
    await page.getByTestId('text-cancel').click()
    await expect(bars(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('is saved with the project', async ({ page }) => {
    await openTwo(page)
    await addTitle(page, 'Kept')
    await reloadSaved(page)
    await expect(page.getByRole('button', { name: /^Text Kept/ })).toBeVisible()
    await expect(page.getByTestId('caption-text')).toHaveText('Kept')
  })
})

test.describe('text in other scripts', () => {
  test('is drawn in Hebrew, Arabic and mixed lines', async ({ page }) => {
    await openTwo(page)
    await addTitle(page, 'שלום עולם')
    await expect(page.getByTestId('caption-text')).toHaveText('שלום עולם')
    await expect.poll(async () => (await captionPixels(page)).count).toBeGreaterThan(500)
    await bars(page).first().click()
    await page.getByTestId('text-field').fill('مرحبا بالعالم 123\nשלום hello 2026')
    await page.getByTestId('text-save').click()
    await expect.poll(async () => (await captionPixels(page)).count).toBeGreaterThan(500)
    await expect(page.getByRole('button', { name: /^النص مرحبا بالعالم|^Text مرحبا بالعالم 123/ })).toBeVisible()
  })

  test('wraps a long text inside the picture', async ({ page }) => {
    await openTwo(page)
    await addTitle(page, 'a long title that goes on and on '.repeat(8).trim())
    await expect.poll(async () => (await captionPixels(page)).count).toBeGreaterThan(2_000)
    const box = await captionPixels(page)
    expect(box.left).toBeGreaterThanOrEqual(0.04)
    expect(box.right).toBeLessThanOrEqual(0.96)
    expect(box.top).toBeGreaterThan(0.2)
    expect(box.bottom).toBeLessThan(0.97)
  })

  test('is in the app’s language: the dialog in Hebrew', async ({ page }) => {
    await openTwo(page)
    await page.getByRole('button', { name: 'עברית' }).click()
    await page.getByRole('button', { name: 'הוספת טקסט' }).click()
    await expect(page.getByRole('dialog')).toContainText('טקסט חדש')
    await expect(page.getByRole('dialog')).toContainText('כיוון קריאה')
    await page.getByTestId('text-field').fill('בדיקה')
    await page.getByRole('button', { name: 'שמירה' }).click()
    await expect(page.getByTestId('caption-text')).toHaveText('בדיקה')
  })
})

test.describe('subtitles from a file', () => {
  test('become captions that show at their times, and the cue past the end is skipped and counted', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('subtitle-input').setInputFiles(subs('hello.srt'))
    await expect(page.getByTestId('notice')).toHaveText('Captions added: 2. Entries skipped: 1')
    await expect(bars(page)).toHaveCount(2)
    await expect(bars(page).nth(0)).toHaveAttribute('data-start', '200')
    await expect(bars(page).nth(0)).toHaveAttribute('data-end', '800')
    await expect(bars(page).nth(1)).toHaveAttribute('data-start', '1200')
    await seekTo(page, 500)
    await expect(page.getByTestId('caption-text')).toHaveText('First line and a third'.slice(0, 10))
    await seekTo(page, 1_500)
    await expect(page.getByTestId('caption-text')).toContainText('Second line')
    await expect.poll(async () => (await captionPixels(page)).count).toBeGreaterThan(500)
    await seekTo(page, 1_000)
    await expect(page.getByTestId('caption-text')).toHaveText('')
  })

  test('are one undo step, are saved, and are replaced when the file is read again', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('subtitle-input').setInputFiles(subs('hello.srt'))
    await expect(bars(page)).toHaveCount(2)
    await page.getByTestId('subtitle-input').setInputFiles(subs('hello.srt'))
    await expect(page.getByTestId('notice')).toContainText('Captions added')
    await expect(bars(page)).toHaveCount(2)
    await reloadSaved(page)
    await expect(bars(page)).toHaveCount(2)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(bars(page)).toHaveCount(2)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(bars(page)).toHaveCount(0)
  })

  test('follow their footage when the clips are rearranged', async ({ page }) => {
    await openTwo(page)
    // The second half of the recording first, then the first half: the captions move with what they were said over.
    await setClips(page, [[1_000, 2_000], [0, 1_000]])
    await page.getByTestId('subtitle-input').setInputFiles(subs('hello.srt'))
    await expect(bars(page)).toHaveCount(2)
    // 0.2 s to 0.8 s of the recording is now at 1.2 s to 1.8 s of the edit, and 1.2 s to 1.8 s is at 0.2 s to 0.8 s.
    await expect(bars(page).nth(0)).toHaveAttribute('data-start', '200')
    await expect(bars(page).nth(0)).toHaveAttribute('data-end', '800')
    await expect(bars(page).nth(0)).toContainText('Second line')
    await expect(bars(page).nth(1)).toHaveAttribute('data-start', '1200')
    await expect(bars(page).nth(1)).toContainText('First line')
  })

  test('go to the recording of the selected clip', async ({ page }) => {
    await openTwo(page)
    await clips(page).nth(1).click()
    await page.getByTestId('subtitle-input').setInputFiles(subs('hello.srt'))
    // silent.webm is 1 s long: only the first cue fits.
    await expect(page.getByTestId('notice')).toHaveText('Captions added: 1. Entries skipped: 2')
    await expect(bars(page)).toHaveCount(1)
    // That recording starts at 2 s of the edit.
    await expect(bars(page).first()).toHaveAttribute('data-start', '2200')
  })

  test('are read from an old Hebrew file and from Arabic UTF-8', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('subtitle-input').setInputFiles(subs('hebrew-windows-1255.srt'))
    await expect(bars(page)).toHaveCount(2)
    await expect(bars(page).nth(0)).toContainText('שלום עולם יפה מאוד היום')
    await seekTo(page, 500)
    await expect(page.getByTestId('caption-text')).toHaveText('שלום עולם יפה מאוד היום')
    await page.getByTestId('subtitle-input').setInputFiles(subs('arabic.srt'))
    await expect(bars(page)).toHaveCount(1)
    await expect(bars(page).first()).toContainText('مرحبا بالعالم')
  })

  test('are refused with a reason when the file is not subtitles or too big', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('subtitle-input').setInputFiles(subs('not-subtitles.txt'))
    await expect(page.getByTestId('notice')).toContainText('no captions that fall inside the video')
    await page.getByTestId('subtitle-input').setInputFiles({ name: 'big.srt', mimeType: 'text/plain', buffer: Buffer.alloc(6 * 1024 * 1024, 'a') })
    await expect(page.getByTestId('notice')).toContainText('too large')
    await expect(bars(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('have a caption that can be edited like a title, except for its time', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('subtitle-input').setInputFiles(subs('hello.srt'))
    await bars(page).first().click()
    await expect(page.getByRole('dialog')).toContainText('follows its footage')
    await expect(page.getByTestId('text-starts')).toHaveCount(0)
    await page.getByTestId('text-field').fill('Edited caption')
    await page.getByTestId('text-position-top').check()
    await page.getByTestId('text-save').click()
    await expect(bars(page).first()).toContainText('Edited caption')
    await expect(bars(page).first()).toHaveAttribute('data-start', '200')
  })

  test('are cut with the footage: a caption on a part that is removed does not show', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('subtitle-input').setInputFiles(subs('hello.srt'))
    await expect(bars(page)).toHaveCount(2)
    // Remove the first 1 s of the first clip: the first caption (0.2 s to 0.8 s) goes with it.
    await page.getByTestId('range-tool').click()
    await page.getByTestId('remove-range').click()
    await expect(bars(page)).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(bars(page)).toHaveCount(2)
  })
})
