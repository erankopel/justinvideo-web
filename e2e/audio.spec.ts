import { expect, type Page, test } from '@playwright/test'
import { audio, clearHistory, damageStored, heard, WEBKIT_CANNOT, media, pick, positionMs, reloadSaved, seekTo, shownVolume, soundMode, storedPaths, storedRecords, subs } from './helpers'

const clips = (page: Page) => page.locator('.timeline .clip')
const bars = (page: Page) => page.locator('.timeline .audio-bar')
const undo = (page: Page) => page.getByRole('button', { name: 'Undo' })
const redo = (page: Page) => page.getByRole('button', { name: 'Redo' })

/** Opens a project of landscape.webm (2 s, a steady tone) followed by silent.webm (1 s), with nothing to undo. */
async function openTwo(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('landscape.webm'), media('silent.webm')])
  await expect(clips(page)).toHaveCount(2)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(2)
  await expect.poll(() => positionMs(page)).toBe(0)
}

/** Opens a project of three seconds with no sound at all, so that only what is laid under it can be heard. */
async function openSilent(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('silent.webm'), media('silent.webm'), media('silent.webm')])
  await expect(clips(page)).toHaveCount(3)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(3)
  await expect.poll(() => positionMs(page)).toBe(0)
}

/** Presses Add music and chooses the file in the picker that opens, as a person would. */
async function addMusic(page: Page, file = audio('tone.wav')): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('add-music').click()
  await (await chooser).setFiles(file)
}

async function setClipVolume(page: Page, preset: number): Promise<void> {
  await page.getByTestId('volume').click()
  await page.getByTestId(`clip-volume-preset-${preset}`).click()
  await page.getByTestId('clip-volume-save').click()
  await expect(page.getByRole('dialog')).toBeHidden()
}

const notice = (page: Page) => page.getByTestId('notice')

/** A time in seconds as the dialogs write it: the number is isolated from the words around it, which the match must step over. */
const sec = (value: string): RegExp => new RegExp(`${value.replace('.', '\\.')}\u2069? s`)

