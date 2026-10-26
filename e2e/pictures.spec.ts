import { expect, type Locator, type Page, test } from '@playwright/test'
import { clearHistory, levelAt, media, nearLevel, pick, seekTo, shownFrame, reload } from './helpers'

const clips = (page: Page): Locator => page.locator('.timeline .clip')

interface Tiles {
  readonly times: number[]
  readonly widths: number[]
  readonly drawn: number
  /** The brightness at the top left corner of each tile, 0 to 255, or -1 where nothing is drawn. */
  readonly levels: number[]
}

/** What the strip on a clip shows: the moment each tile is of, and the brightness actually painted in it. */
async function tilesOf(page: Page, index: number): Promise<Tiles> {
  return page.evaluate((i) => {
    const canvas = document.querySelectorAll<HTMLCanvasElement>('.timeline .clip canvas.strip')[i]
    if (!canvas) return { times: [], widths: [], drawn: 0, levels: [] }
    const numbers = (text: string | undefined): number[] => (text ? text.split(',').map(Number) : [])
    const times = numbers(canvas.dataset['times'])
    const xs = numbers(canvas.dataset['xs'])
    const widths = numbers(canvas.dataset['widths'])
    const scale = canvas.width / Number.parseFloat(canvas.style.width)
    const context = canvas.getContext('2d')
    const levels = xs.map((x) => {
      if (!context) return -1
      // A little in from the tile's corner, and no further than the last column: a tile at the end of a narrow strip may be a sliver.
      const column = Math.min(Math.round((Math.max(x, 0) + 3) * scale), canvas.width - 1)
      const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(column, Math.round(3 * scale), 1, 1).data
      return a === 0 ? -1 : 0.2126 * r + 0.7152 * g + 0.0722 * b
    })
    return { times, widths, drawn: Number(canvas.dataset['drawn']), levels }
  }, index)
}

/** Waits until every tile of a clip's strip has its own frame, and returns them. */
async function filled(page: Page, index = 0): Promise<Tiles> {
  await expect
    .poll(async () => {
      const tiles = await tilesOf(page, index)
      return tiles.times.length > 0 && tiles.drawn === tiles.times.length && tiles.levels.every((level) => level >= 0)
    })
    .toBe(true)
  return tilesOf(page, index)
}

async function open(page: Page, ...files: string[]): Promise<void> {
  await page.goto('/')
  await pick(page, files.map(media))
  await expect(clips(page)).toHaveCount(files.length)
  await expect.poll(async () => (await shownFrame(page)).ready).toBe(true)
}

