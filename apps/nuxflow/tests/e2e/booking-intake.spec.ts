import { test, expect, request as playwrightRequest } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

/**
 * An event that asks for a waiver: the questions show in the booking box, booking is
 * refused until they're answered, and the answers land in the form's inbox labelled with
 * the booking.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8787'
const stamp = Date.now()
const eventSlug = `e2e-intake-${stamp}`
let formId = ''

test.beforeAll(async () => {
  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const form = await admin.post('/api/v1/forms', {
    data: {
      name: 'Health waiver', slug: `e2e-waiver-${stamp}`, status: 'active',
      fields: [
        { id: 'w1', type: 'radio', label: 'Any injuries?', name: 'injuries', required: true, options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] },
        { id: 'w2', type: 'text', label: 'What injury?', name: 'injury', required: true, showIf: { field: 'injuries', op: 'equals', value: 'yes' } },
        { id: 'w3', type: 'text', label: 'Type your full name to agree', name: 'agree', required: true },
      ],
    },
  })
  expect(form.ok(), await form.text()).toBe(true)
  formId = ((await form.json()) as { id: string }).id

  const start = new Date(Date.now() + 7 * 86_400_000).toISOString()
  const event = await admin.post('/api/v1/content', {
    data: {
      title: 'Morning yoga', slug: eventSlug, typeSlug: 'event', status: 'published',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bring a mat.' }] }] },
      eventStartAt: start, eventRsvpEnabled: true, settings: { access: 'public', intakeFormId: formId },
    },
  })
  expect(event.ok(), await event.text()).toBe(true)
  await admin.dispose()
})

test('booking waits for the waiver, and the answers reach the form', async ({ page }) => {
  await gotoHydrated(page, `/${eventSlug}`)
  // The booking box (the page also has a comment form with its own Email box).
  const box = page.locator('.nuxflow-event-rsvp')
  await expect(box.getByText('Health waiver')).toBeVisible()
  await box.getByLabel('Your name').fill('Sam Visitor')
  await box.getByLabel('Email').fill(`sam-${stamp}@example.test`)

  await box.getByRole('button', { name: 'Save my place' }).click()
  await expect(box.getByRole('alert')).toContainText('Any injuries?')

  await box.getByLabel('Yes').check()
  await expect(box.getByLabel('What injury?')).toBeVisible()
  await box.getByLabel('No').check()
  await expect(box.getByLabel('What injury?')).toHaveCount(0)
  await box.getByLabel('Type your full name to agree').fill('Sam Visitor')
  await box.getByRole('button', { name: 'Save my place' }).click()
  await expect(box.getByRole('status')).toBeVisible()

  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const list = await admin.get(`/api/v1/forms/${formId}/submissions`)
  const { submissions } = await list.json() as { submissions: Array<{ data: Record<string, unknown> }> }
  expect(submissions[0]!.data).toMatchObject({ injuries: 'no', agree: 'Sam Visitor', 'Booked by': `Sam Visitor <sam-${stamp}@example.test>` })
  expect(String(submissions[0]!.data.Booking)).toContain('Morning yoga')
  await admin.dispose()
})
