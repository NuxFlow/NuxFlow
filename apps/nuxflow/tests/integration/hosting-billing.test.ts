/**
 * The hosting platform's shop (server/utils/hosting-billing.ts): plan prices synced to
 * Stripe, sign-up on the accounts origin, the webhook creating the customer's site,
 * "grace, then pause" for failed payments, plan changes from the Customer Portal, and
 * deleting a paid-for site ending its billing. Stripe itself is a fake.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { contentItems, hostingPlans, hostingSubscriptions, notifications, sites, userSiteRoles } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedSetting } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/webpush', () => ({
  broadcastPushToSite: vi.fn().mockResolvedValue(undefined),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../server/utils/better-auth', () => ({
  getOrCreateBetterAuth: async () => ({ api: { sendVerificationEmail: vi.fn() } }),
  clearBetterAuthCache: () => {},
}))
vi.mock('../../server/utils/accounts-origin', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCentralAuth: () => true,
  isAccountsHost: (event: { _headers?: Record<string, string> }) => event._headers?.host === 'accounts.platform.test',
  accountsUrl: (path: string) => `https://accounts.platform.test${path}`,
}))

// ── A fake Stripe ──────────────────────────────────────────────────────────────
interface FakeSub { id: string; status: string; customer: string; cancel_at_period_end: boolean; metadata: Record<string, string>; items: { data: { price: { id: string }; current_period_end: number }[] } }
const stripe = {
  products: 0,
  prices: [] as { id: string; amount: number; interval: string; active: boolean }[],
  subs: new Map<string, FakeSub>(),
  cancelledNow: [] as string[],
  lastCheckout: null as null | { priceId: string; trialDays?: number; metadata?: Record<string, string> },
  nextEvent: null as unknown,
}
const fakeProvider = {
  createProduct: vi.fn(async () => ({ id: `prod_${++stripe.products}` })),
  updateProduct: vi.fn(async () => ({})),
  createPrice: vi.fn(async (_p: string, amount: number, _c: string, interval: string) => {
    const price = { id: `price_${stripe.prices.length + 1}`, amount, interval, active: true }
    stripe.prices.push(price)
    return price
  }),
  archivePrice: vi.fn(async (id: string) => {
    stripe.prices.find(p => p.id === id)!.active = false
  }),
  findCustomerForSite: vi.fn(async () => null),
  createCustomer: vi.fn(async () => ({ id: 'cus_1' })),
  createCheckoutSession: vi.fn(async (opts: { priceId: string; trialDays?: number; metadata?: Record<string, string> }) => {
    stripe.lastCheckout = opts
    return { id: `cs_${Date.now()}_${Math.random()}`, url: 'https://checkout.stripe.test/pay' }
  }),
  createBillingPortalSession: vi.fn(async () => ({ url: 'https://billing.stripe.test/portal' })),
  getSubscription: vi.fn(async (id: string) => stripe.subs.get(id)),
  cancelSubscriptionNow: vi.fn(async (id: string) => {
    stripe.cancelledNow.push(id)
  }),
  constructWebhookEvent: vi.fn(async (_body: string, sig: string) => {
    if (sig !== 'good') throw new Error('bad signature')
    return stripe.nextEvent
  }),
}
vi.mock('../../server/utils/payments/resolve', () => ({
  resolveStripeProvider: async () => fakeProvider,
  getStripeProvider: async () => fakeProvider,
}))

const realRuntimeConfig = globalThis.useRuntimeConfig
globalThis.useRuntimeConfig = (() => ({ ...realRuntimeConfig(), hostingSitesDomain: 'sites.test' })) as typeof globalThis.useRuntimeConfig

const { syncPlanToStripe, checkSubdomain, subdomainProblem } = await import('../../server/utils/hosting-billing')
const { clearHostingPlatformCache } = await import('../../server/utils/hosting-platform')
const { clearHostingPlanCache } = await import('../../server/utils/hosting-plans')
const { default: createPlan } = await import('../../server/api/v1/admin/plans/index.post')
const { default: patchPlan } = await import('../../server/api/v1/admin/plans/[id].patch')
const { default: deletePlan } = await import('../../server/api/v1/admin/plans/[id].delete')
const { default: hostingInfo } = await import('../../server/api/accounts/hosting/index.get')
const { default: checkout } = await import('../../server/api/accounts/hosting/checkout.post')
const { default: subdomain } = await import('../../server/api/accounts/hosting/subdomain.get')
const { default: mySubs } = await import('../../server/api/accounts/hosting/subscriptions.get')
const { default: portal } = await import('../../server/api/accounts/hosting/billing-portal.post')
const { default: webhook } = await import('../../server/api/accounts/hosting/stripe-webhook.post')
const { deleteSiteCompletely } = await import('../../server/utils/site-deletion')
const { assertSharedSenderAllowed, hostingSenderDomain } = await import('../../server/utils/email')

type Handler = (e: H3Event) => Promise<unknown>

const PRIMARY = 'site-hb-primary'
let operatorId: string
let customerId: string
let otherId: string

const operator = () => ({ user: { id: operatorId, name: 'Op', email: 'op@hb.test' } })
const customer = () => ({ user: { id: customerId, name: 'Cara', email: 'cara@hb.test' } })
function onAccounts(opts: Parameters<typeof createMockEvent>[0] = {}): H3Event {
  return createMockEvent({ siteId: undefined, headers: { host: 'accounts.platform.test' }, ...opts }) as unknown as H3Event
}
function onPrimary(opts: Parameters<typeof createMockEvent>[0] = {}): H3Event {
  return createMockEvent({ siteId: PRIMARY, headers: { host: 'platform.test' }, ...opts }) as unknown as H3Event
}

async function makePlan(body: Record<string, unknown> = {}) {
  return await (createPlan as Handler)(onPrimary({ session: operator(), body: { name: 'Starter', priceMonthly: 5, priceYearly: 50, isPublic: true, trialDays: 14, maxContentItems: 100, ...body } })) as typeof hostingPlans.$inferSelect
}

/** What Stripe would send for the subscription, then the webhook call itself. */
async function stripeSays(sub: FakeSub, type = 'customer.subscription.updated') {
  stripe.subs.set(sub.id, sub)
  stripe.nextEvent = { type, data: { object: type === 'checkout.session.completed' ? { subscription: sub.id, metadata: sub.metadata } : sub } }
  return (webhook as Handler)(onAccounts({ method: 'POST', rawBody: '{}', headers: { 'host': 'accounts.platform.test', 'stripe-signature': 'good' } }))
}

