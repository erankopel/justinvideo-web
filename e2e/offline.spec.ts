import { expect, type Page, test } from '@playwright/test'
import { clearHistory, exportVideo, inspectFile, media, pick, WEBKIT_CANNOT } from './helpers'

test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_CANNOT.offline)

/** Waits until the site's service worker is in charge of the page, which is when it can serve it without a connection. */
async function installed(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
  })
  // Its files are all in the cache before it counts as installed.
  const cached = await page.evaluate(async () => {
    const names = await caches.keys()
    const cache = await caches.open(names[0] ?? '')
    return (await cache.keys()).length
  })
  expect(cached).toBeGreaterThan(5)
}

test.describe('without a connection', () => {
  test('the site, its policy and its licenses open from the browser’s own copy', async ({ page, context }) => {
    await page.goto('/')
    await installed(page)
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your projects')
    await page.goto('/privacy/')
    await expect(page.locator('#en')).toContainText('The web version.')
    await page.goto('/licenses/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Licenses and notices')
    // An address the site does not have still gives the site, since there is nothing else to show.
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your projects')
  })

  test('a whole piece of work can be done: a video is imported, edited and exported', async ({ page, context }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await installed(page)
    await context.setOffline(true)
    await page.reload()
    await pick(page, media('landscape.webm'))
    await expect(page.locator('.timeline .clip')).toHaveCount(1)
    await clearHistory(page)
    await page.getByTestId('split').click()
    const exported = await exportVideo(page)
    const facts = await inspectFile(exported.path)
    expect(facts.video?.packets).toBe(50)
    expect(facts.duration).toBeGreaterThan(1.95)
  })

  test('the site comes back with a connection: a page is taken from the network when it answers', async ({ page, context }) => {
    await page.goto('/')
    await installed(page)
    await context.setOffline(true)
    await page.reload()
    await context.setOffline(false)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your projects')
  })
})

test.describe('the offline files', () => {
  test('the worker lists every file of the site, and not the maps or the domain file', async ({ request }) => {
    const source = await (await request.get('/sw.js')).text()
    expect(source).toMatch(/const VERSION = "[0-9a-f]{16}"/)
    const files = JSON.parse(/const FILES = (\[[\s\S]*?\])\n/.exec(source)?.[1] ?? '[]') as string[]
    expect(files).toEqual(expect.arrayContaining(['/', '/privacy/', '/licenses/', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png']))
    expect(files.some((file) => /^\/assets\/index-.*\.js$/.test(file))).toBe(true)
    expect(files.some((file) => /^\/assets\/media-worker-.*\.js$/.test(file))).toBe(true)
    expect(files.some((file) => file.endsWith('.map') || file === '/CNAME' || file === '/sw.js' || file === '/404.html')).toBe(false)
    for (const file of files) expect((await request.get(file)).ok(), file).toBe(true)
    // The AAC encoder of the export is one of the files, but is kept when it is first used and not when the site is installed.
    const later = JSON.parse(/const LATER = (\[[\s\S]*?\])\n/.exec(source)?.[1] ?? '[]') as string[]
    expect(later.length).toBeGreaterThan(0)
    for (const file of later) {
      expect(file).toMatch(/^\/assets\/mediabunny-aac-encoder-.*\.js$/)
      expect(files).toContain(file)
    }
  })

  test('the manifest names the app and has icons that exist', async ({ page, request }) => {
    await page.goto('/')
    await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/manifest.webmanifest')
    await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', '/icons/icon-180.png')
    const manifest = (await (await request.get('/manifest.webmanifest')).json()) as { name: string; start_url: string; display: string; icons: { src: string; sizes: string; type: string; purpose?: string }[] }
    expect(manifest).toMatchObject({ name: 'JustInVideo', start_url: '/', display: 'standalone' })
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
    for (const icon of manifest.icons) {
      const response = await request.get(icon.src)
      expect(response.ok(), icon.src).toBe(true)
      expect(response.headers()['content-type']).toContain('image/png')
    }
  })

  test('the policy says that the site keeps a copy of its files for offline use', async ({ page }) => {
    await page.goto('/privacy/')
    await expect(page.locator('#en')).toContainText("a copy of its own files in the browser's cache")
    await expect(page.locator('#he')).toContainText('במטמון של הדפדפן')
    await expect(page.locator('#ar')).toContainText('ذاكرة التخزين المؤقت')
  })
})

test.describe('the check itself', () => {
  test.use({ serviceWorkers: 'block' })

  test('without the service worker the same reload fails, so the tests above do show it at work', async ({ page, context }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your projects')
    await context.setOffline(true)
    // An address that was never fetched, so not even the browser's own HTTP cache can answer it. One browser refuses
    // the visit and the other shows an error page: neither shows the site.
    await page.goto(`/?never-fetched=${Date.now()}`).catch(() => undefined)
    await expect(page.getByRole('heading', { name: 'Your projects' })).toHaveCount(0)
  })
})
