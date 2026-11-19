/**
 * "Change this page with AI" in the Canvas editor. The AI's reply is faked in the browser
 * (no model runs in CI), so this checks the part that matters for owning the change: the
 * suggestion is only a preview, nothing is saved while it's under review, Discard puts the
 * page back, and Keep saves it with an "AI-assisted" entry in the audit log.
 */
import { test, expect, type Page } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

let contentId: string

const PAGE = {
  type: 'canvas',
  blocks: [
    { id: 'one', type: 'canvas-text', props: { content: '<p>Original words</p>', align: 'left' } },
    { id: 'two', type: 'canvas-text', props: { content: '<p>Second block</p>', align: 'left' } },
  ],
}

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/v1/content', {
    data: { title: 'AI edit test', slug: `ai-edit-${Date.now()}`, status: 'draft', content: PAGE },
  })
  expect(res.ok()).toBeTruthy()
  contentId = (await res.json()).id
})

test.afterAll(async ({ request }) => {
  await request.delete(`/api/v1/content/${contentId}`)
})

const frameOf = (page: Page) => page.frameLocator('[data-testid="canvas-frame"]')

async function openAndAsk(page: Page) {
  await page.route('**/api/v1/ai/generate-canvas', async (route) => {
    const body = route.request().postDataJSON() as { instruction?: string; content?: { blocks: unknown[] } }
    expect(body.instruction).toBe('Make the first block friendlier')
    expect(body.content?.blocks).toHaveLength(2)
    await route.fulfill({
      json: {
        content: { type: 'canvas', blocks: [{ ...PAGE.blocks[0], props: { ...PAGE.blocks[0]!.props, content: '<p>Friendly words</p>' } }, PAGE.blocks[1]] },
        summary: 'Made the first section sound friendlier.',
        changes: [{ kind: 'updated', blockId: 'one', blockName: 'Text', note: 'Warmer wording', fields: ['Content'] }],
        skipped: 0,
      },
    })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHydrated(page, `/admin/content/${contentId}`)
  await expect(frameOf(page).locator('.canvas-text').first()).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('canvas-ai-button').click()
  await expect(page.getByTestId('ai-tab-edit')).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('What would you like changed?').fill('Make the first block friendlier')
  await page.getByTestId('ai-edit-submit').click()

  await expect(page.getByText('Made the first section sound friendlier.')).toBeVisible()
  await expect(page.getByTestId('ai-change-list')).toContainText('Changed Text')
  await expect(frameOf(page).locator('[data-ai-changed]')).toContainText('Friendly words')
}

test('a suggestion is only a preview, and Discard puts the page back', async ({ page, request }) => {
  await openAndAsk(page)
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(frameOf(page).locator('.canvas-text').first()).toContainText('Original words')
  await expect(frameOf(page).locator('[data-ai-changed]')).toHaveCount(0)

  const saved = await (await request.get(`/api/v1/content/${contentId}`)).json()
  expect(JSON.stringify(saved.content ?? saved.data?.content)).toContain('Original words')
})

test('Keep saves the change and records it as AI-assisted', async ({ page, request }) => {
  await openAndAsk(page)
  const saved = page.waitForResponse(r => r.url().includes(`/api/v1/content/${contentId}`) && r.request().method() === 'PATCH')
  await page.getByTestId('ai-keep').click()
  const patch = await saved
  expect(patch.ok()).toBeTruthy()
  expect(patch.request().postDataJSON().aiAssist).toMatchObject({ kind: 'edit', instruction: 'Make the first block friendlier' })

  const { logs } = await (await request.get('/api/v1/audit-log')).json() as { logs: Array<{ action: string; resourceId: string; aiAssist: { instruction: string } | null }> }
  const entry = logs.find(l => l.resourceId === contentId && l.action === 'ai_assisted_update')
  expect(entry?.aiAssist?.instruction).toBe('Make the first block friendlier')
})