function subFor(signupId: string, priceId: string, status = 'active', extra: Partial<FakeSub> = {}): FakeSub {
  return {
    id: 'sub_1',
    status,
    customer: 'cus_1',
    cancel_at_period_end: false,
    metadata: { nuxflowHosting: '1', hostingSubscriptionId: signupId },
    items: { data: [{ price: { id: priceId }, current_period_end: 1_900_000_000 }] },
    ...extra,
  }
}

async function signUp(sub = 'cornercafe') {
  return await (checkout as Handler)(onAccounts({
    method: 'POST',
    session: customer(),
    body: { planId: (await getCurrentTestDb().query.hostingPlans.findFirst())!.id, interval: 'month', subdomain: sub, siteName: 'The Corner Café', template: 'blog' },
  })) as { url: string; id: string }
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'platform.test', isPrimary: true, name: 'Platform' })
  operatorId = await seedUser(db, { email: 'op@hb.test' })
  customerId = await seedUser(db, { email: 'cara@hb.test', name: 'Cara' })
  otherId = await seedUser(db, { email: 'other@hb.test' })
  await seedRole(db, operatorId, PRIMARY, 'super_admin')
  await seedSetting(db, PRIMARY, 'platform.hosting_enabled', 'true')
  await seedSetting(db, PRIMARY, 'hosting.stripe_webhook_secret', 'whsec_test')
})

