import { expect, type Page, test } from '@playwright/test'
import { audio, clearHistory, media, pick, positionMs, seekTo } from './helpers'

/**
 * The timeline under a finger. A touch is sent to the browser as real touch input, through Chromium's devtools protocol, which is
 * what makes pointer events of the touch kind and lets the browser decide between a drag along the timeline and a scroll of the
 * page. The other browsers of these tests cannot be given touches that move, only taps, which phone.spec.ts has.
 */
test.skip(({ browserName }) => browserName !== 'chromium', 'Touches that move are sent through the devtools protocol of Chromium')
test.use({ hasTouch: true, isMobile: true })

interface Finger {
  x: number
  y: number
}

/** One or two fingers on the screen, which come down, move in steps, and go up. */
async function fingers(page: Page) {
  const client = await page.context().newCDPSession(page)
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Finger[]): Promise<unknown> =>
    client.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((point, id) => ({ x: point.x, y: point.y, id })) })
  const between = (from: Finger, to: Finger, share: number): Finger => ({ x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share })
  return {
    down: (...points: Finger[]) => send('touchStart', points),
    /**
     * The finger leaves the screen. Chromium does not make a click of a tap that comes within the next moment, which a person's
     * finger takes to get to the next thing anyway, so this waits a little.
     */
    async up(): Promise<void> {
      await send('touchEnd', [])
      await page.waitForTimeout(350)
    },
    /** Moves every finger from where it is to where it is going, in a number of steps. */
    async move(from: Finger[], to: Finger[], steps = 10): Promise<void> {
      for (let step = 1; step <= steps; step++) await send('touchMove', from.map((point, index) => between(point, to[index] ?? point, step / steps)))
    },
  }
}

const timeline = (page: Page) => page.getByTestId('timeline')
const clips = (page: Page) => page.locator('.timeline .clip')
const zoomOf = async (page: Page): Promise<number> => Number(await timeline(page).getAttribute('data-zoom'))

/** Where the timeline is on the screen, brought fully into view. */
async function surface(page: Page): Promise<{ x: number; y: number; width: number; height: number; centre: number }> {
  await timeline(page).scrollIntoViewIfNeeded()
  const box = await timeline(page).boundingBox()
  if (!box) throw new Error('The timeline is not on the screen')
  return { ...box, centre: box.x + box.width / 2 }
}

async function openTwo(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('landscape.webm'), media('silent.webm')])
  await expect(clips(page)).toHaveCount(2)
  await clearHistory(page)
  await expect.poll(() => positionMs(page)).toBe(0)
}

/** Where the tools are shown a set at a time, the set that a button is in is chosen before it is pressed. */
async function goTo(page: Page, tab: 'edit' | 'trim' | 'text' | 'sound'): Promise<void> {
  const bar = page.getByTestId(`tab-${tab}`)
  if (await bar.isVisible()) await bar.tap()
}

const sources = (page: Page): Promise<string[]> => clips(page).evaluateAll((elements) => elements.map((element) => element.getAttribute('data-source') ?? ''))

const VIEWS = [
  { name: 'upright', width: 390, height: 844 },
  { name: 'on its side', width: 740, height: 360 },
]

