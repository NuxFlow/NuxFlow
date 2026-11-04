/**
 * E2E tests for the calendar and events: adding from a day on the calendar, the event's
 * times surviving a save, the event page and its RSVP form, the attendee list, moving items
 * by dragging them, and scheduling a post.
 */
import { createHmac } from 'node:crypto'
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { ADMIN_STORAGE_STATE_PATH } from './global-setup'
import { gotoHydrated, waitForHydration } from './helpers'

test.use({ storageState: ADMIN_STORAGE_STATE_PATH })

const RUN = Date.now().toString(36)
const EVENT_TITLE = `E2E Open Day ${RUN}`
const EVENT_SLUG = `e2e-open-day-${RUN}`
const POST_TITLE = `E2E Planned Post ${RUN}`
const DRAFT_TITLE = `E2E Undated Draft ${RUN}`

const pad = (n: number) => String(n).padStart(2, '0')
const now = new Date()
// The 28th exists in every month, and it's far enough ahead whatever day this runs on.
const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 28))
const NEXT_MONTH_DAY = `${nextMonth.getUTCFullYear()}-${pad(nextMonth.getUTCMonth() + 1)}-28`
const dayLabel = nextMonth.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

// Stands in for the emailed link: signed the same way as server/utils/event-rsvp.ts, with
// the secret the test server runs with (playwright.config.ts).
async function confirmLink(request: APIRequestContext, eventId: string, email: string): Promise<string> {
  const settings = await (await request.get('/api/v1/settings')).json()
  const list = await (await request.get(`/api/v1/rsvps?event=${eventId}`)).json()
  const row = list.rsvps.find((r: { email: string }) => r.email === email)
  const token = createHmac('sha256', 'e2e-test-secret-exactly-32-chars!').update(`event-rsvp:confirm:${settings.site.id}:${row.id}`).digest('hex')
  return `/rsvp/confirm?id=${row.id}&token=${token}`
}

async function openNextMonth(page: Page) {
  await gotoHydrated(page, '/admin/calendar')
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByRole('button', { name: `Add to ${dayLabel}` })).toBeVisible({ timeout: 15_000 })
}

