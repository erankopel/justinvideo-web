import preact from '@preact/preset-vite'
import { defineConfig } from 'vitest/config'
import { appPageSecurity } from './src/policy/app-security'
import { offlineSupport } from './src/offline/sw-plugin'
import { licensesPage } from './src/policy/licenses-plugin'
import { privacyPolicyPage } from './src/policy/plugin'

// Served from the root of video.medicom.vip, so assets use absolute paths. The build that goes live (PUBLIC_BUILD, set by
// the deploy workflow) needs the privacy policy's effective date and does not publish source maps, which would hand out
// the original source of the site; every other build keeps them for debugging.
export default defineConfig({
  plugins: [preact(), privacyPolicyPage(), licensesPage(), appPageSecurity(), offlineSupport()],
  base: '/',
  // The workers are modules, as the page makes them, so that the export's worker can load the AAC encoder when it needs it.
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: !process.env['PUBLIC_BUILD'] },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
