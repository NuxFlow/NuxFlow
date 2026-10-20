/**
 * Hosting plans (server/utils/hosting-plans.ts): the built-in unlimited default, how each
 * limit is counted, enforcement at the real entry points, the Super Admin plan and site
 * routes, the site owner's summary, the operator's 80%/100% notices, and the Super Admin
 * hosting-platform switch they all sit behind.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { generateText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { ulid } from 'ulid'
import { dynamicPlugins, emailLog, hostingPlans, notifications, siteInvitations, siteSettings, sites, siteUsageDaily, users } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedMedia, seedSetting } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/webpush', () => ({
  broadcastPushToSite: vi.fn().mockResolvedValue(undefined),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../server/utils/embeddings', () => ({
  upsertContentEmbedding: vi.fn().mockResolvedValue(undefined),
  deleteContentEmbedding: vi.fn().mockResolvedValue(undefined),
}))
// h3's createEvent isn't usable under Vitest; same stand-in as inbound-email.test.ts.
vi.mock('../../server/utils/system-event', () => ({
  createSystemEvent: (opts: { env: unknown; siteId?: string; host?: string }) => {
    const event = createMockEvent({ siteId: opts.siteId, headers: { host: opts.host ?? 'localhost' } }) as unknown as { context: Record<string, unknown> }
    event.context.cloudflare = { env: opts.env, context: { waitUntil: (p: Promise<unknown>) => { void p } } }
    return event
  },
}))
vi.mock('../../server/utils/better-auth', () => ({
  getOrCreateBetterAuth: async () => ({ api: { sendVerificationEmail: vi.fn() } }),
  clearBetterAuthCache: () => {},
}))

const { checkPlanLimit, assertWithinPlan, clearHostingPlanCache, limitForRole, planUsage } = await import('../../server/utils/hosting-plans')
const { requireAiSdkModel, withUsageCounting } = await import('../../server/utils/ai-sdk')
const { sendEmailWithConfig } = await import('../../server/utils/email')
const { registerAccountForSite } = await import('../../server/utils/registration')
const { countUsage, flushUsage, pendingUsage, resetUsageBuffer, usageDay } = await import('../../server/utils/usage')
const { checkAiAllowance, clearAiDailyCapCache } = await import('../../server/utils/ai-allowance')
const { resolveSetting, saveSetting } = await import('../../server/utils/settings')
const { sendPlanUsageAlerts, sendPlatformAiCapAlert } = await import('../../server/scheduled/plan-usage-alerts')
const { default: createContent } = await import('../../server/api/v1/content/index.post')
const { default: listPlans } = await import('../../server/api/v1/admin/plans/index.get')
const { default: createPlan } = await import('../../server/api/v1/admin/plans/index.post')
const { default: patchPlan } = await import('../../server/api/v1/admin/plans/[id].patch')
const { default: deletePlan } = await import('../../server/api/v1/admin/plans/[id].delete')
const { default: patchSite } = await import('../../server/api/v1/admin/sites/[id].patch')
const { default: sitePlan } = await import('../../server/api/v1/site-plan/index.get')
const { clearHostingPlatformCache, isHostingPlatform } = await import('../../server/utils/hosting-platform')
const { default: getPlatform } = await import('../../server/api/v1/admin/platform/index.get')
const { default: putPlatform } = await import('../../server/api/v1/admin/platform/index.put')
const { default: listUsage } = await import('../../server/api/v1/admin/usage/index.get')
const { default: me } = await import('../../server/api/v1/users/me.get')
const { default: patchSettings } = await import('../../server/api/v1/settings/index.patch')

type Handler = (e: H3Event) => Promise<unknown>

const PRIMARY = 'site-plans-primary'
const TENANT = 'site-plans-tenant'
let operatorId: string
let tenantAdminId: string
let typeId: string

const operator = () => ({ user: { id: operatorId, name: 'Op', email: 'op@plans.test' } })
const tenantAdmin = () => ({ user: { id: tenantAdminId, name: 'Ad', email: 'admin@plans.test' } })
function ev(opts: Parameters<typeof createMockEvent>[0] = {}): H3Event {
  return createMockEvent({ siteId: TENANT, ...opts }) as unknown as H3Event
}
/** An event whose Worker has the Workers AI binding (never called — models are mocked or refused first). */
function aiEv(opts: Parameters<typeof createMockEvent>[0] = {}): H3Event {
  const event = ev(opts) as unknown as { context: Record<string, unknown> }
  event.context.cloudflare = { env: { AI: {} }, context: { waitUntil: (p: Promise<unknown>) => { void p } } }
  return event as unknown as H3Event
}
const usage = (inputTokens: number, outputTokens: number) => ({
  inputTokens: { total: inputTokens, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: outputTokens, text: undefined, reasoning: undefined },
})
function mockModel(tokens: [number, number] = [100, 50]) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({ content: [{ type: 'text', text: 'ok' }], finishReason: { unified: 'stop', raw: 'stop' }, usage: usage(...tokens), warnings: [] }),
  })
}
// The first count in a fresh isolate is written straight away; count something on another
// site first so the counts a test checks stay in the buffer.
const primeUsageBuffer = () => countUsage(ev({ siteId: PRIMARY }), 'renders')
const pendingFor = (metric: string, siteId = TENANT) => pendingUsage().filter(p => p.metric === metric && p.siteId === siteId).reduce((n, p) => n + p.value, 0)

