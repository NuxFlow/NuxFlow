import { test, expect } from '@playwright/test'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from apps/nuxflow/.env
dotenv.config({ path: path.resolve(__dirname, '../../apps/nuxflow/.env') })

// Configure playwright to use the live site by default if no TEST_BASE_URL is passed
const BASE_URL = process.env.TEST_BASE_URL || 'https://nuxflow.dev'

test.describe('NuxFlow Production Live E2E Testing', () => {
  test.beforeEach(async ({ page }) => {
    // Increase timeout for live testing to accommodate edge roundtrips and hydration
    test.setTimeout(90000)

    // Log browser console logs for debug info
    page.on('console', msg => console.log(`[BROWSER LOG] ${msg.type().toUpperCase()}: ${msg.text()}`))
    page.on('pageerror', err => console.error(`[BROWSER ERROR] ${err.stack || err.message}`))

    // Intercept network requests to print request and response details
    page.on('request', request => {
      if (request.url().includes('/api/')) {
        console.log(`[NETWORK REQ] ${request.method()} ${request.url()}`);
        const postData = request.postData();
        if (postData) console.log(`[NETWORK REQ BODY]`, postData);
      }
    })
    page.on('response', async response => {
      if (response.url().includes('/api/')) {
        console.log(`[NETWORK RES STATUS] ${response.status()} for ${response.url()}`);
        try {
          const bodyText = await response.text();
          console.log(`[NETWORK RES BODY]`, bodyText);
        } catch (err) {
          console.log(`[NETWORK RES ERROR] Failed to read response body: ${err.message}`);
        }
      }
    })

    // Navigate to the login page on the live URL
    console.log(`Navigating to ${BASE_URL}/login`)
    await page.goto(`${BASE_URL}/login`)

    // Wait for the page to settle and expect the Sign-in heading
    await expect(page.locator('h1')).toContainText('Sign in to NuxFlow', { timeout: 30000 })

    // Wait for Nuxt app hydration on the live environment
    console.log('Waiting for page hydration...')
    await page.waitForTimeout(2500)

    // Fill in credentials provided from environment variables (git-ignored)
    const email = process.env.TEST_ADMIN_EMAIL
    const password = process.env.TEST_ADMIN_PASSWORD
    if (!email || !password) {
      throw new Error('E2E credentials not found. Please set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD in process.env or .env file.')
    }

    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[type="password"]').fill(password)

    // Submit form
    console.log('Logging in...')
    await page.locator('button[type="submit"]:has-text("Sign in")').click()

    // Wait for redirection and ensure we are in the admin dashboard (Welcome/Good evening message or layout)
    await expect(page.locator('h1.text-2xl')).toHaveText(/Good\s+morning|Good\s+afternoon|Good\s+evening/, { timeout: 30000 })
    console.log('Successfully logged into NuxFlow Admin dashboard!')
  })

  test('should thoroughly test Taxonomies and Terms', async ({ page }) => {
    console.log('Testing Taxonomies...')
    await page.goto(`${BASE_URL}/admin/taxonomies`)
    await page.waitForTimeout(2000)

    // Ensure page header exists
    await expect(page.locator('h1.text-2xl')).toHaveText('Taxonomies')

    // 1. Create a new taxonomy
    await page.locator('button:has-text("New taxonomy")').click()
    
    // Fill creation form
    const taxName = `E2E Tax - ${Date.now()}`
    const taxSlug = `e2e-tax-${Date.now()}`
    
    await page.locator('input[placeholder="e.g. Topics"]').fill(taxName)
    // Slug should auto-populate, but let's make sure it's filled or force it
    await page.waitForTimeout(500)
    await page.locator('input[placeholder="e.g. topic"]').fill(taxSlug)
    
    // Click "Create" in modal
    await page.locator('button:has-text("Create")').click()
    console.log(`Created custom taxonomy: ${taxName}`)

    // 2. Locate and open the newly created taxonomy
    const taxCard = page.locator(`p.font-medium:has-text("${taxName}")`).locator('xpath=ancestor::div[contains(@class, "cursor-pointer")]')
    await expect(taxCard).toBeVisible({ timeout: 15000 })
    await taxCard.click()

    // 3. Verify term panel opens and add terms
    await expect(page.locator('p:has-text("terms")')).toBeVisible({ timeout: 10000 })
    
    const term1 = `E2E Term A - ${Date.now()}`
    const term2 = `E2E Term B - ${Date.now()}`
    
    // Add Term 1
    const termInput = page.locator('input[placeholder="Term name"]')
    await termInput.fill(term1)
    await page.locator('button:has-text("Add")').click()
    await expect(page.locator(`span:has-text("${term1}")`)).toBeVisible({ timeout: 10000 })
    console.log(`Added term: ${term1}`)

    // Add Term 2
    await termInput.fill(term2)
    await page.locator('button:has-text("Add")').click()
    await expect(page.locator(`span:has-text("${term2}")`)).toBeVisible({ timeout: 10000 })
    console.log(`Added term: ${term2}`)

    // 4. Delete Term 1
    const term1Row = page.locator(`span:has-text("${term1}")`).locator('xpath=ancestor::div[contains(@class, "group")]')
    await term1Row.hover()
    // Click delete icon (x button)
    await term1Row.locator('button.opacity-0').click()
    await expect(page.locator(`span:has-text("${term1}")`)).not.toBeVisible({ timeout: 10000 })
    console.log(`Successfully deleted term: ${term1}`)

    // 5. Delete the entire taxonomy
    // Click trash button on taxonomy card
    const trashBtn = taxCard.locator('button')
    await trashBtn.click()
    
    // Accept delete in the confirmation modal
    await page.locator('button:has-text("Delete")').click()
    await expect(page.locator(`p.font-medium:has-text("${taxName}")`)).not.toBeVisible({ timeout: 15000 })
    console.log('Successfully deleted the custom taxonomy!')
  })

  test('should thoroughly test Users list and Invites', async ({ page }) => {
    console.log('Testing Users & Invites...')
    await page.goto(`${BASE_URL}/admin/users`)
    await page.waitForTimeout(2000)

    await expect(page.locator('h1.text-xl')).toHaveText('Users')

    // 1. Open invite modal
    await page.locator('button:has-text("Invite user")').click()
    
    const inviteName = `E2E User ${Date.now()}`
    const inviteEmail = `e2e-user-${Date.now()}@example.com`

    await page.locator('input[placeholder="Jane Smith"]').fill(inviteName)
    await page.locator('input[placeholder="jane@example.com"]').fill(inviteEmail)
    
    // Select "Viewer" role (should be default but we set it anyway)
    // Send invite
    await page.locator('button:has-text("Send invite")').click()
    console.log(`Sent invite to: ${inviteEmail}`)

    // 2. Verify new user appears in user table
    const table = page.locator('table')
    await expect(table).toContainText(inviteEmail, { timeout: 15000 })

    // 3. Remove invited user (setup dialog listener to accept window.confirm)
    page.once('dialog', async dialog => {
      console.log(`Handling confirm dialog: ${dialog.message()}`)
      await dialog.accept()
    })

    // Find the row for our invited user
    const userRow = page.locator(`tr:has-text("${inviteEmail}")`)
    const deleteBtn = userRow.locator('button').last()
    await deleteBtn.click()

    // Verify user is removed from table
    await expect(table).not.toContainText(inviteEmail, { timeout: 15000 })
    console.log(`Successfully deleted invited user: ${inviteEmail}`)
  })

  test('should thoroughly test Forms creation and management', async ({ page }) => {
    console.log('Testing Forms...')
    await page.goto(`${BASE_URL}/admin/forms`)
    await page.waitForTimeout(2000)

    await expect(page.locator('h1.text-xl')).toHaveText('Forms')

    // 1. Navigate to new form
    await page.locator('a:has-text("New form")').click()
    await expect(page.locator('button:has-text("Save form")')).toBeVisible({ timeout: 15000 })

    const formName = `E2E Form - ${Date.now()}`
    // Change form name
    const nameInput = page.locator('.text-lg input')
    await nameInput.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')
    await nameInput.fill(formName)

    // 2. Add some fields
    // Click "Short text" on left sidebar
    await page.locator('button:has-text("Short text")').click()
    // Verify field added
    await expect(page.locator('p:has-text("Short text")')).toBeVisible()

    // Add "Email" field
    await page.locator('button:has-text("Email")').click()
    // Verify field added
    await expect(page.locator('p.font-medium:has-text("Email")')).toBeVisible()

    // Configure the Email field to be required
    // Click on the Email field in canvas
    await page.locator('p.font-medium:has-text("Email")').locator('xpath=ancestor::div[contains(@class, "cursor-pointer")]').click()
    
    // Toggle switch in settings panel to required
    const requiredSwitch = page.locator('button[role="switch"]')
    const isChecked = await requiredSwitch.getAttribute('aria-checked')
    if (isChecked !== 'true') {
      await requiredSwitch.click()
    }

    // 3. Save Form
    await page.locator('button:has-text("Save form")').click()
    console.log(`Saving new form: ${formName}`)

    // Should redirect to edit page with newly generated 26-character ULID
    await expect(page).toHaveURL(/\/admin\/forms\/[a-zA-Z0-9]{26}\/edit/, { timeout: 15000 })
    console.log('Form saved and redirected successfully!')

    // 4. Extract Form ID and verify forms list
    const currentUrl = page.url()
    const formId = currentUrl.split('/').slice(-2)[0]
    console.log(`Extracted Form ID from URL: ${formId}`)

    await page.goto(`${BASE_URL}/admin/forms`)
    await page.waitForTimeout(2000)
    const table = page.locator('table')
    await expect(table).toContainText(formName, { timeout: 15000 })

    // 5. Check submissions page directly using the parsed form ID
    console.log(`Debugging Submissions API directly for form ID: ${formId}`)
    const apiResult = await page.evaluate(async (fId) => {
      try {
        const res = await fetch(`/api/v1/forms/${fId}/submissions`)
        return {
          status: res.status,
          statusText: res.statusText,
          body: await res.text()
        }
      } catch (err) {
        return {
          status: -1,
          statusText: 'Fetch Error',
          body: err instanceof Error ? err.stack || err.message : String(err)
        }
      }
    }, formId)
    console.log('[DEBUG] Submissions API call result:', apiResult)

    console.log(`Navigating directly to submissions page for form ID: ${formId}`)
    await page.goto(`${BASE_URL}/admin/forms/${formId}/submissions`)
    await page.waitForTimeout(2000)

    await expect(page.locator('h1.text-xl')).toContainText('Submissions')
    await expect(page.locator('p:has-text("No submissions yet")')).toBeVisible()
    console.log('Form listing and submissions verified!')
  })

  test('should thoroughly test Contact Form Submissions', async ({ page }) => {
    console.log('Testing Contact Forms...')

    // 1. Submit a contact form submission using the API in the browser context (inherits current cookies/session/origin)
    const testSubject = `E2E Contact Subject - ${Date.now()}`
    const testName = `E2E Contact Tester`
    const testEmail = `contact-e2e-${Date.now()}@example.com`
    const testMessage = `This is a thorough E2E test message from the Playwright runner. Date: ${new Date().toISOString()}`

    console.log('Submitting a contact form message via the API inside browser context...')
    const submissionResult = await page.evaluate(async (payload) => {
      const response = await fetch('/api/v1/contact/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Submit failed: ${response.status} - ${text}`)
      }
      return await response.json()
    }, {
      name: testName,
      email: testEmail,
      subject: testSubject,
      message: testMessage
    })

    console.log('Submission API response:', submissionResult)
    expect(submissionResult.success).toBe(true)

    // 2. Go to /admin/contact-forms and verify the submission shows up
    await page.goto(`${BASE_URL}/admin/contact-forms`)
    await page.waitForTimeout(2000)
    await expect(page.locator('h1.text-xl')).toHaveText('Contact Form')

    // Find the submission card
    const subCard = page.locator(`p:has-text("${testEmail}")`).locator('xpath=ancestor::div[contains(@class, "cursor-pointer")]')
    await expect(subCard).toBeVisible({ timeout: 15000 })
    await subCard.click()

    // 3. Verify detail pane loads the message correctly
    await expect(page.locator('p:has-text("Email:")')).toContainText(testEmail)
    await expect(page.locator('p:has-text("Subject:")')).toContainText(testSubject)
    await expect(page.locator(`p:has-text("${testMessage}")`)).toBeVisible()
    console.log('Verified contact form details loaded successfully!')

    // 4. Test actions: Mark read and Archive
    // Click "Mark read" button
    const markReadBtn = page.locator('button:has-text("Mark read")')
    if (await markReadBtn.isVisible()) {
      await markReadBtn.click()
      // Toast or badge should update. Let's wait for page to settle and expect badge change
      await expect(page.locator('span:has-text("read")').first()).toBeVisible({ timeout: 10000 })
      console.log('Successfully marked contact submission as Read!')
    }

    // Click "Archive" button
    const archiveBtn = page.locator('button:has-text("Archive")')
    if (await archiveBtn.isVisible()) {
      await archiveBtn.click()
      await expect(page.locator('span:has-text("archived")').first()).toBeVisible({ timeout: 10000 })
      console.log('Successfully archived contact submission!')
    }
  })

  test('should thoroughly test Memberships and Tiers', async ({ page }) => {
    console.log('Testing Memberships...')
    await page.goto(`${BASE_URL}/admin/memberships`)
    await page.waitForTimeout(2000)

    // Header validation
    await expect(page.locator('h1.text-xl')).toHaveText('Memberships')

    // 1. Create a new membership tier
    await page.locator('button:has-text("New tier")').click()
    await expect(page.locator('h2:has-text("New membership tier")')).toBeVisible({ timeout: 10000 })

    const tierName = `E2E Plan - ${Date.now()}`
    const tierDesc = `This is a test membership tier description generated by E2E runner.`
    const tierPrice = 29.99

    // Fill form
    await page.locator('input[placeholder="e.g. Pro"]').fill(tierName)
    await page.locator('input[placeholder="Optional description"]').fill(tierDesc)
    await page.locator('input[type="number"]').fill(String(tierPrice))
    
    // Add a feature
    await page.locator('input[placeholder="Add a feature"]').fill('Premium E2E feature')
    await page.locator('input[placeholder="Add a feature"]').press('Enter')

    // Submit form
    await page.locator('button[type="submit"]:has-text("Create tier")').click()
    console.log(`Creating membership tier: ${tierName}`)

    // 2. Verify tier exists in list
    const tierCard = page.locator(`p:has-text("${tierName}")`).locator('xpath=ancestor::div[contains(@class, "flex") and contains(@class, "justify-between")]').first()
    await expect(tierCard).toBeVisible({ timeout: 15000 })
    await expect(tierCard).toContainText(`USD${tierPrice.toFixed(2)}`)
    console.log('Membership tier successfully created and verified!')

    // 3. Delete the tier
    // Setup dialog listener to accept confirm delete
    page.once('dialog', async dialog => {
      console.log(`Handling confirm dialog: ${dialog.message()}`)
      await dialog.accept()
    })

    const trashBtn = tierCard.locator('button').last()
    await trashBtn.click()

    // Verify it is removed
    await expect(page.locator(`p:has-text("${tierName}")`)).not.toBeVisible({ timeout: 15000 })
    console.log('Membership tier successfully deleted!')

    // 4. Switch to Subscribers tab and ensure it loads
    await page.locator('button:has-text("Subscribers")').click()
    await expect(page.locator('p:has-text("No subscribers yet")')).toBeVisible({ timeout: 10000 })
    console.log('Subscribers tab loaded successfully!')
  })

  test('should thoroughly test SEO Global defaults and Redirects', async ({ page }) => {
    console.log('Testing SEO...')
    await page.goto(`${BASE_URL}/admin/seo`)
    await page.waitForTimeout(2000)

    // Header validation
    await expect(page.locator('h1.text-xl')).toHaveText('SEO')

    // 1. Verify "Global defaults" card loads and edit meta description
    await expect(page.locator('p:has-text("Global SEO defaults")').first()).toBeVisible({ timeout: 10000 })
    
    const metaDescInput = page.locator('textarea[placeholder*="A short description"]')
    const originalDesc = await metaDescInput.inputValue()
    const testDesc = `E2E Test Meta Description - ${Date.now()}`
    
    await metaDescInput.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')
    await metaDescInput.fill(testDesc)
    
    // Save changes
    const saveResponsePromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/settings') && 
      response.request().method() === 'PATCH' && 
      response.status() === 200
    )
    await page.locator('button:has-text("Save changes")').click()
    const saveResponse = await saveResponsePromise
    const saveResult = JSON.parse(await saveResponse.text())
    expect(saveResult.success).toBe(true)
    console.log('SEO global settings successfully modified and saved (verified via PATCH response)!')

    // Restore original description
    await metaDescInput.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')
    await metaDescInput.fill(originalDesc)
    
    const restoreResponsePromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/settings') && 
      response.request().method() === 'PATCH' && 
      response.status() === 200
    )
    await page.locator('button:has-text("Save changes")').click()
    const restoreResponse = await restoreResponsePromise
    const restoreResult = JSON.parse(await restoreResponse.text())
    expect(restoreResult.success).toBe(true)
    console.log('SEO global settings successfully restored (verified via PATCH response)!')

    // 2. Switch to Redirects tab
    await page.locator('button:has-text("Redirects")').click()
    await expect(page.locator('p:has-text("Add redirect")')).toBeVisible({ timeout: 10000 })
    console.log('Successfully switched to Redirects tab!')

    // 3. Add a new redirect rule
    const fromPath = `/e2e-redirect-from-${Date.now()}`
    const toPath = `/e2e-redirect-to-${Date.now()}`
    
    await page.locator('input[placeholder="/old-page"]').fill(fromPath)
    await page.locator('input[placeholder*="/new-page"]').fill(toPath)
    
    // Click "Add redirect" button
    const addResponsePromise = page.waitForResponse(response => response.url().includes('/api/v1/redirects') && response.status() === 200)
    await page.locator('button:has-text("Add redirect")').click()
    await addResponsePromise
    
    const table = page.locator('table')
    await expect(table).toContainText(fromPath, { timeout: 10000 })
    console.log(`Redirect rule successfully added and verified in list: ${fromPath} -> ${toPath}`)

    // 4. Delete the newly created redirect rule
    const redirectRow = page.locator(`tr:has-text("${fromPath}")`)
    // Click the delete button in the row
    const deleteResponsePromise = page.waitForResponse(response => response.url().includes('/api/v1/redirects/') && response.status() === 200)
    await redirectRow.locator('button').click()
    await deleteResponsePromise
    
    await expect(page.locator(`tr:has-text("${fromPath}")`)).not.toBeAttached({ timeout: 10000 })
    console.log('Redirect rule successfully deleted and verified in list!')
  })

  test('should thoroughly test Admin Settings and AI Settings', async ({ page }) => {
    console.log('Testing Admin Settings...')
    
    // 1. General Settings
    await page.goto(`${BASE_URL}/admin/settings`)
    await page.waitForTimeout(2000)
    await expect(page.locator('h1.text-xl')).toHaveText('Settings')
    
    // Switch to Appearance tab
    await page.locator('button:has-text("Appearance")').click()
    await expect(page.locator('p:has-text("The icon shown in browser tabs")')).toBeVisible({ timeout: 10000 })
    console.log('Appearance settings tab successfully loaded!')
    
    // Switch back to General tab
    await page.locator('button:has-text("General")').click()
    await expect(page.locator('text=The primary domain this site runs on')).toBeVisible({ timeout: 10000 })
    
    // 2. AI Settings
    console.log('Testing AI Settings...')
    await page.goto(`${BASE_URL}/admin/settings/ai`)
    await page.waitForTimeout(2000)
    await expect(page.locator('h1.text-xl')).toHaveText('AI Settings')
    
    // Fill Gemini API key or OpenAI API key
    const openAiInput = page.locator('input[placeholder="sk-..."]')
    const originalOpenAiKey = await openAiInput.inputValue()
    const testOpenAiKey = `sk-e2e-test-key-${Date.now()}`
    
    await openAiInput.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')
    await openAiInput.fill(testOpenAiKey)
    
    // Click "Save"
    const aiSaveResponsePromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/settings') && 
      response.request().method() === 'PATCH' && 
      response.status() === 200
    )
    await page.locator('button:has-text("Save")').first().click()
    const aiSaveResponse = await aiSaveResponsePromise
    const aiSaveResult = JSON.parse(await aiSaveResponse.text())
    expect(aiSaveResult.success).toBe(true)
    console.log('AI settings successfully updated!')
    
    // Restore original key
    await openAiInput.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')
    await openAiInput.fill(originalOpenAiKey)
    
    const aiRestoreResponsePromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/settings') && 
      response.request().method() === 'PATCH' && 
      response.status() === 200
    )
    await page.locator('button:has-text("Save")').first().click()
    await aiRestoreResponsePromise
    console.log('AI settings successfully restored!')
  })

  test('should thoroughly test API Keys generation and revocation', async ({ page }) => {
    console.log('Testing API Keys...')
    await page.goto(`${BASE_URL}/admin/settings/api-keys`)
    await page.waitForTimeout(2000)
    await expect(page.locator('h1.text-xl')).toHaveText('API Keys')
    
    // Fill Key name
    const keyName = `E2E Key - ${Date.now()}`
    await page.locator('input[placeholder="My app"]').fill(keyName)
    
    // Click Create
    const createKeyPromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/api-keys') && 
      response.request().method() === 'POST' && 
      response.status() === 201
    )
    await page.locator('button:has-text("Create")').click()
    const createKeyResponse = await createKeyPromise
    const createKeyResult = JSON.parse(await createKeyResponse.text())
    expect(createKeyResult.key).toBeDefined()
    
    // Ensure alert for newly created key exists
    await expect(page.locator('text=API key created')).toBeVisible({ timeout: 10000 })
    console.log(`Successfully generated new API Key: ${keyName}`)
    
    // Check table for inclusion
    const table = page.locator('table')
    await expect(table).toContainText(keyName, { timeout: 10000 })
    
    // Revoke the key
    const keyRow = page.locator(`tr:has-text("${keyName}")`)
    const deleteKeyPromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/api-keys/') && 
      response.request().method() === 'DELETE' && 
      response.status() === 200
    )
    await keyRow.locator('button').click()
    await deleteKeyPromise
    
    // Verify it is deleted from list
    await expect(page.locator(`tr:has-text("${keyName}")`)).not.toBeAttached({ timeout: 10000 })
    console.log('API key successfully revoked and removed!')
  })

  test('should thoroughly test Navigation Menus creation, item addition, and deletion', async ({ page }) => {
    console.log('Testing Navigation Menus...')
    await page.goto(`${BASE_URL}/admin/menus`)
    await page.waitForTimeout(2000)
    await expect(page.locator('h1.text-xl')).toHaveText('Navigation')
    
    // 1. Create a new menu
    await page.locator('button:has-text("New menu")').click()
    const menuName = `E2E Menu - ${Date.now()}`
    await page.locator('input[placeholder="e.g. Main Navigation"]').fill(menuName)
    
    const createMenuPromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/menus') && 
      response.request().method() === 'POST' && 
      response.status() === 200
    )
    await page.locator('button:has-text("Create menu")').click()
    const createMenuResponse = await createMenuPromise
    const createMenuResult = JSON.parse(await createMenuResponse.text())
    const menuId = createMenuResult.id
    
    // Wait for redirect to edit page
    await expect(page).toHaveURL(new RegExp(`/admin/menus/${menuId}`), { timeout: 15000 })
    console.log(`Menu "${menuName}" successfully created! Redirected to: /admin/menus/${menuId}`)
    
    // 2. Add an item
    // Toggle to Custom URL
    await page.locator('button:has-text("Custom URL")').click()
    
    // Fill inputs
    await page.locator('input[placeholder="https://example.com"]').fill('https://nuxflow.dev')
    await page.locator('input[placeholder="Optional label"]').fill('Home')
    
    // Click "Add to menu"
    await page.locator('button:has-text("Add to menu")').click()
    
    // Verify item is added to builder list
    await expect(page.locator('span:has-text("Home")')).toBeVisible({ timeout: 10000 })
    
    // 3. Save Menu changes
    const saveMenuPromise = page.waitForResponse(response => 
      response.url().includes(`/api/v1/menus/${menuId}`) && 
      response.request().method() === 'PATCH' && 
      response.status() === 200
    )
    await page.locator('button:has-text("Save")').first().click()
    await saveMenuPromise
    console.log('Menu changes successfully saved!')
    
    // 4. Go back to menus index and delete the menu
    await page.goto(`${BASE_URL}/admin/menus`)
    await page.waitForTimeout(2000)
    
    const menuCard = page.locator(`span:has-text("${menuName}")`).locator('xpath=ancestor::a[contains(@class, "group")]')
    await menuCard.hover()
    
    // Click delete trash icon inside card
    await menuCard.locator('button').click()
    
    // Confirm modal delete
    const deleteMenuPromise = page.waitForResponse(response => 
      response.url().includes(`/api/v1/menus/`) && 
      response.request().method() === 'DELETE' && 
      response.status() === 200
    )
    await page.locator('button:has-text("Delete")').click()
    await deleteMenuPromise
    
    // Verify card is removed
    await expect(page.locator(`span:has-text("${menuName}")`)).not.toBeAttached({ timeout: 15000 })
    console.log('Menu successfully deleted and verified in list!')
  })

  test('should verify access to all miscellaneous administrative routes', async ({ page }) => {
    console.log('Testing Miscellaneous Admin Dashboards...')
    
    // 1. Media Library
    console.log('Routing to Media Library...')
    await page.goto(`${BASE_URL}/admin/media`)
    await page.waitForTimeout(2000)
    await expect(page.locator('h1.text-xl')).toHaveText('Media library')
    
    // 2. Comments
    console.log('Routing to Comments...')
    await page.goto(`${BASE_URL}/admin/comments`)
    await page.waitForTimeout(2000)
    await expect(page.locator('h1.text-2xl')).toHaveText('Comments')
    
    // 3. Themes
    console.log('Routing to Themes...')
    await page.goto(`${BASE_URL}/admin/themes`)
    await page.waitForTimeout(2000)
    await expect(page.locator('h1.text-xl')).toHaveText('Themes')
    
    // 4. Plugins
    console.log('Routing to Plugins...')
    await page.goto(`${BASE_URL}/admin/plugins`)
    await page.waitForTimeout(2000)
    await expect(page.locator('h1.text-xl')).toHaveText('Plugins')
    
    // 5. Audit Log
    console.log('Routing to Audit Log...')
    await page.goto(`${BASE_URL}/admin/settings/audit-log`)
    await page.waitForTimeout(2000)
    await expect(page.locator('h1.text-xl')).toHaveText('Audit log')
    
    // 6. Import & Backup
    console.log('Routing to Import & Backup...')
    await page.goto(`${BASE_URL}/admin/import`)
    await page.waitForTimeout(2000)
    await expect(page.locator('h1.text-2xl')).toHaveText('Import & Backup')
    
    console.log('All miscellaneous admin routes successfully resolved and verified!')
  })
})