afterAll(async () => {
  globalThis.useRuntimeConfig = realRuntimeConfig
  await teardownTestDb()
})

beforeEach(async () => {
  const db = getCurrentTestDb()
  await db.delete(hostingSubscriptions)
  await db.delete(hostingPlans)
  for (const s of await db.select({ id: sites.id }).from(sites)) {
    if (s.id !== PRIMARY) await db.delete(sites).where(eq(sites.id, s.id))
  }
  await db.delete(notifications)
  stripe.prices = []
  stripe.subs.clear()
  stripe.cancelledNow = []
  clearHostingPlatformCache()
  clearHostingPlanCache()
  vi.clearAllMocks()
})

describe('plans in Stripe', () => {
  it('creates the product and a price per interval, and replaces a price whose amount changes', async () => {
    const plan = await makePlan()
    expect(plan).toMatchObject({ stripeProductId: 'prod_1', stripePriceMonthlyId: expect.stringMatching(/^price_/), stripePriceYearlyId: expect.stringMatching(/^price_/) })
    expect(stripe.prices.map(p => [p.amount, p.interval])).toEqual([[5, 'month'], [50, 'year']])

    const updated = await (patchPlan as Handler)(onPrimary({ session: operator(), params: { id: plan.id }, body: { priceMonthly: 6, priceYearly: null } })) as typeof plan
    expect(updated.stripePriceMonthlyId).not.toBe(plan.stripePriceMonthlyId)
    expect(updated.stripePriceYearlyId).toBeNull()
    expect(stripe.prices.find(p => p.id === plan.stripePriceMonthlyId)?.active).toBe(false)
    expect(stripe.prices.find(p => p.id === plan.stripePriceYearlyId)?.active).toBe(false)
    expect(stripe.prices.find(p => p.id === updated.stripePriceMonthlyId)).toMatchObject({ amount: 6, active: true })
  })

  it('leaves Stripe alone for a plan without prices, and when only limits change', async () => {
    const free = await makePlan({ name: 'Manual', priceMonthly: null, priceYearly: null, isPublic: false })
    expect(free.stripeProductId).toBeNull()
    const paid = await makePlan()
    await (patchPlan as Handler)(onPrimary({ session: operator(), params: { id: paid.id }, body: { maxContentItems: 5 } }))
    expect(fakeProvider.createPrice).toHaveBeenCalledTimes(2)
  })

  it('needs Stripe set up before a plan can have a price', async () => {
    const before = { name: 'X', description: '', priceMonthly: null, priceYearly: null, currency: 'gbp', stripeProductId: null, stripePriceMonthlyId: null, stripePriceYearlyId: null }
    fakeProvider.createProduct.mockRejectedValueOnce(new Error('No such key'))
    await expect(syncPlanToStripe(onPrimary(), null, { ...before, priceMonthly: 5 })).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('subdomains', () => {
  it('refuses bad shapes and reserved names', () => {
    expect(subdomainProblem('ab')).toBeTruthy()
    expect(subdomainProblem('-cafe')).toBeTruthy()
    expect(subdomainProblem('xn--cafe')).toBeTruthy()
    expect(subdomainProblem('accounts')).toMatch(/reserved/)
    expect(subdomainProblem('corner-cafe')).toBeNull()
  })

  it("is held for a day by someone else's unpaid sign-up, but not for the same person", async () => {
    await makePlan()
    await signUp('heldname')
    expect(await checkSubdomain(getCurrentTestDb(), 'heldname', otherId)).toMatchObject({ available: false })
    expect(await checkSubdomain(getCurrentTestDb(), 'heldname', customerId)).toMatchObject({ available: true, domain: 'heldname.sites.test' })
    expect(await (subdomain as Handler)(onAccounts({ query: { name: 'HeldName' } }))).toMatchObject({ available: false })
  })
})

describe('sign-up', () => {
  it('only exists on the accounts origin of a hosting platform', async () => {
    await expect((checkout as Handler)(onPrimary({ method: 'POST', session: customer(), body: {} }))).rejects.toMatchObject({ statusCode: 404 })
    expect(await (hostingInfo as Handler)(onPrimary())).toMatchObject({ enabled: false })
  })

  it('lists public plans with prices, and starts a Stripe checkout with the trial', async () => {
    await makePlan()
    await makePlan({ name: 'Hidden', isPublic: false })
    const info = await (hostingInfo as Handler)(onAccounts()) as { enabled: boolean; plans: { name: string; trialDays: number }[] }
    expect(info).toMatchObject({ enabled: true, sitesDomain: 'sites.test' })
    expect(info.plans.map(p => p.name)).toEqual(['Starter'])

    const { url, id } = await signUp()
    expect(url).toBe('https://checkout.stripe.test/pay')
    expect(stripe.lastCheckout).toMatchObject({ trialDays: 14, metadata: { nuxflowHosting: '1', hostingSubscriptionId: id, ownerUserId: customerId } })
    const row = await getCurrentTestDb().query.hostingSubscriptions.findFirst({ where: eq(hostingSubscriptions.id, id) })
    expect(row).toMatchObject({ status: 'checkout', requestedSubdomain: 'cornercafe', hostedSiteId: null, stripeCustomerId: 'cus_1' })
  })

  it('needs a signed-in customer, a public plan and a free address', async () => {
    const plan = await makePlan({ isPublic: false })
    await expect((checkout as Handler)(onAccounts({ method: 'POST', body: {} }))).rejects.toMatchObject({ statusCode: 401 })
    await expect((checkout as Handler)(onAccounts({ method: 'POST', session: customer(), body: { planId: plan.id, interval: 'month', subdomain: 'okname', siteName: 'X' } })))
      .rejects.toMatchObject({ statusCode: 422 })
    await (patchPlan as Handler)(onPrimary({ session: operator(), params: { id: plan.id }, body: { isPublic: true } }))
    await expect((checkout as Handler)(onAccounts({ method: 'POST', session: customer(), body: { planId: plan.id, interval: 'month', subdomain: 'admin', siteName: 'X' } })))
      .rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('the webhook', () => {
  it('rejects a bad signature and ignores Stripe events that are not hosting sign-ups', async () => {
    await expect((webhook as Handler)(onAccounts({ method: 'POST', rawBody: '{}', headers: { 'host': 'accounts.platform.test', 'stripe-signature': 'bad' } })))
      .rejects.toMatchObject({ statusCode: 400 })
    stripe.nextEvent = { type: 'customer.subscription.updated', data: { object: { id: 'sub_member', metadata: { userId: 'x' } } } }
    expect(await (webhook as Handler)(onAccounts({ method: 'POST', rawBody: '{}', headers: { 'host': 'accounts.platform.test', 'stripe-signature': 'good' } })))
      .toEqual({ received: true, ignored: true })
  })

  it('creates the site once payment is confirmed — once, however many events arrive', async () => {
    const db = getCurrentTestDb()
    const plan = await makePlan()
    const { id } = await signUp()
    const sub = subFor(id, plan.stripePriceMonthlyId!, 'trialing')
    await Promise.all([stripeSays(sub, 'checkout.session.completed'), stripeSays(sub, 'customer.subscription.created')])
    await stripeSays(sub)

    const row = (await db.query.hostingSubscriptions.findFirst({ where: eq(hostingSubscriptions.id, id) }))!
    expect(row).toMatchObject({ status: 'trialing', stripeSubscriptionId: 'sub_1', hostedSiteId: expect.any(String) })
    const created = await db.select().from(sites).where(eq(sites.domain, 'cornercafe.sites.test'))
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ id: row.hostedSiteId, name: 'The Corner Café', status: 'active', hostingPlanId: plan.id, setupCompleted: true })
    expect(await db.query.userSiteRoles.findFirst({ where: and(eq(userSiteRoles.siteId, row.hostedSiteId!), eq(userSiteRoles.userId, customerId)) })).toMatchObject({ role: 'admin' })
    const slugs = (await db.select({ slug: contentItems.slug }).from(contentItems).where(eq(contentItems.siteId, row.hostedSiteId!))).map(r => r.slug).sort()
    expect(slugs).toEqual(['hello-world', 'home', 'privacy'])
    expect(await db.select().from(notifications).where(and(eq(notifications.type, 'system.hosting'), eq(notifications.userId, operatorId)))).toHaveLength(1)

    const mine = await (mySubs as Handler)(onAccounts({ session: customer() })) as { subscriptions: { site: { domain: string } | null; status: string }[] }
    expect(mine.subscriptions).toMatchObject([{ status: 'trialing', site: { domain: 'cornercafe.sites.test' } }])
    const theirs = await (mySubs as Handler)(onAccounts({ session: { user: { id: otherId, name: 'O', email: 'other@hb.test' } } })) as { subscriptions: unknown[] }
    expect(theirs.subscriptions).toEqual([])
  })

  it('keeps the site up while a card is retried, pauses it when Stripe gives up, and reopens it once paid', async () => {
    const db = getCurrentTestDb()
    const plan = await makePlan()
    const { id } = await signUp()
    await stripeSays(subFor(id, plan.stripePriceMonthlyId!, 'active'))
    const siteId = (await db.query.hostingSubscriptions.findFirst({ where: eq(hostingSubscriptions.id, id) }))!.hostedSiteId!
    const siteStatus = async () => (await db.query.sites.findFirst({ where: eq(sites.id, siteId) }))!.status

    await stripeSays(subFor(id, plan.stripePriceMonthlyId!, 'past_due'))
    await stripeSays(subFor(id, plan.stripePriceMonthlyId!, 'past_due'))
    expect(await siteStatus()).toBe('active')
    const failing = await db.select().from(notifications).where(and(eq(notifications.type, 'system.hosting'), eq(notifications.title, 'Payment failing: The Corner Café')))
    expect(failing).toHaveLength(1)

    await stripeSays(subFor(id, plan.stripePriceMonthlyId!, 'unpaid'))
    expect(await siteStatus()).toBe('maintenance')
    expect((await db.query.hostingSubscriptions.findFirst({ where: eq(hostingSubscriptions.id, id) }))).toMatchObject({ pausedForNonPayment: true })

    await stripeSays(subFor(id, plan.stripePriceMonthlyId!, 'active'))
    expect(await siteStatus()).toBe('active')
    expect((await db.query.hostingSubscriptions.findFirst({ where: eq(hostingSubscriptions.id, id) }))).toMatchObject({ pausedForNonPayment: false, pastDueSince: null })
  })

  it("never reopens a site the operator suspended, and pauses when the subscription ends", async () => {
    const db = getCurrentTestDb()
    const plan = await makePlan()
    const { id } = await signUp()
    await stripeSays(subFor(id, plan.stripePriceMonthlyId!, 'active'))
    const siteId = (await db.query.hostingSubscriptions.findFirst({ where: eq(hostingSubscriptions.id, id) }))!.hostedSiteId!

    await db.update(sites).set({ status: 'suspended' }).where(eq(sites.id, siteId))
    await stripeSays(subFor(id, plan.stripePriceMonthlyId!, 'unpaid'))
    await stripeSays(subFor(id, plan.stripePriceMonthlyId!, 'active'))
    expect((await db.query.sites.findFirst({ where: eq(sites.id, siteId) }))!.status).toBe('suspended')

    await db.update(sites).set({ status: 'active' }).where(eq(sites.id, siteId))
    await stripeSays(subFor(id, plan.stripePriceMonthlyId!, 'canceled'), 'customer.subscription.deleted')
    expect((await db.query.sites.findFirst({ where: eq(sites.id, siteId) }))!.status).toBe('maintenance')
  })

  it("follows a plan change made in Stripe's portal", async () => {
    const db = getCurrentTestDb()
    const starter = await makePlan()
    const pro = await makePlan({ name: 'Pro', priceMonthly: 15, priceYearly: 150, maxContentItems: null })
    const { id } = await signUp()
    await stripeSays(subFor(id, starter.stripePriceMonthlyId!, 'active'))
    await stripeSays(subFor(id, pro.stripePriceYearlyId!, 'active'))
    const row = (await db.query.hostingSubscriptions.findFirst({ where: eq(hostingSubscriptions.id, id) }))!
    expect(row).toMatchObject({ planId: pro.id, interval: 'year' })
    expect((await db.query.sites.findFirst({ where: eq(sites.id, row.hostedSiteId!) }))!.hostingPlanId).toBe(pro.id)

    await expect((deletePlan as Handler)(onPrimary({ session: operator(), params: { id: pro.id } }))).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('email from customer sites', () => {
  it('sends from the shared sites domain, never from another customer', async () => {
    expect(hostingSenderDomain('cornercafe.sites.test')).toBe('sites.test')
    expect(hostingSenderDomain('sites.test.evil.example')).toBeNull()
    expect(hostingSenderDomain('platform.test')).toBeNull()

    const db = getCurrentTestDb()
    const plan = await makePlan()
    const { id } = await signUp()
    await stripeSays(subFor(id, plan.stripePriceMonthlyId!, 'active'))
    const siteId = (await db.query.hostingSubscriptions.findFirst({ where: eq(hostingSubscriptions.id, id) }))!.hostedSiteId!
    const event = onPrimary()
    await expect(assertSharedSenderAllowed(event, siteId, 'noreply@sites.test')).resolves.toBeUndefined()
    await expect(assertSharedSenderAllowed(event, siteId, 'hello@cornercafe.sites.test')).resolves.toBeUndefined()
    await expect(assertSharedSenderAllowed(event, siteId, 'noreply@othercafe.sites.test')).rejects.toThrow()
    await expect(assertSharedSenderAllowed(event, siteId, 'noreply@platform.test')).rejects.toThrow()
  })
})

describe('billing portal and deletion', () => {
  it("opens the portal for the customer's own subscription only", async () => {
    await makePlan()
    const { id } = await signUp()
    expect(await (portal as Handler)(onAccounts({ method: 'POST', session: customer(), body: { id } }))).toEqual({ url: 'https://billing.stripe.test/portal' })
    await expect((portal as Handler)(onAccounts({ method: 'POST', session: { user: { id: otherId, name: 'O', email: 'other@hb.test' } }, body: { id } })))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('ends billing straight away when a paid-for site is deleted', async () => {
    const db = getCurrentTestDb()
    const plan = await makePlan()
    const { id } = await signUp()
    await stripeSays(subFor(id, plan.stripePriceMonthlyId!, 'active'))
    const siteId = (await db.query.hostingSubscriptions.findFirst({ where: eq(hostingSubscriptions.id, id) }))!.hostedSiteId!

    fakeProvider.cancelSubscriptionNow.mockRejectedValueOnce(new Error('Stripe is down'))
    await expect(deleteSiteCompletely(onPrimary({ session: operator() }), siteId, operatorId)).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.query.sites.findFirst({ where: eq(sites.id, siteId) })).toBeTruthy()

    await deleteSiteCompletely(onPrimary({ session: operator() }), siteId, operatorId)
    expect(stripe.cancelledNow).toEqual(['sub_1'])
    expect((await db.query.hostingSubscriptions.findFirst({ where: eq(hostingSubscriptions.id, id) }))).toMatchObject({ status: 'canceled' })
  })
})
