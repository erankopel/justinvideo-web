import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { effectiveDate, policyIsPublishable, renderPolicyPage } from './render'

const SOURCE = fileURLToPath(new URL('../../content/privacy-policy.md', import.meta.url))

/**
 * Publishes the privacy policy at /privacy/, both in the dev server and in the build. With PUBLIC_BUILD set, as the
 * deploy workflow does, the build fails while the effective date is still the placeholder, so that a policy with
 * no date can never go live.
 */
export function privacyPolicyPage(source: string = SOURCE): Plugin {
  const page = (): string => renderPolicyPage(readFileSync(source, 'utf8'))
  return {
    name: 'privacy-policy-page',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0]
        if (path !== '/privacy' && path !== '/privacy/' && path !== '/privacy/index.html') return next()
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end(page())
      })
    },
    generateBundle() {
      const markdown = readFileSync(source, 'utf8')
      if (process.env['PUBLIC_BUILD'] && !policyIsPublishable(markdown)) {
        this.error(`The privacy policy has no effective date yet (it says: ${effectiveDate(markdown) ?? 'nothing'}). Fill it in at docs/store/PRIVACY-POLICY.md in the app repository, run npm run sync-shared there, and make the copy again (see the release guide in the app repository).`)
      }
      this.emitFile({ type: 'asset', fileName: 'privacy/index.html', source: renderPolicyPage(markdown) })
    },
  }
}
