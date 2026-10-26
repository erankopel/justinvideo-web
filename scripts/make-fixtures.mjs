// Makes the small test videos in test-data/media. They are VP9 (with Opus sound) because that is the one codec every
// browser that runs the tests, including the sandbox's Chromium, can both write and read. They are committed, so the
// tests do not depend on this script; run `npm run make-fixtures` only to change them.
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const web = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await build({
  entryPoints: [join(web, 'scripts', 'fixtures-page.ts')],
  bundle: true,
  format: 'iife',
  write: false,
  target: 'es2022',
})
const script = bundle.outputFiles[0].text

const fixtures = [
  // A landscape video with sound.
  { file: 'landscape.webm', format: 'webm', width: 320, height: 180, seconds: 2, fps: 25, audio: true, label: 'LAND' },
  // A phone's portrait video: coded wide and turned a quarter, so it is 180 by 320 on screen. With sound.
  { file: 'portrait-rotated.mp4', format: 'mp4', width: 320, height: 180, seconds: 2, fps: 25, rotation: 90, audio: true, label: 'PORT' },
  // A video without any sound.
  { file: 'silent.webm', format: 'webm', width: 160, height: 90, seconds: 1, fps: 25, audio: false, label: 'SILENT' },
  // A fast recording, 60 frames per second, to check that an export thins it and keeps the rest.
  { file: 'fast.webm', format: 'webm', width: 160, height: 90, seconds: 1, fps: 60, audio: false, label: 'FAST' },
]

const browser = await chromium.launch()
const page = await browser.newPage()
// A page on localhost is a secure context, which WebCodecs needs, without a server.
await page.route('http://localhost/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>fixtures</title>' }))
await page.goto('http://localhost/')
await page.addScriptTag({ content: script })
mkdirSync(join(web, 'test-data', 'media'), { recursive: true })
for (const { file, ...options } of fixtures) {
  const bytes = await page.evaluate((o) => window.makeVideo(o), options)
  writeFileSync(join(web, 'test-data', 'media', file), Buffer.from(bytes))
  console.log(`${file}: ${bytes.length} bytes`)
}
await browser.close()
