import { readFileSync } from 'node:fs'
import { test, expect, request as playwrightRequest } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'

/**
 * Client-gallery downloads behind a page password: locked visitors can't download, and once
 * unlocked "Download all" gives a zip of the gallery and the lightbox gives single photos.
 * Inline data: images keep the test independent of media storage.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8787'
const slug = `e2e-downloads-${Date.now()}`
const photo = (text: string) => `data:image/png;base64,${Buffer.from(text).toString('base64')}`

test.beforeAll(async () => {
  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const res = await admin.post('/api/v1/content', {
    data: {
      title: 'Jones Wedding',
      slug,
      typeSlug: 'page',
      status: 'published',
      settings: { access: 'password' },
      pagePassword: 'jones2027',
      content: {
        type: 'canvas',
        blocks: [{
          id: 'gal',
          type: 'canvas-gallery',
          props: { layout: 'grid', allowDownload: true, images: JSON.stringify([{ url: photo('FIRST'), alt: 'One' }, { url: photo('SECOND'), alt: 'Two' }]) },
        }],
      },
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  await admin.dispose()
})

test('locked visitors can\'t download; unlocked ones get a zip and single photos', async ({ page, request }) => {
  const zipUrl = `/api/public/gallery-download?path=${slug}&block=gal`
  expect((await request.get(zipUrl)).status()).toBe(404)

  await page.goto(`/${slug}`)
  await page.getByLabel('Password', { exact: true }).fill('jones2027')
  await page.getByRole('button', { name: 'View page' }).click()

  const [zipDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /Download all/ }).click(),
  ])
  expect(zipDownload.suggestedFilename()).toBe(`${slug}.zip`)
  const entries = unzipSync(new Uint8Array(readFileSync(await zipDownload.path())))
  expect(Object.keys(entries)).toEqual(['photo-1.png', 'photo-2.png'])
  expect(strFromU8(entries['photo-2.png']!)).toBe('SECOND')

  await page.locator('.canvas-gallery-item button').first().click()
  const [single] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download this photo' }).click(),
  ])
  expect(single.suggestedFilename()).toBe('photo-1.png')
  expect(readFileSync(await single.path(), 'utf8')).toBe('FIRST')
})
