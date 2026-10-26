import { expect, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { audio, clearHistory, media, pick, WEBKIT_CANNOT, withMicrophones } from './helpers'

/**
 * The site on a phone: a screen of 360 pixels or so across, touched with a finger. Every press here is a tap, because a click of
 * a mouse tells the browser that the main way of pointing is a mouse, and the taller rows that a touch screen gets would go.
 */
test.use({ hasTouch: true })

const SIZES = [
  { name: 'a small phone upright', width: 360, height: 640 },
  { name: 'a large phone upright', width: 412, height: 915 },
  { name: 'a phone on its side', width: 740, height: 360 },
  { name: 'a short phone on its side', width: 667, height: 300 },
]

const dialog = (page: Page) => page.locator('dialog[open]')
const clips = (page: Page) => page.locator('.timeline .clip')

/** Where the tools are shown a set at a time, the set that a button is in is chosen before it is pressed. */
async function goTo(page: Page, tab: 'edit' | 'trim' | 'text' | 'sound'): Promise<void> {
  const bar = page.getByTestId(`tab-${tab}`)
  if (await bar.isVisible()) await bar.tap()
}

async function open(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize({ width: size.width, height: size.height })
  await page.goto('/')
  await pick(page, [media('landscape.webm'), media('silent.webm')])
  await expect(clips(page)).toHaveCount(2)
  await clearHistory(page)
  // The page was loaded again: the editor has to be back before anything is pressed in it.
  await expect(clips(page)).toHaveCount(2)
}

/** A title and a piece of music, which are the two rows under the clips. */
async function addTitleAndMusic(page: Page): Promise<void> {
  await goTo(page, 'text')
  await page.getByTestId('add-text').tap()
  await page.getByTestId('text-field').fill('Hello')
  await page.getByTestId('text-save').tap()
  await expect(page.locator('.timeline .cue')).toHaveCount(1)
  await page.getByTestId('music-input').setInputFiles(audio('tone.wav'))
  await expect(page.locator('.timeline .audio-bar')).toHaveCount(1)
}

const sideways = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

/** The dialog is inside the window, its buttons are wholly in sight, and none of the form shows under them. */
async function expectFits(page: Page, size: { width: number; height: number }, button: string): Promise<void> {
  await expect(page.getByTestId(button)).toBeInViewport({ ratio: 1 })
  const box = await dialog(page).boundingBox()
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0)
  expect((box?.y ?? 0) + (box?.height ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(size.height)
  expect((box?.x ?? -1) + 0.5).toBeGreaterThanOrEqual(0)
  expect((box?.x ?? 0) + (box?.width ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(size.width + 0.5)
  // Where the dialog scrolls, its buttons are stuck to the bottom edge: the box has no padding under them for the form to show in.
  const scrolled = await dialog(page).evaluate((element) => {
    const bar = element.querySelector('form.dialog-form > .buttons:last-child')
    if (!bar || element.scrollHeight <= element.clientHeight) return null
    element.scrollTop = 0
    return element.getBoundingClientRect().bottom - parseFloat(getComputedStyle(element).borderBottomWidth) - bar.getBoundingClientRect().bottom
  })
  if (scrolled !== null) {
    expect(scrolled).toBeGreaterThanOrEqual(-0.5)
    expect(scrolled).toBeLessThanOrEqual(1.5)
  }
}

for (const size of SIZES) {
  test.describe(`on ${size.name}, ${size.width} by ${size.height}`, () => {
    test('nothing scrolls sideways, on the list of projects or in the editor with its rows', async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto('/')
      await expect(page.getByText('No projects yet')).toBeVisible()
      expect(await sideways(page)).toBeLessThanOrEqual(0)
      await open(page, size)
      expect(await sideways(page)).toBeLessThanOrEqual(0)
      await addTitleAndMusic(page)
      expect(await sideways(page)).toBeLessThanOrEqual(0)
    })

    test('every button is at least 44 pixels each way, and the rows of titles and music are tall enough for a finger', async ({ page }) => {
      await open(page, size)
      await addTitleAndMusic(page)
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('main button, header.site button, footer.site button')]
          .map((button) => ({ label: button.textContent?.trim() || button.getAttribute('aria-label') || button.dataset['testid'] || '?', box: button.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 43.5 || box.height < 43.5))
          .map(({ label, box }) => `${label}: ${Math.round(box.width)} by ${Math.round(box.height)}`),
      )
      expect(small).toEqual([])
      const cue = await page.locator('.timeline .cue').first().boundingBox()
      const bar = await page.locator('.timeline .audio-bar').first().boundingBox()
      expect(cue?.height ?? 0).toBeGreaterThanOrEqual(28)
      expect(bar?.height ?? 0).toBeGreaterThanOrEqual(34)
    })

    test('the dialogs are in the window with their buttons in sight', async ({ page }) => {
      await open(page, size)
      await addTitleAndMusic(page)
      await goTo(page, 'text')
      await page.getByTestId('add-text').tap()
      await expectFits(page, size, 'text-save')
      await page.getByTestId('text-cancel').tap()
      await page.locator('.timeline .audio-bar').first().tap()
      await expectFits(page, size, 'audio-save')
      await page.getByTestId('audio-cancel').tap()
      await clips(page).first().tap()
      await goTo(page, 'sound')
      await page.getByTestId('volume').tap()
      await expectFits(page, size, 'clip-volume-save')
      await page.getByTestId('clip-volume-cancel').tap()
      await page.getByTestId('fades').tap()
      await expectFits(page, size, 'master-save')
      await page.getByTestId('master-cancel').tap()
      await page.getByTestId('export').tap()
      await expectFits(page, size, 'export-start')
    })

    test('the choices of a dialog are rows a finger can hit, and a stepper keeps its two buttons together', async ({ page }) => {
      await open(page, size)
      await goTo(page, 'text')
      await page.getByTestId('add-text').tap()
      const row = await page.getByTestId('text-size-large').locator('xpath=ancestor::label').boundingBox()
      expect(row?.height ?? 0).toBeGreaterThanOrEqual(39.5)
      const earlier = await page.getByTestId('text-earlier').boundingBox()
      const later = await page.getByTestId('text-later').boundingBox()
      expect(Math.abs((earlier?.y ?? 0) - (later?.y ?? 100))).toBeLessThan(1)
      expect((later?.x ?? 0) + (later?.width ?? 0)).toBeLessThanOrEqual(size.width)
    })
  })
}

test.describe('the page is set up for a touch screen', () => {
  test('it keeps the pull to refresh and the double tap zoom from getting in the way, and the keyboard from covering a dialog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    const set = await page.evaluate(() => ({
      overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY,
      touchAction: getComputedStyle(document.body).touchAction,
      viewport: document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '',
    }))
    expect(set.overscroll).toBe('none')
    expect(set.touchAction).toBe('manipulation')
    expect(set.viewport).toContain('width=device-width')
    expect(set.viewport).toContain('interactive-widget=resizes-content')
    // A pinch still zooms the page: the zoom is not switched off.
    expect(set.viewport).not.toMatch(/user-scalable|maximum-scale/)
  })

  test('the timeline takes the touches that are on it, so that dragging along it does not scroll the page', async ({ page }) => {
    await open(page, { width: 390, height: 844 })
    expect(await page.getByTestId('timeline').evaluate((element) => getComputedStyle(element).touchAction)).toBe('none')
  })

  test('a press that is held on the timeline does not bring up the browser’s menu, and a click of a mouse still does', async ({ page, browserName }) => {
    await open(page, { width: 390, height: 844 })
    const timeline = page.getByTestId('timeline')
    const asked = (): Promise<boolean> => timeline.evaluate((element) => !element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    await clips(page).first().tap()
    expect(await asked()).toBe(true)
    // Firefox with touch switched on makes a touch of every click of the mouse, so there the mouse cannot be told apart.
    if (browserName === 'firefox') return
    const box = await timeline.boundingBox()
    await page.mouse.click((box?.x ?? 0) + 20, (box?.y ?? 0) + 10)
    expect(await asked()).toBe(false)
  })
})