test.describe.serial('Calendar and events', () => {
  test('the menu leads to events and posts', async ({ page }) => {
    await gotoHydrated(page, '/admin')
    await page.getByRole('link', { name: 'Events', exact: true }).click()
    await expect(page.getByRole('heading', { name: /events/i })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: 'New event' })).toBeVisible()
    await page.getByRole('link', { name: 'Posts', exact: true }).click()
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible({ timeout: 15_000 })
  })

  test('adding from a day opens the editor with the date filled in', async ({ page }) => {
    await openNextMonth(page)
    // Choosing a hidden-until-hover button is fine: it's still focusable and clickable.
    await page.getByRole('button', { name: `Add to ${dayLabel}` }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: 'Event' }).click()
    await dialog.getByRole('textbox').fill(EVENT_TITLE)
    await dialog.getByRole('button', { name: 'Continue' }).click()

    await expect(page).toHaveURL(/\/admin\/content\/new\?/, { timeout: 15_000 })
    await expect(page.getByPlaceholder('Page title')).toHaveValue(EVENT_TITLE)
    await expect(page.getByLabel('Start Date & Time')).toHaveValue(`${NEXT_MONTH_DAY}T09:00`)
  })

  test('an event cannot be published without a start date', async ({ page }) => {
    await gotoHydrated(page, '/admin/content/new?type=event')
    await page.getByPlaceholder('Page title').fill(`No date ${RUN}`)
    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page.getByText('Add a start date before publishing this event.')).toBeVisible({ timeout: 15_000 })
  })

  test('publishing keeps the time, through a reload and another save', async ({ page }) => {
    await gotoHydrated(page, `/admin/content/new?type=event&date=${NEXT_MONTH_DAY}&title=${encodeURIComponent(EVENT_TITLE)}`)
    await page.getByLabel('Start Date & Time').fill(`${NEXT_MONTH_DAY}T18:30`)
    await page.getByLabel('Location / Venue').fill('The Town Hall, Room 2')
    await page.getByLabel('Let visitors RSVP on this page').check()
    await page.getByLabel('Places available').fill('1')
    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page).toHaveURL(/\/admin\/content\/[0-9A-Z]{26}/, { timeout: 15_000 })

    for (let i = 0; i < 2; i++) {
      await page.reload()
      await expect(page.getByLabel('Start Date & Time')).toHaveValue(`${NEXT_MONTH_DAY}T18:30`, { timeout: 15_000 })
      await expect(page.getByLabel('Status').first()).toContainText('Published')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 15_000 })
    }
  })

  test('the calendar shows the event on its day', async ({ page }) => {
    await openNextMonth(page)
    await expect(page.getByRole('link', { name: EVENT_TITLE })).toBeVisible()
    await page.getByRole('tab', { name: 'Agenda' }).click()
    await expect(page.getByRole('heading', { name: dayLabel })).toBeVisible()
    await expect(page.getByRole('link', { name: new RegExp(EVENT_TITLE) })).toContainText('18:30')
  })

  test('the event page shows when and where, and takes an RSVP', async ({ page, request }) => {
    await gotoHydrated(page, `/${EVENT_SLUG}`)
    const details = page.getByRole('region', { name: 'Event details' })
    await expect(details).toContainText(/18:30|06:30 PM/)
    await expect(details).toContainText('The Town Hall, Room 2')
    await expect(details.getByRole('link', { name: 'Add to calendar' })).toBeVisible()
    await expect(details.getByText('1 place left')).toBeVisible({ timeout: 15_000 })

    // Nothing is held until the address is confirmed through the emailed link.
    const pageData = await (await request.get(`/api/public/pages/${EVENT_SLUG}`)).json()
    await details.getByLabel('Your name').fill('Rita Guest')
    await details.getByLabel('Email').fill(`rita-${RUN}@example.test`)
    await details.getByRole('button', { name: 'Save my place' }).click()
    await expect(details.getByText('Check your inbox')).toBeVisible({ timeout: 15_000 })
    await page.goto(await confirmLink(request, pageData.id, `rita-${RUN}@example.test`))
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Yes, confirm my place' }).click()
    await expect(page.getByRole('heading', { name: 'You\'re on the list' })).toBeVisible({ timeout: 15_000 })

    // The next visitor finds it full, and joins the waitlist.
    await gotoHydrated(page, `/${EVENT_SLUG}`)
    await expect(details.getByRole('button', { name: 'Join the waitlist' })).toBeVisible({ timeout: 15_000 })
    await details.getByLabel('Your name').fill('Sam Second')
    await details.getByLabel('Email').fill(`sam-${RUN}@example.test`)
    await details.getByRole('button', { name: 'Join the waitlist' }).click()
    await expect(details.getByText('Check your inbox')).toBeVisible({ timeout: 15_000 })
    await page.goto(await confirmLink(request, pageData.id, `sam-${RUN}@example.test`))
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Yes, confirm my place' }).click()
    await expect(page.getByRole('heading', { name: 'You\'re on the waitlist' })).toBeVisible({ timeout: 15_000 })

    // The calendar file and the feed are valid enough to open.
    const file = await request.get(pageData.event.icsUrl)
    expect(file.headers()['content-type']).toContain('text/calendar')
    expect(await file.text()).toContain('BEGIN:VEVENT')
    const feed = await (await request.get('/events.ics')).text()
    expect(feed).toContain(EVENT_TITLE)
  })

  test('the attendee list shows both, and cancelling promotes the waitlist', async ({ page }) => {
    await gotoHydrated(page, '/admin/content?type=event')
    await page.getByRole('link', { name: EVENT_TITLE, exact: true }).click()
    await page.getByRole('link', { name: 'View attendees' }).click()

    const rita = page.getByRole('row', { name: /Rita Guest/ })
    const sam = page.getByRole('row', { name: /Sam Second/ })
    await expect(rita).toContainText('Coming', { timeout: 15_000 })
    await expect(sam).toContainText('Waitlist')

    await rita.getByRole('button', { name: 'Actions for Rita Guest' }).click()
    await page.getByRole('menuitem', { name: 'Cancel their place' }).click()
    await expect(rita).toContainText('Cancelled', { timeout: 15_000 })
    await expect(sam).toContainText('Coming', { timeout: 15_000 })
  })

  test('an undated draft is listed, and dragging it onto a day plans it', async ({ page, request }) => {
    const created = await request.post('/api/v1/content', { data: { title: DRAFT_TITLE, slug: `e2e-undated-${RUN}`, typeSlug: 'post' } })
    expect(created.ok()).toBe(true)

    // Tall enough to show the whole month, so nothing has to scroll in the middle of a drag.
    await page.setViewportSize({ width: 1400, height: 1500 })
    await openNextMonth(page)
    const chip = page.getByRole('complementary').getByRole('link', { name: DRAFT_TITLE })
    await expect(chip).toBeVisible()
    const cell = page.locator('.group.min-h-28').filter({ has: page.getByRole('button', { name: `Add to ${dayLabel}` }) })
    // Native drag and drop needs a second move over the target before the drop registers.
    await chip.hover()
    await page.mouse.down()
    await cell.hover()
    await cell.hover({ position: { x: 10, y: 10 } })
    await page.mouse.up()

    await expect(page.getByRole('complementary').getByRole('link', { name: DRAFT_TITLE })).toHaveCount(0, { timeout: 15_000 })
    await expect(cell.getByRole('link', { name: DRAFT_TITLE })).toBeVisible()
  })

  test('a post added from a future day can be scheduled', async ({ page }) => {
    await openNextMonth(page)
    await page.getByRole('button', { name: `Add to ${dayLabel}` }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: 'Post' }).click()
    await dialog.getByRole('textbox').fill(POST_TITLE)
    await dialog.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByLabel('Publish on')).toHaveValue(`${NEXT_MONTH_DAY}T09:00`, { timeout: 15_000 })
    await page.getByRole('button', { name: 'Schedule' }).click()
    await expect(page).toHaveURL(/\/admin\/content\/[0-9A-Z]{26}/, { timeout: 15_000 })

    await page.reload()
    await expect(page.getByLabel('Publish on')).toHaveValue(`${NEXT_MONTH_DAY}T09:00`, { timeout: 15_000 })
    await expect(page.getByLabel('Status').first()).toContainText('Scheduled')
  })

  test('the public Calendar block lists the event with a working link', async ({ request }) => {
    const res = await (await request.get('/api/public/events?limit=100')).json()
    const listed = res.events.find((e: { title: string }) => e.title === EVENT_TITLE)
    expect(listed.path).toBe(`/${EVENT_SLUG}`)
    expect(listed.rsvp).toBe(true)
    expect(res.feedUrl).toBe('/events.ics')
  })
})
