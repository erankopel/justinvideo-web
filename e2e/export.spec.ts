import { expect, type Page, test } from '@playwright/test'
import { audio, clearHistory, exportVideo, inspectFile, levelAt, media, nearLevel, pick, positionMs, readBack, reloadSaved, removeStoredMedia, seekTo, setClips, WEBKIT_CANNOT } from './helpers'

test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_CANNOT.encode)

test.describe.configure({ timeout: 90_000 })

const clips = (page: Page) => page.locator('.timeline .clip')
const bars = (page: Page) => page.locator('.timeline .audio-bar')

/** The steady tone of landscape.webm is 0.3 at its peak, which is 0.212 as root mean square. */
const LANDSCAPE_RMS = 0.3 / Math.SQRT2
/** And that of tone.wav is 0.5 at its peak. */
const TONE_RMS = 0.5 / Math.SQRT2

async function openTwo(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('landscape.webm'), media('silent.webm')])
  await expect(clips(page)).toHaveCount(2)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(2)
  await expect.poll(() => positionMs(page)).toBe(0)
}

async function openOne(page: Page, file = 'landscape.webm'): Promise<void> {
  await page.goto('/')
  await pick(page, media(file))
  await expect(clips(page)).toHaveCount(1)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(1)
}

async function openSilent(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('silent.webm'), media('silent.webm'), media('silent.webm')])
  await expect(clips(page)).toHaveCount(3)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(3)
}

async function addMusic(page: Page): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('add-music').click()
  await (await chooser).setFiles(audio('tone.wav'))
  await expect(bars(page)).toHaveCount(1)
}

async function closeExport(page: Page): Promise<void> {
  await page.getByTestId('export-close').click()
  await expect(page.getByRole('dialog')).toBeHidden()
}

/** The files left in the site's private file system for exports that were not handed over. */
async function leftovers(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const names: string[] = []
    try {
      const folder = await root.getDirectoryHandle('exports')
      for await (const [name] of (folder as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) names.push(name)
    } catch {
      // No folder, no files.
    }
    return names
  })
}

