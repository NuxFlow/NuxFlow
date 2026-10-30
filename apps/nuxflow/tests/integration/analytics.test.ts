/**
 * Visitor analytics: the page-view beacon (POST /_nuxflow/view), the per-site report
 * (GET /api/v1/analytics, reading Cloudflare's Analytics Engine SQL API — mocked here),
 * and the operator's credentials on Super Admin → Platform.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { siteSettings } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: viewHandler } = await import('../../server/routes/_nuxflow/view.post')
const { default: analyticsHandler } = await import('../../server/api/v1/analytics/index.get')
const { default: platformGet } = await import('../../server/api/v1/admin/platform/index.get')
const { default: platformPut } = await import('../../server/api/v1/admin/platform/index.put')
const { clearAnalyticsCache } = await import('../../server/utils/analytics')
const { resolveSetting } = await import('../../server/utils/settings')

type Handler = (e: H3Event) => Promise<unknown>

const PRIMARY = 'site-analytics-main'
const TENANT = 'site-analytics-tenant'
const ACCOUNT_ID = 'a'.repeat(32)
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
let operatorId: string
let editorId: string
let authorId: string

function withAe(event: ReturnType<typeof createMockEvent>, ae: unknown) {
  (event.context as Record<string, unknown>).cloudflare = { env: { AE: ae }, context: { waitUntil: () => {} } }
  return event as unknown as H3Event
}

// As a browser sends it: navigator.sendBeacon() posts the JSON string as text/plain, which
// h3's readBody() returns unparsed — so the route must read and parse the raw text.
function beacon(body: unknown, opts: { headers?: Record<string, string>; siteId?: string; ae?: unknown } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const event = withAe(createMockEvent({
    siteId: opts.siteId ?? TENANT,
    method: 'POST',
    body: text,
    headers: { 'user-agent': CHROME, 'content-type': 'text/plain;charset=UTF-8', 'sec-fetch-site': 'same-origin', 'cf-ipcountry': 'gb', 'host': 'tenant.localhost', 'cf-connecting-ip': '203.0.113.9', ...opts.headers },
  }), opts.ae ?? null)
  ;(event as unknown as { _rawBody: string })._rawBody = text
  return event
}

function asUser(userId: string, opts: { siteId?: string; query?: Record<string, string>; body?: unknown; ae?: unknown } = {}) {
  return withAe(createMockEvent({
    siteId: opts.siteId ?? TENANT,
    session: { user: { id: userId, name: 'U', email: 'u@example.com' } },
    query: opts.query,
    body: opts.body,
  }), 'ae' in opts ? opts.ae : { writeDataPoint: vi.fn() })
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'main.localhost', isPrimary: true })
  await seedSite(db, { id: TENANT, domain: 'tenant.localhost' })
  operatorId = await seedUser(db, { email: 'operator@analytics.test' })
  editorId = await seedUser(db, { email: 'editor@analytics.test' })
  authorId = await seedUser(db, { email: 'author@analytics.test' })
  await seedRole(db, operatorId, PRIMARY, 'super_admin')
  await seedRole(db, editorId, TENANT, 'editor')
  await seedRole(db, authorId, TENANT, 'author')
})
afterAll(teardownTestDb)

describe('POST /_nuxflow/view', () => {
  it('records one data point: page, country, referring host and device, indexed by site', async () => {
    const ae = { writeDataPoint: vi.fn() }
    const event = beacon({ path: '/blog/hello/?utm_source=x', referrer: 'https://www.google.com/search?q=secret' }, { ae })
    await (viewHandler as Handler)(event)

    expect(ae.writeDataPoint).toHaveBeenCalledWith({
      blobs: ['view', '/blog/hello', 'GB', 'google.com', 'desktop'],
      doubles: [1],
      indexes: [TENANT],
    })
    expect((event as unknown as { _status: number })._status).toBe(204)
  })

  it('ignores beacons from other sites, bots, non-public pages and junk', async () => {
    const ae = { writeDataPoint: vi.fn() }
    await (viewHandler as Handler)(beacon({ path: '/' }, { ae, headers: { 'sec-fetch-site': 'cross-site' } }))
    await (viewHandler as Handler)(beacon({ path: '/' }, { ae, headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } }))
    await (viewHandler as Handler)(beacon({ path: '/admin/content' }, { ae }))
    await (viewHandler as Handler)(beacon({ path: '//evil.example' }, { ae }))
    await (viewHandler as Handler)(beacon('not json', { ae }))
    expect(ae.writeDataPoint).not.toHaveBeenCalled()
  })

  it('is a quiet no-op when analytics aren\'t switched on (no AE binding)', async () => {
    const event = beacon({ path: '/' })
    await expect((viewHandler as Handler)(event)).resolves.toBeNull()
  })

  it('stops counting one visitor after 60 views a minute', async () => {
    const ae = { writeDataPoint: vi.fn() }
    for (let i = 0; i < 65; i++) {
      await (viewHandler as Handler)(beacon({ path: `/p${i}` }, { ae, headers: { 'cf-connecting-ip': '198.51.100.7' } }))
    }
    expect(ae.writeDataPoint).toHaveBeenCalledTimes(60)
  })
})

describe('GET /api/v1/analytics', () => {
  const realFetch = globalThis.fetch
  let sqlSent: string[] = []
  let apiStatus = 200

  beforeEach(() => {
    clearAnalyticsCache()
    sqlSent = []
    apiStatus = 200
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer cf-token')
      const sql = String(init?.body)
      sqlSent.push(sql)
      if (apiStatus !== 200) return new Response('{"errors":[{"message":"Authentication error"}]}', { status: apiStatus })
      const today = new Date().toISOString().slice(0, 10)
      const data = sql.includes('AS day')
        ? [{ day: `${today} 00:00:00`, views: '12' }]
        : sql.includes('blob2 AS key')
          ? [{ key: '/blog/hello', views: 9 }, { key: '/', views: 3 }]
          : sql.includes('blob3 AS key')
            ? [{ key: 'GB', views: 12 }]
            : sql.includes('blob4 AS key')
              ? [{ key: '', views: 7 }, { key: 'google.com', views: 5 }]
              : sql.includes('blob5 AS key')
                ? [{ key: 'mobile', views: 8 }, { key: 'desktop', views: 4 }]
                : sql.includes('timestamp <')
                  ? [{ views: 6 }]
                  : [{ views: 12 }]
      return new Response(JSON.stringify({ meta: [], data, rows: data.length }), { status: 200 })
    }) as typeof fetch
  })
  afterEach(() => { globalThis.fetch = realFetch })

  it('is for editors and up', async () => {
    await expect((analyticsHandler as Handler)(asUser(authorId))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('says what\'s missing before the operator has added a token', async () => {
    expect(await (analyticsHandler as Handler)(asUser(editorId))).toEqual({ recording: true, readable: false, report: null, error: null })
    expect(await (analyticsHandler as Handler)(asUser(editorId, { ae: null }))).toMatchObject({ recording: false, readable: false })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('the operator saves the token and account ID on Super Admin → Platform', async () => {
    await (platformPut as Handler)(asUser(operatorId, { siteId: PRIMARY, body: { analyticsApiToken: 'cf-token', cloudflareAccountId: ACCOUNT_ID.toUpperCase() } }))

    const stored = await getCurrentTestDb().query.siteSettings.findFirst({
      where: and(eq(siteSettings.siteId, PRIMARY), eq(siteSettings.key, 'analytics.cf_api_token')),
    })
    expect(String(stored?.value)).not.toContain('cf-token')
    expect(await resolveSetting(asUser(operatorId, { siteId: PRIMARY }), 'analytics.cf_api_token')).toBe('cf-token')
    expect(await (platformGet as Handler)(asUser(operatorId, { siteId: PRIMARY }))).toMatchObject({
      analytics: { recording: true, dataset: 'nuxflow_analytics', tokenSet: true, accountId: ACCOUNT_ID },
      // Deployed without the release scripts (no NUXT_BUILD_* vars).
      build: { commit: null, release: null, pool: null },
    })
  })

  it('a tenant site\'s report reads only that site\'s views, with the operator\'s credentials', async () => {
    const res = await (analyticsHandler as Handler)(asUser(editorId, { query: { days: '7' } })) as { report: Record<string, unknown>; readable: boolean }

    expect(res.readable).toBe(true)
    expect(sqlSent).toHaveLength(7)
    for (const sql of sqlSent) expect(sql).toContain(`index1 = '${TENANT}'`)
    expect(res.report).toMatchObject({
      days: 7,
      views: 12,
      previousViews: 6,
      pages: [{ path: '/blog/hello', views: 9 }, { path: '/', views: 3 }],
      countries: [{ code: 'GB', views: 12 }],
      referrers: [{ host: '', views: 7 }, { host: 'google.com', views: 5 }],
      devices: [{ device: 'mobile', views: 8 }, { device: 'desktop', views: 4 }],
    })
    const series = res.report.series as { day: string; views: number }[]
    expect(series).toHaveLength(7)
    expect(series.at(-1)).toEqual({ day: new Date().toISOString().slice(0, 10), views: 12 })
    expect(series[0]!.views).toBe(0)
  })

  it('rejects ranges other than 7, 30 and 90 days', async () => {
    await expect((analyticsHandler as Handler)(asUser(editorId, { query: { days: '365' } }))).rejects.toMatchObject({ statusCode: expect.any(Number) })
  })

  it('explains a token Cloudflare refuses instead of failing the page', async () => {
    apiStatus = 403
    const res = await (analyticsHandler as Handler)(asUser(editorId, { query: { days: '30' } })) as { report: unknown; error: string }
    expect(res.report).toBeNull()
    expect(res.error).toMatch(/Account Analytics → Read/)
  })

  it('only a super admin can change the credentials', async () => {
    await expect((platformPut as Handler)(asUser(editorId, { body: { analyticsApiToken: 'x' } }))).rejects.toMatchObject({ statusCode: 403 })
  })
})
