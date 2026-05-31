import { test, expect } from '@playwright/test'

test.describe('NuxFlow User Authentication', () => {
  test('should load the login page and handle invalid login attempts', async ({ page }) => {
    await page.goto('/login')

    // Wait for the page to settle (either redirects to setup or stays on login)
    await expect(page.locator('h1')).toHaveText(/Welcome to NuxFlow|Sign\s+in\s+to\s+NuxFlow/, { timeout: 15000 })

    const currentUrl = page.url()
    if (currentUrl.endsWith('/setup')) {
      // Step 1: Site Details
      await page.locator('input[placeholder="My Awesome Site"]').fill('E2E Test Site')
      await page.waitForTimeout(500)
      const domainInput = page.locator('input[placeholder="example.com"]')
      const domainVal = await domainInput.inputValue()
      if (domainVal !== 'localhost') {
        await domainInput.fill('localhost')
      }
      await page.locator('button:has-text("Continue")').click()
      
      // Step 2: Admin Account
      await page.locator('input[placeholder="Jane Smith"]').fill('Test Administrator')
      await page.locator('input[placeholder="jane@example.com"]').fill('admin@nuxflow.spec')
      await page.locator('input[placeholder="••••••••"]').first().fill('password123')
      await page.locator('input[placeholder="••••••••"]').last().fill('password123')
      await page.locator('button:has-text("Continue")').click()

      // Step 3: Email Settings
      await page.locator('button:has-text("Continue")').click()

      // Step 4: Template / Finish
      await page.locator('button:has-text("Finish setup")').click()

      // Now navigate to login
      await page.goto('/login')
    }

    // Expect the login heading to be present
    await expect(page.locator('h1')).toContainText('Sign in to NuxFlow', { timeout: 30000 })

    // Locate the email and password inputs
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')
    
    await emailInput.fill('invalid-email@nuxflow.spec')
    await passwordInput.fill('wrongpassword')

    // Click submit
    await page.locator('button[type="submit"]:has-text("Sign in")').click()

    // Expect an error alert to appear
    const alert = page.locator('.text-red-500, [class*="red"]')
    await expect(alert.first()).toBeVisible()
  })
})
