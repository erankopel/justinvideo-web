import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { type Component, renderLicensesPage } from './licenses'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const NOTICE = fileURLToPath(new URL('../../content/notice.md', import.meta.url))

const LGPL = fileURLToPath(new URL('../../content/licenses/LGPL-2.1.txt', import.meta.url))

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license']

interface PackageFile {
  readonly version: string
  readonly license?: string
  readonly homepage?: string
  readonly repository?: string | { readonly url?: string }
}

/** The address of a package's repository as a plain https address, or its homepage. */
function repositoryOf(file: PackageFile): string {
  const raw = typeof file.repository === 'string' ? file.repository : (file.repository?.url ?? '')
  const url = raw.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^github:/, 'https://github.com/')
  if (/^https?:\/\//.test(url)) return url
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`
  return file.homepage ?? ''
}

/**
 * What a package has built into it that is under a license of its own: the AAC encoder of the export is FFmpeg's, compiled to
 * WebAssembly inside the package. Listed after the package, from the version of the package.
 */
function builtInto(name: string, version: string): Component[] {
  if (name !== '@mediabunny/aac-encoder') return []
  return [
    {
      name: 'ffmpeg-libavcodec',
      version: '62.23.103',
      license: 'LGPL-2.1-or-later',
      homepage: 'https://ffmpeg.org/',
      sourceUrl: 'https://github.com/FFmpeg/FFmpeg',
      text: readFileSync(LGPL, 'utf8'),
      insideOf: `${name} ${version}`,
      buildUrl: `https://github.com/Vanilagy/mediabunny/tree/v${version}/packages/aac-encoder`,
    },
  ]
}

/** The components the site ships: the packages it depends on, with their versions, licenses and license texts. */
export function bundledComponents(root = ROOT): Component[] {
  const manifest = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { dependencies?: Record<string, string> }
  return Object.keys(manifest.dependencies ?? {})
    .sort()
    .flatMap((name) => {
      const folder = `${root}node_modules/${name}/`
      const file = JSON.parse(readFileSync(`${folder}package.json`, 'utf8')) as PackageFile
      const licenseFile = LICENSE_FILES.map((candidate) => folder + candidate).find((path) => existsSync(path))
      if (!licenseFile) throw new Error(`The package ${name} ships no license file to publish`)
      const repository = repositoryOf(file)
      const component: Component = {
        name,
        version: file.version,
        license: file.license ?? 'see the text',
        homepage: file.homepage ?? repository,
        sourceUrl: repository.includes('github.com') ? `${repository}/tree/v${file.version}` : repository,
        text: readFileSync(licenseFile, 'utf8'),
      }
      return [component, ...builtInto(name, file.version)]
    })
}

/** Publishes the page of licenses and notices at /licenses/, in the dev server and in the build. */
export function licensesPage(): Plugin {
  const page = (): string => renderLicensesPage(readFileSync(NOTICE, 'utf8'), bundledComponents())
  return {
    name: 'licenses-page',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0]
        if (path !== '/licenses' && path !== '/licenses/' && path !== '/licenses/index.html') return next()
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end(page())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'licenses/index.html', source: page() })
    },
  }
}
