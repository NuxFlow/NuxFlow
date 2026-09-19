/**
 * Playwright global setup.
 * Ensures the site has been set up (via the one-time setup wizard) before any
 * test spec runs. This is idempotent — it silently ignores the 409 Conflict
 * returned when the site already exists.
 *
 * Also signs in as the admin ONCE here and saves the resulting session cookie
 * to ADMIN_STORAGE_STATE_PATH, so specs that need an authenticated admin (see
 * admin-content.spec.ts, membership.spec.ts) can reuse it via
 * `test.use({ storageState: ADMIN_STORAGE_STATE_PATH })` instead of each test
 * logging in fresh through the UI. /api/auth/sign-in/email is rate-limited to
 * 10 requests per 10 minutes (server/middleware/04.auth-override.ts) as a
 * real anti-brute-force measure — logging in per-test (admin-content.spec.ts
 * alone has 14 tests) blew straight through that limit the first time this
 * suite ran end-to-end in CI. auth-flow.spec.ts's own login-flow tests still
 * log in for real (unauthenticated by default, no storageState), since that's
 * exactly the behavior they're testing.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { request } from '@playwright/test'

// `pnpm dev` now runs `wrangler dev`, which serves on 8787 (not Nuxt's default 3000).
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8787'

export const ADMIN_EMAIL = 'admin@e2e.test'
export const ADMIN_PASSWORD = 'E2eTestPass123!'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ADMIN_STORAGE_STATE_PATH = path.join(__dirname, '.auth', 'admin.json')

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

    const signInRes = await ctx.post('/api/auth/sign-in/email', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, rememberMe: true },
    })
    if (!signInRes.ok()) {
      throw new Error(`[e2e:setup] Admin sign-in failed: ${signInRes.status()} ${await signInRes.text()}`)
    }

    // register.vue hides the whole registration form (no input[type="email"]) unless
    // this is 'true' — most of the register-page tests (auth-flow.spec.ts,
    // membership.spec.ts) assume the form is visible. Enabled here so that's the
    // default test-site state; the one test that specifically covers the
    // disabled-registration UI toggles this off and back on around itself.
    const settingsRes = await ctx.patch('/api/v1/settings', {
      data: { settings: { 'auth.allow_public_registration': 'true' } },
    })
    if (!settingsRes.ok()) {
      throw new Error(`[e2e:setup] Enabling public registration failed: ${settingsRes.status()} ${await settingsRes.text()}`)
    }

    await ctx.storageState({ path: ADMIN_STORAGE_STATE_PATH })
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
