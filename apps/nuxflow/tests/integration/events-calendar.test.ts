/**
 * The calendar and events, end to end through their routes: date rules on content writes,
 * scheduled publishing, the admin calendar's days, public lists and feeds, and RSVPs.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { auditLogs, contentItems, eventRsvps, formSubmissions, forms } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedContentItem, seedContentType, seedRole, seedSetting, seedSite, seedUser } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../server/utils/webpush', () => ({
  broadcastPushToSite: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../server/utils/embeddings', () => ({
  upsertContentEmbedding: vi.fn().mockResolvedValue(undefined),
  deleteContentEmbedding: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../server/utils/edge-cache', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  purgeContentCache: vi.fn().mockResolvedValue(undefined),
  withEdgeCache: (_e: unknown, _ttl: number, build: () => unknown) => build(),
}))

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({ messageId: 'm-1' }),
}))
vi.mock('../../server/utils/email', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendEmailWithConfig: mockSend,
}))

const { default: createHandler } = await import('../../server/api/v1/content/index.post')
const { default: patchHandler } = await import('../../server/api/v1/content/[id].patch')
const { default: calendarHandler } = await import('../../server/api/v1/content/calendar.get')
const { default: eventsHandler } = await import('../../server/api/public/events.get')
const { default: feedHandler } = await import('../../server/routes/events.ics')
const { default: singleIcsHandler } = await import('../../server/routes/_nuxflow/event-ics/[id]')
const { default: rsvpGet } = await import('../../server/api/public/rsvp/[id].get')
const { default: rsvpPost } = await import('../../server/api/public/rsvp/[id].post')
const { default: rsvpLink } = await import('../../server/api/public/rsvp/link.post')
const { default: listRsvps } = await import('../../server/api/v1/rsvps/index.get')
const { default: addRsvp } = await import('../../server/api/v1/rsvps/index.post')
const { default: patchRsvp } = await import('../../server/api/v1/rsvps/[id].patch')
const { default: deleteRsvp } = await import('../../server/api/v1/rsvps/[id].delete')
const { publishScheduled } = await import('../../server/scheduled/publish-scheduled')
const { rsvpToken } = await import('../../server/utils/event-rsvp')

type Handler = (e: H3Event) => Promise<unknown>

// London time, with an email provider: confirmation links are used.
const SITE = 'site-events-01'
// No email provider: RSVPs take effect straight away.
const NO_MAIL = 'site-events-02'
const OTHER = 'site-events-03'

let editorId: string
let authorId: string
let viewerId: string
let eventType: string
let postType: string
let noMailEventType: string

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

function ev(opts: { userId?: string; siteId?: string; body?: unknown; params?: Record<string, string>; query?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? SITE,
    session: opts.userId ? { user: { id: opts.userId, name: 'U', email: 'u@test.test' } } : undefined,
    body: opts.body,
    params: opts.params,
    query: opts.query,
    method: opts.body !== undefined ? 'POST' : 'GET',
    headers: { host: 'events.localhost', 'cf-connecting-ip': '203.0.113.9' },
  }) as unknown as H3Event
}

async function seedEvent(overrides: Partial<typeof contentItems.$inferInsert> = {}, siteId = SITE, typeId = eventType) {
  return seedContentItem(getCurrentTestDb(), siteId, typeId, {
    title: 'Open day',
    status: 'published',
    visibility: 'public',
    eventStartAt: inDays(10),
    eventRsvpEnabled: true,
    ...overrides,
  })
}

const rsvpRow = (itemId: string, email: string) => getCurrentTestDb().query.eventRsvps.findFirst({
  where: and(eq(eventRsvps.contentItemId, itemId), eq(eventRsvps.email, email)),
})

/** A visitor asks for places and presses the button in the emailed link. */
async function bookAndConfirm(itemId: string, email: string, seats = 1) {
  await (rsvpPost as Handler)(ev({ params: { id: itemId }, body: { name: email, email, seats } }))
  const row = await rsvpRow(itemId, email)
  return (rsvpLink as Handler)(ev({ body: { action: 'confirm', id: row!.id, token: await rsvpToken('confirm', SITE, row!.id) } })) as Promise<{ status: string }>
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'events.localhost', timezone: 'Europe/London' })
  await seedSite(db, { id: NO_MAIL, domain: 'nomail.localhost', timezone: 'UTC' })
  await seedSite(db, { id: OTHER, domain: 'other.localhost' })
  editorId = await seedUser(db, { email: 'editor@events.test' })
  authorId = await seedUser(db, { email: 'author@events.test' })
  viewerId = await seedUser(db, { email: 'viewer@events.test' })
  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')
  await seedRole(db, viewerId, SITE, 'viewer')
  eventType = await seedContentType(db, SITE, { slug: 'event', name: 'Events', singularName: 'Event' })
  postType = await seedContentType(db, SITE, { slug: 'post', name: 'Posts', singularName: 'Post' })
  noMailEventType = await seedContentType(db, NO_MAIL, { slug: 'event', name: 'Events', singularName: 'Event' })
  await seedSetting(db, SITE, 'email.provider', 'resend')
  await seedSetting(db, SITE, 'email.resend_api_key', 're_test_key')
})

