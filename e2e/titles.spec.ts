import { expect, type Locator, type Page, test } from '@playwright/test'
import { audio, clearHistory, media, pick, positionMs, reloadSaved, seekTo, subs } from './helpers'

const clips = (page: Page) => page.locator('.timeline .clip')
const cues = (page: Page) => page.locator('.timeline .cue')
const undo = (page: Page) => page.getByRole('button', { name: 'Undo' })
const redo = (page: Page) => page.getByRole('button', { name: 'Redo' })
const caption = (page: Page) => page.getByTestId('caption-text')

/** Three seconds in three clips of a second, with cuts at 1 s and 2 s. */
async function openSilent(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('silent.webm'), media('silent.webm'), media('silent.webm')])
  await expect(clips(page)).toHaveCount(3)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(3)
  await expect.poll(() => positionMs(page)).toBe(0)
}

/** Adds a title at the playhead, one second long, as a person does: in the dialog, made shorter four times. */
async function addTitle(page: Page, text = 'Hello'): Promise<void> {
  await page.getByTestId('add-text').click()
  await page.getByTestId('text-field').fill(text)
  for (let i = 0; i < 4; i++) await page.getByTestId('text-shorter').click()
  await page.getByTestId('text-save').click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(cues(page)).toHaveCount(1)
  await expect(cues(page).first()).toHaveAttribute('data-end', '1000')
}

const startOf = async (cue: Locator): Promise<number> => Number(await cue.getAttribute('data-start'))
const endOf = async (cue: Locator): Promise<number> => Number(await cue.getAttribute('data-end'))

/** Presses on a title a little inside it and drags it by a number of milliseconds of the edit. */
async function dragTitle(page: Page, cue: Locator, byMs: number, options: { release?: boolean; steps?: number } = {}): Promise<void> {
  await page.getByTestId('timeline').scrollIntoViewIfNeeded()
  const box = await cue.boundingBox()
  if (!box) throw new Error('no title')
  const zoom = Number(await page.getByTestId('timeline').getAttribute('data-zoom'))
  const x = Math.max(box.x, 0) + 20
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + byMs * zoom, y, { steps: options.steps ?? 10 })
  if (options.release ?? true) await page.mouse.up()
}

const sec = (value: string): RegExp => new RegExp(`${value.replace('.', '\\.')}`)

