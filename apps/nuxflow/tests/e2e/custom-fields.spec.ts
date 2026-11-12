import { test, expect, request as playwrightRequest } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

/**
 * A site's own content type with custom fields: it's listed under Admin → Content types,
 * the editor's Details panel fills its fields (a required one blocks publishing), and the
 * published page lists them.
 */

test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8787'
const run = Date.now().toString(36)
const typeSlug = `property-${run}`

test.beforeAll(async () => {
  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const created = await admin.post('/api/v1/content-types', { data: { action: 'create', name: `Properties ${run}`, singularName: 'Property', slug: typeSlug } })
  expect(created.ok(), await created.text()).toBe(true)
  const { id } = await created.json() as { id: string }
  const fields = await admin.post('/api/v1/content-types', {
    data: {
      action: 'update',
      id,
      fields: [
        { key: 'price', label: 'Price', type: 'number', prefix: '£', required: true, filterable: true },
        { key: 'bedrooms', label: 'Bedrooms', type: 'number' },
        { key: 'amenities', label: 'Amenities', type: 'multiselect', options: ['Parking', 'Garden'], filterable: true },
      ],
    },
  })
  expect(fields.ok(), await fields.text()).toBe(true)
  await admin.dispose()
})

test('a custom type\'s fields go from the editor to the page', async ({ page }) => {
  await gotoHydrated(page, '/admin/content-types')
  await expect(page.getByText(`Properties ${run}`)).toBeVisible()

  await gotoHydrated(page, `/admin/content/new?type=${typeSlug}`)
  await page.getByPlaceholder('Page title').fill(`Rose Cottage ${run}`)
  await page.getByLabel('Bedrooms').fill('3')
  await page.getByRole('checkbox', { name: 'Parking' }).click()

  // Price is required to publish.
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText('Fill in "Price".')).toBeVisible({ timeout: 15_000 })

  await page.getByLabel('Price').fill('250000')
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(page).toHaveURL(/\/admin\/content\/[0-9A-Z]{26}/, { timeout: 15_000 })
  await expect(page.getByLabel('Status').first()).toContainText('Published', { timeout: 15_000 })

  await gotoHydrated(page, `/rose-cottage-${run}`)
  const details = page.locator('.nux-item-details')
  await expect(details).toContainText('£250,000')
  await expect(details).toContainText('Bedrooms')
  await expect(details).toContainText('Parking')
})

test('a listing of the type can be filtered and sorted by its fields', async ({ page }) => {
  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const add = async (title: string, fields: Record<string, unknown>) => {
    const res = await admin.post('/api/v1/content', { data: { title, slug: `${title.toLowerCase().replace(/\s+/g, '-')}-${run}`, typeSlug, status: 'published', fields } })
    expect(res.ok(), await res.text()).toBe(true)
  }
  await add('Garden Flat', { price: 180000, amenities: ['Garden'] })
  await add('Big House', { price: 900000, amenities: ['Parking', 'Garden'] })
  const listing = await admin.post('/api/v1/content', {
    data: {
      title: 'For sale', slug: `for-sale-${run}`, typeSlug: 'page', status: 'published',
      content: { type: 'canvas', blocks: [{ id: 'l', type: 'canvas-posts', props: { title: 'For sale', contentType: typeSlug, limit: 20, showFilters: true, showDate: false } }] },
    },
  })
  expect(listing.ok(), await listing.text()).toBe(true)
  await admin.dispose()

  await gotoHydrated(page, `/for-sale-${run}`)
  const list = page.locator('.canvas-posts-list')
  await expect(list.getByText('Big House')).toBeVisible()
  await expect(list).toContainText('£900,000')

  const filters = page.getByRole('search', { name: 'Filter the list' })
  await filters.getByLabel('Parking').check()
  await expect(list.getByText('Garden Flat')).toHaveCount(0)
  await expect(list.getByText('Big House')).toBeVisible()

  await filters.getByRole('button', { name: 'Clear' }).click()
  await filters.getByLabel('Price up to').fill('500000')
  await filters.getByLabel('Price up to').press('Tab')
  await expect(list.getByText('Big House')).toHaveCount(0)
  await expect(list.getByText('Garden Flat')).toBeVisible()
})
