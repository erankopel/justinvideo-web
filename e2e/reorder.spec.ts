import { expect, type Locator, type Page, test } from '@playwright/test'
import { clearHistory, media, pick, positionMs, reloadSaved } from './helpers'

const clips = (page: Page) => page.locator('.timeline .clip')
const undo = (page: Page) => page.getByRole('button', { name: 'Undo' })
const redo = (page: Page) => page.getByRole('button', { name: 'Redo' })

/** The ids of the clips, in the order they are on the timeline. */
const order = async (page: Page): Promise<string[]> => clips(page).evaluateAll((all) => all.map((clip) => clip.getAttribute('data-clip-id') ?? ''))

/** Opens landscape.webm (2 s), silent.webm (1 s) and fast.webm (1 s) as three clips, A, B and C, and returns their ids. */
async function openThree(page: Page): Promise<[string, string, string]> {
  await page.goto('/')
  await pick(page, [media('landscape.webm'), media('silent.webm'), media('fast.webm')])
  await expect(clips(page)).toHaveCount(3)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(3)
  await expect.poll(() => positionMs(page)).toBe(0)
  const [a, b, c] = await order(page)
  if (!a || !b || !c) throw new Error('no clips')
  return [a, b, c]
}

/** Time to hold a press still for a clip to be picked up: a little more than the timeline waits. */
const HOLD_MS = 550

/**
 * Presses in the middle of a clip, holds still until it is picked up (unless hold is false, which is a plain drag), and
 * drags it by a number of milliseconds of the edit.
 */
async function dragClip(page: Page, clip: Locator, byMs: number, options: { release?: boolean; steps?: number; hold?: boolean } = {}): Promise<void> {
  await page.getByTestId('timeline').scrollIntoViewIfNeeded()
  const box = await clip.boundingBox()
  if (!box) throw new Error('no clip')
  const zoom = Number(await page.getByTestId('timeline').getAttribute('data-zoom'))
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  if (options.hold ?? true) await page.waitForTimeout(HOLD_MS)
  await page.mouse.move(x + byMs * zoom, y, { steps: options.steps ?? 10 })
  if (options.release ?? true) await page.mouse.up()
}

/** Puts the playhead back at the start. */
async function seekHome(page: Page): Promise<void> {
  await page.keyboard.press('Home')
  await expect.poll(() => positionMs(page)).toBe(0)
}