/** Puts the tenant on a fresh plan with only the given limits set. */
async function useLimits(limits: Partial<typeof hostingPlans.$inferInsert>) {
  const db = getCurrentTestDb()
  const id = ulid()
  await db.insert(hostingPlans).values({ id, name: `Plan ${id.slice(-4)}`, ...limits })
  await db.update(sites).set({ hostingPlanId: id }).where(eq(sites.id, TENANT))
  clearHostingPlanCache()
  return id
}

async function setMonthUsage(metric: string, value: number, siteId = TENANT) {
  await flushUsage(getCurrentTestDb(), [{ siteId, day: usageDay(), metric, value }])
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'platform.plans.test', isPrimary: true })
  await seedSite(db, { id: TENANT, domain: 'tenant.plans.test', name: 'Tenant Co' })
  operatorId = await seedUser(db, { email: 'op@plans.test' })
  tenantAdminId = await seedUser(db, { email: 'admin@plans.test' })
  await seedRole(db, operatorId, PRIMARY, 'super_admin')
  await seedRole(db, tenantAdminId, TENANT, 'admin')
  typeId = await seedContentType(db, TENANT, { slug: 'post', name: 'Posts', singularName: 'Post' })
  // Everything but the last block runs with the hosting-platform switch on.
  await seedSetting(db, PRIMARY, 'platform.hosting_enabled', 'true')
})

afterAll(teardownTestDb)

beforeEach(async () => {
  const db = getCurrentTestDb()
  await db.update(sites).set({ hostingPlanId: null }).where(eq(sites.id, TENANT))
  await db.delete(hostingPlans)
  await db.delete(siteUsageDaily)
  resetUsageBuffer()
  clearHostingPlanCache()
  clearHostingPlatformCache()
})

describe('the built-in unlimited plan', () => {
  it('allows everything when a site has no plan', async () => {
    for (const key of ['storage', 'content', 'team', 'members', 'plugins', 'ai', 'emails'] as const) {
      expect(await checkPlanLimit(getCurrentTestDb(), TENANT, key, 1_000_000)).toMatchObject({ allowed: true, max: null })
    }
  })

  it('treats a blank limit on a plan as unlimited', async () => {
    await useLimits({ maxContentItems: 5 })
    expect((await checkPlanLimit(getCurrentTestDb(), TENANT, 'storage', 10 ** 12)).allowed).toBe(true)
  })
})

