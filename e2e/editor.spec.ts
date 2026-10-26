import { expect, type Page, test } from '@playwright/test'
import { levelAt, media, nearLevel, pauseOncePast, pick, positionMs, seekTo, setClips, shownFrame, WEBKIT_CANNOT } from './helpers'

const LANDSCAPE_MS = 2_000

/** The timeline's box on screen, after scrolling it into view: a mouse can only reach what is inside the window. */
async function timelineBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  await page.getByTestId('timeline').scrollIntoViewIfNeeded()
  const box = await page.getByTestId('timeline').boundingBox()
  if (!box) throw new Error('no timeline')
  return box
}

async function open(page: Page, ...files: string[]): Promise<void> {
  await page.goto('/')
  await pick(page, files.map(media))
  await expect(page.getByTestId('preview')).toBeVisible()
  await expect.poll(async () => (await shownFrame(page)).ready).toBe(true)
}

/** Waits for the picture to show the frame at a time in landscape.webm. */
async function expectFrameAt(page: Page, sourceMs: number): Promise<void> {
  await expect
    .poll(async () => nearLevel((await shownFrame(page)).level, levelAt(sourceMs, LANDSCAPE_MS)), { message: `the picture should show the frame at ${sourceMs} ms` })
    .toBe(true)
}

test.describe('the preview', () => {
  test('shows the first frame, in the shape of the video', async ({ page }) => {
    await open(page, 'landscape.webm')
    await expectFrameAt(page, 0)
    await expect(page.getByTestId('timecode')).toHaveText('00:00:00:00 / 00:00:02:00')
    const box = await page.getByTestId('preview').boundingBox()
    expect((box?.width ?? 0) / (box?.height ?? 1)).toBeCloseTo(320 / 180, 1)
  })

  test('shows a phone video upright, in its own shape', async ({ page }) => {
    await open(page, 'portrait-rotated.mp4')
    const frame = await shownFrame(page)
    expect(frame.videoWidth).toBe(180)
    expect(frame.videoHeight).toBe(320)
    const box = await page.getByTestId('preview').boundingBox()
    expect((box?.width ?? 0) / (box?.height ?? 1)).toBeCloseTo(180 / 320, 1)
  })

  test('lands on the right frame when it moves, and on the last frame at the end', async ({ page }) => {
    await open(page, 'landscape.webm')
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(() => positionMs(page)).toBe(1_000)
    await expectFrameAt(page, 1_000)
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(() => positionMs(page)).toBe(2_000)
    await expectFrameAt(page, 1_960)
    await page.keyboard.press('Home')
    await expectFrameAt(page, 0)
    await page.keyboard.press('End')
    await expect(page.getByTestId('timecode')).toHaveText('00:00:02:00 / 00:00:02:00')
  })

  test('steps a frame at a time', async ({ page }) => {
    await open(page, 'landscape.webm')
    await page.getByTestId('frame-forward').click()
    await expect(page.getByTestId('timecode')).toContainText('00:00:00:01')
    await page.getByTestId('frame-forward').click()
    await expect(page.getByTestId('timecode')).toContainText('00:00:00:02')
    await page.getByTestId('frame-back').click()
    await expect(page.getByTestId('timecode')).toContainText('00:00:00:01')
    await page.getByTestId('frame-back').click()
    await page.getByTestId('frame-back').click()
    await expect(page.getByTestId('timecode')).toContainText('00:00:00:00')
  })

  test('plays, advances, pauses on the frame it is at, and plays again from the start after the end', async ({ page }) => {
    await open(page, 'landscape.webm')
    await page.getByTestId('play').click()
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'true')
    await expect.poll(() => positionMs(page)).toBeGreaterThan(300)

    await page.getByTestId('play').click()
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'false')
    const paused = await positionMs(page)
    await page.waitForTimeout(300)
    expect(await positionMs(page)).toBe(paused)
    await expectFrameAt(page, Math.floor(paused / 40) * 40)

    await page.getByTestId('play').click()
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'false', { timeout: 10_000 })
    expect(await positionMs(page)).toBe(LANDSCAPE_MS)
    await expectFrameAt(page, 1_960)

    await page.getByTestId('play').click()
    await expect.poll(() => positionMs(page)).toBeLessThan(1_500)
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'true')
  })

  test('plays across a cut between pieces that do not continue each other', async ({ page }) => {
    await open(page, 'landscape.webm')
    // The first 0.8 s, then 1.6 s to 2 s of the recording: the cut is at 0.8 s of the edit.
    await setClips(page, [[0, 800], [1_600, 2_000]])
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:01:06')
    await expect.poll(async () => (await shownFrame(page)).ready).toBe(true)

    await page.keyboard.press('Home')
    await expectFrameAt(page, 0)
    await page.getByTestId('next-cut').click()
    await expect.poll(() => positionMs(page)).toBe(800)
    await expectFrameAt(page, 1_600)
    await page.getByTestId('previous-cut').click()
    await expect.poll(() => positionMs(page)).toBe(0)

    await page.getByTestId('play').click()
    await pauseOncePast(page, 1_000)
    const at = await positionMs(page)
    // 1.0 s of the edit is 0.2 s into the second piece, which is 1.8 s of the recording.
    await expectFrameAt(page, 1_600 + (at - 800))
  })

  test('plays straight through the cut of a split', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', WEBKIT_CANNOT.split)
    await open(page, 'landscape.webm')
    await setClips(page, [[0, 1_000], [1_000, 2_000]])
    await expect.poll(async () => (await shownFrame(page)).ready).toBe(true)
    await page.keyboard.press('Home')
    await page.getByTestId('play').click()
    await pauseOncePast(page, 1_200)
    const at = await positionMs(page)
    await expectFrameAt(page, at)
  })

  test('keeps playing from a new place when the playhead is moved during play', async ({ page }) => {
    await open(page, 'landscape.webm')
    await page.getByTestId('play').click()
    await expect.poll(() => positionMs(page)).toBeGreaterThan(100)
    await page.getByTestId('next-cut').click()
    await expect.poll(() => positionMs(page)).toBe(LANDSCAPE_MS)
  })

  test('says so when the browser cannot play a video', async ({ page }) => {
    await open(page, 'landscape.webm')
    await page.evaluate(() => {
      for (const video of document.querySelectorAll('[data-testid=preview] video')) video.dispatchEvent(new Event('error'))
    })
    await expect(page.getByRole('alert')).toContainText('could not play')
  })
})

