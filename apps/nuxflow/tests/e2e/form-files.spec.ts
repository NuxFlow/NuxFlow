import { test, expect, request as playwrightRequest } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

/**
 * A visitor attaches a photo to a Form Builder form; the file really reaches storage (real
 * multipart parsing and the local R2 bucket, which integration tests only stub) and the
 * site's team can download it from the submission, while a visitor can't.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8787'
const stamp = Date.now()
const formSlug = `e2e-quote-${stamp}`
const pageSlug = `e2e-quote-page-${stamp}`
let formId = ''

test.beforeAll(async () => {
  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const form = await admin.post('/api/v1/forms', {
    data: {
      name: 'Quote request',
      slug: formSlug,
      status: 'active',
      fields: [
        { id: 'f1', type: 'text', label: 'Your name', name: 'name', required: true },
        { id: 'f2', type: 'file', label: 'Photos of the job', name: 'photos', required: true },
      ],
    },
  })
  expect(form.ok(), await form.text()).toBe(true)
  formId = ((await form.json()) as { id: string }).id

  const page = await admin.post('/api/v1/content', {
    data: {
      title: 'Get a quote',
      slug: pageSlug,
      typeSlug: 'page',
      status: 'published',
      content: { type: 'canvas', blocks: [{ id: 'quote', type: 'dynamic-form/form', props: { formSlug } }] },
    },
  })
  expect(page.ok(), await page.text()).toBe(true)
  await admin.dispose()
})

test('a visitor\'s photo reaches the submission and only the team can download it', async ({ page, request }) => {
  await gotoHydrated(page, `/${pageSlug}`)
  await page.getByLabel('Your name').fill('Sam Visitor')

  // Wrong types are caught before sending.
  await page.getByLabel('Photos of the job').setInputFiles({ name: 'drawing.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') })
  await expect(page.getByText('isn\'t a file type this form takes')).toBeVisible()

  await page.getByLabel('Photos of the job').setInputFiles({ name: 'boiler.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('JPEG-BYTES-FOR-E2E') })
  await expect(page.getByText('boiler.jpg')).toBeVisible()
  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByText('Your submission has been received.')).toBeVisible()

  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const list = await admin.get(`/api/v1/forms/${formId}/submissions`)
  expect(list.ok()).toBe(true)
  const { submissions } = await list.json() as { submissions: Array<{ id: string; data: Record<string, unknown> }> }
  expect(submissions).toHaveLength(1)
  expect(submissions[0]!.data.name).toBe('Sam Visitor')
  expect((submissions[0]!.data.photos as Array<{ name: string }>)[0]!.name).toBe('boiler.jpg')

  const fileUrl = `/_nuxflow/form-file/${submissions[0]!.id}?field=photos&n=0`
  const download = await admin.get(fileUrl)
  expect(download.status()).toBe(200)
  expect(download.headers()['content-disposition']).toContain('attachment')
  expect(await download.text()).toBe('JPEG-BYTES-FOR-E2E')
  await admin.dispose()

  expect((await request.get(fileUrl)).status()).toBe(401)
})