test.describe('the volume of a clip', () => {
  test('is set in a dialog, is one undo step and is kept', async ({ page }) => {
    await openTwo(page)
    await expect(page.getByTestId('volume')).toBeDisabled()
    await clips(page).nth(0).click()
    await page.getByTestId('volume').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Clip volume')
    await expect(page.getByTestId('clip-volume-value')).toContainText('100%')
    await page.getByTestId('clip-volume-preset-50').click()
    await expect(page.getByTestId('clip-volume-value')).toContainText('50%')
    await expect(page.getByTestId('clip-volume-preset-50')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('clip-volume-save').click()
    await expect(dialog).toBeHidden()
    await expect(undo(page)).toBeEnabled()

    await reloadSaved(page)
    await clips(page).nth(0).click()
    await page.getByTestId('volume').click()
    await expect(page.getByTestId('clip-volume-value')).toContainText('50%')
    await page.getByTestId('clip-volume-cancel').click()
    await undo(page).click()
    await clips(page).nth(0).click()
    await page.getByTestId('volume').click()
    await expect(page.getByTestId('clip-volume-value')).toContainText('100%')
  })

  test('can be set with the slider, from silence to twice as loud, and Cancel changes nothing', async ({ page }) => {
    await openTwo(page)
    await clips(page).nth(0).click()
    await page.getByTestId('volume').click()
    const slider = page.getByTestId('clip-volume')
    await slider.fill('200')
    await expect(page.getByTestId('clip-volume-value')).toContainText('200%')
    await slider.fill('0')
    await expect(page.getByTestId('clip-volume-value')).toContainText('0%')
    await expect(page.getByTestId('clip-volume-preset-0')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('clip-volume-cancel').click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(undo(page)).toBeDisabled()
  })

  test('is what is heard: half, louder than the file, and silent', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', WEBKIT_CANNOT.hear)
    await openTwo(page)
    await clips(page).nth(0).click()
    const full = await heard(page)
    const mode = await soundMode(page)
    if (mode === 'graph') {
      expect(full.level).toBeGreaterThan(0.1)
      const level = full.level ?? 0
      await setClipVolume(page, 50)
      expect((await heard(page)).level).toBeCloseTo(level * 0.5, 1)
      expect((await heard(page)).level ?? 0).toBeGreaterThan(level * 0.4)
      expect((await heard(page)).level ?? 1).toBeLessThan(level * 0.6)
      await setClipVolume(page, 150)
      const loud = (await heard(page)).level ?? 0
      expect(loud).toBeGreaterThan(level * 1.35)
      expect(loud).toBeLessThan(level * 1.65)
      await setClipVolume(page, 0)
      expect((await heard(page)).level ?? 1).toBeLessThan(0.005)
    } else {
      // Without Web Audio the sound is at the volume of the video, which cannot be above the file's.
      expect(await shownVolume(page)).toBe(1)
      await setClipVolume(page, 50)
      await clips(page).nth(0).click()
      await heard(page)
      expect(await shownVolume(page)).toBe(0.5)
      await setClipVolume(page, 150)
      await heard(page)
      expect(await shownVolume(page)).toBe(1)
      await setClipVolume(page, 0)
      await heard(page)
      expect(await shownVolume(page)).toBe(0)
    }
  })

  test('is only that of its own clip: the next clip keeps its own', async ({ page }) => {
    await openTwo(page)
    await clips(page).nth(0).click()
    await setClipVolume(page, 0)
    await seekTo(page, 500)
    const quiet = await heard(page)
    if (quiet.level !== null) expect(quiet.level).toBeLessThan(0.005)
    else expect(await shownVolume(page)).toBe(0)
    await seekTo(page, 100)
    await page.getByTestId('timeline').scrollIntoViewIfNeeded()
    await clips(page).nth(1).click()
    await page.getByTestId('volume').click()
    await expect(page.getByTestId('clip-volume-value')).toContainText('100%')
  })
})

test.describe('music', () => {
  test('is added from a file at the playhead, in a row of its own, as one undo step, and is kept', async ({ page }) => {
    await openSilent(page)
    await expect(bars(page)).toHaveCount(0)
    await seekTo(page, 1_000)
    // A tap on the ruler lands within a few milliseconds of where it was aimed.
    const at = await positionMs(page)
    await addMusic(page)
    await expect(bars(page)).toHaveCount(1)
    const bar = bars(page).first()
    await expect(bar).toHaveAttribute('data-start', String(at))
    await expect(bar).toHaveAttribute('data-end', String(at + 3000))
    await expect(bar).toHaveAttribute('aria-label', /^Music tone\.wav, from 0:0[01] to 0:0[34]$/)
    await expect(bar).toContainText('tone.wav')
    await expect(undo(page)).toBeEnabled()
    expect((await storedPaths(page)).filter((path) => path.endsWith('.wav'))).toHaveLength(1)

    await reloadSaved(page)
    await expect(bars(page)).toHaveCount(1)
    await undo(page).click()
    await expect(bars(page)).toHaveCount(0)
    await redo(page).click()
    await expect(bars(page)).toHaveCount(1)
  })

  test('can be the sound of a video file too', async ({ page }) => {
    await openSilent(page)
    await addMusic(page, media('landscape.webm'))
    await expect(bars(page)).toHaveCount(1)
    await expect(bars(page).first()).toHaveAttribute('data-end', '2000')
    await expect(bars(page).first()).toContainText('landscape.webm')
  })

  test('is refused with a reason when the file has no sound, and nothing is kept', async ({ page }) => {
    await openSilent(page)
    const before = await storedPaths(page)
    await addMusic(page, media('silent.webm'))
    await expect(notice(page)).toContainText('That file has no sound.')
    await addMusic(page, subs('not-subtitles.txt'))
    await expect(notice(page)).toContainText('That file has no sound.')
    await expect(bars(page)).toHaveCount(0)
    await expect(undo(page)).toBeDisabled()
    expect(await storedPaths(page)).toEqual(before)
  })

  test('is edited in a dialog: volume, start, length, the part skipped, and the fades', async ({ page }) => {
    await openSilent(page)
    await seekTo(page, 1_000)
    const at = await positionMs(page)
    await addMusic(page)
    await bars(page).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Edit music')
    await expect(page.getByTestId('audio-name')).toContainText('tone.wav')
    await expect(page.getByTestId('audio-starts')).toContainText(sec('1.0'))
    await expect(page.getByTestId('audio-lasts')).toContainText(sec('3.0'))
    await expect(page.getByTestId('audio-skips')).toContainText(sec('0.0'))

    await page.getByTestId('audio-later').click()
    await page.getByTestId('audio-later').click()
    await expect(page.getByTestId('audio-starts')).toContainText(sec('2.0'))
    await page.getByTestId('audio-shorter').click()
    await expect(page.getByTestId('audio-lasts')).toContainText(sec('2.5'))
    await page.getByTestId('audio-skip-more').click()
    await expect(page.getByTestId('audio-skips')).toContainText(sec('0.5'))
    await page.getByTestId('audio-fadein-longer').click()
    await page.getByTestId('audio-fadein-longer').click()
    await page.getByTestId('audio-fadeout-longer').click()
    await expect(page.getByTestId('audio-fadein')).toContainText(sec('1.0'))
    await expect(page.getByTestId('audio-fadeout')).toContainText(sec('0.5'))
    await page.getByTestId('audio-volume-preset-50').click()
    await page.getByTestId('audio-save').click()
    await expect(dialog).toBeHidden()

    const bar = bars(page).first()
    await expect(bar).toHaveAttribute('data-start', String(at + 1000))
    await expect(bar).toHaveAttribute('data-end', String(at + 3500))

    await bar.click()
    await expect(page.getByTestId('audio-starts')).toContainText(sec('2.0'))
    await expect(page.getByTestId('audio-lasts')).toContainText(sec('2.5'))
    await expect(page.getByTestId('audio-skips')).toContainText(sec('0.5'))
    await expect(page.getByTestId('audio-fadein')).toContainText(sec('1.0'))
    await expect(page.getByTestId('audio-fadeout')).toContainText(sec('0.5'))
    await expect(page.getByTestId('audio-volume-value')).toContainText('50%')
    await page.getByTestId('audio-cancel').click()

    // The whole change was one undo step.
    await undo(page).click()
    await expect(bar).toHaveAttribute('data-start', String(at))
    await expect(bar).toHaveAttribute('data-end', String(at + 3000))
  })

  test('keeps its fades and length within the piece and the file', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await bars(page).first().click()
    // Not before the start of the edit, not longer than the file, not skipping more than is left.
    await page.getByTestId('audio-earlier').click()
    await expect(page.getByTestId('audio-starts')).toContainText(sec('0.0'))
    await page.getByTestId('audio-longer').click()
    await expect(page.getByTestId('audio-lasts')).toContainText(sec('3.0'))
    await page.getByTestId('audio-skip-more').click()
    await expect(page.getByTestId('audio-skips')).toContainText(sec('0.0'))
    await page.getByTestId('audio-skip-less').click()
    await expect(page.getByTestId('audio-skips')).toContainText(sec('0.0'))
    // Shortening a piece pulls its fades in with it.
    for (let i = 0; i < 6; i++) await page.getByTestId('audio-fadein-longer').click()
    await expect(page.getByTestId('audio-fadein')).toContainText(sec('3.0'))
    await page.getByTestId('audio-fadein-longer').click()
    await expect(page.getByTestId('audio-fadein')).toContainText(sec('3.0'))
    await page.getByTestId('audio-fadeout-longer').click()
    await expect(page.getByTestId('audio-fadeout')).toContainText(sec('0.0'))
    for (let i = 0; i < 5; i++) await page.getByTestId('audio-shorter').click()
    await expect(page.getByTestId('audio-lasts')).toContainText(sec('0.5'))
    await expect(page.getByTestId('audio-fadein')).toContainText(sec('0.5'))
    await page.getByTestId('audio-cancel').click()
  })

  test('can be removed, and put back by Undo', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await bars(page).first().click()
    await page.getByTestId('audio-delete').click()
    await expect(bars(page)).toHaveCount(0)
    await undo(page).click()
    await expect(bars(page)).toHaveCount(1)
    await expect.poll(async () => (await storedRecords(page)).length).toBe(1)
  })

  test('overlapping pieces are in two lanes, and a tap on either opens its own dialog', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await expect(bars(page)).toHaveCount(1)
    await addMusic(page, media('landscape.webm'))
    await expect(bars(page)).toHaveCount(2)
    const tops = await bars(page).evaluateAll((all) => all.map((bar) => (bar as HTMLElement).style.top))
    expect(new Set(tops).size).toBe(2)
    await bars(page).nth(1).click()
    await expect(page.getByTestId('audio-name')).toContainText('landscape.webm')
    await page.getByTestId('audio-cancel').click()
  })

  test('is in the app’s language: Hebrew', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await page.getByRole('button', { name: 'עברית' }).click()
    await page.getByRole('button', { name: 'הוספת מוזיקה' }).waitFor()
    await bars(page).first().click()
    await expect(page.getByRole('dialog')).toContainText('עריכת מוזיקה')
    await expect(page.getByTestId('audio-starts')).toContainText('מתחיל ב')
    await expect(page.getByTestId('audio-name')).toContainText('מוזיקה')
  })

  test('is heard at its own volume', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await expect(bars(page)).toHaveCount(1)
    const full = await heard(page)
    const mode = await soundMode(page)
    const setVolume = async (preset: number): Promise<void> => {
      await bars(page).first().click()
      await page.getByTestId(`audio-volume-preset-${preset}`).click()
      await page.getByTestId('audio-save').click()
      await expect(page.getByRole('dialog')).toBeHidden()
      await seekTo(page, 500)
    }
    if (mode === 'graph') {
      const level = full.level ?? 0
      expect(level).toBeGreaterThan(0.28)
      expect(level).toBeLessThan(0.43)
      await setVolume(50)
      const half = (await heard(page)).level ?? 0
      expect(half).toBeGreaterThan(level * 0.4)
      expect(half).toBeLessThan(level * 0.6)
      await setVolume(150)
      const loud = (await heard(page)).level ?? 0
      // A half more than the level heard a moment before, which is measured on a tone that is not quite steady: one run in ten in
      // WebKit read 1.347 times it, so the bounds are a third of it either way.
      expect(loud).toBeGreaterThan(level * 1.3)
      expect(loud).toBeLessThan(level * 1.7)
    } else {
      // Without Web Audio the piece is at the volume of its element, which cannot be above the file's.
      const volume = (): Promise<number | undefined> => page.evaluate(() => document.querySelector<HTMLAudioElement>('[data-testid=preview] audio')?.volume)
      await seekTo(page, 500)
      await expect.poll(volume).toBe(1)
      await setVolume(50)
      await expect.poll(volume).toBe(0.5)
      await setVolume(150)
      await expect.poll(volume).toBe(1)
    }
  })

  test('waits in its file where the playhead is in the piece, after the part that is skipped', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await expect(bars(page)).toHaveCount(1)
    await bars(page).first().click()
    // Two seconds of the file are played, from a second into it.
    for (let i = 0; i < 2; i++) await page.getByTestId('audio-shorter').click()
    for (let i = 0; i < 2; i++) await page.getByTestId('audio-skip-more').click()
    await expect(page.getByTestId('audio-skips')).toContainText(sec('1.0'))
    await page.getByTestId('audio-save').click()
    await seekTo(page, 300)
    const at = await positionMs(page)
    const time = (): Promise<number> => page.evaluate(() => document.querySelector<HTMLAudioElement>('[data-testid=preview] audio')?.currentTime ?? -1)
    await expect.poll(time).toBeCloseTo(1 + at / 1000, 1)
    await seekTo(page, 1_200)
    const later = await positionMs(page)
    await expect.poll(time).toBeCloseTo(1 + later / 1000, 1)
  })

  test('plays its file in step with the picture, from where the playhead is', async ({ page }, info) => {
    // A browser with no sound device, as the one that runs these tests in Firefox, cannot play an audio element at all.
    test.skip(info.project.name === 'firefox', 'Firefox without a sound device cannot play an audio element')
    // The graph is left out in WebKit, which is the browser that cannot be measured with it: the music is then heard at the element's own volume.
    if (info.project.name === 'webkit') {
      await page.addInitScript(() => {
        const scope = window as unknown as Record<string, unknown>
        delete scope['AudioContext']
        delete scope['webkitAudioContext']
      })
    }
    await openSilent(page)
    await addMusic(page)
    await expect(bars(page)).toHaveCount(1)
    await bars(page).first().click()
    for (let i = 0; i < 2; i++) await page.getByTestId('audio-shorter').click()
    for (let i = 0; i < 2; i++) await page.getByTestId('audio-skip-more').click()
    await page.getByTestId('audio-save').click()
    await seekTo(page, 300)
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-testid=play]')?.click())
    await expect.poll(() => positionMs(page), { timeout: 8_000 }).toBeGreaterThan(700)
    const state = await page.evaluate(() => {
      const audio = document.querySelector<HTMLAudioElement>('[data-testid=preview] audio')
      const position = Number(document.querySelector('[data-testid=preview]')?.getAttribute('data-position-ms'))
      return audio ? { paused: audio.paused, time: audio.currentTime, position } : null
    })
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-testid=play]')?.click())
    if (info.project.name === 'webkit') expect(await soundMode(page), WEBKIT_CANNOT.graphPlace).toBe('elements')
    expect(state?.paused).toBe(false)
    // A second of the file is skipped, and the sound is where the picture is.
    expect(Math.abs((state?.time ?? 0) - (1 + (state?.position ?? 0) / 1000))).toBeLessThan(0.35)
  })

  test('is not played where the edit has gone past it, and its player is let go', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await bars(page).first().click()
    for (let i = 0; i < 4; i++) await page.getByTestId('audio-shorter').click()
    await page.getByTestId('audio-save').click()
    // 1 s of music from 0. At 2 s the piece is over, and so is its player.
    await seekTo(page, 2_000)
    await expect.poll(() => page.locator('[data-testid=preview] audio').count()).toBe(0)
    await seekTo(page, 200)
    await expect.poll(() => page.locator('[data-testid=preview] audio').count()).toBe(1)
  })

  test('says so when the browser cannot play it', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await expect(bars(page)).toHaveCount(1)
    // Damage the stored copy, so the file is there but is not sound.
    expect(await damageStored(page, '.wav')).toBe(1)
    await reloadSaved(page)
    await expect(bars(page)).toHaveCount(1)
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-testid=play]')?.click())
    await expect(notice(page)).toContainText('could not play that music', { timeout: 8_000 })
  })
})

