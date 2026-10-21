/**
 * E2E tests for the mailing list: turning the signup popup on in Admin → Mailing list,
 * a visitor seeing it (only after answering the cookie banner, on their second page),
 * signing up and getting the reward, closing it for good, and the address showing up
 * in the admin list.
 *
 * The e2e site has no third-party email provider, so double opt-in stays off and
 * signups are added straight away.
 */
import { test, expect, type Browser } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'

const RUN = Date.now().toString(36)
const EMAIL = `reader-${RUN}@example.com`
const REWARD = `Your code: E2E${RUN.toUpperCase()}`

async function visitorPage(browser: Browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  return { context, page }
}

test.describe.serial('Mailing list', () => {
  test('admin turns the signup popup on', async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE_PATH })
    const page = await context.newPage()
    await page.goto('/admin/mailing-list?tab=signup')
    await expect(page.getByRole('heading', { name: 'Signup popup' })).toBeVisible({ timeout: 15_000 })

    const toggle = page.getByRole('switch', { name: 'Show the popup' })
    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click()
    await page.getByLabel('Text').last().fill(REWARD)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Signup settings saved').first()).toBeVisible({ timeout: 10_000 })
    await context.close()
  })

  test('a visitor sees it on their second page, signs up and gets the reward', async ({ browser }) => {
    const { context, page } = await visitorPage(browser)
    await page.goto('/')
    // Nothing until the cookie banner is answered.
    await page.getByRole('button', { name: 'Necessary only' }).click()
    await expect(page.locator('.nuxflow-signup')).toHaveCount(0)

    await page.goto('/blog')
    const popup = page.locator('.nuxflow-signup')
    await expect(popup).toBeVisible({ timeout: 15_000 })
    await expect(popup.getByText('Get new posts by email')).toBeVisible()

    await popup.getByPlaceholder('you@example.com').fill(EMAIL)
    await popup.getByRole('button', { name: 'Subscribe' }).click()
    await expect(popup.getByText('Thanks for subscribing!')).toBeVisible({ timeout: 10_000 })
    await expect(popup.getByText(REWARD)).toBeVisible()

    // Signed up: it never comes back.
    await page.goto('/')
    await page.goto('/blog')
    await page.waitForTimeout(5_000)
    await expect(page.locator('.nuxflow-signup')).toHaveCount(0)
    await context.close()
  })

  test('closing it keeps it away', async ({ browser }) => {
    const { context, page } = await visitorPage(browser)
    await page.goto('/')
    await page.getByRole('button', { name: 'Necessary only' }).click()
    await page.goto('/blog')
    const popup = page.locator('.nuxflow-signup')
    await expect(popup).toBeVisible({ timeout: 15_000 })
    await popup.getByRole('button', { name: 'Close' }).click()
    await expect(popup).toHaveCount(0)

    await page.goto('/')
    await page.goto('/blog')
    await page.waitForTimeout(5_000)
    await expect(page.locator('.nuxflow-signup')).toHaveCount(0)
    await context.close()
  })

  test('the address appears in Admin → Mailing list', async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE_PATH })
    const page = await context.newPage()
    await page.goto('/admin/mailing-list')
    await expect(page.getByText(EMAIL)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('row', { name: new RegExp(EMAIL) }).getByText('Subscribed')).toBeVisible()
    await context.close()
  })

  test('admin turns the popup off again', async ({ browser }) => {
    // Leaves the shared e2e site as other specs expect it (no popup over public pages).
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE_PATH })
    const page = await context.newPage()
    await page.goto('/admin/mailing-list?tab=signup')
    const toggle = page.getByRole('switch', { name: 'Show the popup' })
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    if ((await toggle.getAttribute('aria-checked')) === 'true') await toggle.click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Signup settings saved').first()).toBeVisible({ timeout: 10_000 })
    await context.close()
  })
})