describe('counting', () => {
  it('sums media sizes for storage', async () => {
    const db = getCurrentTestDb()
    await seedMedia(db, TENANT, { size: 600 })
    await seedMedia(db, TENANT, { size: 300 })
    await useLimits({ maxStorageBytes: 1000 })
    expect(await checkPlanLimit(db, TENANT, 'storage', 100)).toMatchObject({ allowed: true, used: 900 })
    expect(await checkPlanLimit(db, TENANT, 'storage', 101)).toMatchObject({ allowed: false })
  })

  it('counts team as every role except member, plus live staff invitations, never the operator', async () => {
    const db = getCurrentTestDb()
    const editor = await seedUser(db, { email: 'ed@plans.test' })
    const member = await seedUser(db, { email: 'mem@plans.test' })
    const invited = await seedUser(db, { email: 'inv@plans.test' })
    const lapsed = await seedUser(db, { email: 'old@plans.test' })
    await seedRole(db, editor, TENANT, 'editor')
    await seedRole(db, member, TENANT, 'member')
    await seedRole(db, operatorId, TENANT, 'super_admin')
    await db.insert(siteInvitations).values([
      { id: ulid(), siteId: TENANT, userId: invited, role: 'author', expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      { id: ulid(), siteId: TENANT, userId: lapsed, role: 'author', expiresAt: new Date(Date.now() - 86_400_000).toISOString() },
    ])
    // admin + editor + pending author; not the member, the operator, or the expired invite.
    expect(await planUsage(db, TENANT, 'team')).toBe(3)
    expect(await planUsage(db, TENANT, 'members')).toBe(1)
    expect(limitForRole('viewer')).toBe('team')
    expect(limitForRole('member')).toBe('members')
  })

  it('counts this month only for monthly limits, including counts not yet written', async () => {
    const db = getCurrentTestDb()
    await flushUsage(db, [{ siteId: TENANT, day: '2000-01-15', metric: 'ai_credits', value: 999 }])
    await setMonthUsage('ai_credits', 4)
    // Plain AI calls (which include the site's own key) don't count towards the plan.
    await setMonthUsage('ai_calls', 50)
    expect(await planUsage(db, TENANT, 'ai')).toBe(4)
  })
})

describe('enforcement', () => {
  it('refuses a new page over the plan, with a clear message and code', async () => {
    const db = getCurrentTestDb()
    await seedContentItem(db, TENANT, typeId, { slug: `existing-${ulid()}` })
    const existing = await planUsage(db, TENANT, 'content')
    await useLimits({ maxContentItems: existing })

    const err = await (createContent as Handler)(ev({ session: tenantAdmin(), body: { title: 'One too many', slug: 'one-too-many', typeSlug: 'post' } }))
      .catch((e: unknown) => e) as { statusCode: number; message: string; data: Record<string, unknown> }
    expect(err.statusCode).toBe(403)
    expect(err.message).toBe(`Your plan allows ${existing} pages and posts.`)
    expect(err.data).toMatchObject({ code: 'plan_limit', limit: 'content', used: existing, max: existing })
  })

  it("refuses a public sign-up when the site's members are full, without creating an account", async () => {
    const db = getCurrentTestDb()
    await seedSetting(db, TENANT, 'auth.allow_public_registration', 'true')
    await useLimits({ maxSiteMembers: await planUsage(db, TENANT, 'members') })
    await expect(registerAccountForSite(ev(), TENANT, { name: 'New', email: 'new-member@plans.test', password: 'a-long-password-1' }))
      .rejects.toMatchObject({ statusCode: 403, message: "This site isn't accepting new members." })
    expect(await db.query.users.findFirst({ where: eq(users.email, 'new-member@plans.test') })).toBeUndefined()
  })

  it('says a plan without plugins has no plugins', async () => {
    await useLimits({ maxPlugins: 0 })
    await expect(assertWithinPlan(ev(), 'plugins')).rejects.toMatchObject({ message: "Your plan doesn't include plugins." })
    await getCurrentTestDb().delete(dynamicPlugins)
  })

  it('stops platform-paid AI once the monthly allowance is used — up front, and at the model itself', async () => {
    await useLimits({ maxAiCallsPerMonth: 3 })
    await setMonthUsage('ai_credits', 3)
    await expect(requireAiSdkModel(aiEv())).rejects.toMatchObject({ statusCode: 403, data: { code: 'plan_limit', limit: 'ai' } })

    // Background features (spam checks, inbox triage) reach the model without
    // requireAiSdkModel — the wrapped model is the gate for them.
    const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('should not be called') } })
    await expect(generateText({ model: withUsageCounting(ev(), { model, payer: 'platform', heavy: false }), prompt: 'hi', maxRetries: 0 }))
      .rejects.toThrow("This month's AI allowance is used up")
  })

  it("never limits or charges AI on the site's own key, but still counts the call", async () => {
    primeUsageBuffer()
    await useLimits({ maxAiCallsPerMonth: 3 })
    await setMonthUsage('ai_credits', 3)
    const { text } = await generateText({ model: withUsageCounting(ev(), { model: mockModel(), payer: 'site', heavy: true }), prompt: 'hi', maxRetries: 0 })
    expect(text).toBe('ok')
    expect(pendingFor('ai_calls')).toBe(1)
    expect(pendingFor('ai_credits')).toBe(0)

    // And requireAiSdkModel lets an own-key site through even with the allowance used up.
    await seedSetting(getCurrentTestDb(), TENANT, 'ai.provider', 'openai')
    await seedSetting(getCurrentTestDb(), TENANT, 'ai.openai_api_key', 'sk-own-key')
    try {
      await expect(requireAiSdkModel(aiEv())).resolves.toBeDefined()
    } finally {
      // Through saveSetting, so the settings cache forgets them too.
      await saveSetting(ev(), 'ai.provider', null)
      await saveSetting(ev(), 'ai.openai_api_key', null)
    }
  })

  it('charges platform-paid text by the tokens used, weighting the heavy model', async () => {
    primeUsageBuffer()
    await generateText({ model: withUsageCounting(ev(), { model: mockModel([1500, 500]), payer: 'platform', heavy: false }), prompt: 'hi', maxRetries: 0 })
    expect(pendingFor('ai_credits')).toBe(2)
    await generateText({ model: withUsageCounting(ev(), { model: mockModel([1500, 500]), payer: 'platform', heavy: true }), prompt: 'hi', maxRetries: 0 })
    expect(pendingFor('ai_credits')).toBe(12)
    // A tiny call is still at least one credit.
    await generateText({ model: withUsageCounting(ev(), { model: mockModel([3, 2]), payer: 'platform', heavy: false }), prompt: 'hi', maxRetries: 0 })
    expect(pendingFor('ai_credits')).toBe(13)
    expect(pendingFor('ai_calls')).toBe(3)
  })

  it('holds back ordinary emails over the allowance but always sends sign-in and security emails', async () => {
    const db = getCurrentTestDb()
    await useLimits({ maxEmailsPerMonth: 2 })
    await setMonthUsage('emails', 2)
    const config = { siteId: TENANT, emailProvider: 'console' }
    const event = ev()

    await expect(sendEmailWithConfig(config as never, { to: 'x@t.test', subject: 'Form reply', text: 'Hi', category: 'form_notification' }, event))
      .rejects.toThrow("This month's email allowance is used up")
    const [logged] = await db.select().from(emailLog).where(and(eq(emailLog.siteId, TENANT), eq(emailLog.subject, 'Form reply')))
    expect(logged).toMatchObject({ status: 'failed' })
    expect(logged!.error).toContain('allowance')

    for (const category of ['auth', 'security', 'invite']) {
      await expect(sendEmailWithConfig(config as never, { to: 'x@t.test', subject: category, text: 'Hi', category }, event)).resolves.toBeDefined()
    }
  })
})

