/**
 * The Canvas block settings panel on a long page.
 *
 * It used to be sized to the canvas, not the screen: on a phone that meant thousands of
 * pixels of blank space under the block's fields, and on any screen a block low on the page
 * opened its settings far above where you were looking. Only a page taller than the screen
 * shows this, so these tests make one.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

const PHONE = { width: 390, height: 664 }
const TABLET = { width: 820, height: 1000 }
const DESKTOP = { width: 1440, height: 900 }

const padding = { top: 24, right: 24, bottom: 24, left: 24, unit: 'px' }
const longPage = {
  type: 'canvas',
  blocks: [
    { id: 'hero', type: 'canvas-hero', props: { headline: 'Welcome', subtext: 'Hero text', ctaLabel: 'Go', ctaUrl: '/', padding } },
    { id: 'image', type: 'canvas-image', props: { src: '', alt: '' } },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `text-${i}`,
      type: 'canvas-text',
      props: { content: `<h2>Section ${i}</h2><p>${'Lorem ipsum dolor sit amet. '.repeat(25)}</p>`, align: 'left', padding },
    })),
  ],
}

let contentId: string

test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/v1/content', {
    data: { title: 'Settings panel test', slug: `settings-panel-${Date.now()}`, status: 'draft', content: longPage },
  })
  expect(res.ok()).toBeTruthy()
  contentId = (await res.json()).id
})

test.afterEach(async ({ request }) => {
  await request.delete(`/api/v1/content/${contentId}`)
})

const panelOf = (page: Page) => page.getByTestId('canvas-settings-panel')
// The page is drawn inside the editor's frame (CanvasFrame.vue).
const frameOf = (page: Page) => page.frameLocator('[data-testid="canvas-frame"]')
const blocksOf = (page: Page) => frameOf(page).locator('.group\\/block')

async function openEditor(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport)
  await gotoHydrated(page, `/admin/content/${contentId}`)
  await expect(blocksOf(page).first()).toBeVisible({ timeout: 30_000 })
}

async function selectBlock(block: Locator) {
  // The editor's frame scrolls inside itself. Bring the whole editor on screen first, as
  // a person would — otherwise Playwright scrolls the admin page along with the frame.
  await block.page().getByTestId('canvas-frame').evaluate(el => el.scrollIntoView({ block: 'end' }))
  await block.scrollIntoViewIfNeeded()
  await block.click() // the centre: the sticky toolbar can cover a block's top edge
}

/** The panel's header is on screen, and the panel is no taller than the screen. */
async function expectPanelOnScreen(page: Page) {
  const panel = panelOf(page)
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await expect(panel.getByRole('button', { name: 'Close panel' })).toBeInViewport()
}

async function expectPanelEndOnScreen(page: Page) {
  const box = await panelOf(page).boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
}

test.describe('Canvas settings panel', () => {
  for (const [name, viewport] of [['phone', PHONE], ['tablet', TABLET], ['desktop', DESKTOP]] as const) {
    test(`stays on screen for the first and last block on a ${name}`, async ({ page }) => {
      await openEditor(page, viewport)

      await selectBlock(blocksOf(page).first())
      await expect(panelOf(page).getByText('Hero', { exact: true })).toBeVisible()
      await expectPanelOnScreen(page)
      await panelOf(page).getByRole('button', { name: 'Close panel' }).click()

      await selectBlock(blocksOf(page).last())
      await expect(panelOf(page).getByText('Text', { exact: true })).toBeVisible()
      await expectPanelOnScreen(page)
      await expectPanelEndOnScreen(page)
    })
  }

  test('a tall panel on a wide screen can still be scrolled to its end', async ({ page }) => {
    await openEditor(page, DESKTOP)
    await selectBlock(blocksOf(page).first())
    const box = await panelOf(page).boundingBox()

    // Before the page scrolls its end is below the fold, so the wheel has to carry on from
    // the end of the panel's own list to the page, not stop there.
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 200)
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400)

    await expect.poll(async () => {
      const b = await panelOf(page).boundingBox()
      return b!.y + b!.height
    }).toBeLessThanOrEqual(DESKTOP.height)
    await expect(panelOf(page).locator('select').last()).toBeInViewport()
  })

  test('the hero settings end at the Padding fields, with no blank space, on a phone', async ({ page }) => {
    await openEditor(page, PHONE)
    await selectBlock(blocksOf(page).first())

    // The fields scroll inside the panel, and the page behind doesn't have to move.
    const fields = panelOf(page).locator('.overflow-y-auto')
    await expect.poll(() => fields.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    const unit = panelOf(page).locator('select').last()
    await unit.scrollIntoViewIfNeeded()
    await expect(unit).toBeInViewport()
    await expectPanelOnScreen(page)

    // Scrolled to the end, what's left below the last field is only the list's own padding.
    await fields.evaluate((el) => { el.scrollTop = el.scrollHeight })
    const unitBox = await unit.boundingBox()
    const panelBox = await panelOf(page).boundingBox()
    expect(panelBox!.y + panelBox!.height - (unitBox!.y + unitBox!.height)).toBeLessThan(40)
  })
})

