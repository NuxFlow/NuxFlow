import { test, expect, request as playwrightRequest } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

/**
 * Holiday lets: the owner blocks some nights in the editor's Availability panel, and visitors
 * see those nights booked on the Availability calendar (the leaving day stays free).
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8787'
const slug = `e2e-cottage-${Date.now()}`
let itemId = ''

/** A date `n` days from today, in the browser's (this machine's) calendar. */
function day(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test.beforeAll(async () => {
  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const res = await admin.post('/api/v1/content', {
    data: {
      title: 'Seaview Cottage', slug, typeSlug: 'page', status: 'published',
      content: { type: 'canvas', blocks: [{ id: 'cal', type: 'canvas-availability', props: { title: 'When is it free?', months: 3 } }] },
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  itemId = ((await res.json()) as { id: string }).id
  await admin.dispose()
})

test.describe('as the owner', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

  test('blocks nights in the editor, and gets an export link', async ({ page }) => {
    await gotoHydrated(page, `/admin/content/${itemId}`)
    await expect(page.getByText('Your own blocked dates', { exact: true })).toBeVisible({ timeout: 20_000 })
    await page.getByLabel('First night').fill(day(3))
    await page.getByLabel('Leaving').fill(day(5))
    await page.getByLabel('Note', { exact: true }).fill('Family staying')
    await page.getByRole('button', { name: 'Block', exact: true }).click()
    await expect(page.getByText('Family staying')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Your calendar export link' })).toHaveValue(/\/_nuxflow\/availability-ics\/.+\?token=[0-9a-f]{64}$/)
  })
})

test('a visitor sees those nights booked, and the leaving day free', async ({ page }) => {
  await gotoHydrated(page, `/${slug}`)
  const cal = page.locator('.canvas-availability')
  await expect(cal.getByRole('heading', { name: 'When is it free?' })).toBeVisible()
  await expect(cal.locator(`[data-date="${day(3)}"]`)).toHaveAttribute('data-booked', '', { timeout: 15_000 })
  await expect(cal.locator(`[data-date="${day(4)}"]`)).toHaveAttribute('data-booked', '')
  await expect(cal.locator(`[data-date="${day(5)}"]`)).not.toHaveAttribute('data-booked', '')
  await expect(cal.locator(`[data-date="${day(4)}"]`)).toHaveAttribute('aria-label', /booked$/)
  await expect(page.getByText('Family staying')).toHaveCount(0)
})
