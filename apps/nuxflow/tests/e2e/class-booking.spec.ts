/**
 * E2E tests for booking classes: the repeat controls in the editor, choosing a date on a
 * repeating event, the weekly timetable, and class passes. The test server has no Stripe
 * key, so paid classes show as not open; taking real payments is covered by
 * tests/integration/class-booking.test.ts.
 */
import { createHmac } from 'node:crypto'
import { test, expect, type APIRequestContext } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated, waitForHydration } from './helpers'

test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

const RUN = Date.now().toString(36)
const CLASS_TITLE = `E2E Yoga ${RUN}`
const CLASS_SLUG = `e2e-yoga-${RUN}`
const PAID_TITLE = `E2E Paid Pilates ${RUN}`
const PAID_SLUG = `e2e-paid-pilates-${RUN}`
const TIMETABLE_SLUG = `e2e-timetable-${RUN}`
const PASSES_SLUG = `e2e-passes-page-${RUN}`
const PASS_NAME = `E2E Ten Pack ${RUN}`

const isoDay = (date: Date) => date.toISOString().slice(0, 10)
const DAY = 86_400_000
const todayIso = isoDay(new Date())

async function createEvent(request: APIRequestContext, data: Record<string, unknown>) {
  const res = await request.post('/api/v1/content', { data: { typeSlug: 'event', status: 'published', content: { type: 'doc', content: [] }, ...data } })
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json()) as { id: string }
}

// Stands in for the emailed link: signed the same way as server/utils/event-rsvp.ts, with
// the secret the test server runs with (playwright.config.ts).
async function confirmLink(request: APIRequestContext, eventId: string, email: string): Promise<string> {
  const settings = await (await request.get('/api/v1/settings')).json()
  const list = await (await request.get(`/api/v1/rsvps?event=${eventId}`)).json()
  const row = list.rsvps.find((r: { email: string }) => r.email === email)
  const token = createHmac('sha256', 'e2e-test-secret-exactly-32-chars!').update(`event-rsvp:confirm:${settings.site.id}:${row.id}`).digest('hex')
  return `/rsvp/confirm?id=${row.id}&token=${token}`
}

