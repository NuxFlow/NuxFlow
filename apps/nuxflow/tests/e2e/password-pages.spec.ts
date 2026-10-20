import { test, expect, request as playwrightRequest } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'

/**
 * Password-protected pages (client galleries), as a visitor sees them: the password form
 * (and none of the page) until the right password, then the page; and a fresh visitor is
 * still locked out afterwards. The set-up runs as the admin through the API.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8787'
const SECRET = 'E2E-PROTECTED-CONTENT'
const slug = `e2e-gallery-${Date.now()}`

test.beforeAll(async () => {
  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const res = await admin.post('/api/v1/content', {
    data: {
      title: 'Smith Wedding',
      slug,
      typeSlug: 'page',
      status: 'published',
      settings: { access: 'password' },
      pagePassword: 'smith2027',
      content: { type: 'canvas', blocks: [{ id: 't', type: 'canvas-text', props: { content: `<p>${SECRET}</p>` } }] },
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  await admin.dispose()
})

test('shows the password form, not the page, until the right password', async ({ page }) => {
  const response = await page.goto(`/${slug}`)
  expect(response?.status()).toBe(401)
  expect(await response?.text()).not.toContain(SECRET)

  await expect(page.getByRole('heading', { name: 'Smith Wedding' })).toBeVisible()
  await page.getByLabel('Password', { exact: true }).fill('not-it')
  await page.getByRole('button', { name: 'View page' }).click()
  await expect(page.getByRole('alert')).toContainText('isn\'t right')
  await expect(page.getByText(SECRET)).toHaveCount(0)

  await page.getByLabel('Password', { exact: true }).fill('smith2027')
  await page.getByRole('button', { name: 'View page' }).click()
  await expect(page.getByText(SECRET)).toBeVisible()

  // Remembered on reload.
  await page.reload()
  await expect(page.getByText(SECRET)).toBeVisible()
})

test('a different visitor is still asked for the password', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const response = await page.goto(`/${slug}`)
  expect(response?.status()).toBe(401)
  await expect(page.getByRole('button', { name: 'View page' })).toBeVisible()
  await context.close()
})
