import { test, expect, request as playwrightRequest } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

/**
 * Podcast: the feed appears once switched on, an episode page plays in the site-wide player,
 * and the player stays as the visitor moves to another page.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8787'
const run = Date.now().toString(36)

test.beforeAll(async () => {
  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const on = await admin.patch('/api/v1/settings', {
    data: { settings: { 'podcast.settings': { enabled: true, title: `Bread Talk ${run}`, description: '', author: 'Sam', ownerEmail: '', coverImage: '', category: 'Leisure', explicit: false, contentType: 'post' } } },
  })
  expect(on.ok(), await on.text()).toBe(true)
  for (const [slug, title, audio] of [[`ep-${run}`, `Episode one ${run}`, '/_nuxflow/media/e2e/ep1.mp3'], [`other-${run}`, `Another post ${run}`, '']] as const) {
    const res = await admin.post('/api/v1/content', {
      data: {
        title, slug, typeSlug: 'post', status: 'published',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `See /other-${run}` }] }] },
        settings: { access: 'public', ...(audio ? { podcast: { audioUrl: audio, duration: '45:10', episode: 1 } } : {}) },
      },
    })
    expect(res.ok(), await res.text()).toBe(true)
  }
  await admin.dispose()
})

test('an episode plays in the player, which stays between pages', async ({ page, request }) => {
  const feed = await request.get('/podcast.xml')
  expect(feed.status()).toBe(200)
  expect(await feed.text()).toContain(`Episode one ${run}`)

  await gotoHydrated(page, `/ep-${run}`)
  await page.getByRole('button', { name: 'Play episode' }).click()
  const player = page.getByRole('region', { name: 'Audio player' })
  await expect(player).toContainText(`Episode one ${run}`)

  // Move to another page inside the app (the header's home link): the layout, and so the
  // player, stays.
  await page.locator('header a[href="/"]').first().click()
  await expect(page).toHaveURL(/\/$/)
  await expect(player).toContainText(`Episode one ${run}`)

  await player.getByRole('button', { name: 'Close the player' }).click()
  await expect(player).toHaveCount(0)
})