test.describe('dragging a clip', () => {
  test('moves a clip later when it is picked up and dragged past the middle of the next one, as one undo step that is kept', async ({ page }) => {
    const [a, b, c] = await openThree(page)
    // A is 2 s long, and B 1 s: A's front edge is at 2 s and has to pass the middle of B, at 2.5 s.
    await dragClip(page, clips(page).nth(0), 700)
    expect(await order(page)).toEqual([b, a, c])
    // The playhead goes to where the clip now begins, as with the Later button, and picking it up selected it.
    await expect.poll(() => positionMs(page)).toBe(1_000)
    await expect(clips(page).nth(1)).toHaveAttribute('aria-pressed', 'true')

    await undo(page).click()
    expect(await order(page)).toEqual([a, b, c])
    await redo(page).click()
    expect(await order(page)).toEqual([b, a, c])
    await reloadSaved(page)
    await expect(clips(page)).toHaveCount(3)
    expect(await order(page)).toEqual([b, a, c])
  })

  test('moves a clip earlier when it is dragged back past the middle of the one before it', async ({ page }) => {
    const [a, b, c] = await openThree(page)
    await dragClip(page, clips(page).nth(2), -700)
    expect(await order(page)).toEqual([a, c, b])
    await expect.poll(() => positionMs(page)).toBe(2_000)
  })

  test('can take a clip past several, to either end', async ({ page }) => {
    const [a, b, c] = await openThree(page)
    // A's front edge, at 2 s, has to pass the middle of C, at 3.5 s: so past B and C both. (The drags stay inside the window,
    // where every browser reports the pointer.)
    await dragClip(page, clips(page).nth(0), 1_600)
    expect(await order(page)).toEqual([b, c, a])
    await dragClip(page, clips(page).nth(2), -1_600)
    expect(await order(page)).toEqual([a, b, c])
  })

  test('is lifted and drawn where the pointer has taken it, with a mark where it will go, until it is let go', async ({ page }) => {
    await openThree(page)
    const before = await clips(page).nth(0).boundingBox()
    await dragClip(page, clips(page).nth(0), 700, { release: false })
    const clip = clips(page).nth(0)
    await expect(clip).toHaveClass(/moving/)
    const after = await clip.boundingBox()
    const zoom = Number(await page.getByTestId('timeline').getAttribute('data-zoom'))
    expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0) - 700 * zoom)).toBeLessThan(3)
    // The mark is at the end of B, where the front of A will be.
    await expect(page.getByTestId('guide')).toBeVisible()
    await expect(page.getByTestId('guide')).toHaveAttribute('data-time', '3000')
    await page.mouse.up()
    await expect(page.getByTestId('guide')).toHaveCount(0)
    await expect(page.locator('.timeline .clip.moving')).toHaveCount(0)
  })

  test('changes nothing when it is not dragged far enough to pass the middle of its neighbour', async ({ page }) => {
    const [a, b, c] = await openThree(page)
    await dragClip(page, clips(page).nth(0), 300, { release: false })
    // Lifted, but with no mark: it would go back where it was.
    await expect(clips(page).nth(0)).toHaveClass(/moving/)
    await expect(page.getByTestId('guide')).toHaveCount(0)
    await page.mouse.up()
    expect(await order(page)).toEqual([a, b, c])
    await expect(undo(page)).toBeDisabled()
  })

  test('is let go where it was by Escape, and that leaves no undo step', async ({ page }) => {
    const [a, b, c] = await openThree(page)
    await dragClip(page, clips(page).nth(0), 700, { release: false })
    await expect(clips(page).nth(0)).toHaveClass(/moving/)
    await page.keyboard.press('Escape')
    await expect(page.locator('.timeline .clip.moving')).toHaveCount(0)
    await page.mouse.move(300, 300, { steps: 4 })
    await page.mouse.up()
    expect(await order(page)).toEqual([a, b, c])
    await expect(undo(page)).toBeDisabled()
  })

  test('is the same move as the Later button makes', async ({ page }) => {
    const [a, b, c] = await openThree(page)
    await clips(page).nth(0).click()
    await page.getByTestId('later').click()
    const byButton = await order(page)
    await undo(page).click()
    expect(await order(page)).toEqual([a, b, c])
    await dragClip(page, clips(page).nth(0), 700)
    expect(await order(page)).toEqual(byButton)
    expect(byButton).toEqual([b, a, c])
  })

  test('is not what a press that moves at once does: that scrubs, on any clip, selected or not, as before', async ({ page }) => {
    const [a, b, c] = await openThree(page)
    await dragClip(page, clips(page).nth(1), -400, { hold: false })
    expect(await order(page)).toEqual([a, b, c])
    expect(await positionMs(page)).toBeGreaterThan(100)
    await expect(page.locator('.timeline .clip.moving')).toHaveCount(0)
    await clips(page).nth(1).click()
    await seekHome(page)
    await dragClip(page, clips(page).nth(1), -400, { hold: false })
    expect(await order(page)).toEqual([a, b, c])
    expect(await positionMs(page)).toBeGreaterThan(100)
    await expect(undo(page)).toBeDisabled()
  })

  test('is not what a press that moves before the hold is over does, even if it then goes on slowly: that scrubs', async ({ page }) => {
    const [a, b, c] = await openThree(page)
    const box = await clips(page).nth(0).boundingBox()
    if (!box) throw new Error('no clip')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2, { steps: 4 })
    await page.waitForTimeout(HOLD_MS)
    await expect(page.locator('.timeline .clip.moving')).toHaveCount(0)
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 4 })
    await page.mouse.up()
    expect(await order(page)).toEqual([a, b, c])
    expect(await positionMs(page)).toBeGreaterThan(100)
  })

  test('is picked up by holding still, which selects and lifts the clip, and letting go without moving changes nothing', async ({ page }) => {
    const [a, b, c] = await openThree(page)
    const box = await clips(page).nth(1).boundingBox()
    if (!box) throw new Error('no clip')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(HOLD_MS)
    await expect(clips(page).nth(1)).toHaveClass(/moving/)
    await expect(clips(page).nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('guide')).toHaveCount(0)
    await page.mouse.up()
    await expect(page.locator('.timeline .clip.moving')).toHaveCount(0)
    expect(await order(page)).toEqual([a, b, c])
    await expect(clips(page).nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(undo(page)).toBeDisabled()
  })

  test('is not picked up by a quick click, which selects the clip as before', async ({ page }) => {
    const [a, b, c] = await openThree(page)
    await clips(page).nth(1).click()
    await expect(clips(page).nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.timeline .clip.moving')).toHaveCount(0)
    expect(await order(page)).toEqual([a, b, c])
  })

  test('is not done to the only clip, which has nothing to change places with: holding does nothing, and a press that moves scrubs', async ({ page }) => {
    await page.goto('/')
    await pick(page, media('landscape.webm'))
    await expect(clips(page)).toHaveCount(1)
    await dragClip(page, clips(page).first(), -400, { release: false })
    await expect(page.locator('.timeline .clip.moving')).toHaveCount(0)
    await page.mouse.up()
    expect(await positionMs(page)).toBeGreaterThan(100)
  })

  test('leaves the edges of the selected clip for trimming, which needs no hold', async ({ page }) => {
    const [a, b, c] = await openThree(page)
    await clips(page).nth(0).click()
    const handle = await page.getByTestId('trim-end').boundingBox()
    if (!handle) throw new Error('no handle')
    const zoom = Number(await page.getByTestId('timeline').getAttribute('data-zoom'))
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 - 500 * zoom, handle.y + handle.height / 2, { steps: 8 })
    await page.mouse.up()
    expect(await order(page)).toEqual([a, b, c])
    await expect(page.getByTestId('timecode')).not.toContainText('/ 00:00:04:00')
    await expect(page.locator('.timeline .clip.moving')).toHaveCount(0)
  })

  test('is told of in the hint under the timeline', async ({ page }) => {
    await openThree(page)
    await expect(page.locator('.hint')).toContainText('Press and hold a clip, then drag it, to move it')
  })
})
