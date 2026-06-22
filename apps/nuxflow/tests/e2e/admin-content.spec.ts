/**
 * E2E tests for authenticated admin flows.
 *
 * Covers: dashboard navigation, content list, content editor entry point,
 * settings pages, media library, and SEO settings.
 *
 * Each test logs in as admin to stay independent. Playwright runs these
 * sequentially (workers: 1 in playwright.config.ts) so there are no race
 * conditions on the shared database.
 */
import { test, expect, type Page } from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './global-setup'

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login')
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 })
  await page.fill('input[type="email"]', ADMIN_EMAIL)
  await page.fill('input[type="password"]', ADMIN_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/admin/, { timeout: 20_000 })
}

// ---------------------------------------------------------------------------
// Admin shell
// ---------------------------------------------------------------------------

test.describe('Admin dashboard', () => {
  test('renders the admin area after login', async ({ page }) => {
    await loginAsAdmin(page)
    expect(page.url()).toContain('/admin')
    // Sidebar navigation should be present
    await expect(page.locator('nav, aside, [role="navigation"]').first()).toBeVisible({ timeout: 10_000 })
  })

  test('sidebar contains a link to Content', async ({ page }) => {
    await loginAsAdmin(page)
    const contentLink = page.getByRole('link', { name: /content/i }).first()
    await expect(contentLink).toBeVisible({ timeout: 10_000 })
  })

  test('sidebar contains a link to Media', async ({ page }) => {
    await loginAsAdmin(page)
    const mediaLink = page.getByRole('link', { name: /media/i }).first()
    await expect(mediaLink).toBeVisible({ timeout: 10_000 })
  })
})

// ---------------------------------------------------------------------------
// Content management
// ---------------------------------------------------------------------------

test.describe('Admin content list', () => {
  test('navigates to /admin/content without error', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/content')
    await expect(page).toHaveURL(/\/admin\/content/, { timeout: 15_000 })
    await expect(page.locator('body')).not.toContainText('404')
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('shows a button to create new content', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/content')
    const createBtn = page.getByRole('button', { name: /new|create|add/i }).first()
    await expect(createBtn).toBeVisible({ timeout: 10_000 })
  })

  test('clicking create opens an editor or dialog', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/content')
    await page.waitForLoadState('networkidle')

    const createBtn = page.getByRole('button', { name: /new|create|add/i }).first()
    await createBtn.click()

    // Allow navigation or modal to settle
    await page.waitForTimeout(1500)

    const isModal = await page.locator('[role="dialog"]').isVisible()
    const isEditorPage = page.url().includes('/admin/content/')
    expect(isModal || isEditorPage).toBe(true)
  })
})

test.describe('Admin content editor', () => {
  test('navigates to /admin/content/:id page structure without error', async ({ page }) => {
    await loginAsAdmin(page)

    // Go to content list and try to open the first item if one exists
    await page.goto('/admin/content')
    await page.waitForLoadState('networkidle')

    // Look for any row/link that leads to an editor
    const editorLink = page.getByRole('link', { name: /edit|view/i }).first()
    if (await editorLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await editorLink.click()
      await page.waitForURL(/\/admin\/content\//, { timeout: 15_000 })
      await expect(page.locator('body')).not.toContainText('404')
    } else {
      // No items yet — verify the list page itself is well-formed
      await expect(page.locator('body')).not.toContainText('Error')
    }
  })
})

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

test.describe('Admin media library', () => {
  test('loads /admin/media without error', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/media')
    await expect(page).toHaveURL(/\/admin\/media/, { timeout: 15_000 })
    await expect(page.locator('body')).not.toContainText('404')
  })

  test('shows an upload button or drop zone', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/media')
    await page.waitForLoadState('networkidle')

    const uploadBtn = page.getByRole('button', { name: /upload|add|import/i }).first()
    const dropzone = page.locator('[data-testid="dropzone"], .dropzone, [class*="drop"]').first()

    const hasUpload = (await uploadBtn.isVisible({ timeout: 5_000 }).catch(() => false))
      || (await dropzone.isVisible({ timeout: 5_000 }).catch(() => false))
    expect(hasUpload).toBe(true)
  })

  test('loads the /admin/media/videos page without error', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/media/videos')
    await expect(page).toHaveURL(/\/admin\/media\/videos/, { timeout: 15_000 })
    await expect(page.locator('body')).not.toContainText('404')
  })
})

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

test.describe('Admin settings pages', () => {
  test('loads /admin/settings without error', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/settings')
    await expect(page).toHaveURL(/\/admin\/settings/, { timeout: 15_000 })
    await expect(page.locator('body')).not.toContainText('404')
  })

  test('loads /admin/seo without error', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/seo')
    await expect(page).toHaveURL(/\/admin\/seo/, { timeout: 15_000 })
    await expect(page.locator('body')).not.toContainText('404')
  })

  test('SEO page shows the AI Crawlers tab', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/seo')
    await page.waitForLoadState('networkidle')

    const aiCrawlersTab = page.getByRole('tab', { name: /ai crawlers/i })
      .or(page.getByText(/ai crawlers/i).first())
    await expect(aiCrawlersTab).toBeVisible({ timeout: 10_000 })
  })

  test('loads /admin/settings/ai without error', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/settings/ai')
    await expect(page.locator('body')).not.toContainText('404')
  })
})
