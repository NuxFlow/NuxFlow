import { test, expect } from '@playwright/test'

test.describe('NuxFlow Setup & Onboarding', () => {
  test('should load the setup page or redirect if already configured', async ({ page }) => {
    // Navigate to the setup page
    await page.goto('/setup')

    // Since E2E could run on a pre-installed database or a fresh one, wait for the page to settle:
    await expect(page.locator('h1')).toHaveText(/Welcome to NuxFlow|The\s+CMS\s+built\s+for\s+the\s+edge/, { timeout: 15000 })

    const currentUrl = page.url()
    if (currentUrl.endsWith('/setup')) {
      // Fresh setup flow
      await expect(page.locator('h1')).toContainText('Welcome to NuxFlow', { timeout: 30000 })
      
      // Step 1: Site Details
      await expect(page.locator('h2')).toContainText('Site details')
      
      const siteNameInput = page.locator('input[placeholder="My Awesome Site"]')
      await siteNameInput.fill('E2E Test Site')
      
      // Domain should auto-fill on blur, wait briefly and check before filling manually
      await page.waitForTimeout(500)
      const domainInput = page.locator('input[placeholder="example.com"]')
      const domainVal = await domainInput.inputValue()
      if (domainVal !== 'localhost') {
        await domainInput.fill('localhost')
      }
      
      // Click Continue
      const continueBtn = page.locator('button:has-text("Continue")')
      await expect(continueBtn).toBeEnabled()
      await continueBtn.click()

      // Step 2: Admin Account
      await expect(page.locator('h2')).toContainText('Admin account')
      
      await page.locator('input[placeholder="Jane Smith"]').fill('Test Administrator')
      await page.locator('input[placeholder="jane@example.com"]').fill('admin@nuxflow.spec')
      await page.locator('input[placeholder="••••••••"]').first().fill('password123')
      await page.locator('input[placeholder="••••••••"]').last().fill('password123')
      
      await page.locator('button:has-text("Continue")').click()

      // Step 3: Email Settings
      await expect(page.locator('h2')).toContainText('Email settings')
      await page.locator('button:has-text("Continue")').click()

      // Step 4: Template / Finish
      await expect(page.locator('h2')).toContainText('Choose a Starter Template')
      await page.locator('button:has-text("Finish setup")').click()

      // Step 5: Setup Done / Redirect
      await expect(page.locator('h1')).toContainText('Welcome to NuxFlow')
    } else {
      // Already configured: setup guard redirects to / or login
      console.log('Setup already completed, redirected to:', currentUrl)
      expect(currentUrl).not.toContain('/setup')
    }
  })
})
