/**
 * Per-site usage counting (server/utils/usage.ts): the buffered counter and its flush, the
 * request middleware (views/API), the render hook, AI-call counting through the wrapped
 * model, email counting, the nightly snapshot, retention, and the Super Admin → Usage API.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { generateText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { dynamicPlugins, siteUsageDaily } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedMedia, seedSetting } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

globalThis.defineNitroPlugin = ((fn: unknown) => fn) as never

const { countUsage, flushUsage, pendingUsage, resetUsageBuffer, usageDay } = await import('../../server/utils/usage')
const { default: usageMiddleware } = await import('../../server/middleware/05.usage')
const { default: usagePlugin } = await import('../../server/plugins/usage')
const { withUsageCounting } = await import('../../server/utils/ai-sdk')
const { sendEmailWithConfig } = await import('../../server/utils/email')
const { snapshotUsage } = await import('../../server/scheduled/usage-snapshot')
const { pruneOldData } = await import('../../server/scheduled/prune-old-data')
const { default: usageIndex } = await import('../../server/api/v1/admin/usage/index.get')
const { default: usageSite } = await import('../../server/api/v1/admin/usage/[siteId].get')

type Handler = (e: H3Event) => unknown

const A = 'site-usage-a'
const B = 'site-usage-b'
let operatorId: string
let adminId: string

function ev(opts: Parameters<typeof createMockEvent>[0] = {}): H3Event {
  const e = createMockEvent(opts) as unknown as H3Event & { method: string }
  e.method = opts.method ?? 'GET'
  return e
}

async function usageRow(siteId: string, metric: string, day = usageDay()) {
  const [row] = await getCurrentTestDb().select().from(siteUsageDaily)
    .where(and(eq(siteUsageDaily.siteId, siteId), eq(siteUsageDaily.day, day), eq(siteUsageDaily.metric, metric)))
  return row?.value
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: A, domain: 'a.usage.test', isPrimary: true })
  await seedSite(db, { id: B, domain: 'b.usage.test' })
  operatorId = await seedUser(db, { email: 'operator@usage.test' })
  adminId = await seedUser(db, { email: 'admin@usage.test' })
  await seedRole(db, operatorId, A, 'super_admin')
  await seedRole(db, adminId, B, 'admin')
  // Super Admin → Usage only exists on a hosting platform (hosting-platform.ts).
  await seedSetting(db, A, 'platform.hosting_enabled', 'true')
})

afterAll(async () => {
  await teardownTestDb()
})

beforeEach(async () => {
  resetUsageBuffer()
  await getCurrentTestDb().delete(siteUsageDaily)
})

describe('countUsage and flushUsage', () => {
  it('writes the first count in a fresh isolate straight away, then buffers', async () => {
    countUsage(ev({ siteId: A }), 'views')
    await vi.waitFor(async () => expect(await usageRow(A, 'views')).toBe(1))

    countUsage(ev({ siteId: A }), 'views')
    countUsage(ev({ siteId: A }), 'views', 2)
    countUsage(ev({ siteId: B }), 'api')
    expect(pendingUsage()).toEqual(expect.arrayContaining([
      expect.objectContaining({ siteId: A, metric: 'views', value: 3 }),
      expect.objectContaining({ siteId: B, metric: 'api', value: 1 }),
    ]))
    expect(await usageRow(A, 'views')).toBe(1)
  })

  it('adds to an existing row and splits large batches across statements', async () => {
    const day = usageDay()
    await flushUsage(getCurrentTestDb(), [{ siteId: A, day, metric: 'api', value: 5 }])
    await flushUsage(getCurrentTestDb(), [
      { siteId: A, day, metric: 'api', value: 7 },
      ...Array.from({ length: 30 }, (_, i) => ({ siteId: B, day: `2026-01-${String(i + 1).padStart(2, '0')}`, metric: 'views', value: i })),
    ])
    expect(await usageRow(A, 'api')).toBe(12)
    expect(await usageRow(B, 'views', '2026-01-30')).toBe(29)
  })

  it('ignores a request with no site and never throws', () => {
    countUsage(ev({ siteId: '' }), 'views')
    expect(pendingUsage()).toEqual([])
    // A broken event (no context at all) must not fail the request being counted.
    expect(() => countUsage({} as H3Event, 'views', 1, A)).not.toThrow()
  })
})

describe('request counting', () => {
  // Fills the first-write slot so later counts stay in the buffer, where they're easy to read.
  beforeEach(() => countUsage(ev({ siteId: B }), 'renders'))

  const pendingFor = (metric: string) => pendingUsage().find(p => p.siteId === A && p.metric === metric)?.value ?? 0

  it('counts public page views and API requests', () => {
    ;(usageMiddleware as Handler)(ev({ siteId: A, path: '/about' }))
    ;(usageMiddleware as Handler)(ev({ siteId: A, path: '/' }))
    ;(usageMiddleware as Handler)(ev({ siteId: A, path: '/api/public/pages/about' }))
    ;(usageMiddleware as Handler)(ev({ siteId: A, path: '/api/v1/content', method: 'POST' }))
    expect(pendingFor('views')).toBe(2)
    expect(pendingFor('api')).toBe(2)
  })

  it('does not count admin pages, files, feeds or POSTs as views', () => {
    for (const path of ['/admin/content', '/favicon.ico', '/sitemap.xml', '/_nuxflow/media/x', '/feed.xml']) {
      ;(usageMiddleware as Handler)(ev({ siteId: A, path }))
    }
    ;(usageMiddleware as Handler)(ev({ siteId: A, path: '/contact', method: 'POST' }))
    expect(pendingFor('views')).toBe(0)
  })

  it('does not count the accounts origin', () => {
    const e = ev({ siteId: A, path: '/login' })
    e.context.isAccountsHost = true
    ;(usageMiddleware as Handler)(e)
    expect(pendingFor('views')).toBe(0)
  })

  it('counts every server render', () => {
    let hook: ((response: unknown, ctx: { event: H3Event }) => void) | undefined
    ;(usagePlugin as unknown as (n: unknown) => void)({ hooks: { hook: (name: string, fn: typeof hook) => { if (name === 'render:response') hook = fn } } })
    hook!({}, { event: ev({ siteId: A }) })
    hook!({}, { event: ev({ siteId: A }) })
    expect(pendingFor('renders')).toBe(2)
  })
})

describe('AI and email counting', () => {
  beforeEach(() => countUsage(ev({ siteId: B }), 'renders'))
  const pendingFor = (metric: string) => pendingUsage().find(p => p.siteId === A && p.metric === metric)?.value ?? 0

  it('counts each call made with a model from getAiSdkModel()', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'hi' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        warnings: [],
      }),
    })
    const counted = withUsageCounting(ev({ siteId: A }), { model, payer: 'platform', heavy: false })
    await generateText({ model: counted, prompt: 'one' })
    await generateText({ model: counted, prompt: 'two' })
    expect(pendingFor('ai_calls')).toBe(2)
    expect(pendingFor('ai_credits')).toBe(2)
  })

  it('counts emails a provider accepted, per recipient — not console sends or failures', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }))
    try {
      const resend = { siteId: A, emailProvider: 'resend', resendApiKey: 're_test', emailFrom: 'site@a.usage.test' }
      await sendEmailWithConfig(resend as never, { to: ['x@t.test', 'y@t.test'], subject: 'Hi', text: 'Hi' }, ev({ siteId: A }))
      await sendEmailWithConfig({ ...resend, emailProvider: 'console' } as never, { to: 'z@t.test', subject: 'Hi', text: 'Hi' }, ev({ siteId: A }))
      fetchSpy.mockResolvedValue(new Response('nope', { status: 500 }))
      await sendEmailWithConfig(resend as never, { to: 'w@t.test', subject: 'Hi', text: 'Hi' }, ev({ siteId: A })).catch(() => {})
    } finally {
      fetchSpy.mockRestore()
    }
    expect(pendingFor('emails')).toBe(2)
  })
})

describe('nightly snapshot', () => {
  it('records totals for every site, zeros included, and replaces rather than adds', async () => {
    const db = getCurrentTestDb()
    const typeId = await seedContentType(db, A, { slug: 'page' })
    await seedContentItem(db, A, typeId, { slug: 'one' })
    await seedContentItem(db, A, typeId, { slug: 'two' })
    await seedMedia(db, A, { size: 1000 })
    await seedMedia(db, A, { size: 500 })
    const member = await seedUser(db, { email: 'member@usage.test' })
    await seedRole(db, member, A, 'member')
    await db.insert(dynamicPlugins).values({ id: 'p1', siteId: A, name: 'P', version: '1.0.0', publisherKey: 'k', checksum: 'c', signature: 's' } as never)

    await snapshotUsage()
    await snapshotUsage()

    expect(await usageRow(A, 'content_items')).toBe(2)
    expect(await usageRow(A, 'storage_bytes')).toBe(1500)
    expect(await usageRow(A, 'team_members')).toBe(0) // the operator's super admin doesn't count
    expect(await usageRow(A, 'site_members')).toBe(1)
    expect(await usageRow(A, 'plugins')).toBe(1)
    expect(await usageRow(B, 'content_items')).toBe(0)
    expect(await usageRow(B, 'team_members')).toBe(1)
  })
})

describe('retention', () => {
  it('prunes usage rows older than 400 days', async () => {
    const day = (daysAgo: number) => usageDay(new Date(Date.now() - daysAgo * 86_400_000))
    await flushUsage(getCurrentTestDb(), [
      { siteId: A, day: day(401), metric: 'views', value: 1 },
      { siteId: A, day: day(399), metric: 'views', value: 1 },
    ])
    await pruneOldData()
    expect(await usageRow(A, 'views', day(401))).toBeUndefined()
    expect(await usageRow(A, 'views', day(399))).toBe(1)
  })
})

describe('Super Admin → Usage API', () => {
  const asOperator = (opts: Parameters<typeof createMockEvent>[0] = {}) =>
    ev({ siteId: A, session: { user: { id: operatorId, name: 'Op', email: 'operator@usage.test' } }, ...opts })

  it('is only for a super admin', async () => {
    const session = { user: { id: adminId, name: 'Ad', email: 'admin@usage.test' } }
    await expect(Promise.resolve((usageIndex as Handler)(ev({ siteId: B, session })))).rejects.toMatchObject({ statusCode: 403 })
    await expect(Promise.resolve((usageSite as Handler)(ev({ siteId: B, session, params: { siteId: B } })))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('sums a month of events and takes the latest totals, for every site', async () => {
    const db = getCurrentTestDb()
    await flushUsage(db, [
      { siteId: A, day: '2026-09-30', metric: 'views', value: 100 }, // previous month
      { siteId: A, day: '2026-10-01', metric: 'views', value: 10 },
      { siteId: A, day: '2026-10-31', metric: 'views', value: 5 },
      { siteId: A, day: '2026-10-02', metric: 'ai_calls', value: 3 },
      { siteId: A, day: '2026-11-01', metric: 'views', value: 1000 }, // next month
      { siteId: A, day: '2026-09-28', metric: 'storage_bytes', value: 900 },
      { siteId: A, day: '2026-10-20', metric: 'storage_bytes', value: 1200 },
    ])

    const res = await (usageIndex as Handler)(asOperator({ query: { month: '2026-10' } })) as {
      from: string, to: string, sites: { id: string, usage: Record<string, number>, snapshotDay: string | null }[]
    }
    expect(res.from).toBe('2026-10-01')
    expect(res.to).toBe('2026-10-31')
    const a = res.sites.find(s => s.id === A)!
    expect(a.usage).toMatchObject({ views: 15, ai_calls: 3, storage_bytes: 1200, renders: 0 })
    expect(a.snapshotDay).toBe('2026-10-20')
    const b = res.sites.find(s => s.id === B)!
    expect(b.usage.views).toBe(0)
    expect(b.snapshotDay).toBeNull()

    // A month with no snapshot of its own starts from the last one before it.
    const nov = await (usageIndex as Handler)(asOperator({ query: { month: '2026-11' } })) as typeof res
    expect(nov.sites.find(s => s.id === A)!.usage).toMatchObject({ views: 1000, storage_bytes: 1200 })
  })

  it('rejects a malformed month', async () => {
    await expect(Promise.resolve((usageIndex as Handler)(asOperator({ query: { month: '2026-13' } })))).rejects.toMatchObject({ statusCode: 422 })
  })

  it("returns one site's daily series, with gaps as 0 for events and null for totals", async () => {
    const today = usageDay()
    await flushUsage(getCurrentTestDb(), [
      { siteId: A, day: today, metric: 'views', value: 7 },
      { siteId: A, day: today, metric: 'storage_bytes', value: 42 },
      { siteId: B, day: today, metric: 'views', value: 999 },
    ])
    const res = await (usageSite as Handler)(asOperator({ params: { siteId: A }, query: { days: '7' } })) as {
      days: string[], series: Record<string, (number | null)[]>
    }
    expect(res.days).toHaveLength(7)
    expect(res.days.at(-1)).toBe(today)
    expect(res.series.views).toEqual([0, 0, 0, 0, 0, 0, 7])
    expect(res.series.storage_bytes).toEqual([null, null, null, null, null, null, 42])

    await expect(Promise.resolve((usageSite as Handler)(asOperator({ params: { siteId: 'missing' } })))).rejects.toMatchObject({ statusCode: 404 })
  })
})
