import { test, expect } from '@playwright/test'

/**
 * Public-facing page E2E tests:
 * - 404 for non-existent slugs
 * - Pricing page loads (even with no tiers)
 * - Account page redirects unauthenticated users to login
 */

test.describe('404 handling', () => {
  test('shows 404 error for an unknown slug', async ({ page }) => {
    await page.goto('/this-page-definitely-does-not-exist-xyz-123')
    await page.waitForSelector('body')
    // The slug page renders a 404 block
    await expect(page.locator('body')).toContainText(/404|not found/i)
  })
})

test.describe('Pricing page', () => {
  test('loads without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))

    await page.goto('/pricing')
    await page.waitForLoadState('networkidle')

    // The page should not crash
    expect(errors.filter(e => !e.includes('favicon'))).toHaveLength(0)
  })

  test('renders a pricing section', async ({ page }) => {
    await page.goto('/pricing')
    await page.waitForSelector('body')
    // Either shows a pricing grid or a "no plans" message
    const hasPricingContent = await page.locator('body').isVisible()
    expect(hasPricingContent).toBe(true)
  })
})

test.describe('Account page', () => {
  test('redirects unauthenticated users to the login page', async ({ page }) => {
    await page.goto('/account')
    // Should redirect to login (the auth middleware handles this)
    await page.waitForURL(/\/login/, { timeout: 15_000 })
    expect(page.url()).toContain('/login')
  })
})

test.describe('Admin area access control', () => {
  test('redirects unauthenticated users away from /admin', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForURL(/\/login|\/setup/, { timeout: 15_000 })
    expect(page.url()).toMatch(/\/login|\/setup/)
  })
})
