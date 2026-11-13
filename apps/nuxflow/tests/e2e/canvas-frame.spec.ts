/**
 * The Canvas editor draws the page inside a frame with the site's own styling
 * (CanvasFrame.vue, /_nuxflow/editor-styles): theme CSS is never loaded into the admin
 * itself, so without the frame a themed page looked nothing like it does live.
 */
import { test, expect, type Page } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

const DESKTOP = { width: 1440, height: 900 }
const MARK = 'rgb(1, 2, 3)'

let contentId: string

test.beforeAll(async ({ request }) => {
  // Site styling the frame should pick up, as a public page would: a <style> in the
  // custom head HTML (a theme is the same path, see the integration tests).
  const settings = await request.patch('/api/v1/settings', {
    data: { settings: { 'appearance.custom_head_html': `<style>.canvas-text{outline:3px solid ${MARK}}</style>` } },
  })
  expect(settings.ok()).toBeTruthy()

  const res = await request.post('/api/v1/content', {
    data: {
      title: 'Canvas frame test',
      slug: `canvas-frame-${Date.now()}`,
      status: 'draft',
      content: {
        type: 'canvas',
        blocks: [
          { id: 'one', type: 'canvas-text', props: { content: '<p>First block</p>', align: 'left' } },
          { id: 'two', type: 'canvas-text', props: { content: '<p>Second block</p>', align: 'left' } },
        ],
      },
    },
  })
  expect(res.ok()).toBeTruthy()
  contentId = (await res.json()).id
})

test.afterAll(async ({ request }) => {
  await request.delete(`/api/v1/content/${contentId}`)
  await request.patch('/api/v1/settings', { data: { settings: { 'appearance.custom_head_html': '' } } })
})

const frameOf = (page: Page) => page.frameLocator('[data-testid="canvas-frame"]')
const textBlocks = (page: Page) => frameOf(page).locator('.canvas-text')

async function openEditor(page: Page) {
  await page.setViewportSize(DESKTOP)
  await gotoHydrated(page, `/admin/content/${contentId}`)
  await expect(textBlocks(page).first()).toBeVisible({ timeout: 30_000 })
}

test('draws the page with the site\'s styling, and leaves the admin alone', async ({ page }) => {
  await openEditor(page)
  await expect(textBlocks(page).first()).toHaveCSS('outline-color', MARK)
  // The admin's own document never gets the site's styling.
  const adminHasIt = await page.evaluate(() => [...document.querySelectorAll('style')].some(s => s.textContent?.includes('rgb(1, 2, 3)')))
  expect(adminHasIt).toBe(false)
})

test('selecting, reordering and undo work inside the frame', async ({ page }) => {
  await openEditor(page)
  const blocks = frameOf(page).locator('.group\\/block')

  await blocks.first().click()
  await expect(page.getByTestId('canvas-settings-panel')).toBeVisible()

  await blocks.first().getByRole('button', { name: 'Move block down' }).click()
  await expect(blocks.first()).toContainText('Second block')

  // Ctrl+Z pressed while the frame has focus still reaches the editor.
  await blocks.first().click()
  await page.keyboard.press('Control+z')
  await expect(blocks.first()).toContainText('First block')
})

test('shows the page at a phone\'s width', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('button', { name: 'Phone (390px)' }).click()
  const width = await page.getByTestId('canvas-frame').evaluate(el => (el as HTMLIFrameElement).contentWindow!.innerWidth)
  expect(width).toBe(390)
})