const UPRIGHT = SIZES.filter((size) => size.height > size.width)

/** A phone held upright: the editor is one screen, with the tools in a line under the timeline and the picture taking what is left. */
for (const size of UPRIGHT) {
  test.describe(`held upright, ${size.width} by ${size.height}`, () => {
    test('the picture, the timeline, the tabs, a line of tools and the project buttons are all in sight together', async ({ page }) => {
      await open(page, size)
      await addTitleAndMusic(page)
      await goTo(page, 'edit')
      await page.evaluate(() => window.scrollTo(0, 0))
      for (const id of ['preview', 'play', 'timeline', 'tab-edit', 'tab-sound', 'split', 'export']) await expect(page.getByTestId(id), id).toBeInViewport({ ratio: 1 })
      await expect(page.getByRole('button', { name: 'Undo' })).toBeInViewport({ ratio: 1 })
      await expect(page.getByRole('button', { name: 'Redo' })).toBeInViewport({ ratio: 1 })
      await expect(page.getByTestId('zoom-in')).toBeInViewport({ ratio: 1 })
    })

    test('the picture is in its own shape, the shape its captions are drawn for, whether the video is wide or tall', async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      for (const file of ['landscape.webm', 'portrait-rotated.mp4']) {
        await page.goto('/')
        await pick(page, [media(file)])
        await expect(clips(page)).toHaveCount(1)
        const preview = page.getByTestId('preview')
        await expect.poll(async () => (await preview.boundingBox())?.height ?? 0).toBeGreaterThan(96)
        const box = await preview.boundingBox()
        const aspect = Number(await preview.evaluate((element) => (element as HTMLElement).style.getPropertyValue('--aspect')))
        expect(aspect, file).toBeGreaterThan(0)
        expect(Math.abs((box?.width ?? 0) / (box?.height ?? 1) / aspect - 1), file).toBeLessThan(0.02)
        expect(box?.width ?? 0, file).toBeLessThanOrEqual(size.width)
      }
    })
  })
}

