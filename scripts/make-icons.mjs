// Makes the app icons in public/icons from the picture in public/favicon.svg, with the Chromium that the tests use. They are
// committed, so the build does not depend on this script; run `npm run make-icons` only to change them.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const web = join(dirname(fileURLToPath(import.meta.url)), '..')
const accent = '#3b4cca'

// The icon with its rounded corners, and the one for "maskable" use, which the system crops to its own shape: full to the
// edges, with the picture kept inside the middle four fifths so that no crop can cut into it.
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${accent}"/><path d="M24 17v30l24-15z" fill="#fff"/></svg>`
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${accent}"/><path d="M26.4 21.4v21.2l17.6-10.6z" fill="#fff"/></svg>`

const icons = [
  { file: 'icon-180.png', size: 180, svg: rounded },
  { file: 'icon-192.png', size: 192, svg: rounded },
  { file: 'icon-512.png', size: 512, svg: rounded },
  { file: 'icon-maskable-512.png', size: 512, svg: maskable },
]

mkdirSync(join(web, 'public', 'icons'), { recursive: true })
const browser = await chromium.launch()
for (const { file, size, svg } of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  await page.screenshot({ path: join(web, 'public', 'icons', file), omitBackground: true })
  await page.close()
  console.log(`${file}: ${size} by ${size}`)
}
await browser.close()
