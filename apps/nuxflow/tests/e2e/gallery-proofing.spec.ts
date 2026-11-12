import { test, expect, request as playwrightRequest } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

/**
 * Client proofing: a client hearts photos in a gallery, adds their name and sends their
 * picks; the hearts come back after a reload; the photographer sees the list.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8787'
const slug = `e2e-proofing-${Date.now()}`
const photo = (text: string) => `data:image/png;base64,${Buffer.from(text).toString('base64')}`
let itemId = ''

test.beforeAll(async () => {
  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const res = await admin.post('/api/v1/content', {
    data: {
      title: 'Harper wedding', slug, typeSlug: 'page', status: 'published',
      content: {
        type: 'canvas',
        blocks: [{ id: 'gal', type: 'canvas-gallery', props: { layout: 'grid', allowFavourites: true, images: JSON.stringify([{ url: photo('ONE'), alt: 'One' }, { url: photo('TWO'), alt: 'Two' }, { url: photo('THREE'), alt: 'Three' }]) } }],
      },
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  itemId = ((await res.json()) as { id: string }).id
  await admin.dispose()
})

test('a client picks, sends, and the photographer sees the picks', async ({ page }) => {
  await gotoHydrated(page, `/${slug}`)
  const bar = page.getByRole('region', { name: 'Your favourites' })
  await expect(bar).toContainText('0 photos picked')

  await page.getByRole('button', { name: 'Add photo 1 to your favourites' }).click()
  await expect(bar).toContainText('Add your name')
  await bar.getByLabel('Your name').fill('Harper')
  await page.getByRole('button', { name: 'Add photo 3 to your favourites' }).click()
  await expect(bar).toContainText('2 photos picked')
  await expect(page.getByRole('button', { name: 'Remove photo 1 from your favourites' })).toHaveAttribute('aria-pressed', 'true')

  await bar.getByLabel('Show only my picks').check()
  await expect(page.locator('.canvas-gallery-item')).toHaveCount(2)
  await bar.getByLabel('Show only my picks').uncheck()

  await bar.getByRole('button', { name: 'Send my picks' }).click()
  await expect(bar).toContainText('Sent, thank you')

  await page.reload()
  await expect(page.getByRole('region', { name: 'Your favourites' })).toContainText('2 photos picked', { timeout: 15_000 })

  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const res = await admin.get(`/_nuxflow/gallery-picks?item=${itemId}`)
  const { pickers } = await res.json() as { pickers: Array<{ name: string; submittedAt: string | null; photos: unknown[] }> }
  expect(pickers).toHaveLength(1)
  expect(pickers[0]).toMatchObject({ name: 'Harper' })
  expect(pickers[0]!.photos).toHaveLength(2)
  expect(pickers[0]!.submittedAt).toBeTruthy()
  await admin.dispose()
})
