import { expect, type Locator, type Page, test } from '@playwright/test'
import { clearHistory, levelAt, media, nearLevel, pauseOncePast, pick, positionMs, reloadSaved, shownFrame, WEBKIT_CANNOT } from './helpers'

const clipButtons = (page: Page): Locator => page.locator('.timeline .clip')
const clipList = (page: Page): Locator => page.getByTestId('clips').locator('li')

/** Opens a project of landscape.webm (2 s) followed by silent.webm (1 s): two clips, three seconds. */
async function openTwo(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('landscape.webm'), media('silent.webm')])
  await expect(clipButtons(page)).toHaveCount(2)
  // Adding the second video was an undoable edit: start the test with nothing to undo.
  await clearHistory(page)
  await expect(clipButtons(page)).toHaveCount(2)
  await expect(page.getByTestId('timecode')).toContainText('/ 00:00:03:00')
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  await expect.poll(async () => (await shownFrame(page)).ready).toBe(true)
}

async function timelineGeometry(page: Page): Promise<{ x: number; y: number; width: number; zoom: number }> {
  await page.getByTestId('timeline').scrollIntoViewIfNeeded()
  const box = await page.getByTestId('timeline').boundingBox()
  if (!box) throw new Error('no timeline')
  return { x: box.x, y: box.y, width: box.width, zoom: Number(await page.getByTestId('timeline').getAttribute('data-zoom')) }
}

/** Presses on a clip's edge, drags it by a number of milliseconds of the edit, and optionally lets go. */
async function dragEdge(page: Page, clip: Locator, edge: 'start' | 'end', byMs: number, release = true): Promise<void> {
  const { zoom, y } = await timelineGeometry(page)
  const box = await clip.boundingBox()
  if (!box) throw new Error('no clip')
  const x = edge === 'end' ? box.x + box.width - 5 : box.x + 5
  await page.mouse.move(x, y + 70)
  await page.mouse.down()
  await page.mouse.move(x + (byMs * zoom) / 2, y + 70, { steps: 4 })
  await page.mouse.move(x + byMs * zoom, y + 70, { steps: 4 })
  if (release) await page.mouse.up()
}

test.describe('splitting', () => {
  test('cuts the clip under the playhead in two and keeps the playhead, the length and the picture', async ({ page }) => {
    await openTwo(page)
    await page.keyboard.press('Shift+ArrowRight')
    await expect(page.getByTestId('timecode')).toContainText('00:00:01:00 /')
    await page.getByTestId('split').click()
    await expect(clipButtons(page)).toHaveCount(3)
    await expect(page.getByRole('button', { name: /^Clip 1, from 0:00 to 0:01/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Clip 2, from 0:01 to 0:02/ })).toBeVisible()
    await expect(page.getByTestId('timecode')).toHaveText('00:00:01:00 / 00:00:03:00')
    await expect(clipList(page)).toHaveCount(3)
    expect(nearLevel((await shownFrame(page)).level, levelAt(1_000, 2_000))).toBe(true)
  })

  test('plays straight on through the cut it made', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', WEBKIT_CANNOT.split)
    await openTwo(page)
    await page.keyboard.press('Shift+ArrowRight')
    await page.getByTestId('split').click()
    await page.keyboard.press('Home')
    await page.getByTestId('play').click()
    await pauseOncePast(page, 1_300)
    const at = await positionMs(page)
    await expect.poll(async () => nearLevel((await shownFrame(page)).level, levelAt(at, 2_000))).toBe(true)
  })

  test('can be undone and done again, and the buttons say when there is nothing to undo', async ({ page }) => {
    await openTwo(page)
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
    await page.keyboard.press('Shift+ArrowRight')
    await page.getByTestId('split').click()
    await expect(clipButtons(page)).toHaveCount(3)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(clipButtons(page)).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled()
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect(clipButtons(page)).toHaveCount(3)
  })

  test('on a cut changes nothing, says so, and costs no undo step', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('split').click()
    await expect(page.getByTestId('notice')).toContainText('Nothing to change here')
    await expect(clipButtons(page)).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('is saved: it is still there after a reload, with its history', async ({ page }) => {
    await openTwo(page)
    await page.keyboard.press('Shift+ArrowRight')
    await page.getByTestId('split').click()
    await expect(clipButtons(page)).toHaveCount(3)
    await reloadSaved(page)
    await expect(clipButtons(page)).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(clipButtons(page)).toHaveCount(2)
  })
})

