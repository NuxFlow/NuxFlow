/**
 * E2E for Admin → Starter sites: the page lists the built-in starters and the switch dialog
 * only lets you go ahead once you've ticked that your pages will become drafts. It stops
 * there: actually switching would turn every other spec's published pages into drafts (the
 * switch itself is covered by tests/integration/starters.test.ts).
 */
import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

test.describe('Starter sites', () => {
  test('lists the built-in starters and asks before switching', async ({ page }) => {
    await gotoHydrated(page, '/admin/starters')
    await expect(page.getByRole('heading', { name: 'Starter sites' })).toBeVisible({ timeout: 15_000 })
    for (const id of ['landing', 'blog', 'portfolio', 'blank']) {
      await expect(page.locator(`[data-starter="${id}"]`)).toBeVisible()
    }

    await page.locator('[data-starter="blog"]').getByRole('button', { name: 'Use this starter' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Nothing is deleted.')).toBeVisible()
    const confirm = dialog.getByTestId('starter-confirm')
    await expect(confirm).toBeDisabled()
    await dialog.getByText('I understand my current pages and posts will become drafts').click()
    await expect(confirm).toBeEnabled()
    await dialog.getByRole('button', { name: 'Not now' }).click()
    await expect(dialog).toBeHidden()
  })

  test('is in the admin menu\'s Site group, lit on its own page', async ({ page }) => {
    await gotoHydrated(page, '/admin/starters')
    const lit = page.locator('aside').first().locator('a.nav-active, button.nav-active')
    await expect(lit).toHaveCount(1)
    await expect(lit).toHaveText('Starter sites')
  })
})
