import { expect, type Locator, type Page, test } from '@playwright/test'
import { audio, clearHistory, media, pick, positionMs, reloadSaved, seekTo } from './helpers'

const clips = (page: Page) => page.locator('.timeline .clip')
const bars = (page: Page) => page.locator('.timeline .audio-bar')
const undo = (page: Page) => page.getByRole('button', { name: 'Undo' })
const redo = (page: Page) => page.getByRole('button', { name: 'Redo' })

/** Three seconds in three clips of a second, with cuts at 1 s and 2 s, and no sound of their own. */
async function openSilent(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('silent.webm'), media('silent.webm'), media('silent.webm')])
  await expect(clips(page)).toHaveCount(3)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(3)
  await expect.poll(() => positionMs(page)).toBe(0)
}

/** Lays the 3 s test sound under the edit from the playhead, as a person does with Add music. */
async function addMusic(page: Page): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('add-music').click()
  await (await chooser).setFiles(audio('steps.wav'))
  await expect(bars(page)).toHaveCount(1)
}

const startOf = async (bar: Locator): Promise<number> => Number(await bar.getAttribute('data-start'))
const endOf = async (bar: Locator): Promise<number> => Number(await bar.getAttribute('data-end'))

/** Presses on a piece a little inside its visible left edge and drags it by a number of milliseconds of the edit. */
async function dragPiece(page: Page, bar: Locator, byMs: number, options: { release?: boolean; steps?: number } = {}): Promise<void> {
  await page.getByTestId('timeline').scrollIntoViewIfNeeded()
  const box = await bar.boundingBox()
  if (!box) throw new Error('no piece')
  const zoom = Number(await page.getByTestId('timeline').getAttribute('data-zoom'))
  const x = Math.max(box.x, 0) + 20
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + byMs * zoom, y, { steps: options.steps ?? 10 })
  if (options.release ?? true) await page.mouse.up()
}

/** A time in seconds as the dialogs write it. */
const sec = (value: string): RegExp => new RegExp(`${value.replace('.', '\\.')}\u2069? s`)