test.describe('removing, duplicating and moving a clip', () => {
  test('removing the selected clip closes the gap, puts the playhead where it was and clears the selection', async ({ page }) => {
    await openTwo(page)
    const buttons = clipButtons(page)
    await expect(page.getByTestId('remove')).toBeDisabled()
    await buttons.nth(0).click()
    await expect(page.getByTestId('remove')).toBeEnabled()
    await page.getByTestId('remove').click()
    await expect(buttons).toHaveCount(1)
    await expect(page.getByTestId('timecode')).toHaveText('00:00:00:00 / 00:00:01:00')
    await expect(page.getByTestId('remove')).toBeDisabled()
    await expect(clipList(page).first()).toContainText('silent.webm')
  })

  test('duplicating the selected clip puts a copy after it', async ({ page }) => {
    await openTwo(page)
    await clipButtons(page).nth(0).click()
    await page.getByTestId('duplicate').click()
    await expect(clipButtons(page)).toHaveCount(3)
    await expect(page.getByTestId('timecode')).toHaveText('00:00:02:00 / 00:00:05:00')
    await expect(clipList(page).nth(0)).toContainText('landscape.webm')
    await expect(clipList(page).nth(1)).toContainText('landscape.webm')
    await expect(clipList(page).nth(2)).toContainText('silent.webm')
  })

  test('moving a clip later and earlier swaps it with its neighbour, and keeps it selected', async ({ page }) => {
    await openTwo(page)
    await clipButtons(page).nth(0).click()
    await expect(page.getByTestId('earlier')).toBeDisabled()
    await page.getByTestId('later').click()
    await expect(clipList(page).nth(0)).toContainText('silent.webm')
    await expect(clipList(page).nth(1)).toContainText('landscape.webm')
    await expect(clipButtons(page).nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('later')).toBeDisabled()
    await page.getByTestId('earlier').click()
    await expect(clipList(page).nth(0)).toContainText('landscape.webm')
    await expect(clipButtons(page).nth(0)).toHaveAttribute('aria-pressed', 'true')
  })

  test('the edits are saved one after another and all of them survive a reload', async ({ page }) => {
    await openTwo(page)
    await clipButtons(page).nth(0).click()
    await page.getByTestId('duplicate').click()
    await clipButtons(page).nth(2).click()
    await page.getByTestId('earlier').click()
    await expect(clipList(page).nth(1)).toContainText('silent.webm')
    await reloadSaved(page)
    await expect(clipList(page)).toHaveCount(3)
    await expect(clipList(page).nth(1)).toContainText('silent.webm')
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:05:00')
  })
})

test.describe('the range tool', () => {
  test('appears at the playhead for two seconds and removes that stretch', async ({ page }) => {
    await openTwo(page)
    await expect(page.getByTestId('remove-range')).toBeDisabled()
    await page.getByTestId('range-tool').click()
    const range = page.getByTestId('range')
    await expect(range).toHaveAttribute('data-start', '0')
    await expect(range).toHaveAttribute('data-end', '2000')
    await page.getByTestId('remove-range').click()
    await expect(page.getByTestId('timecode')).toHaveText('00:00:00:00 / 00:00:01:00')
    await expect(page.getByTestId('range')).toHaveCount(0)
    await expect(clipButtons(page)).toHaveCount(1)
  })

  test('has edges that can be dragged, falling on whole frames and holding at least one frame', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('range-tool').click()
    await page.getByTestId('snapping').click()
    const { x, width, y, zoom } = await timelineGeometry(page)
    const middle = x + width / 2
    // The end edge is at 2 s, 2 s to the right of the playhead at the centre.
    await page.mouse.move(middle + 2_000 * zoom, y + 70)
    await page.mouse.down()
    await page.mouse.move(middle + 1_700 * zoom, y + 70, { steps: 5 })
    await page.mouse.move(middle + 1_500 * zoom, y + 70, { steps: 5 })
    await page.mouse.up()
    const end = Number(await page.getByTestId('range').getAttribute('data-end'))
    expect(end).toBeGreaterThan(1_400)
    expect(end).toBeLessThan(1_600)
    expect(Math.round((end * 30) / 1000) * 1000 / 30).toBeCloseTo(end, -1)
    await page.getByTestId('remove-range').click()
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:01:')
  })

  test('is closed by pressing the tool again or Escape', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('range-tool').click()
    await expect(page.getByTestId('range')).toBeVisible()
    await page.getByTestId('range-tool').click()
    await expect(page.getByTestId('range')).toHaveCount(0)
    await page.getByTestId('range-tool').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('range')).toHaveCount(0)
  })

  test('is cut down when an edit makes the video shorter', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('range-tool').click()
    await clipButtons(page).nth(0).click()
    await page.getByTestId('remove').click()
    // Only the 1 s clip is left: the 2 s range is cut to fit it.
    await expect(page.getByTestId('range')).toHaveAttribute('data-end', '1000')
  })
})

