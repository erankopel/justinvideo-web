import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const BODY = fileURLToPath(new URL('./sw-body.js', import.meta.url))

/** What is not kept for offline use: the file that says which domain, the page of an unknown address, and debugging maps. */
const LEFT_OUT = (path: string): boolean => path === 'sw.js' || path === 'CNAME' || path === '404.html' || path.endsWith('.map')

/**
 * Files of the site that are wanted only now and then, and are kept the first time they are used and not when the site is
 * installed: the AAC encoder of the export, a megabyte in each of its two copies that most browsers never use.
 */
export const isLater = (path: string): boolean => /^assets\/mediabunny-aac-encoder-.*\.js$/.test(path)

function filesIn(folder: string, root = folder): string[] {
  return readdirSync(folder).flatMap((name) => {
    const full = join(folder, name)
    return statSync(full).isDirectory() ? filesIn(full, root) : [relative(root, full).split(sep).join('/')]
  })
}

/** The address a file of the build is served at: a folder's index.html is the folder. */
export const addressOf = (path: string): string => (path === 'index.html' ? '/' : path.endsWith('/index.html') ? `/${path.slice(0, -'index.html'.length)}` : `/${path}`)

/** The text of the service worker for a build: the version, the files and which of them wait for their first use, then the body. */
export function serviceWorkerSource(version: string, addresses: readonly string[], body: string, later: readonly string[] = []): string {
  return `// Made by the build. See sw-body.js in the source.\nconst VERSION = ${JSON.stringify(version)}\nconst FILES = ${JSON.stringify(addresses, null, 1)}\nconst LATER = ${JSON.stringify(later, null, 1)}\n\n${body}`
}

/**
 * Writes sw.js next to the finished build: it holds every file of the site, so that the site opens without a connection,
 * and its version changes whenever any of those files does, which is what makes a browser fetch the new site.
 */
export function offlineSupport(): Plugin {
  let outDir = ''
  return {
    name: 'offline-support',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const files = filesIn(outDir).filter((path) => !LEFT_OUT(path)).sort()
      const hash = createHash('sha256')
      for (const path of files) hash.update(path).update(readFileSync(join(outDir, path)))
      const source = serviceWorkerSource(hash.digest('hex').slice(0, 16), files.map(addressOf), readFileSync(BODY, 'utf8'), files.filter(isLater).map(addressOf))
      writeFileSync(join(outDir, 'sw.js'), source)
    },
  }
}
