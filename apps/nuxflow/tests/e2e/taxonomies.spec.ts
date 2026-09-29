/**
 * E2E tests for taxonomies: Admin → Taxonomies management, the editor's term picker
 * (terms saved with the post, including before its first save), and the public archive,
 * overview, and term links on a published post.
 */
import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'

test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

const RUN = Date.now().toString(36)
const TERM_NAME = `E2E News ${RUN}`
const TERM_SLUG = `e2e-news-${RUN}`
const SUB_NAME = `E2E World ${RUN}`
const POST_TITLE = `E2E Tagged Post ${RUN}`
const POST_SLUG = `e2e-tagged-post-${RUN}`

test.describe.serial('Taxonomies', () => {
  test('admin page lists the seeded Categories and Tags', async ({ page }) => {
    await page.goto('/admin/taxonomies')
    await expect(page.getByText('Categories', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('/tag', { exact: true })).toBeVisible()
  })

  test('adds a term and a nested sub-term to Categories', async ({ page }) => {
    await page.goto('/admin/taxonomies')
    await page.getByText('Categories', { exact: true }).first().click()

    await page.getByRole('button', { name: 'Add term' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox').first().fill(TERM_NAME)
    await dialog.getByRole('button', { name: 'Add term' }).click()
    await expect(page.getByText(TERM_NAME, { exact: true })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: `Add a sub-term under ${TERM_NAME}` }).click()
    await page.getByRole('dialog').getByRole('textbox').first().fill(SUB_NAME)
    await page.getByRole('dialog').getByRole('button', { name: 'Add term' }).click()
    await expect(page.getByText(SUB_NAME, { exact: true })).toBeVisible({ timeout: 10_000 })
  })

  test('terms picked on a brand-new post are saved with it', async ({ page }) => {
    await page.goto('/admin/content/new?type=post')
    await page.getByPlaceholder('Page title').fill(POST_TITLE)
    await page.getByRole('button', { name: /^Categories\b/ }).click()
    await page.getByRole('checkbox', { name: SUB_NAME }).check()

    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page).toHaveURL(/\/admin\/content\/[0-9A-Z]{26}/, { timeout: 15_000 })

    // Reload: the selection must come back from the server, not from local state.
    await page.reload()
    await expect(page.getByRole('button', { name: /^Categories\s+1 selected/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(`Categories: ${SUB_NAME}`)).toBeVisible()
  })

  test('public pages show the post under its term, the parent archive, and the overview', async ({ page, request }) => {
    const sub = await request.get(`/api/public/pages/${POST_SLUG}`)
    expect(sub.ok()).toBe(true)
    const body = await sub.json() as { terms: { termName: string; path: string }[] }
    const subTerm = body.terms.find(t => t.termName === SUB_NAME)
    expect(subTerm).toBeDefined()

    await page.goto(`/${POST_SLUG}`)
    await expect(page.getByRole('link', { name: SUB_NAME })).toBeVisible({ timeout: 15_000 })

    // Parent archive rolls up the sub-term's post.
    await page.goto(`/category/${TERM_SLUG}`)
    await expect(page.getByRole('heading', { name: TERM_NAME })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: POST_TITLE })).toBeVisible()

    await page.goto('/category')
    await expect(page.getByRole('link', { name: new RegExp(TERM_NAME) })).toBeVisible({ timeout: 15_000 })

    const feed = await request.get(`/feed.xml?taxonomy=category&term=${TERM_SLUG}`)
    expect(await feed.text()).toContain(POST_TITLE)
  })
})