test.describe('Editor save bar', () => {
  test('keeps Save and Publish reachable while a phone scrolls a long page', async ({ page }) => {
    await openEditor(page, PHONE)
    const bar = page.getByTestId('editor-save-bar')

    await expect(bar).toBeInViewport()
    await blocksOf(page).last().scrollIntoViewIfNeeded()
    await expect(bar.getByRole('button', { name: 'Publish' })).toBeInViewport()

    await bar.getByRole('button', { name: 'Save draft' }).click()
    await expect(bar.getByText(/^Saved /)).toBeVisible({ timeout: 15_000 })
  })

  test('is covered while the settings panel is open on a phone', async ({ page }) => {
    await openEditor(page, PHONE)
    await selectBlock(blocksOf(page).first())
    const box = await page.getByTestId('editor-save-bar').boundingBox()
    const onTop = await page.evaluate(
      ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="canvas-settings-panel"]')),
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    )
    expect(onTop).toBe(true)
  })

  test('is not on a wide screen, which has the Publish card beside the editor', async ({ page }) => {
    await openEditor(page, DESKTOP)
    await expect(page.getByTestId('editor-save-bar')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible()
  })
})

test.describe('Sticky bars leave no gap for the page to show through', () => {
  const ADMIN_HEADER_HEIGHT = 64

  for (const [name, viewport] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
    test(`the toolbar sits against the admin header on a ${name}`, async ({ page }) => {
      await openEditor(page, viewport)
      // The editor's frame scrolls inside itself, so scroll the admin page itself until
      // the frame's end is on screen, and then further.
      await page.getByTestId('canvas-frame').evaluate(el => el.scrollIntoView({ block: 'end' }))
      await page.locator('main').evaluate((el) => { el.scrollTop += 150 })
      const toolbar = page.getByRole('button', { name: 'Add block' }).locator('xpath=../..')
      await expect.poll(async () => Math.round((await toolbar.boundingBox())!.y)).toBe(ADMIN_HEADER_HEIGHT)
    })
  }

  test('the save bar sits against the bottom of a phone screen', async ({ page }) => {
    await openEditor(page, PHONE)
    await blocksOf(page).nth(6).scrollIntoViewIfNeeded()
    const bar = page.getByTestId('editor-save-bar')
    await expect.poll(async () => {
      const box = (await bar.boundingBox())!
      return Math.round(box.y + box.height)
    }).toBe(PHONE.height)
  })
})

test('the sticky toolbar stays above blocks scrolling beneath it on a wide screen', async ({ page }) => {
  await openEditor(page, DESKTOP)
  await blocksOf(page).nth(6).scrollIntoViewIfNeeded()
  const addBlock = page.getByRole('button', { name: 'Add block' })
  await expect(addBlock).toBeInViewport()
  await addBlock.click()
  await expect(page.getByRole('heading', { name: 'Add a block' })).toBeVisible()
})

test('the media library opens above the settings panel on a phone', async ({ page }) => {
  await openEditor(page, PHONE)
  await selectBlock(blocksOf(page).nth(1))
  const open = panelOf(page).getByRole('button', { name: /library/i }).first()
  await open.scrollIntoViewIfNeeded()
  await open.click()
  const dialog = page.getByRole('dialog', { name: 'Choose from media library' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeInViewport()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(panelOf(page)).toBeVisible()
})
