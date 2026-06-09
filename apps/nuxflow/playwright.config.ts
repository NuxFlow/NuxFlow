import { defineConfig, devices } from '@playwright/test'

const E2E_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false, // sequential to avoid race conditions on shared DB
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    // SPA mode (dev) needs a moment for Vue to hydrate
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // In CI, start the dev server. Locally, assume the server is already running.
  webServer: process.env.CI
    ? {
        command: 'pnpm dev',
        url: E2E_BASE_URL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          NUXT_TURSO_URL: 'file:./tmp/e2e-test.db',
          NUXT_BETTER_AUTH_SECRET: 'e2e-test-secret-exactly-32-chars!',
        },
      }
    : undefined,

  globalSetup: './tests/e2e/global-setup.ts',
})
