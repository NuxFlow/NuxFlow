/**
 * SEO → Audit → "Suggest fixes with AI". The AI's reply is faked in the browser; this
 * checks that suggestions are shown next to what the page has now, nothing is saved until
 * Apply, and the saved page is recorded as AI-assisted.
 */
import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

let contentId: string

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/v1/content', {
    data: {
      title: 'SEO fix test',
      slug: `seo-fix-${Date.now()}`,
      status: 'published',
      content: { type: 'canvas', blocks: [{ id: 'a', type: 'canvas-text', props: { content: '<p>We roast coffee.</p>' } }] },
    },
  })
  expect(res.ok()).toBeTruthy()
  contentId = (await res.json()).id
})

test.afterAll(async ({ request }) => {
  await request.delete(`/api/v1/content/${contentId}`)
})

test('suggestions are reviewed, then applied and recorded as AI-assisted', async ({ page, request }) => {
  await page.route('**/api/v1/ai/seo-suggest', async (route) => {
    const { contentIds } = route.request().postDataJSON() as { contentIds: string[] }
    await route.fulfill({
      json: {
        suggestions: contentIds.map(id => ({
          id,
          title: id === contentId ? 'SEO fix test' : 'Other page',
          version: 1,
          current: { seoTitle: '', seoDescription: '' },
          seoTitle: 'Fresh coffee roasted daily',
          seoDescription: 'Small-batch coffee roasted every morning and delivered to your door.',
          error: null,
        })),
      },
    })
  })

  await gotoHydrated(page, '/admin/seo?tab=audit')
  await page.getByTestId('seo-ai-fix').click()
  const rows = page.getByTestId('seo-ai-rows')
  await expect(rows).toContainText('SEO fix test')

  // Untick every page except ours, so the test only saves its own page.
  const others = rows.locator('li').filter({ hasNotText: 'SEO fix test' })
  for (const box of await others.getByRole('checkbox', { checked: true }).all()) await box.click()

  const ours = rows.locator('li').filter({ hasText: 'SEO fix test' })
  await expect(ours.getByRole('textbox').last()).toHaveValue(/Small-batch coffee/)

  // Nothing saved yet.
  let item = await (await request.get(`/api/v1/content/${contentId}`)).json()
  expect(item.seoDescription ?? '').toBe('')

  const saved = page.waitForResponse(r => r.url().includes(`/api/v1/content/${contentId}`) && r.request().method() === 'PATCH')
  await page.getByTestId('seo-ai-apply').click()
  expect((await saved).ok()).toBeTruthy()
  await expect(ours).toContainText('Saved')

  item = await (await request.get(`/api/v1/content/${contentId}`)).json()
  expect(item.seoDescription).toContain('Small-batch coffee')
  const { logs } = await (await request.get('/api/v1/audit-log')).json() as { logs: Array<{ action: string; resourceId: string; aiAssist: { kind: string } | null }> }
  expect(logs.find(l => l.resourceId === contentId && l.action === 'ai_assisted_update')?.aiAssist?.kind).toBe('seo')
})