test.describe('the transport and shortcuts', () => {
  test('jumps from cut to cut', async ({ page }) => {
    await open(page, 'landscape.webm', 'silent.webm')
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:03:00')
    await page.getByTestId('next-cut').click()
    await expect(page.getByTestId('timecode')).toContainText('00:00:02:00 /')
    await page.getByTestId('next-cut').click()
    await expect(page.getByTestId('timecode')).toContainText('00:00:03:00 /')
    await page.getByTestId('previous-cut').click()
    await expect(page.getByTestId('timecode')).toContainText('00:00:02:00 /')
    await page.getByTestId('previous-cut').click()
    await page.getByTestId('previous-cut').click()
    await expect(page.getByTestId('timecode')).toContainText('00:00:00:00 /')
  })

  test('plays and pauses with the space bar, and steps with the arrow keys', async ({ page }) => {
    await open(page, 'landscape.webm')
    await page.keyboard.press('Space')
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'true')
    await page.keyboard.press('Space')
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'false')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('timecode')).toContainText('00:00:00:01')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('timecode')).toContainText('00:00:00:00')
  })

  test('leaves the keys alone while a name is being typed', async ({ page }) => {
    await open(page, 'landscape.webm')
    await page.getByRole('button', { name: 'Rename' }).click()
    const field = page.getByLabel('Project name')
    await field.press('Space')
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'false')
  })
})

