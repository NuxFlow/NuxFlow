/**
 * E2E test for the WordPress import: the export is parsed in the browser and sent to the
 * server in batches (terms → media → posts → finish), so this exercises the real page code
 * end to end — not just the server routes the integration tests cover.
 */
import { test, expect, type Page } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'

test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

const RUN = Date.now().toString(36)
const PARENT = `wp-parent-${RUN}`
const CHILD = `wp-child-${RUN}`
const TAG = `wp-tag-${RUN}`
const POST_SLUG = `wp-post-${RUN}`
const PAGE_SLUG = `wp-page-${RUN}`
const DRAFT_TITLE = `WP Draft ${RUN}`

const cdata = (s: string) => `<![CDATA[${s}]]>`

const WXR = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <wp:category><wp:category_nicename>${cdata(PARENT)}</wp:category_nicename><wp:category_parent>${cdata('')}</wp:category_parent><wp:cat_name>${cdata(`WP Parent ${RUN}`)}</wp:cat_name></wp:category>
  <wp:category><wp:category_nicename>${cdata(CHILD)}</wp:category_nicename><wp:category_parent>${cdata(PARENT)}</wp:category_parent><wp:cat_name>${cdata(`WP Child ${RUN}`)}</wp:cat_name></wp:category>
  <wp:tag><wp:tag_slug>${cdata(TAG)}</wp:tag_slug><wp:tag_name>${cdata(`WP Tag ${RUN}`)}</wp:tag_name></wp:tag>
  <item>
    <title>${cdata('Unreachable image')}</title>
    <wp:post_id>900</wp:post_id>
    <wp:post_name>${cdata(`wp-image-${RUN}`)}</wp:post_name>
    <wp:post_type>${cdata('attachment')}</wp:post_type>
    <wp:attachment_url>${cdata('http://127.0.0.1/private.jpg')}</wp:attachment_url>
  </item>
  <item>
    <title>${cdata(`WP Post ${RUN}`)}</title>
    <wp:post_name>${cdata(POST_SLUG)}</wp:post_name>
    <wp:post_type>${cdata('post')}</wp:post_type>
    <wp:status>${cdata('publish')}</wp:status>
    <wp:post_date_gmt>${cdata('2024-03-01 10:00:00')}</wp:post_date_gmt>
    <content:encoded>${cdata('<p>Imported <strong>body</strong> text.</p>')}</content:encoded>
    <excerpt:encoded>${cdata('')}</excerpt:encoded>
    <category domain="category" nicename="${CHILD}">${cdata(`WP Child ${RUN}`)}</category>
    <category domain="post_tag" nicename="${TAG}">${cdata(`WP Tag ${RUN}`)}</category>
  </item>
  <item>
    <title>${cdata(DRAFT_TITLE)}</title>
    <wp:post_name>${cdata('')}</wp:post_name>
    <wp:post_type>${cdata('post')}</wp:post_type>
    <wp:status>${cdata('draft')}</wp:status>
    <content:encoded>${cdata('<p>Not yet.</p>')}</content:encoded>
  </item>
  <item>
    <title>${cdata(`WP Page ${RUN}`)}</title>
    <wp:post_name>${cdata(PAGE_SLUG)}</wp:post_name>
    <wp:post_type>${cdata('page')}</wp:post_type>
    <wp:status>${cdata('publish')}</wp:status>
    <content:encoded>${cdata('<h2>About</h2><p>A page.</p>')}</content:encoded>
  </item>
</channel>
</rss>`

async function runImport(page: Page) {
  await page.goto('/admin/import')
  await page.getByRole('button', { name: 'WordPress import' }).click()
  await page.locator('input[type="file"][accept=".xml"]').setInputFiles({
    name: 'export.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(WXR, 'utf8'),
  })
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText('Import complete')).toBeVisible({ timeout: 60_000 })
}

test.describe.serial('WordPress import', () => {
  test('imports posts, pages, categories (with parents) and tags in batches', async ({ page, request }) => {
    await runImport(page)
    await expect(page.getByText('Content: 3 imported')).toBeVisible()
    await expect(page.getByText('Taxonomy: 2 categories, 1 tags')).toBeVisible()
    // The private-address image is refused by the server's SSRF check, not fatal.
    await expect(page.getByText('1 skipped (unavailable)')).toBeVisible()

    const post = await request.get(`/api/public/pages/${POST_SLUG}`)
    expect(post.ok()).toBe(true)
    const body = await post.json() as { title: string; terms: { termName: string }[] }
    expect(body.title).toBe(`WP Post ${RUN}`)
    expect(body.terms.map(t => t.termName).sort()).toEqual([`WP Child ${RUN}`, `WP Tag ${RUN}`].sort())

    expect((await request.get(`/api/public/pages/${PAGE_SLUG}`)).ok()).toBe(true)

    // The parent category's archive rolls up the child's post — proves the parent link.
    await page.goto(`/category/${PARENT}`)
    await expect(page.getByRole('link', { name: `WP Post ${RUN}` })).toBeVisible({ timeout: 15_000 })
  })

  test('running the same import again skips everything already there', async ({ page }) => {
    await runImport(page)
    await expect(page.getByText('Content: 0 imported, 3 skipped')).toBeVisible()
  })
})
