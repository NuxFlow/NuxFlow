import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'

/**
 * Admin → Analytics before it's switched on. CI's wrangler.toml (copied from
 * wrangler.toml.example) has no AE binding, so this is what every fresh install sees:
 * the page explains the two setup steps, and public pages send no page-view beacons.
 * The query half is covered against a mocked Cloudflare API in
 * tests/integration/analytics.test.ts.
 */
test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

test.describe('Analytics', () => {
  test('is in the admin menu and explains how to switch it on', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('link', { name: 'Analytics' }).first().click()
    await expect(page).toHaveURL(/\/admin\/analytics$/)
    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible()
    await expect(page.getByText('Visitor analytics aren\'t switched on')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Super Admin → Platform' })).toBeVisible()
  })

  test('Platform has the Visitor analytics settings', async ({ page }) => {
    await page.goto('/admin/super/platform')
    await expect(page.getByRole('heading', { name: 'Visitor analytics' })).toBeVisible()
    await expect(page.getByText('Not set up')).toBeVisible()
  })

  test('public pages send no page-view beacon while recording is off', async ({ page }) => {
    const beacons: string[] = []
    page.on('request', (req) => { if (req.url().includes('/_nuxflow/view')) beacons.push(req.url()) })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    expect(beacons).toEqual([])
  })

  test('the beacon endpoint answers 204 and never errors', async ({ request }) => {
    const res = await request.post('/_nuxflow/view', { data: { path: '/' }, headers: { 'sec-fetch-site': 'same-origin' } })
    expect(res.status()).toBe(204)
  })
})