test.describe('an exported video', () => {
  test('has the edit’s length, every frame of it and its sound, in the shape of the footage', async ({ page }) => {
    await openTwo(page)
    const exported = await exportVideo(page)
    expect(exported.fileName).toMatch(/^landscape-\d{8}-\d{6}\.(webm|mp4)$/)
    const facts = await inspectFile(exported.path)
    // Wide at 720p, as the first clip is landscape and small.
    expect(facts.video).toMatchObject({ width: 1280, height: 720 })
    expect(['vp9', 'avc']).toContain(facts.video?.codec)
    // Two seconds and one second at 25 frames: every frame, none repeated or lost, at the recording's own rate.
    expect(facts.video?.packets).toBe(75)
    expect(facts.video?.rate).toBeCloseTo(25, 0)
    expect(facts.duration).toBeGreaterThan(2.95)
    expect(facts.duration).toBeLessThan(3.06)
    expect(facts.audio).toMatchObject({ rate: 48_000, channels: 2 })
    expect(['opus', 'aac']).toContain(facts.audio?.codec)
    expect(facts.audio?.duration).toBeGreaterThan(2.9)
    expect(facts.audio?.duration).toBeLessThan(3.1)

    const read = await readBack(page, exported.href, { times: [0.3, 1.0, 1.7], sound: [[0.2, 1.8], [2.2, 2.9]] })
    // The frames are the ones of the recording, in order: its brightness names each frame.
    expect(nearLevel(read.levels[0] ?? -1, levelAt(300, 2000), 14)).toBe(true)
    expect(nearLevel(read.levels[1] ?? -1, levelAt(1000, 2000), 14)).toBe(true)
    expect(nearLevel(read.levels[2] ?? -1, levelAt(1700, 2000), 14)).toBe(true)
    // The sound is the first clip's tone, then the silence of the second.
    expect(read.sound[0]).toBeGreaterThan(LANDSCAPE_RMS * 0.8)
    expect(read.sound[0]).toBeLessThan(LANDSCAPE_RMS * 1.2)
    expect(read.sound[1]).toBeLessThan(0.01)
    await closeExport(page)
  })

  test('loses and repeats no frame where a split joins two clips, and cuts cleanly where a part is removed', async ({ page }) => {
    await openOne(page)
    await setClips(page, [[0, 1000], [1000, 2000]])
    await expect(clips(page)).toHaveCount(2)
    const joined = await exportVideo(page)
    const whole = await inspectFile(joined.path)
    expect(whole.video?.packets).toBe(50)
    expect(whole.duration).toBeGreaterThan(1.95)
    expect(whole.duration).toBeLessThan(2.06)
    await closeExport(page)

    await setClips(page, [[0, 500], [1500, 2000]])
    await expect(clips(page)).toHaveCount(2)
    const cut = await exportVideo(page)
    const facts = await inspectFile(cut.path)
    expect(facts.video?.packets).toBeGreaterThanOrEqual(25)
    expect(facts.video?.packets).toBeLessThanOrEqual(27)
    expect(facts.duration).toBeGreaterThan(0.95)
    expect(facts.duration).toBeLessThan(1.06)
    // The second half shows the end of the recording: at 0.75 s of the export it is at 1.75 s of the recording.
    const read = await readBack(page, cut.href, { times: [0.1, 0.75] })
    expect(nearLevel(read.levels[0] ?? -1, levelAt(100, 2000), 14)).toBe(true)
    expect(nearLevel(read.levels[1] ?? -1, levelAt(1750, 2000), 14)).toBe(true)
    await closeExport(page)
  })

  test('starts at the part of the recording that the clip starts at', async ({ page }) => {
    await openOne(page)
    await setClips(page, [[1000, 2000]])
    await expect(clips(page)).toHaveCount(1)
    const exported = await exportVideo(page)
    const facts = await inspectFile(exported.path)
    expect(facts.video?.packets).toBe(25)
    const read = await readBack(page, exported.href, { times: [0.04, 0.5, 0.9] })
    expect(nearLevel(read.levels[0] ?? -1, levelAt(1040, 2000), 14)).toBe(true)
    expect(nearLevel(read.levels[1] ?? -1, levelAt(1500, 2000), 14)).toBe(true)
    expect(nearLevel(read.levels[2] ?? -1, levelAt(1900, 2000), 14)).toBe(true)
    await closeExport(page)
  })

  test('has the clip volumes of the edit: half, louder than the recording, and silent', async ({ page }) => {
    await openOne(page)
    for (const [preset, expected] of [[50, LANDSCAPE_RMS * 0.5], [150, LANDSCAPE_RMS * 1.5], [0, 0]] as const) {
      await clips(page).first().click()
      await page.getByTestId('volume').click()
      await page.getByTestId(`clip-volume-preset-${preset}`).click()
      await page.getByTestId('clip-volume-save').click()
      await expect(page.getByRole('dialog')).toBeHidden()
      const exported = await exportVideo(page)
      const read = await readBack(page, exported.href, { sound: [[0.3, 1.7]] })
      if (expected === 0) {
        expect(read.sound[0]).toBeLessThan(0.005)
      } else {
        expect(read.sound[0]).toBeGreaterThan(expected * 0.8)
        expect(read.sound[0]).toBeLessThan(expected * 1.2)
      }
      await closeExport(page)
    }
  })

  test('has the music at its place and its volume, and is no longer than the edit', async ({ page }) => {
    await openSilent(page)
    await seekTo(page, 1_000)
    const at = await positionMs(page)
    await addMusic(page)
    await bars(page).first().click()
    await page.getByTestId('audio-volume-preset-50').click()
    await page.getByTestId('audio-save').click()
    await expect(page.getByRole('dialog')).toBeHidden()
    const exported = await exportVideo(page)
    const facts = await inspectFile(exported.path)
    // The music goes on until 4 s, past the end of the three seconds of the edit, which it must not make longer.
    expect(facts.duration).toBeGreaterThan(2.95)
    expect(facts.duration).toBeLessThan(3.06)
    expect(facts.audio?.duration).toBeLessThan(3.1)
    const read = await readBack(page, exported.href, { sound: [[0.05, (at - 100) / 1000], [(at + 250) / 1000, 2.8]] })
    expect(read.sound[0]).toBeLessThan(0.01)
    expect(read.sound[1]).toBeGreaterThan(TONE_RMS * 0.5 * 0.8)
    expect(read.sound[1]).toBeLessThan(TONE_RMS * 0.5 * 1.2)
    await closeExport(page)
  })

  test('has the fades over the whole video: the sound rises from silence and falls to it', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await page.getByTestId('fades').click()
    for (let i = 0; i < 2; i++) {
      await page.getByTestId('master-fadein-longer').click()
      await page.getByTestId('master-fadeout-longer').click()
    }
    await page.getByTestId('master-save').click()
    await expect(page.getByRole('dialog')).toBeHidden()
    const exported = await exportVideo(page)
    const read = await readBack(page, exported.href, { sound: [[0, 0.12], [1.3, 1.7], [2.88, 3]] })
    expect(read.sound[0]).toBeLessThan(TONE_RMS * 0.15)
    expect(read.sound[1]).toBeGreaterThan(TONE_RMS * 0.85)
    expect(read.sound[1]).toBeLessThan(TONE_RMS * 1.15)
    expect(read.sound[2]).toBeLessThan(TONE_RMS * 0.15)
    await closeExport(page)
  })

  test('has a voiceover that was recorded, and silence after it', async ({ page }) => {
    await openSilent(page)
    await page.getByTestId('record').click()
    await expect(page.getByTestId('recording')).toBeVisible()
    await expect.poll(() => positionMs(page)).toBeGreaterThan(1_300)
    await page.getByTestId('record').click()
    await expect(bars(page)).toHaveCount(1)
    const end = Number(await bars(page).first().getAttribute('data-end'))
    const exported = await exportVideo(page)
    const windows: [number, number][] = []
    for (let t = 0.1; t < 1.2; t += 0.2) windows.push([t, t + 0.2])
    windows.push([end / 1000 + 0.2, 2.9])
    const read = await readBack(page, exported.href, { sound: windows })
    // The made-up microphone beeps and hums: somewhere in the voiceover there is sound, and after it there is none.
    expect(Math.max(...read.sound.slice(0, -1))).toBeGreaterThan(0.01)
    expect(read.sound[read.sound.length - 1]).toBeLessThan(0.002)
    await closeExport(page)
  })

  test('has the titles and captions burned into the pictures at their times', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('add-text').click()
    await page.getByTestId('text-field').fill('Hello')
    await page.getByTestId('text-size-large').check()
    for (let i = 0; i < 4; i++) await page.getByTestId('text-shorter').click()
    await expect(page.getByTestId('text-lasts')).toContainText('0:01.0')
    await page.getByTestId('text-save').click()
    await expect(page.getByRole('dialog')).toBeHidden()
    const exported = await exportVideo(page)
    // The text is white, in the middle of the bottom of the picture.
    const box = { x: 400, y: 560, width: 480, height: 120 }
    const read = await readBack(page, exported.href, {
      boxes: [
        { time: 0.5, ...box },
        { time: 2.5, ...box },
      ],
    })
    expect(read.bright[0]).toBeGreaterThan(0.02)
    expect(read.bright[1]).toBe(0)
    await closeExport(page)
  })

  test('is in the shape that was chosen, and fits or fills the footage', async ({ page }) => {
    await openOne(page)
    const fitted = await exportVideo(page, { shape: 'vertical', framing: 'fit' })
    const facts = await inspectFile(fitted.path)
    expect(facts.video).toMatchObject({ width: 720, height: 1280 })
    // Fitting a wide picture into a tall frame leaves bars: the corner is black.
    const fit = await readBack(page, fitted.href, { times: [1.0] })
    expect(fit.levels[0]).toBeLessThan(40)
    await closeExport(page)

    const filled = await exportVideo(page, { shape: 'vertical', framing: 'fill' })
    const fill = await readBack(page, filled.href, { times: [1.0] })
    expect(fill.levels[0]).toBeGreaterThan(90)
    await closeExport(page)

    const square = await exportVideo(page, { shape: 'square' })
    expect((await inspectFile(square.path)).video).toMatchObject({ width: 720, height: 720 })
    await closeExport(page)
  })

  test('shows a phone video that is turned upright the right way up', async ({ page }) => {
    await openOne(page, 'portrait-rotated.mp4')
    const exported = await exportVideo(page)
    const facts = await inspectFile(exported.path)
    expect(facts.video).toMatchObject({ width: 720, height: 1280 })
    expect(facts.video?.packets).toBe(50)
    // The label of the test video is written at the left of the coded frame. Turned a quarter clockwise, the left edge is the top.
    const read = await readBack(page, exported.href, {
      boxes: [
        { time: 0.3, x: 250, y: 40, width: 220, height: 520 },
        { time: 0.3, x: 0, y: 560, width: 220, height: 160 },
      ],
    })
    expect(read.bright[0]).toBeGreaterThan(0.02)
    expect(read.bright[1]).toBe(0)
    await closeExport(page)
  })

  test('keeps a slower recording at its own rate and thins a faster one to the export’s', async ({ page }) => {
    await openOne(page, 'fast.webm')
    const thin = await exportVideo(page, { fps: 30 })
    const thinned = await inspectFile(thin.path)
    expect(thinned.video?.packets).toBeGreaterThanOrEqual(28)
    expect(thinned.video?.packets).toBeLessThanOrEqual(32)
    expect(thinned.video?.rate).toBeCloseTo(30, 0)
    await closeExport(page)

    const all = await exportVideo(page, { fps: 60 })
    const kept = await inspectFile(all.path)
    expect(kept.video?.packets).toBeGreaterThanOrEqual(58)
    expect(kept.video?.packets).toBeLessThanOrEqual(61)
    // A recording without sound makes a file without sound.
    expect(kept.audio).toBeNull()
    await closeExport(page)
  })
})