test.describe('trimming by dragging an edge', () => {
  test('shows handles on the selected clip only', async ({ page }) => {
    await openTwo(page)
    await expect(page.getByTestId('trim-end')).toHaveCount(0)
    await clipButtons(page).nth(0).click()
    await expect(page.getByTestId('trim-start')).toHaveCount(1)
    await expect(page.getByTestId('trim-end')).toHaveCount(1)
  })

  test('shortens the clip from its end, drawing the result while dragging and saving it on release', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('snapping').click()
    const first = clipButtons(page).nth(0)
    await first.click()
    const before = (await first.boundingBox())?.width ?? 0
    await dragEdge(page, first, 'end', -700, false)
    // Still holding: the clip is drawn shorter, but nothing is saved.
    await expect.poll(async () => (await first.boundingBox())?.width ?? 0).toBeLessThan(before - 50)
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:03:00')
    await page.mouse.up()
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:02:')
    const total = await page.getByTestId('timecode').innerText()
    expect(total).toMatch(/\/ 00:00:02:(0[5-9]|1\d|2[0-4])$/)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:03:00')
  })

  test('shortens the clip from its start, which drops footage from the front', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('snapping').click()
    const second = clipButtons(page).nth(1)
    await second.click()
    await dragEdge(page, second, 'start', 300)
    // The 1 s clip lost about 0.3 s: the edit is about 2.7 s long.
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:02:')
    expect(await page.getByTestId('timecode').innerText()).toMatch(/\/ 00:00:02:(1[6-9]|2[0-6])$/)
  })

  test('sticks to the playhead when snapping is on, and falls on a frame when it is off', async ({ page }) => {
    await openTwo(page)
    await page.keyboard.press('Shift+ArrowRight')
    await expect(page.getByTestId('timecode')).toContainText('00:00:01:00 /')
    const first = clipButtons(page).nth(0)
    await first.click()

    // Dragging the 2 s edge to about 1.03 s: with snapping it sticks to the playhead at 1.0 s and shows a guide.
    await dragEdge(page, first, 'end', -970, false)
    await expect(page.getByTestId('guide')).toHaveAttribute('data-time', '1000')
    await page.mouse.up()
    await expect(page.getByTestId('guide')).toHaveCount(0)
    await expect(page.getByTestId('timecode')).toHaveText('00:00:01:00 / 00:00:02:00')
    await page.getByRole('button', { name: 'Undo' }).click()

    await page.getByTestId('snapping').click()
    await dragEdge(page, clipButtons(page).nth(0), 'end', -970)
    // 1.03 s falls on frame 31 of 30 per second: 1033 ms, 2 s and 3 frames... the edit is 2 s and 1 frame long.
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:02:01')
  })

  test('cannot reveal footage the recording does not have', async ({ page }) => {
    await openTwo(page)
    await clipButtons(page).nth(0).click()
    await dragEdge(page, clipButtons(page).nth(0), 'end', 600)
    // landscape.webm is used to its last frame already: nothing changes and no undo step is made.
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:03:00')
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('reveals footage that is there: shortening, then lengthening again', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('snapping').click()
    await clipButtons(page).nth(0).click()
    await dragEdge(page, clipButtons(page).nth(0), 'end', -700)
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:02:')
    await dragEdge(page, clipButtons(page).nth(0), 'end', 700)
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:03:0')
  })

  test('a plain drag across a narrow selected clip still scrubs', async ({ page }) => {
    await openTwo(page)
    const second = clipButtons(page).nth(1)
    await second.click()
    const box = await second.boundingBox()
    const { y } = await timelineGeometry(page)
    if (!box) throw new Error('no clip')
    // In the middle of the clip, away from its edges, a drag moves the playhead and trims nothing.
    await page.mouse.move(box.x + box.width / 2, y + 70)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 60, y + 70, { steps: 4 })
    await page.mouse.up()
    await expect.poll(() => positionMs(page)).toBeGreaterThan(100)
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })
})