test.describe.serial('Booking classes', () => {
  let classId = ''

  test('the editor offers a repeat rule, and it survives saving', async ({ page }) => {
    await gotoHydrated(page, `/admin/content/new?type=event&date=${todayIso}&title=${encodeURIComponent(`E2E Editor Class ${RUN}`)}`)
    await page.getByLabel('Start Date & Time').fill(`${isoDay(new Date(Date.now() + 2 * DAY))}T18:00`)
    await page.getByRole('combobox', { name: 'Repeat' }).click()
    await page.getByRole('option', { name: 'Weekly' }).click()

    const days = page.getByRole('group', { name: 'Days of the week' })
    await expect(days).toBeVisible()
    await days.getByRole('button', { name: 'Sat' }).click()
    await expect(days.getByRole('button', { name: 'Sat' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/^Every week on /)).toBeVisible()

    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page).toHaveURL(/\/admin\/content\/(?!new)/, { timeout: 15_000 })
    await page.reload()
    await expect(page.getByRole('group', { name: 'Days of the week' }).getByRole('button', { name: 'Sat' })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
  })

  test('a visitor chooses a date on a repeating class, and each date has its own list', async ({ page, request }) => {
    const firstDay = new Date(Date.now() + DAY)
    const first = isoDay(firstDay)
    const second = isoDay(new Date(firstDay.getTime() + 7 * DAY))
    const created = await createEvent(request, {
      title: CLASS_TITLE,
      slug: CLASS_SLUG,
      eventStartAt: `${first}T18:00:00.000Z`,
      eventEndAt: `${first}T19:00:00.000Z`,
      eventRsvpEnabled: true,
      eventRsvpCapacity: 1,
      eventRecurrence: { freq: 'weekly', interval: 1 },
    })
    classId = created.id

    await gotoHydrated(page, `/${CLASS_SLUG}?date=${second}`)
    await expect(page.getByText(/^Every week\. Next:/)).toBeVisible({ timeout: 15_000 })
    const form = page.locator('.nuxflow-event-rsvp')
    await expect(form.getByText('1 place left')).toBeVisible({ timeout: 15_000 })
    await form.getByLabel('Your name').fill('E2E Visitor')
    await form.getByLabel('Email').fill(`visitor-${RUN}@example.test`)
    await form.getByRole('button', { name: 'Save my place' }).click()
    await expect(form.getByText('Check your inbox')).toBeVisible({ timeout: 15_000 })
    await page.goto(await confirmLink(request, classId, `visitor-${RUN}@example.test`))
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Yes, confirm my place' }).click()
    await expect(page.getByRole('heading', { name: 'You\'re on the list' })).toBeVisible({ timeout: 15_000 })

    // The linked date is the one that filled up; the first date is still open.
    const dates = (await (await request.get(`/api/public/rsvp/${classId}`)).json()).dates as Array<{ date: string; state: string; spotsLeft: number }>
    expect(dates.find(d => d.date === second)).toMatchObject({ state: 'waitlist', spotsLeft: 0 })
    expect(dates.find(d => d.date === first)).toMatchObject({ state: 'open', spotsLeft: 1 })
  })

  test('the attendee list shows one date at a time', async ({ page }) => {
    await gotoHydrated(page, `/admin/events/${classId}`)
    await expect(page.getByRole('button', { name: 'Cancel this date' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('Date')).toBeVisible()
    // Opens on the next date, which has nobody on it yet.
    await expect(page.getByText('Nobody here yet.')).toBeVisible({ timeout: 15_000 })
  })

  test('calling off a date takes it out of the series', async ({ page, request }) => {
    await gotoHydrated(page, `/admin/events/${classId}`)
    await page.getByRole('button', { name: 'Cancel this date' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Cancel it' }).click()
    await expect(page.getByText('Date cancelled. 0 people have been told.', { exact: true })).toBeVisible({ timeout: 15_000 })

    const dates = (await (await request.get(`/api/public/rsvp/${classId}`)).json()).dates as Array<{ date: string }>
    expect(dates.map(d => d.date)).not.toContain(isoDay(new Date(Date.now() + DAY)))
  })

  test('the weekly timetable lists the class and pages through weeks', async ({ page, request }) => {
    const res = await request.post('/api/v1/content', {
      data: {
        title: `E2E Timetable ${RUN}`,
        slug: TIMETABLE_SLUG,
        typeSlug: 'page',
        status: 'published',
        content: { type: 'canvas', blocks: [{ id: 'cal', type: 'canvas-calendar', props: { title: 'Timetable', displayMode: 'week', weekStartsOn: 'monday' } }] },
      },
    })
    expect(res.ok(), await res.text()).toBe(true)

    await gotoHydrated(page, `/${TIMETABLE_SLUG}`)
    const timetable = page.locator('.canvas-timetable')
    await expect(timetable).toBeVisible({ timeout: 15_000 })
    await expect(timetable.locator('.canvas-timetable-day')).toHaveCount(7)

    // The date a week on from the one called off is there, with a link naming its date.
    await timetable.getByRole('button', { name: 'Next week' }).click()
    const link = timetable.getByRole('link', { name: new RegExp(CLASS_TITLE) }).first()
    await expect(link).toBeVisible({ timeout: 15_000 })
    await expect(link).toHaveAttribute('href', new RegExp(`/${CLASS_SLUG}\\?date=\\d{4}-\\d{2}-\\d{2}`))
  })

  test('a paid class says booking is not open while payments are not set up', async ({ page, request }) => {
    const day = isoDay(new Date(Date.now() + 3 * DAY))
    await createEvent(request, {
      title: PAID_TITLE,
      slug: PAID_SLUG,
      eventStartAt: `${day}T10:00:00.000Z`,
      eventRsvpEnabled: true,
      eventPrice: 12.5,
      eventCurrency: 'GBP',
      eventPassesAllowed: false,
    })
    await gotoHydrated(page, `/${PAID_SLUG}`)
    await expect(page.getByText(/per place/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Booking isn\'t open for this event at the moment.')).toBeVisible({ timeout: 15_000 })
  })

  test('an admin sets up a class pass, and the block and pass page show it', async ({ page, request }) => {
    await gotoHydrated(page, '/admin/class-passes')
    await page.getByRole('button', { name: 'New pass' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name').fill(PASS_NAME)
    await dialog.getByLabel('Sessions').fill('10')
    await dialog.getByLabel('Price').fill('80')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText(PASS_NAME)).toBeVisible({ timeout: 15_000 })

    const res = await request.post('/api/v1/content', {
      data: {
        title: `E2E Passes ${RUN}`,
        slug: PASSES_SLUG,
        typeSlug: 'page',
        status: 'published',
        content: { type: 'canvas', blocks: [{ id: 'passes', type: 'canvas-class-passes', props: { title: 'Our passes', buttonText: 'Buy now' } }] },
      },
    })
    expect(res.ok(), await res.text()).toBe(true)

    await gotoHydrated(page, `/${PASSES_SLUG}`)
    await expect(page.locator('.canvas-class-pass').filter({ hasText: PASS_NAME })).toBeVisible({ timeout: 15_000 })

    await gotoHydrated(page, '/booking/passes')
    await expect(page.getByRole('button', { name: new RegExp(PASS_NAME) })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Passes can\'t be bought online right now.', { exact: false })).toBeVisible()
  })

  test('someone can ask for a link to their bookings without an account', async ({ browser }) => {
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await anonymous.newPage()
    await gotoHydrated(page, '/booking/my')
    await page.getByRole('textbox', { name: 'Email' }).fill(`nobody-${RUN}@example.test`)
    await page.getByRole('button', { name: 'Email me a link' }).click()
    await expect(page.getByText('Check your inbox')).toBeVisible({ timeout: 15_000 })
    await anonymous.close()
  })

  test('the thanks page and an incomplete pay link explain themselves', async ({ page }) => {
    await gotoHydrated(page, '/booking/thanks?type=pass')
    await expect(page.getByText(/adding the pass to your email address/)).toBeVisible({ timeout: 15_000 })
    await gotoHydrated(page, '/booking/pay')
    await expect(page.getByRole('heading', { name: 'Link incomplete' })).toBeVisible({ timeout: 15_000 })
  })
})