afterAll(teardownTestDb)

beforeEach(() => {
  mockSend.mockClear()
  mockSend.mockResolvedValue({ messageId: 'm-1' })
})

describe('date rules on content writes', () => {
  const create = (body: Record<string, unknown>) => (createHandler as Handler)(ev({ userId: editorId, body })) as Promise<{ id: string }>
  const patch = (id: string, body: Record<string, unknown>) => (patchHandler as Handler)(ev({ userId: editorId, params: { id }, body }))
  const stored = (id: string) => getCurrentTestDb().query.contentItems.findFirst({ where: eq(contentItems.id, id) })

  it('keeps a scheduled date given when creating', async () => {
    const { id } = await create({ title: 'S', slug: 'rule-sched', typeSlug: 'post', status: 'scheduled', scheduledAt: '2031-01-01T09:00:00.000Z' })
    expect((await stored(id))?.scheduledAt).toBe('2031-01-01T09:00:00.000Z')
  })

  it('refuses to schedule with no date', async () => {
    await expect(create({ title: 'S', slug: 'rule-nodate', typeSlug: 'post', status: 'scheduled' })).rejects.toMatchObject({ statusCode: 422 })
    const { id } = await create({ title: 'S', slug: 'rule-nodate2', typeSlug: 'post' })
    await expect(patch(id, { status: 'scheduled' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('refuses a date the browser form would not send', async () => {
    const { id } = await create({ title: 'S', slug: 'rule-local', typeSlug: 'post' })
    await expect(patch(id, { scheduledAt: '2031-01-01T09:00' })).rejects.toMatchObject({ statusCode: 422 })
    await expect(patch(id, { eventStartAt: 'next tuesday' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('refuses to publish an event with no start, and an end before the start', async () => {
    await expect(create({ title: 'E', slug: 'rule-ev', typeSlug: 'event', status: 'published' })).rejects.toMatchObject({ statusCode: 422 })
    const { id } = await create({ title: 'E', slug: 'rule-ev2', typeSlug: 'event' })
    await expect(patch(id, { status: 'published' })).rejects.toMatchObject({ statusCode: 422 })
    await expect(patch(id, { eventStartAt: '2031-01-02T09:00:00.000Z', eventEndAt: '2031-01-01T09:00:00.000Z' })).rejects.toMatchObject({ statusCode: 422 })
    await patch(id, { eventStartAt: '2031-01-02T09:00:00.000Z', status: 'published' })
    expect((await stored(id))?.status).toBe('published')
  })

  it('does not trap an older live event that has no date', async () => {
    const id = await seedEvent({ eventStartAt: null, slug: 'rule-old' })
    await patch(id, { title: 'Renamed', eventStartAt: null })
    expect((await stored(id))?.title).toBe('Renamed')
  })

  it('stores all-day dates as the date at midnight UTC', async () => {
    const { id } = await create({ title: 'E', slug: 'rule-allday', typeSlug: 'event', eventAllDay: true, eventStartAt: '2031-07-14T23:00:00.000Z', eventEndAt: '2031-07-15T23:00:00.000Z' })
    const row = await stored(id)
    expect(row?.eventStartAt).toBe('2031-07-15T00:00:00.000Z')
    expect(row?.eventEndAt).toBe('2031-07-16T00:00:00.000Z')
  })

  it('refuses a javascript: event link', async () => {
    await expect(create({ title: 'E', slug: 'rule-url', typeSlug: 'event', eventUrl: 'javascript:alert(1)' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('writes nothing when saving the same dates again', async () => {
    const { id } = await create({ title: 'E', slug: 'rule-noop', typeSlug: 'event', eventStartAt: '2031-01-02T09:00:00.000Z' })
    const before = await stored(id)
    await patch(id, { eventStartAt: '2031-01-02T09:00:00.000Z', eventEndAt: null })
    expect((await stored(id))?.version).toBe(before?.version)
  })
})

describe('publishScheduled with the dates the API stores', () => {
  it('publishes earlier today, not at the next UTC midnight', async () => {
    const due = await seedContentItem(getCurrentTestDb(), SITE, postType, { status: 'scheduled', scheduledAt: new Date(Date.now() - 60_000).toISOString(), publishedAt: null })
    await publishScheduled()
    const row = await getCurrentTestDb().query.contentItems.findFirst({ where: eq(contentItems.id, due) })
    expect(row?.status).toBe('published')
  })

  it('leaves a time later today alone', async () => {
    const later = await seedContentItem(getCurrentTestDb(), SITE, postType, { status: 'scheduled', scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), publishedAt: null })
    await publishScheduled()
    const row = await getCurrentTestDb().query.contentItems.findFirst({ where: eq(contentItems.id, later) })
    expect(row?.status).toBe('scheduled')
  })
})

describe('GET /api/v1/content/calendar', () => {
  type Response = { items: { id: string; title: string; calendarDate: string; calendarEndDate: string; canEdit: boolean }[]; unscheduled: { id: string; title: string }[]; timeZone: string }
  const month = (userId: string, from = '2032-03-01', to = '2032-03-31') =>
    (calendarHandler as Handler)(ev({ userId, query: { from, to } })) as Promise<Response>
  const seed = (overrides: Partial<typeof contentItems.$inferInsert>, typeId = postType) => seedContentItem(getCurrentTestDb(), SITE, typeId, overrides)

  it('includes what went out on the 1st, whichever way the date was written', async () => {
    await seed({ title: 'First', publishedAt: '2032-03-01 12:00:00' })
    const { items } = await month(viewerId)
    expect(items.find(i => i.title === 'First')?.calendarDate).toBe('2032-03-01')
  })

  it('uses the site\'s own days, not UTC', async () => {
    // 23:30 UTC on 14 July is 00:30 on the 15th in London.
    await seed({ title: 'Late', publishedAt: '2032-07-14T23:30:00.000Z' })
    const res = await month(viewerId, '2032-07-01', '2032-07-31')
    expect(res.timeZone).toBe('Europe/London')
    expect(res.items.find(i => i.title === 'Late')?.calendarDate).toBe('2032-07-15')
  })

  it('leaves out what falls just outside the month in the site zone', async () => {
    await seed({ title: 'Edge', publishedAt: '2032-08-31T23:30:00.000Z' }) // 1 Sept in London
    const { items } = await month(viewerId, '2032-08-01', '2032-08-31')
    expect(items.find(i => i.title === 'Edge')).toBeUndefined()
  })

  it('puts a long event in each month it covers, with its last day', async () => {
    await seed({ title: 'Long', eventAllDay: true, eventStartAt: '2032-04-29T00:00:00.000Z', eventEndAt: '2032-05-02T00:00:00.000Z' }, eventType)
    for (const [from, to] of [['2032-04-01', '2032-04-30'], ['2032-05-01', '2032-05-31']] as const) {
      const long = (await month(viewerId, from, to)).items.find(i => i.title === 'Long')
      expect(long?.calendarDate).toBe('2032-04-29')
      expect(long?.calendarEndDate).toBe('2032-05-02')
    }
  })

  it('places a planned draft on its date, and lists undated drafts separately', async () => {
    await seed({ title: 'Planned', status: 'draft', scheduledAt: '2032-03-10T09:00:00.000Z', publishedAt: null })
    await seed({ title: 'Undated', status: 'draft', publishedAt: null })
    const { items, unscheduled } = await month(viewerId)
    expect(items.find(i => i.title === 'Planned')?.calendarDate).toBe('2032-03-10')
    expect(unscheduled.map(i => i.title)).toContain('Undated')
    expect(unscheduled.map(i => i.title)).not.toContain('Planned')
  })

  it('shows a translated event once', async () => {
    const source = await seed({ title: 'Original', eventStartAt: '2032-03-20T18:00:00.000Z' }, eventType)
    await seed({ title: 'Traducción', sourceItemId: source, locale: 'es', eventStartAt: '2032-03-20T18:00:00.000Z' }, eventType)
    const { items } = await month(viewerId)
    expect(items.map(i => i.title)).toContain('Original')
    expect(items.map(i => i.title)).not.toContain('Traducción')
  })

  it('says who can move what', async () => {
    await seed({ title: 'Mine', status: 'draft', authorId, scheduledAt: '2032-03-11T09:00:00.000Z', publishedAt: null })
    await seed({ title: 'Theirs', status: 'draft', authorId: editorId, scheduledAt: '2032-03-12T09:00:00.000Z', publishedAt: null })
    const asAuthor = (await month(authorId)).items
    expect(asAuthor.find(i => i.title === 'Mine')?.canEdit).toBe(true)
    expect(asAuthor.find(i => i.title === 'Theirs')?.canEdit).toBe(false)
    expect((await month(viewerId)).items.find(i => i.title === 'Mine')?.canEdit).toBe(false)
  })
})

describe('public lists and feeds', () => {
  type Listed = { events: { title: string; path: string; icsUrl: string; rsvp: boolean }[]; timeZone: string; feedUrl: string }
  const list = (query: Record<string, string> = {}) => (eventsHandler as Handler)(ev({ siteId: OTHER, query })) as Promise<Listed>
  let otherType: string
  let conferenceId: string

  beforeAll(async () => {
    const db = getCurrentTestDb()
    otherType = await seedContentType(db, OTHER, { slug: 'event', name: 'Events', singularName: 'Event' })
    const seed = (o: Partial<typeof contentItems.$inferInsert>) => seedEvent(o, OTHER, otherType)
    conferenceId = await seed({ title: 'Conference on now', slug: 'conference', eventStartAt: inDays(-1), eventEndAt: inDays(1) })
    await seed({ title: 'Finished', slug: 'finished', eventStartAt: inDays(-3), eventEndAt: inDays(-2) })
    await seed({ title: 'Next month', slug: 'next-month', eventStartAt: inDays(30), eventRsvpEnabled: false })
    await seed({ title: 'Today all day', slug: 'today', eventAllDay: true, eventStartAt: `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`, eventRsvpEnabled: false })
    await seed({ title: 'Traducción', slug: 'traduccion', sourceItemId: conferenceId, locale: 'es', eventStartAt: inDays(-1), eventEndAt: inDays(1) })
  })

  it('keeps showing an event while it is on, then moves it to past', async () => {
    const upcoming = (await list()).events.map(e => e.title)
    expect(upcoming).toContain('Conference on now')
    expect(upcoming).toContain('Today all day')
    expect(upcoming).not.toContain('Finished')
    expect((await list({ past: '1' })).events.map(e => e.title)).toEqual(['Finished'])
  })

  it('lists a translation only once, through its original', async () => {
    expect((await list()).events.map(e => e.title)).not.toContain('Traducción')
  })

  it('gives the block a link, a calendar file and the site\'s zone', async () => {
    const res = await list()
    const conference = res.events.find(e => e.title === 'Conference on now')!
    expect(conference.path).toBe('/conference')
    expect(conference.icsUrl).toBe(`/_nuxflow/event-ics/${conferenceId}`)
    expect(conference.rsvp).toBe(true)
    expect(res.timeZone).toBe('UTC')
    expect(res.feedUrl).toBe('/events.ics')
  })

  it('lists whatever overlaps a window, for a month of the grid', async () => {
    const titles = (await list({ from: inDays(-3), to: inDays(5) })).events.map(e => e.title)
    expect(titles).toContain('Finished')
    expect(titles).toContain('Conference on now')
    expect(titles).not.toContain('Next month')
  })

  it('writes a feed with the event page\'s address and no translations', async () => {
    const ics = await (feedHandler as Handler)(ev({ siteId: OTHER })) as string
    expect(ics).toContain('SUMMARY:Conference on now')
    expect(ics).toContain('URL:')
    expect(ics).toContain('/conference')
    expect(ics).not.toContain('Traducción')
    expect(ics).not.toMatch(/DTSTAMP:\d+ /)
  })

  it('keeps the nearest events when the feed is cut short', async () => {
    // Earliest first with a limit, so what drops off is the furthest away.
    const ics = await (feedHandler as Handler)(ev({ siteId: OTHER })) as string
    expect(ics.indexOf('Finished')).toBeLessThan(ics.indexOf('Next month'))
  })

  it('serves one event\'s calendar file, for public published events only', async () => {
    const ics = await (singleIcsHandler as Handler)(ev({ siteId: OTHER, params: { id: conferenceId } })) as string
    expect(ics).toContain('SUMMARY:Conference on now')
    const privateId = await seedEvent({ title: 'Private', slug: 'priv', visibility: 'members' }, OTHER, otherType)
    await expect((singleIcsHandler as Handler)(ev({ siteId: OTHER, params: { id: privateId } }))).rejects.toMatchObject({ statusCode: 404 })
    await expect((singleIcsHandler as Handler)(ev({ params: { id: conferenceId } }))).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('RSVPs', () => {
  const state = (id: string) => (rsvpGet as Handler)(ev({ params: { id } })) as Promise<{ enabled: boolean; state: string; spotsLeft: number | null; maxSeats: number }>

  it('takes no seats until the address is confirmed', async () => {
    const id = await seedEvent({ eventRsvpCapacity: 2 })
    const answer = await (rsvpPost as Handler)(ev({ params: { id }, body: { name: 'Ann', email: 'ann@x.test' } }))
    expect(answer).toEqual({ status: 'pending' })
    expect((await rsvpRow(id, 'ann@x.test'))?.status).toBe('pending')
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect((await state(id)).spotsLeft).toBe(2)

    const row = await rsvpRow(id, 'ann@x.test')
    const result = await (rsvpLink as Handler)(ev({ body: { action: 'confirm', id: row!.id, token: await rsvpToken('confirm', SITE, row!.id) } })) as { status: string; title: string; path: string }
    expect(result.status).toBe('confirmed')
    expect(result.title).toBe('Open day')
    expect((await state(id)).spotsLeft).toBe(1)
  })

  it('answers the same for an address already on the list', async () => {
    const id = await seedEvent()
    await bookAndConfirm(id, 'dup@x.test')
    mockSend.mockClear()
    const answer = await (rsvpPost as Handler)(ev({ params: { id }, body: { name: 'Dup', email: 'DUP@x.test' } }))
    expect(answer).toEqual({ status: 'pending' })
    expect((await rsvpRow(id, 'dup@x.test'))?.status).toBe('confirmed')
  })

  it('does not stuff an inbox when asked twice in a row', async () => {
    const id = await seedEvent()
    await (rsvpPost as Handler)(ev({ params: { id }, body: { name: 'A', email: 'twice@x.test' } }))
    await (rsvpPost as Handler)(ev({ params: { id }, body: { name: 'A', email: 'twice@x.test' } }))
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('tells the visitor when the confirmation email could not go out', async () => {
    const id = await seedEvent()
    mockSend.mockRejectedValueOnce(new Error('provider down'))
    await expect((rsvpPost as Handler)(ev({ params: { id }, body: { name: 'A', email: 'down@x.test' } }))).rejects.toMatchObject({ statusCode: 502 })
  })

  it('goes to the waitlist when full, and promotes when someone cancels', async () => {
    const id = await seedEvent({ eventRsvpCapacity: 2 })
    expect((await bookAndConfirm(id, 'one@x.test', 2)).status).toBe('confirmed')
    expect((await bookAndConfirm(id, 'two@x.test')).status).toBe('waitlist')
    expect((await bookAndConfirm(id, 'three@x.test')).status).toBe('waitlist')
    expect((await state(id)).state).toBe('waitlist')

    mockSend.mockClear()
    const one = await rsvpRow(id, 'one@x.test')
    const cancelled = await (rsvpLink as Handler)(ev({ body: { action: 'cancel', id: one!.id, token: await rsvpToken('cancel', SITE, one!.id) } })) as { status: string }
    expect(cancelled.status).toBe('cancelled')

    // Longest wait first, and they're told.
    expect((await rsvpRow(id, 'two@x.test'))?.status).toBe('confirmed')
    expect((await rsvpRow(id, 'three@x.test'))?.status).toBe('confirmed')
    expect(mockSend.mock.calls.map(c => (c[1] as { subject: string }).subject).join()).toContain('A place opened up')
  })

  it('does not let a smaller party jump the waitlist', async () => {
    const id = await seedEvent({ eventRsvpCapacity: 3 })
    await bookAndConfirm(id, 'a@x.test', 2)
    expect((await bookAndConfirm(id, 'big@x.test', 3)).status).toBe('waitlist')
    expect((await bookAndConfirm(id, 'small@x.test', 1)).status).toBe('waitlist')
  })

  it('never oversells when two people confirm the last place at once', async () => {
    const id = await seedEvent({ eventRsvpCapacity: 1 })
    for (const email of ['r1@x.test', 'r2@x.test']) await (rsvpPost as Handler)(ev({ params: { id }, body: { name: email, email } }))
    const rows = await Promise.all(['r1@x.test', 'r2@x.test'].map(e => rsvpRow(id, e)))
    const results = await Promise.all(rows.map(async row => (rsvpLink as Handler)(ev({ body: { action: 'confirm', id: row!.id, token: await rsvpToken('confirm', SITE, row!.id) } })) as Promise<{ status: string }>))
    expect(results.map(r => r.status).sort()).toEqual(['confirmed', 'waitlist'])
  })

  it('refuses asking for more places than the event has', async () => {
    const id = await seedEvent({ eventRsvpCapacity: 2 })
    await expect((rsvpPost as Handler)(ev({ params: { id }, body: { name: 'A', email: 'many@x.test', seats: 3 } }))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('closes when the event starts or at the closing time', async () => {
    const started = await seedEvent({ eventStartAt: inDays(-1) })
    expect((await state(started)).state).toBe('closed')
    await expect((rsvpPost as Handler)(ev({ params: { id: started }, body: { name: 'A', email: 'late@x.test' } }))).rejects.toMatchObject({ statusCode: 409 })
    const closing = await seedEvent({ eventRsvpClosesAt: inDays(-1) })
    expect((await state(closing)).state).toBe('closed')
  })

  it('takes effect at once on a site that cannot send email', async () => {
    const id = await seedEvent({ eventRsvpCapacity: 1 }, NO_MAIL, noMailEventType)
    const first = await (rsvpPost as Handler)(ev({ siteId: NO_MAIL, params: { id }, body: { name: 'A', email: 'a@x.test' } }))
    expect(first).toEqual({ status: 'confirmed' })
    const second = await (rsvpPost as Handler)(ev({ siteId: NO_MAIL, params: { id }, body: { name: 'B', email: 'b@x.test' } }))
    expect(second).toEqual({ status: 'waitlist' })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('drops honeypot submissions with a normal answer', async () => {
    const id = await seedEvent()
    expect(await (rsvpPost as Handler)(ev({ params: { id }, body: { name: 'Bot', email: 'bot@x.test', website: 'spam' } }))).toEqual({ status: 'pending' })
    expect(await rsvpRow(id, 'bot@x.test')).toBeUndefined()
  })

  it('refuses a bad or wrong-purpose link', async () => {
    const id = await seedEvent()
    await (rsvpPost as Handler)(ev({ params: { id }, body: { name: 'A', email: 'links@x.test' } }))
    const row = await rsvpRow(id, 'links@x.test')
    await expect((rsvpLink as Handler)(ev({ body: { action: 'confirm', id: row!.id, token: 'a'.repeat(64) } }))).rejects.toMatchObject({ statusCode: 404 })
    // A confirm link can't cancel.
    await expect((rsvpLink as Handler)(ev({ body: { action: 'cancel', id: row!.id, token: await rsvpToken('confirm', SITE, row!.id) } }))).rejects.toMatchObject({ statusCode: 404 })
    expect((await rsvpRow(id, 'links@x.test'))?.status).toBe('pending')
  })

  it('does not undo a cancellation when an old confirm link is pressed', async () => {
    const id = await seedEvent()
    await bookAndConfirm(id, 'undo@x.test')
    const row = await rsvpRow(id, 'undo@x.test')
    await (rsvpLink as Handler)(ev({ body: { action: 'cancel', id: row!.id, token: await rsvpToken('cancel', SITE, row!.id) } }))
    const again = await (rsvpLink as Handler)(ev({ body: { action: 'confirm', id: row!.id, token: await rsvpToken('confirm', SITE, row!.id) } })) as { status: string }
    expect(again.status).toBe('cancelled')
    expect((await rsvpRow(id, 'undo@x.test'))?.status).toBe('cancelled')
  })

  it('is not available for drafts, other content types, or other sites', async () => {
    const draft = await seedEvent({ status: 'draft' })
    await expect(state(draft)).rejects.toMatchObject({ statusCode: 404 })
    const post = await seedContentItem(getCurrentTestDb(), SITE, postType, { status: 'published', visibility: 'public', eventStartAt: inDays(1) })
    await expect(state(post)).rejects.toMatchObject({ statusCode: 404 })
    const foreign = await seedEvent({}, NO_MAIL, noMailEventType)
    await expect(state(foreign)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('follows the page\'s gate, and a translation uses its original\'s list', async () => {
    const members = await seedEvent({ visibility: 'members', settings: { access: 'members' } })
    await expect(state(members)).rejects.toMatchObject({ statusCode: 403 })

    const original = await seedEvent({ eventRsvpCapacity: 5 })
    const translation = await seedEvent({ sourceItemId: original, locale: 'es', eventStartAt: null, eventRsvpEnabled: null })
    await (rsvpPost as Handler)(ev({ params: { id: translation }, body: { name: 'Ana', email: 'ana@x.test' } }))
    expect((await rsvpRow(original, 'ana@x.test'))?.status).toBe('pending')
  })

  it('never exposes people on the public state route', async () => {
    const id = await seedEvent()
    await bookAndConfirm(id, 'secret@x.test')
    expect(JSON.stringify(await state(id))).not.toContain('secret')
  })

  describe('organiser', () => {
    it('is editors only', async () => {
      const id = await seedEvent()
      await expect((listRsvps as Handler)(ev({ userId: authorId, query: { event: id } }))).rejects.toMatchObject({ statusCode: 403 })
      await expect((listRsvps as Handler)(ev({ query: { event: id } }))).rejects.toMatchObject({ statusCode: 401 })
    })

    it('lists, counts and exports, with spreadsheet formulas made safe', async () => {
      const id = await seedEvent()
      await bookAndConfirm(id, 'list@x.test', 2)
      await (addRsvp as Handler)(ev({ userId: editorId, body: { event: id, name: '=HYPERLINK("x")', email: 'phone@x.test', seats: 1 } }))
      const res = await (listRsvps as Handler)(ev({ userId: editorId, query: { event: id } })) as { rsvps: unknown[]; counts: { confirmed: number } }
      expect(res.rsvps).toHaveLength(2)
      expect(res.counts.confirmed).toBe(3)
      const csv = await (listRsvps as Handler)(ev({ userId: editorId, query: { event: id, format: 'csv' } })) as string
      expect(csv).toContain('list@x.test')
      expect(csv).toContain('"\'=HYPERLINK(""x"")"')
      const audit = await getCurrentTestDb().query.auditLogs.findFirst({ where: and(eq(auditLogs.siteId, SITE), eq(auditLogs.resource, 'event_rsvp'), eq(auditLogs.action, 'export')) })
      expect(audit).toBeTruthy()
    })

    it('refuses adding the same address twice, but re-adds someone who cancelled', async () => {
      const id = await seedEvent()
      await (addRsvp as Handler)(ev({ userId: editorId, body: { event: id, name: 'P', email: 'twice-org@x.test' } }))
      await expect((addRsvp as Handler)(ev({ userId: editorId, body: { event: id, name: 'P', email: 'twice-org@x.test' } }))).rejects.toMatchObject({ statusCode: 409 })
      const row = await rsvpRow(id, 'twice-org@x.test')
      await (patchRsvp as Handler)(ev({ userId: editorId, params: { id: row!.id }, body: { status: 'cancelled' } }))
      await (addRsvp as Handler)(ev({ userId: editorId, body: { event: id, name: 'P', email: 'twice-org@x.test' } }))
      expect((await rsvpRow(id, 'twice-org@x.test'))?.status).toBe('confirmed')
    })

    it('emails someone moved or cancelled, and gives a freed place to the waitlist', async () => {
      const id = await seedEvent({ eventRsvpCapacity: 1 })
      await bookAndConfirm(id, 'in@x.test')
      await bookAndConfirm(id, 'wait@x.test')
      mockSend.mockClear()
      const row = await rsvpRow(id, 'in@x.test')
      await (patchRsvp as Handler)(ev({ userId: editorId, params: { id: row!.id }, body: { status: 'cancelled' } }))
      expect((await rsvpRow(id, 'wait@x.test'))?.status).toBe('confirmed')
      const subjects = mockSend.mock.calls.map(c => (c[1] as { subject: string }).subject)
      expect(subjects.some(s => s.includes('cancelled'))).toBe(true)
      expect(subjects.some(s => s.includes('A place opened up'))).toBe(true)
    })

    it('erases a person for good and frees their place', async () => {
      const id = await seedEvent({ eventRsvpCapacity: 1 })
      await bookAndConfirm(id, 'erase@x.test')
      await bookAndConfirm(id, 'next@x.test')
      const row = await rsvpRow(id, 'erase@x.test')
      await (deleteRsvp as Handler)(ev({ userId: editorId, params: { id: row!.id } }))
      expect(await rsvpRow(id, 'erase@x.test')).toBeUndefined()
      expect((await rsvpRow(id, 'next@x.test'))?.status).toBe('confirmed')
    })

    it('cannot reach another site\'s bookings', async () => {
      const id = await seedEvent({}, NO_MAIL, noMailEventType)
      await (rsvpPost as Handler)(ev({ siteId: NO_MAIL, params: { id }, body: { name: 'F', email: 'foreign@x.test' } }))
      const row = await rsvpRow(id, 'foreign@x.test')
      await expect((patchRsvp as Handler)(ev({ userId: editorId, params: { id: row!.id }, body: { status: 'cancelled' } }))).rejects.toMatchObject({ statusCode: 404 })
      await expect((deleteRsvp as Handler)(ev({ userId: editorId, params: { id: row!.id } }))).rejects.toMatchObject({ statusCode: 404 })
      await expect((listRsvps as Handler)(ev({ userId: editorId, query: { event: id } }))).rejects.toMatchObject({ statusCode: 404 })
    })

    it('lets people in off the waitlist when the capacity goes up', async () => {
      const id = await seedEvent({ eventRsvpCapacity: 1 })
      await bookAndConfirm(id, 'cap1@x.test')
      await bookAndConfirm(id, 'cap2@x.test')
      await (patchHandler as Handler)(ev({ userId: editorId, params: { id }, body: { eventRsvpCapacity: 2 } }))
      await vi.waitFor(async () => expect((await rsvpRow(id, 'cap2@x.test'))?.status).toBe('confirmed'))
    })
  })
})

describe('intake form before booking', () => {
  async function seedWaiver(status: 'active' | 'draft' = 'active') {
    const id = ulid()
    await getCurrentTestDb().insert(forms).values({
      id, siteId: SITE, name: 'Health waiver', slug: `waiver-${id.toLowerCase()}`, status,
      fields: [
        { id: 'w1', type: 'checkbox', label: 'Injuries', name: 'injuries', options: [{ label: 'Back', value: 'back' }, { label: 'None', value: 'none' }] },
        { id: 'w2', type: 'textarea', label: 'Tell us about the injury', name: 'injuryDetail', required: true, showIf: { field: 'injuries', op: 'equals', value: 'back' } },
        { id: 'w3', type: 'signature', label: 'Sign here', name: 'signature', required: true },
        { id: 'w4', type: 'file', label: 'Doctor\'s note', name: 'note', required: true },
      ] as never,
    })
    return id
  }
  const waiverRows = (formId: string) => getCurrentTestDb().select().from(formSubmissions).where(eq(formSubmissions.formId, formId))

  it('offers the form\'s questions, without file uploads', async () => {
    const formId = await seedWaiver()
    const id = await seedEvent({ settings: { intakeFormId: formId } })
    const state = await (rsvpGet as Handler)(ev({ params: { id } })) as { intake: { name: string; fields: Array<{ name: string }> } }
    expect(state.intake.name).toBe('Health waiver')
    expect(state.intake.fields.map(f => f.name)).toEqual(['injuries', 'injuryDetail', 'signature'])
  })

  it('refuses the booking until the shown questions are answered, and takes no place', async () => {
    const formId = await seedWaiver()
    const id = await seedEvent({ settings: { intakeFormId: formId } })
    const book = (intake: Record<string, unknown>) => (rsvpPost as Handler)(ev({ params: { id }, body: { name: 'Ann', email: 'ann-waiver@x.test', intake } }))
    await expect(book({ injuries: ['back'], signature: 'Ann' })).rejects.toMatchObject({ statusCode: 422 })
    expect(await rsvpRow(id, 'ann-waiver@x.test')).toBeUndefined()
    expect(await waiverRows(formId)).toHaveLength(0)
  })

  it('books and saves the answers as a submission of that form, labelled with the booking', async () => {
    const formId = await seedWaiver()
    const id = await seedEvent({ title: 'Yoga', settings: { intakeFormId: formId } })
    await (rsvpPost as Handler)(ev({ params: { id }, body: { name: 'Bo', email: 'bo-waiver@x.test', intake: { injuries: ['none'], injuryDetail: 'stale', signature: 'Bo' } } }))
    expect(await rsvpRow(id, 'bo-waiver@x.test')).toBeDefined()
    const [sub] = await waiverRows(formId)
    expect(sub!.data).toMatchObject({ injuries: ['none'], signature: 'Bo', 'Booked by': 'Bo <bo-waiver@x.test>' })
    expect(sub!.data).not.toHaveProperty('injuryDetail')
    expect(String(sub!.data.Booking)).toMatch(/^Yoga · /)
  })

  it('ignores a form that\'s no longer active', async () => {
    const formId = await seedWaiver('draft')
    const id = await seedEvent({ settings: { intakeFormId: formId } })
    const state = await (rsvpGet as Handler)(ev({ params: { id } })) as { intake: unknown }
    expect(state.intake).toBeNull()
    await (rsvpPost as Handler)(ev({ params: { id }, body: { name: 'Cy', email: 'cy-waiver@x.test' } }))
    expect(await rsvpRow(id, 'cy-waiver@x.test')).toBeDefined()
  })
})