test.describe('the keys', () => {
  test('S splits, Delete removes the selected clip, Ctrl+Z undoes and Ctrl+Shift+Z does it again', async ({ page }) => {
    await openTwo(page)
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('s')
    await expect(clipButtons(page)).toHaveCount(3)
    await clipButtons(page).nth(2).click()
    await page.keyboard.press('Delete')
    await expect(clipButtons(page)).toHaveCount(2)
    await page.keyboard.press('Control+z')
    await expect(clipButtons(page)).toHaveCount(3)
    await page.keyboard.press('Control+Shift+z')
    await expect(clipButtons(page)).toHaveCount(2)
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await expect(clipButtons(page)).toHaveCount(2)
    await page.keyboard.press('Control+y')
    await expect(clipButtons(page)).toHaveCount(3)
  })

  test('Ctrl+D duplicates, the brackets move the clip, and Escape lets go of it', async ({ page }) => {
    await openTwo(page)
    await clipButtons(page).nth(0).click()
    await page.keyboard.press(']')
    await expect(clipList(page).nth(0)).toContainText('silent.webm')
    await page.keyboard.press('[')
    await expect(clipList(page).nth(0)).toContainText('landscape.webm')
    await page.keyboard.press('Control+d')
    await expect(clipButtons(page)).toHaveCount(3)
    await clipButtons(page).nth(0).click()
    await page.keyboard.press('Escape')
    await expect(clipButtons(page).nth(0)).toHaveAttribute('aria-pressed', 'false')
  })

  test('Space plays even when a clip has the focus, and the keys wait while a name is typed', async ({ page }) => {
    await openTwo(page)
    await clipButtons(page).nth(0).click()
    await page.keyboard.press('Space')
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'true')
    await page.keyboard.press('Space')
    await page.getByRole('button', { name: 'Rename' }).click()
    const field = page.getByLabel('Project name')
    await field.fill('Name with s and Delete')
    await field.press('Delete')
    await field.press('Control+z')
    await expect(clipButtons(page)).toHaveCount(2)
  })

  test('an edit stops playback', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('play').click()
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'true')
    await page.getByTestId('split').click()
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'false')
  })
})

test.describe('editing in Hebrew', () => {
  test('has the buttons and the refusals in Hebrew', async ({ page }) => {
    await openTwo(page)
    await page.getByRole('button', { name: 'עברית' }).click()
    await expect(page.getByRole('button', { name: 'פיצול כאן' })).toBeVisible()
    await page.getByRole('button', { name: 'פיצול כאן' }).click()
    await expect(page.getByTestId('notice')).toContainText('אין מה לשנות כאן')
    await expect(page.getByRole('button', { name: 'הסרת הטווח' })).toBeDisabled()
  })
})

test.describe('trimming to the playhead, from the keyboard', () => {
  test('Q brings the start of the selected clip to the playhead, and W the end, each as one undo step', async ({ page }) => {
    await openTwo(page)
    await clipButtons(page).nth(0).click()
    await page.keyboard.press('Shift+ArrowRight')
    await expect(page.getByTestId('timecode')).toContainText('00:00:01:00 /')
    await page.keyboard.press('q')
    // The first second of the first clip is gone, and the playhead is at the start of what is left.
    await expect(page.getByRole('button', { name: /^Clip 1, from 0:00 to 0:01/ })).toBeVisible()
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:02:00')
    await expect(page.getByTestId('timecode')).toContainText('00:00:00:00 /')
    await expect.poll(async () => nearLevel((await shownFrame(page)).level, levelAt(1_000, 2_000))).toBe(true)

    // Half a second on, 15 frames.
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('timecode')).toContainText('00:00:00:15 /')
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()
    await page.keyboard.press('w')
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:01:15')
    await expect(page.getByRole('button', { name: /^Clip 1, from 0:00 to 0:00/ })).toBeVisible()

    await page.keyboard.press('Control+z')
    await expect(page.getByRole('button', { name: /^Clip 1, from 0:00 to 0:01/ })).toBeVisible()
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:03:00')
  })

  test('the buttons do the same, and are for a selected clip only', async ({ page }) => {
    await openTwo(page)
    await expect(page.getByTestId('trim-start-here')).toBeDisabled()
    await expect(page.getByTestId('trim-end-here')).toBeDisabled()
    await clipButtons(page).nth(0).click()
    await page.keyboard.press('Shift+ArrowRight')
    await page.getByTestId('trim-end-here').click()
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:02:00')
    await expect(page.getByTestId('timecode')).toContainText('00:00:01:00 /')
    await page.getByTestId('trim-start-here').click()
    // The playhead is at the end of the clip: only a frame is left to keep of it, not nothing.
    await expect(page.getByRole('button', { name: /^Clip 1, from 0:00 to 0:00/ })).toBeVisible()
  })

  test('says so when the edge is already at the playhead', async ({ page }) => {
    await openTwo(page)
    await clipButtons(page).nth(0).click()
    await page.keyboard.press('q')
    await expect(page.getByTestId('notice')).toContainText('Nothing to change here')
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('is in the app’s language: Hebrew', async ({ page }) => {
    await openTwo(page)
    await page.getByRole('button', { name: 'עברית' }).click()
    await expect(page.getByTestId('trim-start-here')).toHaveText('קיצור ההתחלה עד הסמן')
    await expect(page.getByTestId('trim-end-here')).toHaveText('קיצור הסוף עד הסמן')
  })
})
