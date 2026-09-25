/**
 * Integration tests for smaller admin routes and middleware that previously had no
 * coverage: CSRF + redirects middleware, homepage status/reset, editorial calendar,
 * dashboard stats, content export, session bridge, and the membership admin lists.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedMedia, seedTier, seedSubscription } from '../helpers/seed'
import { contentItems, contentRevisions, redirects } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { mockPurge } = vi.hoisted(() => ({ mockPurge: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../server/utils/edge-cache', () => ({ purgeContentCache: mockPurge }))

const { default: csrfMiddleware } = await import('../../server/middleware/03.csrf')
const { default: redirectsMiddleware } = await import('../../server/middleware/05.redirects')
const { default: homepageHandler } = await import('../../server/api/v1/homepage.get')
const { default: homepageResetHandler } = await import('../../server/api/v1/homepage/reset.post')
const { default: calendarHandler } = await import('../../server/api/v1/content/calendar.get')
const { default: statsHandler } = await import('../../server/api/v1/stats.get')
const { default: exportHandler } = await import('../../server/api/v1/export/content.get')
const { default: sessionHandler } = await import('../../server/api/v1/auth/session.get')
const { default: tiersHandler } = await import('../../server/api/v1/memberships/index.get')
const { default: subscribersHandler } = await import('../../server/api/v1/memberships/subscribers.get')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-admin-misc-01'
const OTHER = 'site-admin-misc-02'
let adminId: string
let editorId: string
let viewerId: string
let pageType: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'misc.localhost' })
  await seedSite(db, { id: OTHER, domain: 'misc2.localhost' })
  adminId = await seedUser(db, { email: 'admin@misc.test', name: 'Admin' })
  editorId = await seedUser(db, { email: 'editor@misc.test' })
  viewerId = await seedUser(db, { email: 'viewer@misc.test' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, viewerId, SITE, 'viewer')
  pageType = await seedContentType(db, SITE, { slug: 'page' })
})
afterAll(teardownTestDb)

function ev(userId: string | null, opts: { siteId?: string; query?: Record<string, string>; path?: string; method?: string; headers?: Record<string, string> } = {}) {
  const e = createMockEvent({
    siteId: opts.siteId ?? SITE,
    session: userId ? { user: { id: userId, name: 'U', email: 'u@example.com' } } : null,
    query: opts.query,
    path: opts.path,
    method: opts.method,
    headers: opts.headers,
  }) as unknown as H3Event & { path: string; method: string }
  e.path = opts.path ?? '/'
  e.method = opts.method ?? 'GET'
  return e as unknown as H3Event
}

describe('03.csrf middleware', () => {
  const run = (o: Parameters<typeof ev>[1]) => (csrfMiddleware as (e: H3Event) => unknown)(ev(null, o))

  it('blocks a cookie-bearing cross-site POST to /api', () => {
    expect(() => run({ path: '/api/v1/users', method: 'POST', headers: { cookie: 's=1', 'sec-fetch-site': 'same-site', host: 'misc.localhost' } }))
      .toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('blocks a mismatched Origin when Sec-Fetch-Site is absent, and an opaque "null" origin', () => {
    expect(() => run({ path: '/api/x', method: 'DELETE', headers: { cookie: 's=1', origin: 'https://evil.test', host: 'misc.localhost' } }))
      .toThrow(expect.objectContaining({ statusCode: 403 }))
    expect(() => run({ path: '/api/x', method: 'PATCH', headers: { cookie: 's=1', origin: 'null', host: 'misc.localhost' } }))
      .toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('allows same-origin, cookieless (API key / webhook), safe-method, and non-/api requests', () => {
    expect(run({ path: '/api/x', method: 'POST', headers: { cookie: 's=1', 'sec-fetch-site': 'same-origin' } })).toBeUndefined()
    expect(run({ path: '/api/x', method: 'POST', headers: { origin: 'https://evil.test', host: 'misc.localhost' } })).toBeUndefined()
    expect(run({ path: '/api/x', method: 'GET', headers: { cookie: 's=1', 'sec-fetch-site': 'cross-site' } })).toBeUndefined()
    expect(run({ path: '/login', method: 'POST', headers: { cookie: 's=1', 'sec-fetch-site': 'cross-site' } })).toBeUndefined()
    expect(run({ path: '/api/x', method: 'POST', headers: { cookie: 's=1', origin: 'https://misc.localhost', host: 'misc.localhost' } })).toBeUndefined()
  })
})

describe('05.redirects middleware', () => {
  beforeAll(async () => {
    await getCurrentTestDb().insert(redirects).values([
      { id: ulid(), siteId: SITE, from: '/old', to: '/new', statusCode: 301 },
      { id: ulid(), siteId: SITE, from: '/api/v1/x', to: '/nope', statusCode: 302 },
    ])
  })

  it('redirects a matching public path with its configured status', async () => {
    const e = ev(null, { path: '/old' })
    await (redirectsMiddleware as Handler)(e)
    expect((e as unknown as { _redirect: unknown })._redirect).toEqual({ url: '/new', code: 301 })
  })

  it('never redirects /api, /admin, or /_ paths, or unmatched paths', async () => {
    for (const path of ['/api/v1/x', '/admin', '/_nuxflow/media/x', '/unmatched']) {
      const e = ev(null, { path })
      await (redirectsMiddleware as Handler)(e)
      expect((e as unknown as { _redirect?: unknown })._redirect, path).toBeUndefined()
    }
  })

  it('does not apply another site\'s redirects', async () => {
    const e = ev(null, { path: '/old', siteId: OTHER })
    await (redirectsMiddleware as Handler)(e)
    expect((e as unknown as { _redirect?: unknown })._redirect).toBeUndefined()
  })
})

describe('homepage', () => {
  let homeId: string
  beforeAll(async () => {
    homeId = await seedContentItem(getCurrentTestDb(), SITE, pageType, {
      slug: 'home', title: 'Home', content: { type: 'canvas', blocks: [{ id: 'b', type: 'canvas-hero', props: {} }] },
    })
  })

  it('reports whether the homepage has custom content (editor+)', async () => {
    await expect((homepageHandler as Handler)(ev(viewerId))).rejects.toMatchObject({ statusCode: 403 })
    expect(await (homepageHandler as Handler)(ev(editorId))).toMatchObject({ homepage: { id: homeId, hasCustomContent: true } })
  })

  it('reset is admin-only, snapshots a revision, clears content, and bumps the version', async () => {
    await expect((homepageResetHandler as Handler)(ev(editorId))).rejects.toMatchObject({ statusCode: 403 })

    const db = getCurrentTestDb()
    const before = await db.query.contentItems.findFirst({ where: eq(contentItems.id, homeId) })
    const res = await (homepageResetHandler as Handler)(ev(adminId)) as { version: number }

    const after = await db.query.contentItems.findFirst({ where: eq(contentItems.id, homeId) })
    expect(after?.content).toBeNull()
    expect(res.version).toBe(before!.version + 1)
    expect(after?.version).toBe(res.version)

    const rev = await db.query.contentRevisions.findFirst({ where: eq(contentRevisions.itemId, homeId) })
    expect(rev?.content).toEqual(before?.content)
    expect(mockPurge).toHaveBeenCalledWith(expect.anything(), { slugs: ['home'] })
    expect(await (homepageHandler as Handler)(ev(editorId))).toMatchObject({ homepage: { hasCustomContent: false } })
  })
})

describe('GET /api/v1/content/calendar', () => {
  it('places items on their event, scheduled, or published date within range', async () => {
    const db = getCurrentTestDb()
    await seedContentItem(db, SITE, pageType, { title: 'Pub', publishedAt: '2030-03-05T10:00:00.000Z' })
    await seedContentItem(db, SITE, pageType, { title: 'Sched', status: 'scheduled', scheduledAt: '2030-03-10T09:00:00.000Z', publishedAt: null })
    await seedContentItem(db, SITE, pageType, { title: 'Ev', publishedAt: '2029-01-01T00:00:00.000Z', eventStartAt: '2030-03-20T18:00:00.000Z' })
    await seedContentItem(db, SITE, pageType, { title: 'Outside', publishedAt: '2030-05-01T00:00:00.000Z' })

    const res = await (calendarHandler as Handler)(ev(viewerId, { query: { from: '2030-03-01', to: '2030-03-31' } })) as { items: { title: string; calendarDate: string; type: { slug: string } | null }[] }
    const byTitle = Object.fromEntries(res.items.map(i => [i.title, i]))
    expect(Object.keys(byTitle).sort()).toEqual(['Ev', 'Pub', 'Sched'])
    expect(byTitle.Pub.calendarDate).toBe('2030-03-05')
    expect(byTitle.Sched.calendarDate).toBe('2030-03-10')
    expect(byTitle.Ev.calendarDate).toBe('2030-03-20')
    expect(byTitle.Pub.type?.slug).toBe('page')
  })

  it('validates the date format and requires a role on the site', async () => {
    await expect((calendarHandler as Handler)(ev(viewerId, { query: { from: '2030-3-1', to: '2030-03-31' } }))).rejects.toMatchObject({ statusCode: 422 })
    const stranger = await seedUser(getCurrentTestDb(), { email: 'stranger@misc.test' })
    await expect((calendarHandler as Handler)(ev(stranger, { query: { from: '2030-03-01', to: '2030-03-31' } }))).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('GET /api/v1/stats', () => {
  it('counts only this site\'s published pages, media, and members', async () => {
    const db = getCurrentTestDb()
    const otherType = await seedContentType(db, OTHER, { slug: 'page' })
    await seedContentItem(db, OTHER, otherType)
    await seedMedia(db, SITE)
    await seedMedia(db, OTHER)

    const res = await (statsHandler as Handler)(ev(viewerId)) as Record<string, number>
    const published = (await db.select().from(contentItems)).filter(i => i.siteId === SITE && i.status === 'published').length
    expect(res).toEqual({ publishedPages: published, mediaFiles: 1, newSubmissions: 0, users: 3 })
  })
})

describe('GET /api/v1/export/content', () => {
  it('is admin-only', async () => {
    await expect((exportHandler as Handler)(ev(editorId))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('exports JSON of this site\'s items only', async () => {
    const e = ev(adminId)
    const items = JSON.parse(await (exportHandler as Handler)(e) as string) as { siteId: string }[]
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(i => i.siteId === SITE)).toBe(true)
    expect((e as unknown as { _responseHeaders: Record<string, string> })._responseHeaders['Content-Disposition']).toContain('content-export.json')
  })

  it('exports RFC 4180 CSV with doubled quotes and neutralised formulas', async () => {
    const db = getCurrentTestDb()
    await seedContentItem(db, SITE, pageType, { title: 'Say "hi", world', slug: 'quoted' })
    await seedContentItem(db, SITE, pageType, { title: '=HYPERLINK("https://evil.test","x")', slug: 'formula' })

    const csv = await (exportHandler as Handler)(ev(adminId, { query: { format: 'csv' } })) as string
    const lines = csv.split('\n')
    expect(lines[0]).toBe('id,title,slug,status,publishedAt,updatedAt')
    expect(csv).toContain('"Say ""hi"", world","quoted"')
    expect(csv).not.toContain('\\"')
    expect(csv).toContain('"\'=HYPERLINK(""https://evil.test"",""x"")"')
  })
})

describe('GET /api/v1/auth/session', () => {
  it('returns the session user, or null', async () => {
    expect(await (sessionHandler as Handler)(ev(null))).toEqual({ user: null })
    expect(await (sessionHandler as Handler)(ev(editorId))).toMatchObject({ user: { id: editorId } })
  })
})

describe('membership admin lists', () => {
  it('lists every tier (including inactive) cheapest first, admin-only', async () => {
    const db = getCurrentTestDb()
    await seedTier(db, SITE, { name: 'Pro', price: 900 })
    await seedTier(db, SITE, { name: 'Legacy', price: 100, isActive: false })
    await seedTier(db, OTHER, { name: 'Foreign', price: 1 })
    await expect((tiersHandler as Handler)(ev(editorId))).rejects.toMatchObject({ statusCode: 403 })
    const res = await (tiersHandler as Handler)(ev(adminId)) as { tiers: { name: string }[] }
    expect(res.tiers.map(t => t.name)).toEqual(['Legacy', 'Pro'])
  })

  it('lists this site\'s subscribers with user and tier details, paginated', async () => {
    const db = getCurrentTestDb()
    const tier = await seedTier(db, SITE, { name: 'Gold', price: 2000 })
    const foreignTier = await seedTier(db, OTHER, { name: 'F', price: 1 })
    await seedSubscription(db, SITE, editorId, tier)
    await seedSubscription(db, SITE, viewerId, tier)
    await seedSubscription(db, OTHER, editorId, foreignTier)

    await expect((subscribersHandler as Handler)(ev(editorId))).rejects.toMatchObject({ statusCode: 403 })
    const res = await (subscribersHandler as Handler)(ev(adminId, { query: { limit: '1' } })) as { subscribers: { tierName: string; userEmail: string }[]; total: number }
    expect(res.total).toBe(2)
    expect(res.subscribers).toHaveLength(1)
    expect(res.subscribers[0].tierName).toBe('Gold')
    expect(res.subscribers[0].userEmail).toMatch(/@misc\.test$/)
  })
})
