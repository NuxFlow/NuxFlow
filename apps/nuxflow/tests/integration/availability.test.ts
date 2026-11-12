/**
 * Holiday-let availability: following a booking site's calendar, nights blocked by hand, the
 * public calendar's merged nights, the export file (own blocks only, signed link) and the
 * hourly sync, which keeps a calendar's old nights when a fetch fails.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import { availabilityBlocks, availabilityFeeds } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import { addIsoDays } from '../../shared/lib/ical-import'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))

// The calendar "on Airbnb": whatever the test puts here, or a failure.
let remote: { status: number; body: string } | Error = { status: 200, body: '' }
const safeFetchMock = vi.fn(async () => {
  if (remote instanceof Error) throw remote
  return new Response(remote.body, { status: remote.status })
})
vi.mock('../../server/utils/ssrf', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  safeFetch: (...args: unknown[]) => safeFetchMock(...(args as [])),
}))

const { default: getRoute } = await import('../../server/routes/_nuxflow/availability.get')
const { default: postRoute } = await import('../../server/routes/_nuxflow/availability.post')
const { default: icsRoute } = await import('../../server/routes/_nuxflow/availability-ics/[id]')
const { syncDueFeeds } = await import('../../server/utils/availability')

const SITE = 'site-availability-01'
const OTHER = 'site-availability-02'
let editorId: string
let authorId: string
let itemId: string
const today = new Date().toISOString().slice(0, 10)
const d = (n: number) => addIsoDays(today, n)
const ics = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n')
const stay = (start: string, end: string, extra = '') => `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${start.replace(/-/g, '')}\r\nDTEND;VALUE=DATE:${end.replace(/-/g, '')}\r\nSUMMARY:Reserved\r\n${extra}END:VEVENT`

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'lets.localhost' })
  await seedSite(db, { id: OTHER, domain: 'other.localhost' })
  editorId = await seedUser(db, { email: 'editor@lets.test' })
  authorId = await seedUser(db, { email: 'author@lets.test' })
  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')
  const type = await seedContentType(db, SITE, { slug: 'page', name: 'Page' })
  itemId = await seedContentItem(db, SITE, type, { slug: 'the-cottage', title: 'The Cottage' })
})
afterAll(teardownTestDb)

type Handler = (e: H3Event) => Promise<unknown>
const as = (userId: string, body?: Record<string, unknown>, query?: Record<string, string>) => createMockEvent({
  siteId: SITE,
  session: { user: { id: userId, name: 'U', email: 'u@lets.test' } },
  method: body ? 'POST' : 'GET',
  headers: { 'sec-fetch-site': 'same-origin', 'host': 'lets.localhost' },
  body,
  query,
}) as unknown as H3Event
const post = (body: Record<string, unknown>, userId = editorId) => (postRoute as Handler)(as(userId, { item: itemId, ...body }))
const panel = () => (getRoute as Handler)(as(editorId, undefined, { item: itemId })) as Promise<{ feeds: Array<{ id: string; lastError: string | null; eventCount: number }>; blocks: Array<{ id: string }>; exportUrl: string }>
const publicNights = (path = 'the-cottage', siteId = SITE) => (getRoute as Handler)(createMockEvent({ siteId, query: { path } }) as unknown as H3Event) as Promise<{ today: string; booked: Array<{ start: string; end: string }> }>

describe('availability', () => {
  it('follows a booking site calendar and shows its nights, cancelled ones left out', async () => {
    remote = { status: 200, body: ics(stay(d(3), d(6)), stay(d(10), d(12), 'STATUS:CANCELLED\r\n'), stay(d(-30), d(-25))) }
    const res = await post({ action: 'add-feed', url: 'webcal://www.airbnb.example/calendar/ical/1.ics', label: 'Airbnb' }) as { feed: { ok: boolean; eventCount: number } }
    expect(res.feed).toMatchObject({ ok: true, eventCount: 1 })
    expect(safeFetchMock).toHaveBeenCalledWith('https://www.airbnb.example/calendar/ical/1.ics', expect.anything())
    expect((await publicNights()).booked).toEqual([{ start: d(3), end: d(6) }])
  })

  it('refuses a link that is not https, or one already followed', async () => {
    await expect(post({ action: 'add-feed', url: 'http://127.0.0.1/cal.ics' })).rejects.toMatchObject({ statusCode: 422 })
    await expect(post({ action: 'add-feed', url: 'https://www.airbnb.example/calendar/ical/1.ics' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('merges own blocked dates with the booking site nights for visitors', async () => {
    await post({ action: 'add-block', start: d(6), end: d(8), note: 'Family staying' })
    await post({ action: 'add-block', start: d(20), end: d(21) })
    const { booked } = await publicNights()
    expect(booked).toEqual([{ start: d(3), end: d(8) }, { start: d(20), end: d(21) }])
    // Visitors never see notes or where a night came from.
    expect(JSON.stringify(booked)).not.toContain('Family')
  })

  it('refuses a leaving day that is not after the first night', async () => {
    await expect(post({ action: 'add-block', start: d(5), end: d(5) })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('exports only the own blocks, behind a signed link', async () => {
    const { exportUrl } = await panel()
    const url = new URL(exportUrl)
    const id = url.pathname.split('/').pop()!
    const event = (token: string) => createMockEvent({ siteId: SITE, params: { id }, query: { token } }) as unknown as H3Event
    const text = await (icsRoute as Handler)(event(url.searchParams.get('token')!)) as string
    expect(text).toContain(`DTSTART;VALUE=DATE:${d(6).replace(/-/g, '')}`)
    expect(text).toContain(`DTEND;VALUE=DATE:${d(8).replace(/-/g, '')}`)
    expect(text).toContain('SUMMARY:Family staying')
    // The Airbnb stay is not sent back out.
    expect(text).not.toContain(d(3).replace(/-/g, ''))
    await expect((icsRoute as Handler)(event('0'.repeat(64)))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('keeps the old nights when a sync fails, and says why', async () => {
    remote = { status: 503, body: 'down' }
    const res = await post({ action: 'sync' }) as { feeds: Array<{ ok: boolean; error: string }> }
    expect(res.feeds[0]).toMatchObject({ ok: false })
    expect(res.feeds[0]!.error).toContain('503')
    expect((await publicNights()).booked[0]).toEqual({ start: d(3), end: d(8) })
    expect((await panel()).feeds[0]!.lastError).toContain('503')
  })

  it('replaces a calendar nights on the hourly sync once it is due', async () => {
    const db = getCurrentTestDb()
    await db.update(availabilityFeeds).set({ lastSyncedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() }).where(eq(availabilityFeeds.siteId, SITE))
    remote = { status: 200, body: ics(stay(d(30), d(33))) }
    expect(await syncDueFeeds(db)).toEqual({ synced: 1, failed: 0 })
    expect((await publicNights()).booked).toEqual([{ start: d(6), end: d(8) }, { start: d(20), end: d(21) }, { start: d(30), end: d(33) }])
    // Synced just now: the next run leaves it alone.
    expect(await syncDueFeeds(db)).toEqual({ synced: 0, failed: 0 })
  })

  it('only lets editors change it, and only from this site', async () => {
    await expect(post({ action: 'add-block', start: d(40), end: d(41) }, authorId)).rejects.toMatchObject({ statusCode: 403 })
    const cross = createMockEvent({
      siteId: SITE,
      session: { user: { id: editorId, name: 'U', email: 'u@lets.test' } },
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
      body: { action: 'add-block', item: itemId, start: d(40), end: d(41) },
    }) as unknown as H3Event
    await expect((postRoute as Handler)(cross)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('does not show another site the page, and removing the calendar frees its nights', async () => {
    await expect(publicNights('the-cottage', OTHER)).rejects.toMatchObject({ statusCode: 404 })
    const [feed] = (await panel()).feeds
    await post({ action: 'remove-feed', id: feed!.id })
    const rows = await getCurrentTestDb().select().from(availabilityBlocks).where(and(eq(availabilityBlocks.siteId, SITE), isNull(availabilityBlocks.feedId)))
    expect((await publicNights()).booked).toHaveLength(rows.length)
  })
})
