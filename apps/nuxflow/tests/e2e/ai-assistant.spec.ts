/**
 * "Ask AI", the admin helper. Its replies are faked in the browser (no model runs in CI);
 * this checks the part that makes changes the person's own: a suggestion is a card that
 * can be previewed, applies only on a click (recorded as AI-assisted) and can be undone,
 * and a page suggestion opens the editor's "Change this page" with the instruction filled in.
 */
import { test, expect, type Page } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

let contentId: string

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/v1/content', {
    data: {
      title: 'Helper test page',
      slug: `helper-${Date.now()}`,
      status: 'draft',
      content: { type: 'canvas', blocks: [{ id: 'a', type: 'canvas-text', props: { content: '<p>Hello</p>' } }] },
    },
  })
  expect(res.ok()).toBeTruthy()
  contentId = (await res.json()).id
  await request.patch('/api/v1/settings', { data: { settings: { 'frontend.show_search': true } } })
})

test.afterAll(async ({ request }) => {
  await request.delete(`/api/v1/content/${contentId}`)
  await request.patch('/api/v1/settings', { data: { settings: { 'frontend.show_search': true } } })
})

async function ask(page: Page, reply: object) {
  await page.route('**/_nuxflow/assistant', route => route.fulfill({ json: { sources: [], ...reply } }))
  await page.getByTestId('assistant-open').click()
  await page.getByLabel('Your question').fill('Hide the search button')
  await page.getByTestId('assistant-send').click()
}

const searchSetting = async (page: Page) =>
  ((await (await page.request.get('/api/v1/settings')).json()).settings as Record<string, unknown>)['frontend.show_search']

test('a suggested setting is applied only on a click, recorded, and can be undone', async ({ page }) => {
  await gotoHydrated(page, '/admin')
  await ask(page, {
    reply: 'I can hide the search button. Check it and press Apply.',
    proposals: [
      { type: 'setting', key: 'frontend.show_search', label: 'Show the search button', value: false, current: true, note: 'Hides search' },
      { type: 'setting', key: 'theme.dark_mode', label: 'Light or dark mode', value: 'dark', current: 'auto', note: 'Dark' },
    ],
  })
  await expect(page.getByTestId('assistant-turns')).toContainText('I can hide the search button')
  const cards = page.getByTestId('assistant-proposal')
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).toContainText('Yes')
  await expect(cards.first()).toContainText('No')
  expect(await searchSetting(page)).toBe(true)

  // Look-and-feel suggestions open a live preview; nothing is saved by it.
  await cards.nth(1).getByRole('button', { name: 'Preview' }).click()
  await expect(page.getByTitle('Live preview')).toBeVisible()
  await page.keyboard.press('Escape')

  await cards.first().getByTestId('assistant-apply').click()
  await expect(cards.first()).toContainText('Applied')
  expect(await searchSetting(page)).toBe(false)
  const { logs } = await (await page.request.get('/api/v1/audit-log')).json() as { logs: Array<{ action: string; resource: string; aiAssist: { instruction: string } | null }> }
  expect(logs.find(l => l.resource === 'settings' && l.action === 'ai_assisted_update')?.aiAssist?.instruction).toBe('Hide the search button')

  await cards.first().getByTestId('assistant-undo').click()
  await expect(cards.first().getByTestId('assistant-apply')).toBeVisible()
  expect(await searchSetting(page)).toBe(true)
})

test('a suggested page change opens the editor with the instruction ready', async ({ page }) => {
  await gotoHydrated(page, '/admin')
  await ask(page, {
    reply: 'I can change that page.',
    proposals: [{ type: 'page', contentId, title: 'Helper test page', instruction: 'Make the greeting warmer', note: '' }],
  })
  await page.getByRole('button', { name: 'Open in the editor' }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/content/${contentId}`))
  await expect(page.getByLabel('What would you like changed?')).toHaveValue('Make the greeting warmer', { timeout: 30_000 })
  // The instruction is dropped from the address, so a reload doesn't ask again.
  await expect(page).not.toHaveURL(/[?&]ai=/)
})
