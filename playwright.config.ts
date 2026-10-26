import { defineConfig, devices } from '@playwright/test'

// The tests run against the built site, as a visitor would meet it. Chromium always; Firefox when E2E_FIREFOX is set, and
// WebKit, the engine of Safari, when E2E_WEBKIT is (CI sets both, and installs them).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  // A test gets a minute: on a busy runner a browser can take a long while to open a page, which is no failure of the site.
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
  // Both browsers get a made-up microphone that answers without asking, so that recording a voiceover can be tested.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
      },
    },
    ...(process.env['E2E_FIREFOX']
      ? [
          {
            name: 'firefox',
            use: {
              ...devices['Desktop Firefox'],
              launchOptions: { firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } },
            },
          },
        ]
      : []),
    // The other desktop browsers have one pixel to a pixel, which the tests that read the canvas count on; Safari's own device has two.
    ...(process.env['E2E_WEBKIT'] ? [{ name: 'webkit', use: { ...devices['Desktop Safari'], deviceScaleFactor: 1 } }] : []),
  ],
})
