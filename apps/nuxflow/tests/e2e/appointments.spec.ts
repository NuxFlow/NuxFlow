import { test, expect, request as playwrightRequest } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated } from './helpers'

/**
 * One-to-one appointments: the owner sets hours, a visitor picks a free time and books it,
 * the time stops being offered while they confirm by email, and the owner sees the booking
 * in Admin → Appointments. (Confirming needs the emailed link; that's covered by
 * tests/integration/appointments.test.ts.)
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8787'
const slug = `e2e-appointment-${Date.now()}`
const visitor = `Robin ${Date.now().toString(36)}`

test.beforeAll(async () => {
  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE_STATE_PATH })
  const every = [{ open: '09:00', close: '12:00' }]
  const hours = await admin.patch('/api/v1/settings', {
    data: { settings: { 'appointments.settings': { useOpeningHours: false, hours: { mon: every, tue: every, wed: every, thu: every, fri: every, sat: every, sun: every }, daysOff: [] } } },
  })
  expect(hours.ok(), await hours.text()).toBe(true)
  const res = await admin.post('/api/v1/content', {
    data: {
      title: 'Book a chat', slug, typeSlug: 'page', status: 'published',
      content: { type: 'canvas', blocks: [{ id: 'appt', type: 'canvas-appointment', props: { title: 'Book a chat', serviceName: 'Intro chat', duration: 60, step: 60, noticeHours: 0, daysAhead: 14, askPhone: true } }] },
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  await admin.dispose()
})

test('a visitor books a free time, and it is kept for them', async ({ page }) => {
  await gotoHydrated(page, `/${slug}`)
  const block = page.locator('.canvas-appointment')
  await expect(block).toContainText('Intro chat · 1 hour · Free', { timeout: 15_000 })

  const times = block.locator('.canvas-appointment-time')
  await expect(times.first()).toBeVisible()
  const chosen = (await times.first().textContent())!.trim()
  await times.first().click()
  await expect(times.first()).toHaveAttribute('aria-pressed', 'true')

  const day = await block.locator('.canvas-appointment-day[aria-pressed="true"]').getAttribute('data-date')

  await block.getByLabel('Your name').fill(visitor)
  await block.getByLabel('Email').fill('robin@example.com')
  await block.getByLabel('Phone').fill('07700 900000')
  await block.getByRole('button', { name: `Book ${chosen}` }).click()
  await expect(block.getByRole('status')).toContainText('Check your inbox')

  // The time is kept for them while they confirm: nobody else is offered it.
  const res = await page.request.get(`/_nuxflow/appointments?path=${slug}&block=appt`)
  const free = await res.json() as { days: Array<{ date: string; times: Array<{ time: string }> }> }
  const bookedDay = free.days.find(d => d.date === day)
  expect(bookedDay).toBeTruthy()
  expect(bookedDay!.times.map(t => t.time)).not.toContain(chosen)
})

test.describe('as the owner', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

  test('sees the booking in Admin → Appointments', async ({ page }) => {
    await gotoHydrated(page, '/admin/appointments')
    const item = page.getByRole('listitem').filter({ hasText: visitor })
    await expect(item).toContainText('Intro chat', { timeout: 15_000 })
    await expect(item).toContainText('Waiting for email confirmation')
  })
})
