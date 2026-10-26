import { expect, type Page, test } from '@playwright/test'
import { clearHistory, exportVideo, inspectFile, media, pick, positionMs, readBack, WEBKIT_CANNOT } from './helpers'

test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_CANNOT.encode)
test.describe.configure({ timeout: 120_000 })

const clips = (page: Page) => page.locator('.timeline .clip')

/** The steady tone of landscape.webm is 0.3 at its peak, which is 0.212 as root mean square. */
const LANDSCAPE_RMS = 0.3 / Math.SQRT2

async function openTwo(page: Page): Promise<void> {
  await page.goto('/')
  await pick(page, [media('landscape.webm'), media('silent.webm')])
  await expect(clips(page)).toHaveCount(2)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(2)
  await expect.poll(() => positionMs(page)).toBe(0)
}

/** What this browser can encode of what the export prefers, by asking it as the site does. */
async function whatTheBrowserCanEncode(page: Page): Promise<{ avc: boolean; nativeAac: boolean }> {
  return page.evaluate(async () => {
    const avc = await VideoEncoder.isConfigSupported({ codec: 'avc1.42001f', width: 1280, height: 720, bitrate: 5_000_000 }).then((r) => r.supported === true, () => false)
    const nativeAac = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000 }).then((r) => r.supported === true, () => false)
    return { avc, nativeAac }
  })
}

/** The requests for the AAC encoder. Chromium tells of those of a worker as it does of the page's own; Firefox tells only of the page's. */
const aacRequests = (page: Page): string[] => {
  const seen: string[] = []
  page.on('request', (request) => {
    if (/mediabunny-aac-encoder/.test(request.url())) seen.push(request.url())
  })
  return seen
}

/**
 * H.264 with AAC in an MP4 file is what the export writes wherever the browser can encode H.264, whether or not it can encode
 * AAC: where it cannot (Firefox, and Chrome on Linux) the site's own AAC encoder is brought in. Where it cannot encode H.264
 * (the Chromium of these tests), the export is VP9 with Opus in a WebM file, and the AAC encoder is not even loaded.
 */
test.describe('the codecs of the export', () => {
  test('are H.264 and AAC in an MP4 file where H.264 can be encoded, and VP9 and Opus in a WebM file where it cannot', async ({ page, browserName }) => {
    const requested = aacRequests(page)
    await openTwo(page)
    const can = await whatTheBrowserCanEncode(page)
    const exported = await exportVideo(page)
    await expect(page.getByTestId('export-done')).toHaveAttribute('data-mode', 'worker')
    const facts = await inspectFile(exported.path)
    expect(facts.audio).toMatchObject({ rate: 48_000, channels: 2 })
    if (can.avc) {
      expect(exported.fileName).toMatch(/\.mp4$/)
      expect(facts.video?.codec).toBe('avc')
      expect(facts.audio?.codec).toBe('aac')
    } else {
      expect(exported.fileName).toMatch(/\.webm$/)
      expect(facts.video?.codec).toBe('vp9')
      expect(facts.audio?.codec).toBe('opus')
    }
    // Every frame, and the whole of the sound, whichever codecs carry them.
    expect(facts.video?.packets).toBe(75)
    expect(facts.duration).toBeGreaterThan(2.95)
    expect(facts.duration).toBeLessThan(3.06)
    // The encoder that the site brings is fetched when there is H.264 and no AAC of the browser's own, and never otherwise.
    if (browserName === 'chromium') expect(requested.length > 0, requested.join(', ')).toBe(can.avc && !can.nativeAac)
    // And it is a file that a viewer's browser decodes to the sound that was put in: the tone of the first clip, then silence.
    const read = await readBack(page, exported.href, { sound: [[0.2, 1.8], [2.2, 2.9]] })
    expect(read.sound[0]).toBeGreaterThan(LANDSCAPE_RMS * 0.8)
    expect(read.sound[0]).toBeLessThan(LANDSCAPE_RMS * 1.2)
    expect(read.sound[1]).toBeLessThan(0.01)
  })

  test('are the same when the export is made in the page, which loads the AAC encoder under the security policy of the page', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas
    })
    const requested = aacRequests(page)
    const violations: string[] = []
    await page.exposeFunction('reportViolation', (what: string) => violations.push(what))
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => void (window as unknown as { reportViolation: (what: string) => void }).reportViolation(`${event.violatedDirective} ${event.blockedURI}`))
    })
    await openTwo(page)
    const can = await whatTheBrowserCanEncode(page)
    const exported = await exportVideo(page)
    await expect(page.getByTestId('export-done')).toHaveAttribute('data-mode', 'main')
    const facts = await inspectFile(exported.path)
    expect(facts.audio?.codec).toBe(can.avc ? 'aac' : 'opus')
    expect(facts.video?.packets).toBe(75)
    expect(requested.length > 0).toBe(can.avc && !can.nativeAac)
    // The encoder compiles WebAssembly in a worker that the page makes, and the policy of the page allows that and no more.
    expect(violations).toEqual([])
    const read = await readBack(page, exported.href, { sound: [[0.2, 1.8]] })
    expect(read.sound[0]).toBeGreaterThan(LANDSCAPE_RMS * 0.8)
    expect(read.sound[0]).toBeLessThan(LANDSCAPE_RMS * 1.2)
  })

  test('are used again for a second export without loading the encoder again', async ({ page }) => {
    // In the page, where every browser tells of what is requested.
    await page.addInitScript(() => {
      delete (window as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas
    })
    const requested = aacRequests(page)
    await openTwo(page)
    const first = await exportVideo(page)
    await page.getByTestId('export-close').click()
    const loaded = requested.length
    const second = await exportVideo(page)
    expect(requested.length).toBe(loaded)
    expect((await inspectFile(second.path)).audio?.codec).toBe((await inspectFile(first.path)).audio?.codec)
  })
})