test('on a short screen the picture is not squeezed smaller than a thumbnail, and the page scrolls for the rest', async ({ page }) => {
  await open(page, { width: 360, height: 520 })
  await addTitleAndMusic(page)
  const box = await page.getByTestId('preview').boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(95)
  expect(await sideways(page)).toBeLessThanOrEqual(0)
})

for (const size of SIZES) {
  test(`on ${size.name} the buttons are shown a set at a time, chosen from the tabs`, async ({ page }) => {
    await open(page, size)
    const sets = {
      edit: ['split', 'remove', 'duplicate', 'earlier', 'later'],
      trim: ['trim-start-here', 'trim-end-here', 'range-tool', 'remove-range', 'snapping'],
      text: ['add-text', 'import-subtitles'],
      sound: ['volume', 'add-music', 'fades', 'record'],
    } as const
    for (const [name, shown] of Object.entries(sets)) {
      await page.getByTestId(`tab-${name}`).tap()
      await expect(page.getByTestId(`tab-${name}`)).toHaveAttribute('aria-selected', 'true')
      for (const [other, buttons] of Object.entries(sets)) {
        for (const button of buttons) await (other === name ? expect(page.getByTestId(button), button).toBeVisible() : expect(page.getByTestId(button), `${button} under ${name}`).toBeHidden())
      }
      expect(shown.length).toBeGreaterThan(0)
    }
  })
}

test.describe('a wide screen', () => {
  test.use({ hasTouch: false, viewport: { width: 1280, height: 720 } })

  test('has no tabs, and every button at once, as it always had', async ({ page }) => {
    await page.goto('/')
    await pick(page, [media('landscape.webm')])
    await expect(clips(page)).toHaveCount(1)
    await expect(page.getByTestId('tab-edit')).toBeHidden()
    for (const id of ['split', 'trim-start-here', 'snapping', 'add-text', 'volume', 'add-music', 'record']) await expect(page.getByTestId(id), id).toBeVisible()
  })
})