for (const view of VIEWS) {
  test.describe(`a finger on the timeline, ${view.name}`, () => {
    test.use({ viewport: { width: view.width, height: view.height } })

    test('drags along it to scrub, and the page does not scroll with it, whichever way the finger drifts', async ({ page }) => {
      await openTwo(page)
      const box = await surface(page)
      const scrolled = await page.evaluate(() => window.scrollY)
      const touch = await fingers(page)
      const start = { x: box.centre + 40, y: box.y + 80 }
      await touch.down(start)
      // Left, and a good way up as well: the page would go with it if the timeline did not take the touch.
      await touch.move([start], [{ x: start.x - 120, y: start.y - 50 }])
      await touch.up()
      expect(await positionMs(page)).toBeGreaterThan(500)
      expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
      await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'false')
    })

    test('taps the ruler to put the playhead there, and a clip to select it', async ({ page }) => {
      await openTwo(page)
      const box = await surface(page)
      await page.touchscreen.tap(box.centre + 100, box.y + 10)
      await expect.poll(() => positionMs(page)).toBeGreaterThan(400)
      await expect(clips(page).first()).toHaveAttribute('aria-pressed', 'false')
      await clips(page).first().tap()
      await expect(clips(page).first()).toHaveAttribute('aria-pressed', 'true')
    })

    test('pinches to zoom, and back', async ({ page }) => {
      await openTwo(page)
      const box = await surface(page)
      const y = box.y + 80
      const before = await zoomOf(page)
      const touch = await fingers(page)
      const near = [{ x: box.centre - 30, y }, { x: box.centre + 30, y }]
      const far = [{ x: box.centre - 100, y }, { x: box.centre + 100, y }]
      await touch.down(...near)
      await touch.move(near, far)
      await touch.up()
      const zoomedIn = await zoomOf(page)
      expect(zoomedIn).toBeGreaterThan(before * 1.5)
      await touch.down(...far)
      await touch.move(far, near)
      await touch.up()
      expect(await zoomOf(page)).toBeLessThan(zoomedIn * 0.7)
    })

    test('drags the end of the selected clip to trim it', async ({ page }) => {
      await openTwo(page)
      await seekTo(page, 1_500)
      await clips(page).first().tap()
      await expect(clips(page).first()).toHaveAttribute('aria-pressed', 'true')
      const before = await clips(page).first().boundingBox()
      if (!before) throw new Error('No clip')
      const touch = await fingers(page)
      // A little inside the end of the clip, where a finger comes down on its edge.
      const edge = { x: before.x + before.width - 8, y: before.y + before.height / 2 }
      await touch.down(edge)
      await touch.move([edge], [{ x: edge.x - 40, y: edge.y }])
      await touch.up()
      // From 2 seconds to less than that: the width on the screen is not a measure, as the timeline zooms to fit what is left.
      await expect(clips(page).first().locator('.label')).not.toContainText('0:02')
    })

    test('holds a clip to pick it up, and moves it past the next one', async ({ page }) => {
      await openTwo(page)
      await seekTo(page, 1_500)
      const first = await sources(page)
      const box = await clips(page).first().boundingBox()
      if (!box) throw new Error('No clip')
      const touch = await fingers(page)
      const grip = { x: box.x + 30, y: box.y + box.height / 2 }
      await touch.down(grip)
      // Held still for longer than it takes to pick a clip up, then taken across the other clip.
      await page.waitForTimeout(600)
      await touch.move([grip], [{ x: grip.x + 260, y: grip.y }], 16)
      await touch.up()
      await expect.poll(() => sources(page)).toEqual([...first].reverse())
      // One undo step.
      await page.getByRole('button', { name: 'Undo' }).tap()
      await expect.poll(() => sources(page)).toEqual(first)
    })

    test('moves a piece of music by dragging it, and opens a title or a piece of music with a tap', async ({ page }) => {
      await openTwo(page)
      await seekTo(page, 1_000)
      // Through the button, as a person does, which is what notes where the playhead is.
      const chooser = page.waitForEvent('filechooser')
      await goTo(page, 'sound')
      await page.getByTestId('add-music').tap()
      await (await chooser).setFiles(audio('tone.wav'))
      const bar = page.locator('.timeline .audio-bar').first()
      await expect(bar).toHaveCount(1)
      const startedAt = Number(await bar.getAttribute('data-start'))
      const box = await bar.boundingBox()
      if (!box) throw new Error('No piece of music')
      const touch = await fingers(page)
      const grip = { x: box.x + 20, y: box.y + box.height / 2 }
      await touch.down(grip)
      await touch.move([grip], [{ x: grip.x - 30, y: grip.y }])
      await touch.up()
      await expect.poll(async () => Number(await bar.getAttribute('data-start'))).toBeLessThan(startedAt - 100)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      // A tap opens it.
      await bar.tap()
      await expect(page.getByTestId('audio-save')).toBeVisible()
      await page.getByTestId('audio-cancel').tap()
      await goTo(page, 'text')
      await page.getByTestId('add-text').tap()
      await page.getByTestId('text-field').fill('Hi')
      await page.getByTestId('text-save').tap()
      await page.locator('.timeline .cue').first().tap()
      await expect(page.getByTestId('text-save')).toBeVisible()
    })
  })
}
