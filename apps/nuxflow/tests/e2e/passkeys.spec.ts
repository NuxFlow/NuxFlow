import { test, expect } from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './global-setup'

/**
 * Passkey lifecycle on a single-site install: register a passkey from the Security
 * settings, sign out, sign back in with it, then delete it. Uses Chromium's virtual
 * WebAuthn authenticator (CDP). Signs in through the form itself rather than reusing the
 * shared admin session, because signing out ends that session on the server.
 */
test.describe('Passkeys', () => {
  test('register, sign in with, and delete a passkey', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Virtual authenticators need the Chrome DevTools Protocol')
    test.setTimeout(90_000)

    const cdp = await context.newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasUserVerification: true,
        isUserVerified: true,
        hasResidentKey: true,
        automaticPresenceSimulation: true,
      },
    })

    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_EMAIL)
    await page.fill('input[type="password"]', ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(/\/admin/, { timeout: 20_000 })

    const keyName = `E2E key ${Date.now().toString(36)}`
    const openSecurity = async () => {
      await page.goto('/admin/settings')
      await page.getByRole('button', { name: 'Security' }).click()
      await expect(page.getByText('Passkeys & Passwordless Login')).toBeVisible({ timeout: 15_000 })
    }

    await openSecurity()
    await page.getByPlaceholder('e.g. Work MacBook TouchID').fill(keyName)
    await page.getByRole('button', { name: 'Register Passkey' }).click()
    await expect(page.getByText(keyName)).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Sign out' }).first().click()
    await page.waitForURL(/\/login/, { timeout: 15_000 })

    await page.getByRole('button', { name: 'Sign in with Passkey' }).click()
    await page.waitForURL(/\/admin/, { timeout: 20_000 })

    await openSecurity()
    await page.getByRole('button', { name: 'Delete passkey' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText(keyName)).toBeHidden({ timeout: 15_000 })
  })
})
