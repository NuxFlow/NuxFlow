import { test, expect, type Page } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

/**
 * The admin sidebar: collapsible groups that remember how they were left, exactly one link
 * lit per page, and a collapsed icon rail whose groups pop out.
 */
test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

const menu = (page: Page) => page.locator('aside').first()
const groupButton = (page: Page, name: string) => menu(page).getByRole('button', { name, exact: true })
const lit = (page: Page) => menu(page).locator('a.nav-active, button.nav-active')

test.describe('Admin menu', () => {
  test('starts with Content open and the other groups closed', async ({ page }) => {
    await gotoHydrated(page, '/admin')
    await expect(menu(page).getByRole('link', { name: 'Posts', exact: true })).toBeVisible()
    await expect(menu(page).getByRole('link', { name: 'Themes', exact: true })).toHaveCount(0)
    await expect(menu(page).getByRole('link', { name: 'Sites', exact: true })).toHaveCount(0)
  })

  test('a group opens, stays open across a reload, and closes again', async ({ page }) => {
    await gotoHydrated(page, '/admin')
    await groupButton(page, 'Site').click()
    await expect(menu(page).getByRole('link', { name: 'Themes', exact: true })).toBeVisible()

    await gotoHydrated(page, '/admin')
    await expect(menu(page).getByRole('link', { name: 'Themes', exact: true })).toBeVisible()

    await groupButton(page, 'Site').click()
    await expect(menu(page).getByRole('link', { name: 'Themes', exact: true })).toHaveCount(0)
    await gotoHydrated(page, '/admin')
    await expect(menu(page).getByRole('link', { name: 'Themes', exact: true })).toHaveCount(0)
  })

  test('opening a page opens its group, and only its own link is lit', async ({ page }) => {
    await gotoHydrated(page, '/admin/media/videos')
    await expect(lit(page)).toHaveCount(1)
    await expect(lit(page)).toHaveText('Videos')

    await gotoHydrated(page, '/admin/content/generate')
    await expect(lit(page)).toHaveCount(1)
    await expect(lit(page)).toHaveText('Generate with AI')

    await gotoHydrated(page, '/admin/super/database')
    await expect(lit(page)).toHaveText('Database')
    await expect(menu(page).getByRole('link', { name: 'Platform', exact: true })).toBeVisible()
  })

  test('closing the current group lights the group instead', async ({ page }) => {
    await gotoHydrated(page, '/admin/media/videos')
    await groupButton(page, 'Media').click()
    await expect(menu(page).getByRole('link', { name: 'Videos', exact: true })).toHaveCount(0)
    await expect(lit(page)).toHaveCount(1)
    await expect(lit(page)).toHaveText('Media')
  })

  test('following a sidebar link moves the highlight without a reload', async ({ page }) => {
    await gotoHydrated(page, '/admin')
    await expect(lit(page)).toHaveText('Dashboard')
    await menu(page).getByRole('link', { name: 'Posts', exact: true }).click()
    await expect(page).toHaveURL(/type=post/)
    await expect(lit(page)).toHaveCount(1)
    await expect(lit(page)).toHaveText('Posts')
    await menu(page).getByRole('link', { name: 'All content', exact: true }).click()
    await expect(lit(page)).toHaveText('All content')
  })

  test('a collapsed sidebar stays collapsed, and its groups pop out', async ({ page }) => {
    await gotoHydrated(page, '/admin/media/videos')
    await page.getByTitle('Collapse sidebar').click()
    await expect(page.getByTitle('Expand sidebar')).toBeVisible()

    await gotoHydrated(page, '/admin/media/videos')
    await expect(page.getByTitle('Expand sidebar')).toBeVisible()
    // The group holding this page stands in for its hidden link.
    await expect(lit(page)).toHaveCount(1)

    await lit(page).hover()
    const videos = page.getByRole('link', { name: 'Videos', exact: true })
    await expect(videos).toBeVisible()
    await videos.click()
    await expect(page).toHaveURL(/\/admin\/media\/videos/)

    await page.getByTitle('Expand sidebar').click()
    await expect(page.getByTitle('Collapse sidebar')).toBeVisible()
  })
})