describe('Super Admin → Plans and Sites', () => {
  it('is only for a super admin', async () => {
    await expect((listPlans as Handler)(ev({ session: tenantAdmin() }))).rejects.toMatchObject({ statusCode: 403 })
    await expect((createPlan as Handler)(ev({ session: tenantAdmin(), body: { name: 'X' } }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('creates, lists, edits and deletes plans; deleting puts its sites back on unlimited', async () => {
    const db = getCurrentTestDb()
    const created = await (createPlan as Handler)(ev({ siteId: PRIMARY, session: operator(), body: { name: 'Starter', priceText: '£5 a month', maxStorageBytes: 1024 ** 3, maxViewsPerMonth: 20_000 } })) as { id: string }
    expect(created).toMatchObject({ name: 'Starter', maxStorageBytes: 1024 ** 3, maxContentItems: null })

    await (patchSite as Handler)(ev({ siteId: PRIMARY, session: operator(), params: { id: TENANT }, body: { hostingPlanId: created.id } }))
    const listed = await (listPlans as Handler)(ev({ siteId: PRIMARY, session: operator() })) as { plans: { id: string; siteCount: number }[] }
    expect(listed.plans.find(p => p.id === created.id)?.siteCount).toBe(1)

    // Edits apply straight away in this isolate (the cache is cleared).
    expect((await checkPlanLimit(db, TENANT, 'content', 1)).allowed).toBe(true)
    await (patchPlan as Handler)(ev({ siteId: PRIMARY, session: operator(), params: { id: created.id }, body: { maxContentItems: 0 } }))
    expect((await checkPlanLimit(db, TENANT, 'content', 1)).allowed).toBe(false)

    await (deletePlan as Handler)(ev({ siteId: PRIMARY, session: operator(), params: { id: created.id } }))
    expect((await db.query.sites.findFirst({ where: eq(sites.id, TENANT) }))?.hostingPlanId).toBeNull()
    expect((await checkPlanLimit(db, TENANT, 'content', 1)).max).toBeNull()
  })

  it('refuses to assign a plan that does not exist, and a negative limit', async () => {
    await expect((patchSite as Handler)(ev({ siteId: PRIMARY, session: operator(), params: { id: TENANT }, body: { hostingPlanId: 'nope' } })))
      .rejects.toMatchObject({ statusCode: 422 })
    await expect((createPlan as Handler)(ev({ siteId: PRIMARY, session: operator(), body: { name: 'Bad', maxPlugins: -1 } })))
      .rejects.toMatchObject({ statusCode: 422 })
  })
})

describe("the site owner's usage card", () => {
  it('shows nothing on the unlimited plan, and only the limits a plan sets', async () => {
    expect(await (sitePlan as Handler)(ev({ session: tenantAdmin() }))).toEqual({ plan: null, limits: [] })

    await useLimits({ maxAiCallsPerMonth: 100, maxViewsPerMonth: 5000 })
    await setMonthUsage('ai_credits', 40)
    const summary = await (sitePlan as Handler)(ev({ session: tenantAdmin() })) as { limits: { key: string; used: number; max: number; kind: string }[] }
    expect(summary.limits.map(l => l.key)).toEqual(['ai', 'views'])
    expect(summary.limits[0]).toMatchObject({ used: 40, max: 100, kind: 'hard' })
    expect(summary.limits[1]).toMatchObject({ kind: 'soft' })
  })
})

describe("the operator's 80% / 100% notices", () => {
  async function planNotices() {
    return getCurrentTestDb().select().from(notifications)
      .where(and(eq(notifications.type, 'system.plan_usage'), eq(notifications.userId, operatorId)))
  }

  it('notifies once per threshold, never blocks a soft limit, and skips 80% once 100% is reached', async () => {
    await getCurrentTestDb().delete(notifications)
    await useLimits({ maxViewsPerMonth: 100 })

    await setMonthUsage('views', 85)
    expect(await sendPlanUsageAlerts()).toMatchObject({ notified: 1 })
    expect(await sendPlanUsageAlerts()).toMatchObject({ notified: 0 })
    const [first] = await planNotices()
    expect(first).toMatchObject({ siteId: PRIMARY, title: 'Tenant Co: page views a month at 85%' })
    expect(first!.body).toContain('Nothing is blocked')

    await setMonthUsage('views', 30)
    expect(await sendPlanUsageAlerts()).toMatchObject({ notified: 1 })
    expect((await planNotices()).map(n => (n.data as { threshold: number }).threshold).sort()).toEqual([100, 80])
  })

  it('says a hard monthly limit is now refusing requests', async () => {
    await getCurrentTestDb().delete(notifications)
    await useLimits({ maxAiCallsPerMonth: 10 })
    await setMonthUsage('ai_credits', 10)
    await sendPlanUsageAlerts()
    const [notice] = await planNotices()
    expect(notice!.body).toContain('New requests are refused until the 1st.')
  })
})

describe('the platform-wide daily AI cap', () => {
  async function setCap(cap: number | null) {
    await (putPlatform as Handler)(ev({ siteId: PRIMARY, session: operator(), body: { aiDailyCreditCap: cap } }))
  }
  afterAll(() => setCap(null))
  beforeEach(() => clearAiDailyCapCache())

  it('pauses platform-paid AI for customer sites once all of them together reach it — never the main site', async () => {
    await setCap(100)
    await setMonthUsage('ai_credits', 60)
    await seedSite(getCurrentTestDb(), { id: 'site-plans-tenant-2', domain: 'tenant2.plans.test' })
    await setMonthUsage('ai_credits', 40, 'site-plans-tenant-2')
    await expect(requireAiSdkModel(aiEv())).rejects.toMatchObject({ statusCode: 403, data: { code: 'platform_ai_cap', used: 100, max: 100 } })
    expect(await checkAiAllowance(ev({ siteId: PRIMARY }))).toEqual({ allowed: true })

    // The main site's own use doesn't count towards it.
    await getCurrentTestDb().delete(siteUsageDaily)
    await setMonthUsage('ai_credits', 500, PRIMARY)
    expect(await checkAiAllowance(ev())).toEqual({ allowed: true })

    const platform = await (getPlatform as Handler)(ev({ siteId: PRIMARY, session: operator() })) as { ai: { dailyCap: number | null; creditsToday: number } }
    expect(platform.ai).toEqual({ dailyCap: 100, creditsToday: 0 })
  })

  it('does nothing with no cap set, and is only for a super admin to set', async () => {
    await setCap(null)
    await setMonthUsage('ai_credits', 1_000_000)
    expect(await checkAiAllowance(ev())).toEqual({ allowed: true })
    await expect((putPlatform as Handler)(ev({ session: tenantAdmin(), body: { aiDailyCreditCap: 5 } }))).rejects.toMatchObject({ statusCode: 403 })
    await expect((patchSettings as Handler)(ev({ siteId: PRIMARY, session: operator(), body: { settings: { 'platform.ai_daily_credit_cap': 5 } } })))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('tells the operator at 80% and 100%, once each per day', async () => {
    const db = getCurrentTestDb()
    await db.delete(notifications)
    await setCap(100)
    await setMonthUsage('ai_credits', 85)
    expect(await sendPlatformAiCapAlert()).toBe(1)
    expect(await sendPlatformAiCapAlert()).toBe(0)
    await setMonthUsage('ai_credits', 20)
    expect(await sendPlatformAiCapAlert()).toBe(1)
    const notices = await db.select().from(notifications).where(and(eq(notifications.type, 'system.plan_usage'), eq(notifications.userId, operatorId)))
    expect(notices.map(n => (n.data as { threshold: number }).threshold).sort()).toEqual([100, 80])
    expect(notices.find(n => (n.data as { threshold: number }).threshold === 100)!.body).toContain('paused for them until midnight UTC')
  })
})

describe("the operator's own AI keys", () => {
  const original = globalThis.useRuntimeConfig
  beforeAll(() => {
    globalThis.useRuntimeConfig = (() => ({
      ...original(),
      openaiApiKey: 'sk-operator',
      aiProvider: 'openai',
      cloudflareAccountId: 'operator-account',
      cloudflareStreamToken: 'operator-stream',
      cloudflareImagesToken: 'operator-images',
    })) as typeof globalThis.useRuntimeConfig
  })
  afterAll(() => { globalThis.useRuntimeConfig = original })

  it('are only used by the main site while hosting is on', async () => {
    expect(await resolveSetting(ev(), 'ai.openai_api_key', 'openaiApiKey')).toBe('')
    expect(await resolveSetting(ev(), 'ai.provider', 'aiProvider')).toBe('')
    expect(await resolveSetting(ev({ siteId: PRIMARY }), 'ai.openai_api_key', 'openaiApiKey')).toBe('sk-operator')
    // So a customer site falls back to Workers AI, which is counted.
    await useLimits({ maxAiCallsPerMonth: 0 })
    await expect(requireAiSdkModel(aiEv())).rejects.toMatchObject({ statusCode: 403, data: { code: 'plan_limit' } })
  })

  it('and so are its Cloudflare Stream and Images credentials', async () => {
    for (const [key, envKey] of [['cloudflare.account_id', 'cloudflareAccountId'], ['cloudflare.stream_token', 'cloudflareStreamToken'], ['cloudflare.images_token', 'cloudflareImagesToken']]) {
      expect(await resolveSetting(ev(), key!, envKey)).toBe('')
      expect(await resolveSetting(ev({ siteId: PRIMARY }), key!, envKey)).not.toBe('')
    }
  })
})

describe('Ollama on a hosting platform', () => {
  it("isn't offered to a customer site: not saved, not used", async () => {
    await expect((patchSettings as Handler)(ev({ session: tenantAdmin(), body: { ai: { provider: 'ollama' } } })))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect((patchSettings as Handler)(ev({ session: tenantAdmin(), body: { settings: { 'ai.ollama_base_url': 'https://10.0.0.1' } } })))
      .rejects.toMatchObject({ statusCode: 400 })

    // A provider stored before hosting was turned on is ignored rather than used.
    await seedSetting(getCurrentTestDb(), TENANT, 'ai.provider', 'ollama')
    try {
      await expect(requireAiSdkModel(aiEv())).rejects.toMatchObject({ statusCode: 503 })
    } finally {
      await saveSetting(ev(), 'ai.provider', null)
    }
  })

  it('is still offered to the main site', async () => {
    await (patchSettings as Handler)(ev({ siteId: PRIMARY, session: operator(), body: { ai: { provider: 'ollama' } } }))
    await expect(requireAiSdkModel(ev({ siteId: PRIMARY }))).resolves.toBeDefined()
    await saveSetting(ev({ siteId: PRIMARY }), 'ai.provider', null)
  })
})

describe('the hosting-platform switch', () => {
  async function setSwitch(enabled: boolean) {
    return (putPlatform as Handler)(ev({ siteId: PRIMARY, session: operator(), body: { hostingEnabled: enabled } }))
  }
  afterAll(() => setSwitch(true))

  it('is only for a super admin', async () => {
    await expect((getPlatform as Handler)(ev({ session: tenantAdmin() }))).rejects.toMatchObject({ statusCode: 403 })
    await expect((putPlatform as Handler)(ev({ session: tenantAdmin(), body: { hostingEnabled: false } }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('off: every site is unlimited, Plans and Usage are gone, and no alerts go out — plan choices are kept', async () => {
    const db = getCurrentTestDb()
    const planId = await useLimits({ maxContentItems: 0, maxViewsPerMonth: 10 })
    await setMonthUsage('views', 50)
    await db.delete(notifications)
    expect((await checkPlanLimit(db, TENANT, 'content', 1)).allowed).toBe(false)

    expect(await setSwitch(false)).toEqual({ hostingEnabled: false })
    expect(await isHostingPlatform(db)).toBe(false)
    expect(await (getPlatform as Handler)(ev({ siteId: PRIMARY, session: operator() }))).toMatchObject({ hostingEnabled: false, primarySite: { id: PRIMARY } })

    expect((await checkPlanLimit(db, TENANT, 'content', 1)).allowed).toBe(true)
    expect(await (sitePlan as Handler)(ev({ session: tenantAdmin() }))).toEqual({ plan: null, limits: [] })
    expect(await sendPlanUsageAlerts()).toMatchObject({ notified: 0 })
    await expect((listPlans as Handler)(ev({ siteId: PRIMARY, session: operator() }))).rejects.toMatchObject({ statusCode: 404 })
    await expect((listUsage as Handler)(ev({ siteId: PRIMARY, session: operator() }))).rejects.toMatchObject({ statusCode: 404 })
    expect(await (me as Handler)(ev({ siteId: PRIMARY, session: operator() }))).toMatchObject({ isSuperAdmin: true, hostingPlatform: false })
    expect((await db.query.sites.findFirst({ where: eq(sites.id, TENANT) }))?.hostingPlanId).toBe(planId)

    // On again: the same plan applies straight away.
    await setSwitch(true)
    expect((await checkPlanLimit(db, TENANT, 'content', 1)).allowed).toBe(false)
    expect(await (me as Handler)(ev({ siteId: PRIMARY, session: operator() }))).toMatchObject({ hostingPlatform: true })
  })

  it('is stored on the primary site whichever site it is changed from, and is off when never set', async () => {
    const db = getCurrentTestDb()
    await setSwitch(false)
    expect(await db.select().from(siteSettings).where(eq(siteSettings.key, 'platform.hosting_enabled'))).toHaveLength(0)
    await setSwitch(true)
    const rows = await db.select().from(siteSettings).where(eq(siteSettings.key, 'platform.hosting_enabled'))
    expect(rows).toMatchObject([{ siteId: PRIMARY, value: true }])
  })

  it("can't be set through the site settings, even by the primary site's admin", async () => {
    await seedRole(getCurrentTestDb(), tenantAdminId, PRIMARY, 'admin')
    await expect((patchSettings as Handler)(ev({ siteId: PRIMARY, session: tenantAdmin(), body: { settings: { 'platform.hosting_enabled': false } } })))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})
