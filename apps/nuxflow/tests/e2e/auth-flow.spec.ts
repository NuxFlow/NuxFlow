import { test, expect } from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './global-setup'

/**
 * Auth flow E2E tests:
 * - Admin login → redirected to dashboard
 * - Logout
 * - Invalid credentials show error
 * - Forgot-password page UI
 * - Reset-password page UI (no token)
 */

test.describe('Login flow', () => {
  test('shows the login form', async ({ page }) => {
    await page.goto('/login')
    await page.waitForSelector('input[type="email"]')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('shows a link to register', async ({ page }) => {
    await page.goto('/login')
    await page.waitForSelector('a[href="/register"]')
    await expect(page.locator('a[href="/register"]')).toBeVisible()
  })

  test('successful admin login redirects to dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.waitForSelector('input[type="email"]')

    await page.fill('input[type="email"]', ADMIN_EMAIL)
    await page.fill('input[type="password"]', ADMIN_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()

    // After login, admin should land in the admin dashboard
    await page.waitForURL(/\/admin/, { timeout: 20_000 })
    expect(page.url()).toContain('/admin')
  })

  test('invalid credentials show an error message', async ({ page }) => {
    await page.goto('/login')
    await page.waitForSelector('input[type="email"]')

    await page.fill('input[type="email"]', 'wrong@example.com')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.getByRole('button', { name: /sign in/i }).click()

    // An error alert or message should appear
    await page.waitForSelector('[role="alert"], .error, [data-test="error"]', { timeout: 10_000 })
      .catch(async () => {
        // Alternatively look for text containing 'Invalid' or 'incorrect'
        await expect(page.locator('body')).toContainText(/invalid|incorrect|failed/i)
      })
  })
})

test.describe('Forgot-password page', () => {
  test('renders the forgot-password form', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.waitForSelector('input[type="email"]')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible()
  })

  test('shows a success message after submitting any email (prevents enumeration)', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.waitForSelector('input[type="email"]')

    await page.fill('input[type="email"]', 'anyemail@example.com')
    await page.getByRole('button', { name: /send reset link/i }).click()

    // Should always show a "check your inbox" style message regardless of whether the email exists
    await expect(page.locator('body')).toContainText(/check your inbox|reset link|sent/i, { timeout: 10_000 })
  })
})

test.describe('Reset-password page', () => {
  test('shows an invalid link message when no token is in the URL', async ({ page }) => {
    await page.goto('/reset-password')
    await page.waitForSelector('body')
    await expect(page.locator('body')).toContainText(/invalid.*link|missing.*token|reset link/i)
  })

  test('shows the password form when a token is present in the URL', async ({ page }) => {
    await page.goto('/reset-password?token=fake-token-for-ui-test')
    await page.waitForSelector('input[type="password"]')
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /reset password/i })).toBeVisible()
  })
})

test.describe('Register page', () => {
  test('renders the registration form', async ({ page }) => {
    await page.goto('/register')
    await page.waitForSelector('input[type="email"]')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /create account|register|sign up/i })).toBeVisible()
  })
})
