import { defineConfig, devices } from '@playwright/test'

// `pnpm dev` now runs `wrangler dev`, which serves on 8787 (not Nuxt's default 3000).
const E2E_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8787'

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
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // In CI, start the dev server via `wrangler dev` (D1 is auto-provisioned locally —
  // this requires a wrangler.toml with a [[d1_databases]] block to exist in the CI
  // checkout; it's gitignored, so a CI job using this must generate one first).
  // Locally, assume the server is already running.
  //
  // The secret is passed with --var: `wrangler dev` does not hand the process environment
  // to the Worker, so `env` below alone left runtimeConfig.betterAuthSecret empty. Better
  // Auth hid that (it falls back to a dev secret), but anything else signing with it — the
  // password-page unlock cookie — failed in CI only.
  webServer: process.env.CI
    ? {
        command: 'pnpm dev --var NUXT_BETTER_AUTH_SECRET:e2e-test-secret-exactly-32-chars!',
        url: E2E_BASE_URL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          NUXT_BETTER_AUTH_SECRET: 'e2e-test-secret-exactly-32-chars!',
        },
      }
    : undefined,

  globalSetup: './tests/e2e/global-setup.ts',
})
