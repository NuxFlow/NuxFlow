import { test, expect, type Page } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'

/**
 * Super Admin → Platform: the "run this install as a hosting platform" switch.
 * Off by default, and every single-site install relies on that: Plans and Usage must
 * stay out of the menu (and their pages out of reach) until a super admin turns it on.
 *
 * The e2e admin completed the first-ever setup, so it's the primary site's super admin.
 * The switch is put back to off afterwards, whatever happens, so other specs always
 * see the default.
 */
test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

const sidebar = (page: Page) => page.locator('aside, nav').filter({ has: page.getByRole('link', { name: 'Platform' }) }).first()

test.describe('Super Admin → Platform', () => {
  test.afterAll(async ({ request }) => {
    await request.put('/api/v1/admin/platform', { data: { hostingEnabled: false } })
  })

  test('hosting is off by default: no Plans or Usage, and their pages are forbidden', async ({ page, request }) => {
    await request.put('/api/v1/admin/platform', { data: { hostingEnabled: false } })
    await page.goto('/admin/super/platform')
    await expect(page.getByRole('heading', { name: 'Platform', exact: true })).toBeVisible()
    await expect(page.getByRole('switch', { name: /hosting platform/i })).toHaveAttribute('aria-checked', 'false')
    await expect(sidebar(page).getByRole('link', { name: 'Plans' })).toHaveCount(0)
    await expect(sidebar(page).getByRole('link', { name: 'Usage' })).toHaveCount(0)

    await page.goto('/admin/super/plans')
    await expect(page).toHaveURL(/\/admin\/forbidden/)
  })

  test('turning it on shows Plans and Usage; turning it off asks first and hides them again', async ({ page }) => {
    await page.goto('/admin/super/platform')
    const toggle = page.getByRole('switch', { name: /hosting platform/i })

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(sidebar(page).getByRole('link', { name: 'Plans' })).toBeVisible()
    await expect(sidebar(page).getByRole('link', { name: 'Usage' })).toBeVisible()
    // The setup checklist appears once hosting is on.
    await expect(page.getByText('Customer sign-up')).toBeVisible()

    // The daily cap on AI the platform pays for: set it, see it, remove it.
    const capField = page.getByLabel('Daily cap (credits)')
    // The innermost element holding both the heading and the field is the card itself.
    const aiCard = page.locator('div').filter({ has: page.getByRole('heading', { name: 'AI you pay for' }) }).filter({ has: capField }).last()
    await expect(aiCard.getByText('No daily cap')).toBeVisible()
    await capField.fill('5000')
    await aiCard.getByRole('button', { name: 'Save' }).click()
    await expect(aiCard.getByText('Capped')).toBeVisible()
    await expect(aiCard.getByText(/of 5,000\s+credits/)).toBeVisible()
    await capField.fill('')
    await aiCard.getByRole('button', { name: 'Save' }).click()
    await expect(aiCard.getByText('No daily cap')).toBeVisible()

    await page.goto('/admin/super/plans')
    await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible()

    await page.goto('/admin/super/platform')
    await page.getByRole('switch', { name: /hosting platform/i }).click()
    const dialog = page.getByRole('dialog', { name: /turn off the hosting platform/i })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Turn off' }).click()
    await expect(page.getByRole('switch', { name: /hosting platform/i })).toHaveAttribute('aria-checked', 'false')
    await expect(sidebar(page).getByRole('link', { name: 'Plans' })).toHaveCount(0)
  })
})