test('a long name of a project stays in its line, and the language and links are under the editor, not above it', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto('/')
  const name = 'A long name for a video that goes on and on and on and on.webm'
  await pick(page, { name, mimeType: 'video/webm', buffer: readFileSync(media('landscape.webm')) })
  await expect(clips(page)).toHaveCount(1)
  expect(await sideways(page)).toBeLessThanOrEqual(0)
  const rename = await page.getByRole('button', { name: 'Rename' }).boundingBox()
  expect((rename?.x ?? 0) + (rename?.width ?? 0)).toBeLessThanOrEqual(360)
  const bar = await page.locator('.project-bar').evaluate((element) => ({ fits: element.scrollWidth <= element.clientWidth, height: element.getBoundingClientRect().height }))
  expect(bar.fits).toBe(true)
  // The editor is the first thing on the page; the language and the links come after it, as in a page that is read from the top.
  const places = await page.evaluate(() => ({
    main: document.querySelector('main')?.getBoundingClientRect().toJSON() as DOMRect,
    header: document.querySelector('header.site')?.getBoundingClientRect().toJSON() as DOMRect,
    footer: document.querySelector('footer.site')?.getBoundingClientRect().toJSON() as DOMRect,
  }))
  expect(places.main.top).toBeLessThan(places.header.top)
  expect(places.header.top).toBeGreaterThanOrEqual(places.main.bottom - 1)
  expect(places.footer.top).toBeGreaterThanOrEqual(places.header.bottom - 1)
  // And on the list of projects they are where they always were.
  await page.goto('/#/')
  await expect(page.getByText(/Your projects/)).toBeVisible()
  const home = await page.evaluate(() => ({ header: document.querySelector('header.site')?.getBoundingClientRect().top ?? -1, main: document.querySelector('main')?.getBoundingClientRect().top ?? -1 }))
  expect(home.header).toBeLessThan(home.main)
})

test.describe('while a voiceover is recorded', () => {
  test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_CANNOT.record)

  test('the other tabs are locked, so that the recording and its level stay in sight, and open again when it is done', async ({ page }) => {
    await withMicrophones(page, [{ id: 'mic-a', label: 'A microphone' }], {})
    await open(page, { width: 390, height: 844 })
    await goTo(page, 'sound')
    await page.getByTestId('record').tap()
    await expect(page.getByTestId('recording')).toBeVisible()
    await expect(page.getByTestId('tab-edit')).toBeDisabled()
    await expect(page.getByTestId('tab-text')).toBeDisabled()
    await expect(page.getByTestId('tab-sound')).toBeEnabled()
    await expect(page.getByTestId('recording-level')).toBeInViewport()
    await page.getByTestId('record').tap()
    await expect(page.getByTestId('tab-edit')).toBeEnabled({ timeout: 15_000 })
  })
})

const ON_ITS_SIDE = SIZES.filter((size) => size.width > size.height)

