import { test, expect } from '@playwright/test'

// Self-healing helper that logs in, running the onboarding setup wizard if a fresh database is detected.
async function ensureLoggedIn(page) {
  // Navigate to login
  await page.goto('/login')

  // Wait for the page to settle (either redirects to setup or stays on login)
  await expect(page.locator('h1')).toHaveText(/Welcome to NuxFlow|Sign\s+in\s+to\s+NuxFlow/, { timeout: 20000 })

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

    // Redirected back to login
    await page.goto('/login')
  }

  // Expect the login heading to be present
  await expect(page.locator('h1')).toContainText('Sign in to NuxFlow', { timeout: 30000 })

  // Fill in correct details and click Sign in
  await page.locator('input[type="email"]').fill('admin@nuxflow.spec')
  await page.locator('input[type="password"]').fill('password123')
  await page.locator('button[type="submit"]:has-text("Sign in")').click()

  // Wait for redirection to dashboard or homepage greeting
  await expect(page.locator('h1.text-2xl')).toHaveText(/Good\s+morning|Good\s+afternoon|Good\s+evening/, { timeout: 20000 })
}

// Helper to fill in both the page title and its slug using robust fallback selectors for the slug field.
async function fillTitleAndSlug(page, title, slug) {
  // Fill title
  const titleInput = page.locator('input[placeholder="Page title"]')
  await expect(titleInput).toBeVisible({ timeout: 15000 })
  await titleInput.fill(title)

  // Locate the slug input using robust fallbacks
  const slugInput = page.locator([
    '.font-mono input',
    'input.font-mono',
    '[class*="font-mono"] input',
    'label:has-text("Slug") ~ * input',
    'label:has-text("Slug") ~ input',
    'input:below(input[placeholder="Page title"])'
  ].join(', ')).first()

  await expect(slugInput).toBeVisible({ timeout: 5000 })
  await slugInput.fill(slug)
}

test.describe('NuxFlow Content Management and Publishing', () => {
  test.beforeEach(async ({ page }) => {
    // Enable client console and error forwarding for debugging
    page.on('console', msg => console.log(`[BROWSER LOG] ${msg.type().toUpperCase()}: ${msg.text()}`))
    page.on('pageerror', err => console.error(`[BROWSER ERROR] ${err.stack || err.message}`))
    
    // Intercept network requests to /api/v1/content to print request and response details
    page.on('request', request => {
      if (request.url().includes('/api/v1/content')) {
        console.log(`[NETWORK REQ] ${request.method()} ${request.url()}`);
        console.log(`[NETWORK REQ BODY]`, request.postData());
      }
    })
    page.on('response', async response => {
      if (response.url().includes('/api/v1/content')) {
        console.log(`[NETWORK RES STATUS] ${response.status()} for ${response.url()}`);
        try {
          const bodyText = await response.text();
          console.log(`[NETWORK RES BODY]`, bodyText);
        } catch (err) {
          console.log(`[NETWORK RES ERROR] Failed to read response body: ${err.message}`);
        }
      }
    })

    await ensureLoggedIn(page)
  })

  test('should create, save draft, and publish a standard text post', async ({ page }) => {
    // Navigate to create new post
    await page.goto('/admin/content/new?type=post')

    const postTitle = `E2E Standard Post - ${Date.now()}`
    const postSlug = `e2e-standard-post-${Date.now()}`

    // Fill Title and Slug
    await fillTitleAndSlug(page, postTitle, postSlug)

    // Type content in the editor prose area
    const editorProse = page.locator('.nux-editor-prose')
    await expect(editorProse).toBeVisible()
    await editorProse.click()
    await page.keyboard.type('Hello from NuxFlow E2E test. This is standard rich text.')

    // Save as draft first
    const saveDraftButton = page.locator('button:has-text("Save draft")')
    await saveDraftButton.click()

    // Wait for the URL to change to the saved item ID page (i.e. not `/new` anymore)
    try {
      await expect(page).not.toHaveURL(/\/admin\/content\/new/, { timeout: 15000 })
      await expect(page).toHaveURL(/\/admin\/content\/\w+/)
    } catch (e) {
      const errorContent = await page.locator('.text-red-500, [class*="red"]').allTextContents()
      console.error('[E2E FAILURE INFO] UI Errors at standard post draft save failure:', errorContent)
      throw e
    }

    // Click "Publish" button to make it public
    const publishButton = page.locator('button:has-text("Publish")')
    await publishButton.click()

    // Go back to the content list
    await page.goto('/admin/content?type=post')

    // Verify the newly created post title exists in the posts list table
    const table = page.locator('table')
    await expect(table).toContainText(postTitle, { timeout: 15000 })
  })

  test('should create, switch to canvas mode, add hero block, and publish a page', async ({ page }) => {
    // Navigate to create new page
    await page.goto('/admin/content/new?type=page')

    const pageTitle = `E2E Canvas Page - ${Date.now()}`
    const pageSlug = `e2e-canvas-page-${Date.now()}`

    // Fill Title and Slug
    await fillTitleAndSlug(page, pageTitle, pageSlug)

    // Switch to Canvas editor mode using the toolbar toggle buttons
    const canvasToggle = page.locator('button:has-text("Canvas")')
    await expect(canvasToggle).toBeVisible()
    await canvasToggle.click()

    // Verify Canvas empty state "Add your first block" button appears
    const addFirstBlockBtn = page.locator('button:has-text("Add your first block")')
    await expect(addFirstBlockBtn).toBeVisible({ timeout: 10000 })
    await addFirstBlockBtn.click()

    // Block picker modal "Add a block" opens
    const blockPickerHeading = page.locator('h2:has-text("Add a block")')
    await expect(blockPickerHeading).toBeVisible()

    // Pick the "Hero" block. It has the text "Hero" inside
    const heroBlockButton = page.locator('button:has-text("Hero")')
    await expect(heroBlockButton).toBeVisible()
    await heroBlockButton.click()

    // The block is added to the canvas. Verify block list has "1 block"
    await expect(page.locator('text=1 block')).toBeVisible({ timeout: 10000 })

    // Click "Publish" button to save and publish the page
    const publishButton = page.locator('button:has-text("Publish")')
    await publishButton.click()

    // Wait for the URL to change (navigates away from `new` to the saved content page)
    try {
      await expect(page).not.toHaveURL(/\/admin\/content\/new/, { timeout: 15000 })
      await expect(page).toHaveURL(/\/admin\/content\/\w+/)
    } catch (e) {
      const errorContent = await page.locator('.text-red-500, [class*="red"]').allTextContents()
      console.error('[E2E FAILURE INFO] UI Errors at canvas page publish failure:', errorContent)
      throw e
    }

    // Go back to the content list
    await page.goto('/admin/content?type=page')

    // Verify the newly created page title exists in the pages list table
    const table = page.locator('table')
    await expect(table).toContainText(pageTitle, { timeout: 15000 })
  })
})