test.describe('dragging a piece of music', () => {
  test('moves it along the timeline, keeping its length, as one undo step that is kept', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    const bar = bars(page).first()
    await dragPiece(page, bar, 300)
    const moved = await startOf(bar)
    // A pixel is 2 or 3 ms here, and the pointer is not at a whole pixel.
    expect(Math.abs(moved - 300)).toBeLessThanOrEqual(8)
    expect(await endOf(bar)).toBe(moved + 3_000)
    await expect(bar).not.toHaveClass(/moving/)
    // The playhead stayed where it was: dragging a piece does not scrub.
    expect(await positionMs(page)).toBe(0)

    // The dialog agrees, and the move is the one undo step.
    await bar.click()
    await expect(page.getByTestId('audio-starts')).toContainText(sec('0.3'))
    await page.getByTestId('audio-cancel').click()
    await undo(page).click()
    await expect(bar).toHaveAttribute('data-start', '0')
    await redo(page).click()
    await expect(bar).toHaveAttribute('data-start', String(moved))

    await reloadSaved(page)
    await expect(bars(page)).toHaveCount(1)
    await expect(bars(page).first()).toHaveAttribute('data-start', String(moved))
  })

  test('is lifted while it is dragged, drawn where it would land, and saved as one step when it is let go', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    const bar = bars(page).first()
    await dragPiece(page, bar, 400, { release: false })
    await expect(bar).toHaveClass(/moving/)
    // Already drawn where it would land, though the mouse is still down.
    const dragged = await startOf(bar)
    expect(dragged).toBeGreaterThan(300)
    await page.mouse.up()
    await expect(bar).not.toHaveClass(/moving/)
    await expect(bar).toHaveAttribute('data-start', String(dragged))
    // Letting go saved it as one step: one Undo puts the piece back at the start, and it is still there.
    await undo(page).click()
    await expect(bar).toHaveAttribute('data-start', '0')
    await expect(bars(page)).toHaveCount(1)
  })

  test('sticks to a cut that is near, with a guide to show it, and lands exactly on it', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    const bar = bars(page).first()
    // 990 ms later is 10 ms short of the cut at a second: close enough to stick.
    await dragPiece(page, bar, 990, { release: false })
    await expect(page.getByTestId('guide')).toBeVisible()
    await expect(page.getByTestId('guide')).toHaveAttribute('data-time', '1000')
    await page.mouse.up()
    await expect(bar).toHaveAttribute('data-start', '1000')
    await expect(page.getByTestId('guide')).toHaveCount(0)
  })

  test('sticks by its end as well, to the end of the edit', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    // A piece of two seconds, so that its end can meet the end of the edit at three seconds without leaving it.
    await bars(page).first().click()
    await page.getByTestId('audio-shorter').click()
    await page.getByTestId('audio-shorter').click()
    await page.getByTestId('audio-save').click()
    await expect(page.getByRole('dialog')).toBeHidden()
    const bar = bars(page).first()
    expect(await endOf(bar)).toBe(2_000)
    // Its end is at 2 s, which is a cut. Dragging by 990 ms puts the end 10 ms short of the end of the edit.
    await dragPiece(page, bar, 990)
    await expect(bar).toHaveAttribute('data-start', '1000')
    await expect(bar).toHaveAttribute('data-end', '3000')
  })

  test('lands where it is put when snapping is turned off', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await page.getByTestId('snapping').click()
    const bar = bars(page).first()
    await dragPiece(page, bar, 990)
    const start = await startOf(bar)
    expect(Math.abs(start - 990)).toBeLessThanOrEqual(8)
    expect(start).not.toBe(1_000)
  })

  test('is let go where it was by Escape, and that leaves no undo step', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    const bar = bars(page).first()
    await dragPiece(page, bar, 500, { release: false })
    await expect(bar).toHaveClass(/moving/)
    await page.keyboard.press('Escape')
    await expect(bar).not.toHaveClass(/moving/)
    await expect(bar).toHaveAttribute('data-start', '0')
    await page.mouse.move(300, 300, { steps: 4 })
    await page.mouse.up()
    await expect(bar).toHaveAttribute('data-start', '0')
    // The only step in the history is adding the piece.
    await undo(page).click()
    await expect(bars(page)).toHaveCount(0)
    await expect(undo(page)).toBeDisabled()
  })

  test('cannot be put before the start of the edit, nor lost beyond its end', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await page.getByTestId('snapping').click()
    // With the playhead in the middle, a piece can be taken across the whole edit without the pointer leaving the window.
    await seekTo(page, 1_500)
    const bar = bars(page).first()
    await dragPiece(page, bar, 1_000)
    const moved = await startOf(bar)
    expect(Math.abs(moved - 1_000)).toBeLessThanOrEqual(8)
    await dragPiece(page, bar, -1_700)
    await expect(bar).toHaveAttribute('data-start', '0')
    await dragPiece(page, bar, 2_950)
    await expect(bar).toHaveAttribute('data-start', '2900')
  })

  test('a press that does not move opens the piece, as before', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await bars(page).first().click()
    await expect(page.getByRole('dialog')).toContainText('Edit music')
    await expect(page.getByTestId('audio-starts')).toContainText(sec('0.0'))
    await page.getByTestId('audio-cancel').click()
    await expect(bars(page).first()).toHaveAttribute('data-start', '0')
  })

  test('dragging on the clips still moves the playhead, not the piece', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await page.getByTestId('timeline').scrollIntoViewIfNeeded()
    const box = await clips(page).nth(1).boundingBox()
    if (!box) throw new Error('no clip')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    expect(await positionMs(page)).toBeGreaterThan(100)
    await expect(bars(page).first()).toHaveAttribute('data-start', '0')
  })
})