test.describe('the timeline', () => {
  test('shows each clip as a button and selects one', async ({ page }) => {
    await open(page, 'landscape.webm', 'silent.webm')
    const first = page.getByRole('button', { name: /^Clip 1, from 0:00 to 0:02/ })
    const second = page.getByRole('button', { name: /^Clip 2, from 0:02 to 0:03/ })
    await expect(first).toHaveAttribute('aria-pressed', 'false')
    await first.click()
    await expect(first).toHaveAttribute('aria-pressed', 'true')
    await second.press('Enter')
    await expect(second).toHaveAttribute('aria-pressed', 'true')
    await expect(first).toHaveAttribute('aria-pressed', 'false')
    await second.press('Enter')
    await expect(second).toHaveAttribute('aria-pressed', 'false')
  })

  test('deselects when the empty part of the timeline is clicked', async ({ page }) => {
    await open(page, 'landscape.webm')
    const clip = page.getByRole('button', { name: /^Clip 1/ })
    await clip.click()
    await expect(clip).toHaveAttribute('aria-pressed', 'true')
    // At the start the left half of the timeline is before the edit and holds no clip.
    const box = await timelineBox(page)
    await page.mouse.click(box.x + 20, box.y + 70)
    await expect(clip).toHaveAttribute('aria-pressed', 'false')
  })

  test('scrubs when it is dragged: the playhead moves the other way and the picture follows', async ({ page }) => {
    await open(page, 'landscape.webm')
    const timeline = page.getByTestId('timeline')
    const zoom = Number(await timeline.getAttribute('data-zoom'))
    const box = await timelineBox(page)
    const y = box.y + 70
    const x = box.x + box.width / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    // Dragging left by the width of 1.2 s moves the playhead to 1.2 s.
    await page.mouse.move(x - 600 * zoom, y, { steps: 6 })
    await page.mouse.move(x - 1_200 * zoom, y, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => positionMs(page)).toBeGreaterThan(1_100)
    expect(await positionMs(page)).toBeLessThan(1_300)
    const settled = await positionMs(page)
    await expectFrameAt(page, Math.floor(settled / 40) * 40)
  })

  test('moves the playhead when the ruler is tapped', async ({ page }) => {
    await open(page, 'landscape.webm')
    const timeline = page.getByTestId('timeline')
    const zoom = Number(await timeline.getAttribute('data-zoom'))
    const box = await timelineBox(page)
    await page.mouse.click(box.x + box.width / 2 + 1_000 * zoom, box.y + 10)
    await expect.poll(() => positionMs(page)).toBeGreaterThan(950)
    expect(await positionMs(page)).toBeLessThan(1_050)
  })

  test('scrubs with the wheel and zooms with ctrl and the wheel', async ({ page }) => {
    await open(page, 'landscape.webm')
    const timeline = page.getByTestId('timeline')
    const box = await timelineBox(page)
    await page.mouse.move(box.x + box.width / 2, box.y + 60)
    const zoom = Number(await timeline.getAttribute('data-zoom'))
    await page.mouse.wheel(500 * zoom, 0)
    await expect.poll(() => positionMs(page)).toBeGreaterThan(450)
    expect(await positionMs(page)).toBeLessThan(550)

    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -100)
    await page.keyboard.up('Control')
    await expect.poll(async () => Number(await timeline.getAttribute('data-zoom'))).toBeGreaterThan(zoom * 1.5)
  })

  test('zooms with the buttons, inside the limits', async ({ page }) => {
    await open(page, 'landscape.webm')
    const timeline = page.getByTestId('timeline')
    const farthest = Number(await timeline.getAttribute('data-zoom'))
    await expect(page.getByTestId('zoom-out')).toBeDisabled()
    await page.getByTestId('zoom-in').click()
    await expect.poll(async () => Number(await timeline.getAttribute('data-zoom'))).toBeCloseTo(farthest * 1.5, 5)
    await page.getByTestId('zoom-out').click()
    await expect.poll(async () => Number(await timeline.getAttribute('data-zoom'))).toBeCloseTo(farthest, 5)
    for (let i = 0; i < 20; i++) {
      if (await page.getByTestId('zoom-in').isDisabled()) break
      await page.getByTestId('zoom-in').click()
    }
    await expect(page.getByTestId('zoom-in')).toBeDisabled()
    // One frame at 30 fps is 34 ms, drawn 24 px wide at the closest zoom.
    expect(Number(await timeline.getAttribute('data-zoom'))).toBeCloseTo(24 / 34, 4)
  })

  test('draws a ruler with labels that stay apart', async ({ page }) => {
    await open(page, 'landscape.webm')
    const ticks = page.locator('.timeline .tick')
    await expect.poll(() => ticks.count()).toBeGreaterThan(1)
    const boxes = await ticks.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left))
    for (let i = 1; i < boxes.length; i++) expect((boxes[i] ?? 0) - (boxes[i - 1] ?? 0)).toBeGreaterThanOrEqual(70)
  })

  test('stays left to right in Hebrew, and the labels are in Hebrew', async ({ page }) => {
    await open(page, 'landscape.webm')
    await page.getByRole('button', { name: 'עברית' }).click()
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByTestId('timeline')).toBeVisible()
    expect(await page.getByTestId('timeline').evaluate((el) => getComputedStyle(el).direction)).toBe('ltr')
    expect(await page.locator('.transport').evaluate((el) => getComputedStyle(el).direction)).toBe('ltr')
    await expect(page.getByRole('button', { name: 'הפעלה' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^קטע 1, מ-0:00 עד 0:02/ })).toBeVisible()
    const play = await page.getByTestId('play').boundingBox()
    const next = await page.getByTestId('next-cut').boundingBox()
    expect((next?.x ?? 0) > (play?.x ?? 0)).toBe(true)
  })

  test('shows the empty edit and disables the transport when every clip is gone', async ({ page }) => {
    await open(page, 'landscape.webm')
    await setClips(page, [])
    await expect(page.getByText('The edit is empty')).toBeVisible()
    await expect(page.getByTestId('play')).toBeDisabled()
  })
})