test.describe('the fades over the whole edit', () => {
  test('are set in a dialog, are one undo step and are kept', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('fades').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Fades over the whole video')
    await expect(page.getByTestId('master-fadein')).toContainText(sec('0.0'))
    await page.getByTestId('master-fadein-longer').click()
    await page.getByTestId('master-fadein-longer').click()
    await page.getByTestId('master-fadeout-longer').click()
    await expect(page.getByTestId('master-fadein')).toContainText(sec('1.0'))
    await expect(page.getByTestId('master-fadeout')).toContainText(sec('0.5'))
    await page.getByTestId('master-fadeout-shorter').click()
    await page.getByTestId('master-fadeout-shorter').click()
    await expect(page.getByTestId('master-fadeout')).toContainText(sec('0.0'))
    await page.getByTestId('master-fadeout-longer').click()
    await page.getByTestId('master-save').click()
    await expect(dialog).toBeHidden()
    await expect(undo(page)).toBeEnabled()

    await reloadSaved(page)
    await page.getByTestId('fades').click()
    await expect(page.getByTestId('master-fadein')).toContainText(sec('1.0'))
    await expect(page.getByTestId('master-fadeout')).toContainText(sec('0.5'))
    await page.getByTestId('master-cancel').click()
    await undo(page).click()
    await page.getByTestId('fades').click()
    await expect(page.getByTestId('master-fadein')).toContainText(sec('0.0'))
  })

  test('Cancel changes nothing', async ({ page }) => {
    await openTwo(page)
    await page.getByTestId('fades').click()
    await page.getByTestId('master-fadein-longer').click()
    await page.getByTestId('master-cancel').click()
    await expect(undo(page)).toBeDisabled()
  })

  test('are heard: the sound rises from silence at the start and falls to it at the end', async ({ page }) => {
    await openSilent(page)
    await addMusic(page)
    await expect(bars(page)).toHaveCount(1)
    // The music fills the edit; fades of two seconds at each end of three seconds.
    await page.getByTestId('fades').click()
    for (let i = 0; i < 4; i++) {
      await page.getByTestId('master-fadein-longer').click()
      await page.getByTestId('master-fadeout-longer').click()
    }
    await page.getByTestId('master-save').click()
    const middle = await heard(page)
    if (middle.level === null) {
      expect(await soundMode(page)).toBe('elements')
      return
    }
    // The first listen began at 0: the level there is below what a full level would be.
    await seekTo(page, 1_500)
    const full = (await heard(page, 100)).level ?? 0
    await seekTo(page, 0)
    const start = await heard(page, 100)
    const expectedStart = Math.min(1, start.atMs / 2000)
    expect(start.level ?? 1).toBeLessThan(full * Math.min(1, expectedStart + 0.25))
    await seekTo(page, 2_500)
    const end = await heard(page, 100)
    expect(end.level ?? 1).toBeLessThan(full * 0.5)
  })
})