/** A phone held on its side: the picture on the left, the tabs, tools and transport on the right, the zoom and the timeline along the bottom. */
for (const size of ON_ITS_SIDE) {
  test.describe(`on its side, ${size.width} by ${size.height}`, () => {
    test('the picture, the tabs, the transport, the timeline and the project buttons are all in sight together', async ({ page }) => {
      await open(page, size)
      await page.evaluate(() => window.scrollTo(0, 0))
      for (const id of ['preview', 'play', 'previous-cut', 'next-cut', 'timeline', 'tab-edit', 'tab-sound', 'zoom-in', 'zoom-out', 'timecode', 'export', 'split']) await expect(page.getByTestId(id), id).toBeInViewport({ ratio: 1 })
      await expect(page.getByRole('button', { name: 'Undo' })).toBeInViewport({ ratio: 1 })
      await expect(page.getByRole('button', { name: 'Redo' })).toBeInViewport({ ratio: 1 })
      expect(await sideways(page)).toBeLessThanOrEqual(0)
    })

    test('the picture is in its own shape, the time is on it, and the tools take no more room than they are given', async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      for (const file of ['landscape.webm', 'portrait-rotated.mp4']) {
        await page.goto('/')
        await pick(page, [media(file)])
        await expect(clips(page)).toHaveCount(1)
        const preview = page.getByTestId('preview')
        await expect.poll(async () => (await preview.boundingBox())?.height ?? 0).toBeGreaterThan(96)
        const box = await preview.boundingBox()
        const aspect = Number(await preview.evaluate((element) => (element as HTMLElement).style.getPropertyValue('--aspect')))
        expect(Math.abs((box?.width ?? 0) / (box?.height ?? 1) / aspect - 1), file).toBeLessThan(0.02)
        // The time is drawn on the picture's own part of the screen, which has no row to spare for it.
        const picture = await page.locator('.picture').boundingBox()
        const time = await page.getByTestId('timecode').boundingBox()
        expect(time?.x ?? -1, file).toBeGreaterThanOrEqual((picture?.x ?? 0) - 1)
        expect((time?.x ?? 0) + (time?.width ?? 0), file).toBeLessThanOrEqual((picture?.x ?? 0) + (picture?.width ?? 0) + 1)
        expect(time?.y ?? -1, file).toBeGreaterThanOrEqual((picture?.y ?? 0) - 1)
        expect((time?.y ?? 0) + (time?.height ?? 0), file).toBeLessThanOrEqual((picture?.y ?? 0) + (picture?.height ?? 0) + 1)
      }
    })

    test('changing the tab changes the tools and moves nothing else, however many buttons the tab has', async ({ page }) => {
      await open(page, size)
      const places = async (): Promise<number[]> => {
        const boxes = await Promise.all(['preview', 'timeline', 'play', 'tab-edit'].map((id) => page.getByTestId(id).boundingBox()))
        return boxes.flatMap((box) => [Math.round(box?.x ?? -1), Math.round(box?.y ?? -1), Math.round(box?.width ?? -1), Math.round(box?.height ?? -1)])
      }
      const first = await places()
      for (const tab of ['trim', 'text', 'sound', 'edit'] as const) {
        await goTo(page, tab)
        expect(await places(), tab).toEqual(first)
      }
    })

    test('a notice is laid over the picture, and takes no row of its own', async ({ page }) => {
      await open(page, size)
      const before = await page.getByTestId('timeline').boundingBox()
      // A split at the very start of the edit has nothing to split, and says so.
      await page.getByTestId('split').tap()
      await expect(page.getByTestId('notice')).not.toBeEmpty()
      const notice = await page.getByTestId('notice').boundingBox()
      const picture = await page.locator('.picture').boundingBox()
      expect(notice?.y ?? -1).toBeGreaterThanOrEqual((picture?.y ?? 0) - 1)
      expect((notice?.y ?? 0) + (notice?.height ?? 0)).toBeLessThanOrEqual((picture?.y ?? 0) + (picture?.height ?? 0) + 1)
      expect(await page.getByTestId('timeline').boundingBox()).toEqual(before)
    })
  })
}

test('on its side with a title and music on the timeline the page scrolls for what does not fit, and nothing is lost', async ({ page }) => {
  await open(page, { width: 740, height: 360 })
  await addTitleAndMusic(page)
  expect(await sideways(page)).toBeLessThanOrEqual(0)
  const picture = await page.getByTestId('preview').boundingBox()
  expect(picture?.height ?? 0).toBeGreaterThanOrEqual(95)
  for (const selector of ['.timeline .cue', '.timeline .audio-bar']) {
    const box = await page.locator(selector).first().boundingBox()
    expect(box?.height ?? 0, selector).toBeGreaterThanOrEqual(28)
  }
})