test.describe('the export dialog', () => {
  test('starts from what suits the footage, and is Export disabled when there is nothing to export', async ({ page }) => {
    await openOne(page, 'portrait-rotated.mp4')
    await page.getByTestId('export').click()
    // The recording is coded wide and turned upright: it is shown tall.
    await expect(page.getByTestId('export-shape-vertical')).toBeChecked()
    await expect(page.getByTestId('export-quality-p720')).toBeChecked()
    await expect(page.getByTestId('export-framing-fill')).toBeChecked()
    await expect(page.getByTestId('export-fps-30')).toBeChecked()
    await page.getByTestId('export-cancel').click()
    await expect(page.getByRole('dialog')).toBeHidden()

    await clips(page).first().click()
    await page.keyboard.press('Delete')
    await expect(clips(page)).toHaveCount(0)
    await expect(page.getByTestId('export')).toBeDisabled()
  })

  test('shows its progress, stops when it is cancelled, and keeps nothing', async ({ page }) => {
    await openOne(page)
    await setClips(page, Array.from({ length: 14 }, () => [0, 2000] as [number, number]))
    await expect(clips(page)).toHaveCount(14)
    await page.getByTestId('export').click()
    await page.getByTestId('export-start').click()
    await expect(page.getByTestId('export-progress')).toBeVisible()
    await page.getByTestId('export-cancel').click()
    // Back at the choices, with nothing made and nothing left in the browser's storage.
    await expect(page.getByTestId('export-start')).toBeVisible()
    await expect.poll(() => leftovers(page)).toEqual([])
    await expect(page.getByTestId('export-download')).toHaveCount(0)
  })

  test('says so when a recording is gone, and offers another try', async ({ page }) => {
    await openOne(page)
    expect(await removeStoredMedia(page)).toBeGreaterThan(0)
    await page.getByTestId('export').click()
    await page.getByTestId('export-start').click()
    await expect(page.getByTestId('export-failed')).toContainText('no longer in this browser')
    await page.getByTestId('export-retry').click()
    await expect(page.getByTestId('export-start')).toBeVisible()
    await expect(page.getByTestId('export-cancel')).toBeVisible()
  })

  test('throws the file away when it is closed, and can make another', async ({ page }) => {
    await openOne(page)
    await exportVideo(page)
    await expect.poll(async () => (await leftovers(page)).length).toBe(1)
    await closeExport(page)
    await expect.poll(() => leftovers(page)).toEqual([])
    const second = await exportVideo(page)
    expect((await inspectFile(second.path)).video?.packets).toBe(50)
    await closeExport(page)
  })

  test('is in the app’s language: Hebrew', async ({ page }) => {
    await openOne(page)
    await page.getByRole('button', { name: 'עברית' }).click()
    await expect(page.getByTestId('export')).toHaveText('ייצוא')
    await page.getByTestId('export').click()
    await expect(page.getByRole('dialog')).toContainText('ייצוא סרטון')
    await expect(page.getByRole('dialog')).toContainText('לרוחב 16:9')
    await expect(page.getByRole('dialog')).toContainText('למלא את הפריים')
    await page.getByTestId('export-start').click()
    await expect(page.getByTestId('export-done')).toContainText('הסרטון מוכן', { timeout: 60_000 })
    await expect(page.getByTestId('export-download')).toHaveText('הורדה')
    await closeExport(page)
  })

  test('survives a reload: the project is as it was', async ({ page }) => {
    await openOne(page)
    await exportVideo(page)
    await closeExport(page)
    await reloadSaved(page)
    await expect(clips(page)).toHaveCount(1)
  })
})