test.describe('a voiceover', () => {
  test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_CANNOT.record)

  test('is recorded from the microphone while the picture plays, and laid under the edit where it began', async ({ page }) => {
    await openSilent(page)
    await seekTo(page, 500)
    const at = await positionMs(page)
    await page.getByTestId('record').click()
    await expect(page.getByTestId('recording')).toBeVisible()
    await expect(page.getByTestId('record')).toHaveText('Stop recording')
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'true')
    // Nothing else is touched while the microphone is open.
    await expect(page.getByTestId('split')).toBeDisabled()
    await expect(page.getByTestId('fades')).toBeDisabled()
    await expect(page.getByTestId('add-music')).toBeDisabled()
    await expect(page.getByTestId('play')).toBeDisabled()
    await page.keyboard.press('Space')
    await page.keyboard.press('Home')
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'true')
    await expect.poll(() => positionMs(page)).toBeGreaterThan(at + 1_000)
    await page.getByTestId('record').click()

    await expect(bars(page)).toHaveCount(1)
    const bar = bars(page).first()
    await expect(bar).toHaveClass(/voiceover/)
    await expect(bar).toHaveAttribute('data-start', String(at))
    const end = Number(await bar.getAttribute('data-end'))
    expect(end - at).toBeGreaterThan(800)
    expect(end - at).toBeLessThan(2_600)
    await expect(bar).toHaveAttribute('aria-label', /^Voiceover Voiceover, from/)
    await expect(page.getByTestId('recording')).toHaveCount(0)
    await expect(page.getByTestId('preview')).toHaveAttribute('data-playing', 'false')
    await expect(notice(page)).toHaveText('')
    await expect(page.getByTestId('split')).toBeEnabled()
    expect((await storedPaths(page)).filter((path) => path.endsWith('.wav'))).toHaveLength(1)

    await undo(page).click()
    await expect(bars(page)).toHaveCount(0)
    await redo(page).click()
    await expect(bars(page)).toHaveCount(1)
    await reloadSaved(page)
    await expect(bars(page)).toHaveCount(1)
    await bars(page).first().click()
    await expect(page.getByRole('dialog')).toContainText('Edit voiceover')
    await page.getByTestId('audio-cancel').click()
  })

  test('is stopped by the end of the edit, and ends where the edit does', async ({ page }) => {
    await openSilent(page)
    await seekTo(page, 2_200)
    await page.getByTestId('record').click()
    await expect(page.getByTestId('recording')).toBeVisible()
    // Either the voiceover is laid down or a notice says why not; waiting for either lets a failure name its reason.
    await expect.poll(async () => (await bars(page).count()) + (await notice(page).innerText()).length, { timeout: 8_000 }).toBeGreaterThan(0)
    await expect(notice(page)).toHaveText('')
    await expect(bars(page)).toHaveCount(1)
    await expect(page.getByTestId('recording')).toHaveCount(0)
    await expect(page.getByTestId('record')).toHaveText('Record a voiceover')
    const end = Number(await bars(page).first().getAttribute('data-end'))
    expect(end).toBeLessThanOrEqual(3_000)
    expect(end).toBeGreaterThan(2_700)
  })

  test('cannot be started at the very end of the edit', async ({ page }) => {
    await openSilent(page)
    await page.keyboard.press('End')
    await expect(page.getByTestId('record')).toBeDisabled()
    await page.keyboard.press('Home')
    await expect(page.getByTestId('record')).toBeEnabled()
  })

  test('says so when the microphone is not allowed, and when there is none', async ({ page }) => {
    await openSilent(page)
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('refused', 'NotAllowedError'))
    })
    await page.getByTestId('record').click()
    await expect(notice(page)).toContainText('allow this site to use the microphone')
    await expect(page.getByTestId('recording')).toHaveCount(0)
    await expect(page.getByTestId('record')).toHaveText('Record a voiceover')
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('none', 'NotFoundError'))
    })
    await page.getByTestId('record').click()
    await expect(notice(page)).toContainText('The microphone could not be used')
    await expect(bars(page)).toHaveCount(0)
    await expect(undo(page)).toBeDisabled()
  })

  test('is in the app’s language: Hebrew', async ({ page }) => {
    await openSilent(page)
    await page.getByRole('button', { name: 'עברית' }).click()
    await expect(page.getByTestId('record')).toHaveText('הקלטת קול')
    await page.getByTestId('record').click()
    await expect(page.getByTestId('record')).toHaveText('עצירת ההקלטה')
    await expect(page.getByTestId('recording')).toContainText('מקליט')
    // A recording shorter than a tenth of a second is thrown away, so the picture is let run a little first.
    await expect.poll(() => positionMs(page)).toBeGreaterThan(800)
    await page.getByTestId('record').click()
    await expect(bars(page)).toHaveCount(1)
  })
})