test.describe('leaving the page', () => {
  test('lets go of the pictures when the page is left, and does not when it is kept for going back to', async ({ page }) => {
    await open(page, 'landscape.webm')
    const pictures = page.locator('[data-testid=preview] video')
    await expect(pictures).not.toHaveCount(0)
    // A page that goes into the browser's memory for the back button comes back as it was, so it is left alone.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
    await expect(pictures).not.toHaveCount(0)
    // A page that is going for good lets go of its pictures and decoders itself, as a reload that hangs the browser has shown to matter.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })))
    await expect(pictures).toHaveCount(0)
  })
})

test.describe('playing right after a jump', () => {
  test('starts from the place the jump went to, even when Play comes before the picture has caught up with it', async ({ page }) => {
    await open(page, 'landscape.webm', 'silent.webm')
    // Every seek of a video is made to take a third of a second, so that the picture is never there when Play comes.
    await page.evaluate(() => {
      const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
      if (!time?.set) throw new Error('No currentTime to slow down')
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
        ...time,
        set(this: HTMLMediaElement, seconds: number) {
          setTimeout(() => time.set?.call(this, seconds), 300)
        },
      })
    })
    // Whether the playhead was taken back by the picture before play started depends on timing, so it is tried a number of times.
    for (let round = 0; round < 6; round++) {
      await seekTo(page, 1_500)
      await page.waitForTimeout(450)
      // Home and Space in the same breath: the jump to the start has been asked for, but the picture has not got there
      // when play starts. On a slow machine, or with a long recording, that is what a quick person does too. The first
      // place the playhead is seen past 150 ms is read in the page, frame by frame, as a read from here is a round trip
      // that takes as long as a browser's driver takes, which is a second in some.
      const firstSeen = await page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            for (const key of ['Home', ' ']) document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
            const preview = document.querySelector('[data-testid=preview]')
            const began = performance.now()
            const look = (): void => {
              const position = Number(preview?.getAttribute('data-position-ms'))
              if (preview?.getAttribute('data-playing') === 'true' && position > 150) resolve(position)
              else if (performance.now() - began > 8_000) reject(new Error(`The playhead stayed at ${position} ms`))
              else requestAnimationFrame(look)
            }
            look()
          }),
      )
      await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'true')
      // It has been playing from the start, not from where the playhead was before the jump.
      expect(firstSeen, `round ${round}`).toBeLessThan(1_000)
      await page.keyboard.press('Space')
      await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'false')
    }
  })
})
