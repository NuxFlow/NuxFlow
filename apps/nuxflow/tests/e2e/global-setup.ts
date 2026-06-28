/**
 * Playwright global setup.
 * Ensures the site has been set up (via the one-time setup wizard) before any
 * test spec runs. This is idempotent — it silently ignores the 409 Conflict
 * returned when the site already exists.
 */

import { request } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

export const ADMIN_EMAIL = 'admin@e2e.test'
export const ADMIN_PASSWORD = 'E2eTestPass123!'

export default async function globalSetup() {
  const ctx = await request.newContext({ baseURL: BASE_URL })

  try {
    const res = await ctx.post('/api/v1/setup/complete', {
      data: {
        site: {
          name: 'E2E Test Site',
          domain: 'localhost',
          locale: 'en',
          timezone: 'UTC',
        },
        admin: {
          name: 'E2E Admin',
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
        },
        template: 'blank',
      },
    })

    if (!res.ok() && res.status() !== 409) {
      console.warn('[e2e:setup] Unexpected setup response:', res.status(), await res.text())
    }
  } catch (err) {
    // If the server isn't running yet (local dev without --ui), surface it
    if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      throw new Error(
        `[e2e:setup] Could not reach the dev server at ${BASE_URL}.\n` +
        'Run `pnpm dev` in a separate terminal before running E2E tests.',
        { cause: err },
      )
    }
    throw err
  } finally {
    await ctx.dispose()
  }
}
