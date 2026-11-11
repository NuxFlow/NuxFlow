import { test, expect, request as playwrightRequest } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

/**
 * A multi-step quote form with a conditional question: Next checks the step's required
 * answers, a question appears only for the answer that needs it, Back keeps the answers, and
 * the submission keeps only what was shown.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8787'
const stamp = Date.now()
const formSlug = `e2e-steps-${stamp}`
const pageSlug = `e2e-steps-page-${stamp}`
let formId = ''

test.beforeAll(async () => {
  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const form = await admin.post('/api/v1/forms', {
    data: {
      name: 'Quote', slug: formSlug, status: 'active',
      fields: [
        { id: 'f1', type: 'radio', label: 'Service', name: 'service', required: true, options: [{ label: 'Boiler repair', value: 'boiler' }, { label: 'Plumbing', value: 'plumbing' }] },
        { id: 'f2', type: 'text', label: 'Boiler make', name: 'boilerMake', required: true, showIf: { field: 'service', op: 'equals', value: 'boiler' } },
        { id: 'f3', type: 'step', label: 'Where are you?', name: 'step_1' },
        { id: 'f4', type: 'text', label: 'Postcode', name: 'postcode', required: true },
      ],
    },
  })
  expect(form.ok(), await form.text()).toBe(true)
  formId = ((await form.json()) as { id: string }).id
  const page = await admin.post('/api/v1/content', {
    data: { title: 'Get a quote', slug: pageSlug, typeSlug: 'page', status: 'published', content: { type: 'canvas', blocks: [{ id: 'q', type: 'dynamic-form/form', props: { formSlug } }] } },
  })
  expect(page.ok(), await page.text()).toBe(true)
  await admin.dispose()
})

test('steps, a conditional question, and only shown answers kept', async ({ page }) => {
  await gotoHydrated(page, `/${pageSlug}`)
  await expect(page.getByText('Step 1 of 2')).toBeVisible()

  // Next checks this step's required answers.
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('alert')).toContainText('Service')

  // The boiler question appears only for "Boiler repair".
  await expect(page.getByLabel('Boiler make')).toHaveCount(0)
  await page.getByLabel('Boiler repair').check()
  await page.getByLabel('Boiler make').fill('Worcester')
  // Changing the answer hides it again.
  await page.getByLabel('Plumbing').check()
  await expect(page.getByLabel('Boiler make')).toHaveCount(0)

  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('Step 2 of 2 · Where are you?')).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByLabel('Plumbing')).toBeChecked()
  await page.getByRole('button', { name: 'Next' }).click()

  await page.getByLabel('Postcode').fill('YO1 8AA')
  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByText('Your submission has been received.')).toBeVisible()

  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const list = await admin.get(`/api/v1/forms/${formId}/submissions`)
  const { submissions } = await list.json() as { submissions: Array<{ data: Record<string, unknown> }> }
  expect(submissions[0]!.data).toEqual({ service: 'plumbing', postcode: 'YO1 8AA' })
  await admin.dispose()
})