test.describe('the pictures on the clips', () => {
  test('show the recording, each tile at its own moment, brighter as the test video is later', async ({ page }) => {
    await open(page, 'landscape.webm')
    const tiles = await filled(page)
    expect(tiles.times.length).toBeGreaterThan(2)
    for (let i = 0; i < tiles.times.length; i++) {
      expect(nearLevel(tiles.levels[i] ?? -1, levelAt(tiles.times[i] ?? 0, 2_000), 10), `tile ${i} at ${tiles.times[i]} ms is ${tiles.levels[i]}`).toBe(true)
    }
    expect(tiles.times).toEqual([...tiles.times].sort((a, b) => a - b))
    expect(new Set(tiles.times).size).toBe(tiles.times.length)
    expect(tiles.levels[tiles.levels.length - 1] ?? 0).toBeGreaterThan((tiles.levels[0] ?? 255) + 40)
    // The pictures are in the shape of the recording, 16 by 9.
    expect((tiles.widths[0] ?? 0) / 58).toBeCloseTo(16 / 9, 1)
  })

  test('are in the shape of a phone video as it is seen, upright', async ({ page }) => {
    await open(page, 'portrait-rotated.mp4')
    const tiles = await filled(page)
    expect((tiles.widths[0] ?? 0) / 58).toBeCloseTo(9 / 16, 1)
    expect(tiles.times.length).toBeGreaterThan(5)
  })

  test('are cut with the clip: after a split each half shows its own part of the recording', async ({ page }) => {
    await open(page, 'landscape.webm')
    await filled(page)
    await seekTo(page, 1_000)
    await page.getByTestId('split').click()
    await expect(clips(page)).toHaveCount(2)
    const first = await filled(page, 0)
    const second = await filled(page, 1)
    for (const time of first.times) expect(time).toBeLessThan(1_000)
    for (const time of second.times) expect(time).toBeGreaterThanOrEqual(1_000)
    for (let i = 0; i < second.times.length; i++) {
      expect(nearLevel(second.levels[i] ?? -1, levelAt(second.times[i] ?? 0, 2_000), 10)).toBe(true)
    }
  })

  test('follow a removal: the clips that are left keep their pictures, and a recording of another shape has its own', async ({ page }) => {
    await open(page, 'landscape.webm', 'silent.webm')
    const wide = await filled(page, 0)
    const small = await filled(page, 1)
    // silent.webm is 160 by 90: the same shape, so the same tile width.
    expect(small.widths[0]).toBe(wide.widths[0])
    for (let i = 0; i < small.times.length; i++) {
      expect(nearLevel(small.levels[i] ?? -1, levelAt(small.times[i] ?? 0, 1_000), 10)).toBe(true)
    }
    await clips(page).first().click()
    await page.getByTestId('remove').click()
    await expect(clips(page)).toHaveCount(1)
    await filled(page, 0)
  })

  test('are read again as the timeline is zoomed in, so the tiles keep showing the frames that are under them', async ({ page }) => {
    // In a narrow window the whole of a 2 s video is not already at the closest zoom.
    await page.setViewportSize({ width: 480, height: 900 })
    await open(page, 'landscape.webm')
    const far = await filled(page)
    for (let i = 0; i < 4; i++) await page.getByTestId('zoom-in').click()
    const near = await filled(page)
    // Other moments are shown: the frames were read again for the closer view, as many tiles as there may be.
    expect(near.times).not.toEqual(far.times)
    for (let i = 0; i < near.times.length; i++) {
      expect(nearLevel(near.levels[i] ?? -1, levelAt(near.times[i] ?? 0, 2_000), 10), `tile ${i} at ${near.times[i]} ms`).toBe(true)
    }
  })

  test('do not get in the way: a click on a clip selects it, and the picture and the label stay', async ({ page }) => {
    await open(page, 'landscape.webm')
    await filled(page)
    await clips(page).first().click()
    await expect(clips(page).first()).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.timeline .clip .label')).toBeVisible()
    await expect(page.getByTestId('trim-start')).toBeVisible()
    await clearHistory(page)
  })

  test('are not in the way of deleting: the page is not taken down when a project is deleted while its pictures are being read', async ({ page, browserName }) => {
    // A decoder closed in the middle of a frame took a Firefox page down with it, about once in fifteen times: so it is tried
    // many times. Chromium never did, and the tries are slow, so they are left to the browsers that might.
    test.skip(browserName === 'chromium', 'Only the other browsers took the page down')
    test.setTimeout(180_000)
    let crashes = 0
    page.on('crash', () => crashes++)
    await page.goto('/')
    for (let i = 0; i < 24; i++) {
      await pick(page, media('landscape.webm'))
      await page.getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
      await expect(page).toHaveURL(/#\/$/)
      await expect(page.getByText('No projects yet')).toBeVisible()
    }
    expect(crashes).toBe(0)
  })

  test('are made again when the project is opened again', async ({ page }) => {
    await open(page, 'landscape.webm')
    await filled(page)
    await expect(page.locator('main[data-saving=false]')).toBeVisible()
    await reload(page)
    await expect(clips(page)).toHaveCount(1)
    const tiles = await filled(page)
    expect(nearLevel(tiles.levels[0] ?? -1, levelAt(tiles.times[0] ?? 0, 2_000), 10)).toBe(true)
  })
})