test.describe('dragging a title', () => {
  test('moves it along the timeline, keeping its length, as one undo step that is kept', async ({ page }) => {
    await openSilent(page)
    await addTitle(page)
    const cue = cues(page).first()
    await expect(caption(page)).toHaveText('Hello')
    await dragTitle(page, cue, 300)
    const moved = await startOf(cue)
    expect(Math.abs(moved - 300)).toBeLessThanOrEqual(8)
    expect(await endOf(cue)).toBe(moved + 1_000)
    await expect(cue).not.toHaveClass(/moving/)
    // The playhead stayed where it was, and the title now begins after it, so it is not shown there.
    expect(await positionMs(page)).toBe(0)
    await expect(caption(page)).toHaveText('')
    await seekTo(page, 800)
    await expect(caption(page)).toHaveText('Hello')

    // The dialog agrees, and the move is the one undo step.
    await cue.click()
    // The dialog shows tenths of a second, cut off, so the label follows from the start that was reached.
    await expect(page.getByTestId('text-starts')).toContainText(sec(`0:00.${Math.floor(moved / 100)}`))
    await page.getByTestId('text-cancel').click()
    await undo(page).click()
    await expect(cue).toHaveAttribute('data-start', '0')
    await redo(page).click()
    await expect(cue).toHaveAttribute('data-start', String(moved))

    await reloadSaved(page)
    await expect(cues(page)).toHaveCount(1)
    await expect(cues(page).first()).toHaveAttribute('data-start', String(moved))
  })

  test('is shown where it would land while it is dragged, on the picture too, and is lifted', async ({ page }) => {
    await openSilent(page)
    await addTitle(page)
    const cue = cues(page).first()
    await expect(caption(page)).toHaveText('Hello')
    await dragTitle(page, cue, 1_000, { release: false })
    await expect(cue).toHaveClass(/moving/)
    // It has been taken off the playhead, which is at 0, and the picture shows that before it is let go.
    await expect(caption(page)).toHaveText('')
    await page.mouse.up()
    await expect(cue).not.toHaveClass(/moving/)
    await expect(caption(page)).toHaveText('')
  })

  test('sticks to a cut that is near, with a guide to show it, and lands exactly on it', async ({ page }) => {
    await openSilent(page)
    await addTitle(page)
    const cue = cues(page).first()
    // 990 ms later is 10 ms short of the cut at a second, where its start would meet the end of what it was.
    await dragTitle(page, cue, 990, { release: false })
    await expect(page.getByTestId('guide')).toBeVisible()
    await expect(page.getByTestId('guide')).toHaveAttribute('data-time', '1000')
    await page.mouse.up()
    await expect(cue).toHaveAttribute('data-start', '1000')
    await expect(cue).toHaveAttribute('data-end', '2000')
    await expect(page.getByTestId('guide')).toHaveCount(0)
  })

  test('lands where it is put when snapping is turned off', async ({ page }) => {
    await openSilent(page)
    await addTitle(page)
    await page.getByTestId('snapping').click()
    const cue = cues(page).first()
    await dragTitle(page, cue, 990)
    const start = await startOf(cue)
    expect(Math.abs(start - 990)).toBeLessThanOrEqual(8)
    expect(start).not.toBe(1_000)
  })

  test('stays whole inside the edit: not before its start, and not pulled past its end', async ({ page }) => {
    await openSilent(page)
    await addTitle(page)
    await page.getByTestId('snapping').click()
    await seekTo(page, 1_500)
    const cue = cues(page).first()
    await dragTitle(page, cue, 1_000)
    expect(Math.abs((await startOf(cue)) - 1_000)).toBeLessThanOrEqual(8)
    await dragTitle(page, cue, -1_700)
    await expect(cue).toHaveAttribute('data-start', '0')
    await dragTitle(page, cue, 2_950)
    await expect(cue).toHaveAttribute('data-start', '2000')
    await expect(cue).toHaveAttribute('data-end', '3000')
  })

  test('is let go where it was by Escape, and that leaves no undo step', async ({ page }) => {
    await openSilent(page)
    await addTitle(page)
    const cue = cues(page).first()
    await dragTitle(page, cue, 500, { release: false })
    await expect(cue).toHaveClass(/moving/)
    await page.keyboard.press('Escape')
    await expect(cue).not.toHaveClass(/moving/)
    await expect(cue).toHaveAttribute('data-start', '0')
    await expect(caption(page)).toHaveText('Hello')
    await page.mouse.move(300, 300, { steps: 4 })
    await page.mouse.up()
    await expect(cue).toHaveAttribute('data-start', '0')
    // The only step in the history is adding the title.
    await undo(page).click()
    await expect(cues(page)).toHaveCount(0)
    await expect(undo(page)).toBeDisabled()
  })

  test('a press that does not move opens the title, as before', async ({ page }) => {
    await openSilent(page)
    await addTitle(page)
    await cues(page).first().click()
    await expect(page.getByRole('dialog')).toContainText('Edit text')
    await expect(page.getByTestId('text-starts')).toContainText(sec('0:00.0'))
    await page.getByTestId('text-cancel').click()
    await expect(cues(page).first()).toHaveAttribute('data-start', '0')
  })

  test('is not done to a caption from a subtitle file, which follows its footage: a press on it scrubs', async ({ page }) => {
    await openSilent(page)
    await page.getByTestId('subtitle-input').setInputFiles(subs('hello.srt'))
    await expect(cues(page).first()).toBeVisible()
    const first = cues(page).first()
    const start = await startOf(first)
    const end = await endOf(first)
    await page.getByTestId('timeline').scrollIntoViewIfNeeded()
    const box = await first.boundingBox()
    if (!box) throw new Error('no caption')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 8 })
    await expect(first).not.toHaveClass(/moving/)
    await page.mouse.up()
    // The caption is where it was, and the playhead was moved instead.
    expect(await startOf(first)).toBe(start)
    expect(await endOf(first)).toBe(end)
    expect(await positionMs(page)).toBeGreaterThan(100)
    await expect(first).not.toHaveClass(/movable/)
  })

  test('is an edge that a piece of music sticks to, as a cut is', async ({ page }) => {
    await openSilent(page)
    await addTitle(page)
    // Move the title to a place that is not a cut: it now ends somewhere in the second second.
    const cue = cues(page).first()
    await dragTitle(page, cue, 300)
    const titleEnd = await endOf(cue)
    expect(titleEnd).toBeGreaterThan(1_200)
    expect(titleEnd).toBeLessThan(1_400)
    // Music from the start. Its start is taken to within 10 ms of where the title ends, and it lands exactly there.
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('add-music').click()
    await (await chooser).setFiles(audio('tone.wav'))
    const bar = page.locator('.timeline .audio-bar').first()
    await expect(bar).toBeVisible()
    await page.getByTestId('timeline').scrollIntoViewIfNeeded()
    const box = await bar.boundingBox()
    if (!box) throw new Error('no piece')
    const zoom = Number(await page.getByTestId('timeline').getAttribute('data-zoom'))
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 20 + (titleEnd - 10) * zoom, box.y + box.height / 2, { steps: 10 })
    await expect(page.getByTestId('guide')).toHaveAttribute('data-time', String(titleEnd))
    await page.mouse.up()
    await expect(bar).toHaveAttribute('data-start', String(titleEnd))
  })
})
