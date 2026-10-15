import type { H3Event } from 'h3'
import type Stripe from 'stripe'
import { and, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { auditLogs, contentTypes, hostingPlans, hostingSubscriptions, sites, userSiteRoles, users } from '@nuxflow/db/schema'
import { useDb, type Db } from './db'
import { isHostingPlatform } from './hosting-platform'
import { clearHostingPlanCache, type HostingPlan } from './hosting-plans'
import { accountsUrl, isAccountsHost, isCentralAuth } from './accounts-origin'
import { eventForSite, getPrimarySite, type SiteInfo } from './site-info'
import { resolveStripeProvider, getStripeProvider } from './payments/resolve'
import { syncPaymentProvider } from './payments/sync'
import type { StripeProvider } from './payments/stripe'
import { seedNewSite, type SiteTemplate } from './site-seeding'
import { notifySiteRole } from './notify'
import { sendTemplatedEmail } from './email-template'
import { clearSiteCache } from '../middleware/02.multi-site'

/**
 * The hosting platform's shop: a customer picks a plan and a subdomain on the accounts
 * origin, pays through Stripe Checkout, and Stripe's webhook creates their site. Billing
 * runs in the operator's Stripe account (the primary site's `payments.stripe_secret_key`);
 * changing plan, card or cancelling happen in Stripe's Customer Portal, and NuxFlow only
 * reacts to what the webhook says.
 *
 * Failed payments ("grace, then pause"): while Stripe retries a card (`past_due`) the site
 * stays up and the operator and customer are told once. When Stripe gives up (`paused`,
 * the recommended setting with flexible billing: paying the open invoice resumes it; or
 * `unpaid`) or the subscription ends (`canceled`), the site is put into maintenance mode — visitors see
 * a "back soon" page, the customer can still sign in, export a backup and pay — and the
 * operator decides what happens next. Nothing is ever deleted automatically. A paused
 * site reopens by itself once the subscription is active again.
 */

export const HOSTING_WEBHOOK_SECRET_KEY = 'hosting.stripe_webhook_secret'

/** Stripe statuses where the site should be open. */
const LIVE_STATUSES = new Set(['active', 'trialing'])
/** Stripe statuses where NuxFlow pauses the site. */
const ENDED_STATUSES = new Set(['paused', 'unpaid', 'canceled', 'incomplete_expired'])
/** A sign-up that hasn't paid yet holds its subdomain this long. */
const RESERVATION_MS = 24 * 60 * 60 * 1000

export const SITE_TEMPLATES = ['landing', 'blog', 'portfolio', 'blank'] as const satisfies readonly SiteTemplate[]

export type HostingSubscription = typeof hostingSubscriptions.$inferSelect

export interface HostingContext {
  db: Db
  primary: SiteInfo
  /** The request re-pointed at the primary site, whose settings hold the operator's Stripe keys and email setup. */
  primaryEvent: H3Event
}

/** The domain customer sites live under (`NUXT_HOSTING_SITES_DOMAIN`, e.g. nuxflow.site); '' when unset. */
export function hostingSitesDomain(): string {
  return String(useRuntimeConfig().hostingSitesDomain ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
}

async function platformContext(event: H3Event): Promise<HostingContext> {
  const db = useDb(event)
  if (!(await isHostingPlatform(db))) throw notFound()
  const primary = await getPrimarySite(event)
  if (!primary) throw notFound()
  return { db, primary, primaryEvent: eventForSite(event, primary.id) }
}

/**
 * For the customer-facing hosting routes: they only exist on the accounts origin of a
 * deployment running as a hosting platform. Everywhere else they're a plain 404.
 */
export async function hostingContext(event: H3Event): Promise<HostingContext> {
  if (!isCentralAuth() || !isAccountsHost(event)) throw notFound()
  return platformContext(event)
}

// ── Subdomains ───────────────────────────────────────────────────────────────

// Names a customer can't take: infrastructure, the platform's own words, and anything
// that could be mistaken for the operator.
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www', 'accounts', 'account', 'admin', 'administrator', 'api', 'app', 'apps', 'mail', 'email', 'smtp', 'imap', 'pop',
  'mx', 'ns', 'ns1', 'ns2', 'dns', 'ftp', 'cdn', 'static', 'assets', 'media', 'img', 'images', 'files',
  'help', 'support', 'status', 'docs', 'blog', 'news', 'billing', 'pay', 'payments', 'checkout', 'login', 'signin',
  'signup', 'register', 'auth', 'sso', 'oauth', 'secure', 'security', 'abuse', 'postmaster', 'hostmaster',
  'webmaster', 'root', 'system', 'test', 'demo', 'dev', 'staging', 'preview', 'nuxflow', 'cloud', 'site', 'sites',
  'cf-bounce', 'autoconfig', 'autodiscover',
])

export function normalizeSubdomain(value: string): string {
  return value.trim().toLowerCase()
}

/** Why a subdomain can't be used at all, or null when its shape is fine. */
export function subdomainProblem(name: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(name)) {
    return 'Use 3 to 32 letters, numbers and hyphens, starting and ending with a letter or number.'
  }
  // `xn--` is how look-alike international names are written; `--` elsewhere is just confusing.
  if (name.includes('--')) return "Hyphens can't be next to each other."
  if (RESERVED_SUBDOMAINS.has(name)) return 'That name is reserved. Please choose another.'
  return null
}

export interface SubdomainCheck {
  available: boolean
  domain: string
  reason?: string
}

/** Is `name` free? An unpaid sign-up by someone else holds a name for a day. */
export async function checkSubdomain(db: Db, rawName: string, forUserId?: string): Promise<SubdomainCheck> {
  const name = normalizeSubdomain(rawName)
  const base = hostingSitesDomain()
  const domain = `${name}.${base}`
  const problem = subdomainProblem(name)
  if (problem) return { available: false, domain, reason: problem }
  const taken = await db.query.sites.findFirst({ where: eq(sites.domain, domain), columns: { id: true } })
  if (taken) return { available: false, domain, reason: 'That address is already taken.' }
  const since = new Date(Date.now() - RESERVATION_MS).toISOString().replace('T', ' ').slice(0, 19)
  const held = await db.select({ ownerUserId: hostingSubscriptions.ownerUserId })
    .from(hostingSubscriptions)
    .where(and(
      eq(hostingSubscriptions.requestedSubdomain, name),
      isNull(hostingSubscriptions.hostedSiteId),
      inArray(hostingSubscriptions.status, ['checkout', 'incomplete', 'active', 'trialing']),
      gt(hostingSubscriptions.createdAt, since),
    ))
  if (held.some(h => h.ownerUserId !== forUserId)) return { available: false, domain, reason: 'That address is already taken.' }
  return { available: true, domain }
}

// ── Plans in Stripe ──────────────────────────────────────────────────────────

export type PlanPriceFields = Pick<HostingPlan, 'name' | 'description' | 'priceMonthly' | 'priceYearly' | 'currency' | 'stripeProductId' | 'stripePriceMonthlyId' | 'stripePriceYearlyId'>

/**
 * Brings a plan's Stripe product and prices in line with its name and prices, returning
 * the Stripe ids to store. Stripe prices can't be edited, so a changed amount or currency
 * creates a new price and archives the old one: existing subscribers keep paying the old
 * amount until moved (in Stripe), new sign-ups get the new one.
 */
export async function syncPlanToStripe(event: H3Event, before: PlanPriceFields | null, after: PlanPriceFields): Promise<Pick<HostingPlan, 'stripeProductId' | 'stripePriceMonthlyId' | 'stripePriceYearlyId'>> {
  const ids = {
    stripeProductId: after.stripeProductId,
    stripePriceMonthlyId: after.stripePriceMonthlyId,
    stripePriceYearlyId: after.stripePriceYearlyId,
  }
  const priced = after.priceMonthly != null || after.priceYearly != null
  if (!priced && !ids.stripeProductId) return ids

  const primary = await getPrimarySite(event)
  const stripe = primary ? await resolveStripeProvider(eventForSite(event, primary.id)) : null
  if (!stripe) {
    if (!priced) return ids
    throw conflict('Add your Stripe secret key on the main site (Settings → Payments) before giving a plan a price.')
  }

  if (!ids.stripeProductId) {
    if (!priced) return ids
    const product = await syncPaymentProvider('Stripe', 'create product', () => stripe.createProduct(after.name, after.description || undefined))
    ids.stripeProductId = product.id
  }
  else if (before && (before.name !== after.name || before.description !== after.description)) {
    const productId = ids.stripeProductId
    await syncPaymentProvider('Stripe', 'update product', () => stripe.updateProduct(productId, after.name, after.description || undefined))
  }

  const productId = ids.stripeProductId
  for (const [interval, amountKey, idKey] of [['month', 'priceMonthly', 'stripePriceMonthlyId'], ['year', 'priceYearly', 'stripePriceYearlyId']] as const) {
    const amount = after[amountKey]
    const oldId = ids[idKey]
    const changed = !oldId || before?.[amountKey] !== amount || before?.currency !== after.currency
    if (amount == null) {
      if (oldId) await archiveQuietly(stripe, oldId)
      ids[idKey] = null
    }
    else if (changed) {
      const price = await syncPaymentProvider('Stripe', `create ${interval}ly price`, () => stripe.createPrice(productId, amount, after.currency, interval))
      if (oldId) await archiveQuietly(stripe, oldId)
      ids[idKey] = price.id
    }
  }
  return ids
}

async function archiveQuietly(stripe: StripeProvider, priceId: string) {
  try {
    await stripe.archivePrice(priceId)
  }
  catch (err) {
    // An old price left active only means it still appears in the Stripe dashboard.
    console.warn('[hosting] Could not archive Stripe price', priceId, err)
  }
}

/** Plans offered on the sign-up page: public, with at least one price that exists in Stripe. */
export async function listPublicPlans(db: Db) {
  const plans = await db.select().from(hostingPlans).where(eq(hostingPlans.isPublic, true)).orderBy(hostingPlans.sortOrder, hostingPlans.name)
  return plans
    .filter(p => (p.priceMonthly != null && p.stripePriceMonthlyId) || (p.priceYearly != null && p.stripePriceYearlyId))
    .map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priceText: p.priceText,
      currency: p.currency,
      priceMonthly: p.stripePriceMonthlyId ? p.priceMonthly : null,
      priceYearly: p.stripePriceYearlyId ? p.priceYearly : null,
      trialDays: p.trialDays,
      limits: {
        maxStorageBytes: p.maxStorageBytes,
        maxContentItems: p.maxContentItems,
        maxTeamMembers: p.maxTeamMembers,
        maxAiCallsPerMonth: p.maxAiCallsPerMonth,
        maxEmailsPerMonth: p.maxEmailsPerMonth,
        maxPlugins: p.maxPlugins,
        maxCustomDomains: p.maxCustomDomains,
      },
    }))
}

// ── Checkout ─────────────────────────────────────────────────────────────────

export interface CheckoutRequest {
  user: { id: string; email: string; name: string }
  planId: string
  interval: 'month' | 'year'
  subdomain: string
  siteName: string
  template: SiteTemplate
}

/** Records the sign-up and returns the Stripe Checkout URL to send the customer to. */
export async function startHostingCheckout(ctx: HostingContext, req: CheckoutRequest): Promise<{ url: string; id: string }> {
  const { db, primary, primaryEvent } = ctx
  if (!hostingSitesDomain()) throw createError({ statusCode: 503, message: 'Sign-up is not open yet.' })

  const plan = await db.query.hostingPlans.findFirst({ where: and(eq(hostingPlans.id, req.planId), eq(hostingPlans.isPublic, true)) })
  const priceId = req.interval === 'month' ? plan?.stripePriceMonthlyId : plan?.stripePriceYearlyId
  if (!plan || !priceId) throw validationError("That plan isn't available. Please choose another.")

  const subdomain = normalizeSubdomain(req.subdomain)
  const check = await checkSubdomain(db, subdomain, req.user.id)
  if (!check.available) throw validationError(check.reason ?? 'That address is not available.')

  const stripe = await getStripeProvider(primaryEvent)
  const customer = await syncPaymentProvider('Stripe', 'find customer', async () =>
    (await stripe.findCustomerForSite(req.user.email, primary.id)) ?? stripe.createCustomer(req.user.email, req.user.name, primary.id))

  const id = ulid()
  await db.insert(hostingSubscriptions).values({
    id,
    ownerUserId: req.user.id,
    planId: plan.id,
    interval: req.interval,
    requestedSubdomain: subdomain,
    requestedSiteName: req.siteName,
    template: req.template,
    stripeCustomerId: customer.id,
  })

  const session = await syncPaymentProvider('Stripe', 'create checkout', () => stripe.createCheckoutSession({
    customerId: customer.id,
    priceId,
    successUrl: `${accountsUrl('/account/hosting')}?${new URLSearchParams({ welcome: id })}`,
    cancelUrl: `${accountsUrl('/account/hosting/new')}?${new URLSearchParams({ plan: plan.id, interval: req.interval })}`,
    // `nuxflowHosting` keeps the membership webhook's hands off these (and vice versa);
    // `siteId` is the primary site, the account these payments belong to.
    metadata: { nuxflowHosting: '1', hostingSubscriptionId: id, siteId: primary.id, ownerUserId: req.user.id },
    trialDays: plan.trialDays > 0 ? plan.trialDays : undefined,
    // Flexible billing is what lets Stripe pause (rather than cancel) a subscription
    // whose payments failed, and resume it once the customer pays.
    flexibleBilling: true,
  }))
  await db.update(hostingSubscriptions).set({ stripeCheckoutSessionId: session.id }).where(eq(hostingSubscriptions.id, id))
  if (!session.url) throw createError({ statusCode: 502, message: 'Stripe did not return a checkout page.' })
  return { url: session.url, id }
}

// ── Webhook sync ─────────────────────────────────────────────────────────────

/** Is this Stripe object one of ours (made by startHostingCheckout)? */
export function isHostingStripeObject(obj: { metadata?: Record<string, string> | null }): boolean {
  return obj.metadata?.nuxflowHosting === '1'
}

function iso(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null
}

/**
 * Applies Stripe's current view of a subscription: plan changes, status, and what that
 * means for the site (create it, pause it, reopen it). Safe to run any number of times
 * for the same state — Stripe redelivers webhooks and sends several per checkout.
 */
export async function syncHostingSubscription(ctx: HostingContext, sub: Stripe.Subscription): Promise<HostingSubscription | null> {
  const { db } = ctx
  const byStripeId = await db.query.hostingSubscriptions.findFirst({ where: eq(hostingSubscriptions.stripeSubscriptionId, sub.id) })
  const row = byStripeId ?? (sub.metadata?.hostingSubscriptionId
    ? await db.query.hostingSubscriptions.findFirst({ where: eq(hostingSubscriptions.id, sub.metadata.hostingSubscriptionId) })
    : undefined)
  if (!row) {
    console.warn('[hosting] Stripe subscription with no matching sign-up:', sub.id)
    return null
  }

  const item = sub.items.data[0]
  const priceId = item?.price?.id
  let planId = row.planId
  let interval = row.interval
  if (priceId) {
    const plan = await db.query.hostingPlans.findFirst({
      where: or(eq(hostingPlans.stripePriceMonthlyId, priceId), eq(hostingPlans.stripePriceYearlyId, priceId)),
    })
    if (plan) {
      planId = plan.id
      interval = plan.stripePriceYearlyId === priceId ? 'year' : 'month'
    }
  }

  const status = sub.status
  const live = LIVE_STATUSES.has(status)
  const update: Partial<HostingSubscription> = {
    stripeSubscriptionId: sub.id,
    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    status,
    planId,
    interval,
    currentPeriodEnd: iso(item?.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  }
  const startedFailing = status === 'past_due' && !row.pastDueSince
  if (startedFailing) update.pastDueSince = new Date().toISOString()
  if (live) update.pastDueSince = null

  await db.update(hostingSubscriptions)
    .set({ ...update, updatedAt: sql`(datetime('now'))` })
    .where(eq(hostingSubscriptions.id, row.id))
  let current: HostingSubscription = { ...row, ...update }

  if (current.hostedSiteId && planId !== row.planId) {
    await db.update(sites).set({ hostingPlanId: planId, updatedAt: sql`(datetime('now'))` }).where(eq(sites.id, current.hostedSiteId))
    clearHostingPlanCache()
  }

  if (live) {
    if (!(await siteExists(db, current.hostedSiteId))) current = await provisionHostedSite(ctx, current)
    else if (current.pausedForNonPayment) await reopenSite(ctx, current)
  }
  else if (startedFailing) {
    await tellPaymentFailing(ctx, current)
  }
  else if (ENDED_STATUSES.has(status) && current.hostedSiteId && !current.pausedForNonPayment) {
    await pauseSite(ctx, current)
  }
  return current
}

async function siteExists(db: Db, siteId: string | null): Promise<boolean> {
  if (!siteId) return false
  return !!(await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { id: true } }))
}

/**
 * Creates the customer's site: the domain they chose (or a close variant if it went in
 * the meantime), their plan, the starter content from their template, and them as its
 * admin. The site id is claimed on the sign-up row first, so two webhooks arriving
 * together can't both create a site.
 */
export async function provisionHostedSite(ctx: HostingContext, row: HostingSubscription): Promise<HostingSubscription> {
  const { db } = ctx
  let siteId = row.hostedSiteId
  if (!siteId) {
    const [claimed] = await db.update(hostingSubscriptions)
      .set({ hostedSiteId: ulid() })
      .where(and(eq(hostingSubscriptions.id, row.id), isNull(hostingSubscriptions.hostedSiteId)))
      .returning({ hostedSiteId: hostingSubscriptions.hostedSiteId })
    if (!claimed) return (await db.query.hostingSubscriptions.findFirst({ where: eq(hostingSubscriptions.id, row.id) }))!
    siteId = claimed.hostedSiteId!
  }

  const base = hostingSitesDomain()
  let domain = `${row.requestedSubdomain}.${base}`
  if (await db.query.sites.findFirst({ where: eq(sites.domain, domain), columns: { id: true } })) {
    domain = `${row.requestedSubdomain}-${ulid().slice(-4).toLowerCase()}.${base}`
  }

  await db.insert(sites).values({
    id: siteId,
    name: row.requestedSiteName,
    domain,
    locale: 'en',
    timezone: 'UTC',
    status: 'active',
    setupCompleted: true,
    hostingPlanId: row.planId,
  }).onConflictDoNothing()
  const [seeded] = await db.select({ id: contentTypes.id }).from(contentTypes).where(eq(contentTypes.siteId, siteId)).limit(1)
  if (!seeded) {
    await seedNewSite(db, { siteId, siteName: row.requestedSiteName, authorId: row.ownerUserId, template: row.template as SiteTemplate })
  }
  const role = await db.query.userSiteRoles.findFirst({ where: and(eq(userSiteRoles.userId, row.ownerUserId), eq(userSiteRoles.siteId, siteId)) })
  if (!role) await db.insert(userSiteRoles).values({ id: ulid(), userId: row.ownerUserId, siteId, role: 'admin' })
  await db.insert(auditLogs).values({
    id: ulid(),
    siteId,
    userId: row.ownerUserId,
    action: 'create',
    resource: 'site',
    resourceId: siteId,
    after: { domain, name: row.requestedSiteName, via: 'hosting_signup', hostingSubscriptionId: row.id },
  })
  clearSiteCache(domain)

  const owner = await db.query.users.findFirst({ where: eq(users.id, row.ownerUserId), columns: { email: true, name: true } })
  const adminUrl = `https://${domain}/_nuxflow/auth/start?${new URLSearchParams({ return_to: '/admin' })}`
  if (owner) {
    await sendQuietly(ctx, owner.email, `Your site ${row.requestedSiteName} is ready`, {
      heading: 'Your new site is ready',
      paragraphs: [
        `${row.requestedSiteName} is live at ${domain}.`,
        'Open the admin to choose a design, add your pages, or let the AI draft a first version for you.',
        'Billing, invoices and your plan are under My hosting in your account, any time.',
      ],
      action: { label: 'Open your site', url: adminUrl },
    })
  }
  await tellOperator(ctx, `New site: ${row.requestedSiteName}`, `${owner?.email ?? 'A customer'} signed up and ${domain} was created.`, `https://${domain}`)
  return { ...row, hostedSiteId: siteId }
}

async function pauseSite(ctx: HostingContext, row: HostingSubscription) {
  const { db } = ctx
  const site = await db.query.sites.findFirst({ where: eq(sites.id, row.hostedSiteId!), columns: { status: true, domain: true, name: true } })
  if (!site) return
  // A site the operator already put into maintenance or suspended stays as it is, and
  // isn't reopened automatically later.
  if (site.status === 'active') {
    await db.batch([
      db.update(sites).set({ status: 'maintenance', updatedAt: sql`(datetime('now'))` }).where(eq(sites.id, row.hostedSiteId!)),
      db.update(hostingSubscriptions).set({ pausedForNonPayment: true }).where(eq(hostingSubscriptions.id, row.id)),
    ])
    clearSiteCache(site.domain)
  }
  const ended = row.status === 'canceled'
  const owner = await db.query.users.findFirst({ where: eq(users.id, row.ownerUserId), columns: { email: true } })
  if (owner) {
    await sendQuietly(ctx, owner.email, ended ? `${site.name} has been paused` : `Payment needed for ${site.name}`, {
      heading: ended ? 'Your hosting has ended' : "We couldn't take payment",
      paragraphs: [
        ended
          ? `The subscription for ${site.name} (${site.domain}) has ended, so the site is paused: visitors see a "back soon" page.`
          : `We tried several times but couldn't take payment for ${site.name} (${site.domain}), so the site is paused: visitors see a "back soon" page.`,
        ended
          ? 'Nothing has been deleted. You can still sign in and download a backup from My hosting.'
          : 'Nothing has been deleted. Pay the outstanding invoice under Billing in My hosting and the site reopens by itself. You can still sign in and download a backup.',
      ],
      action: { label: 'Go to My hosting', url: accountsUrl('/account/hosting') },
    })
  }
  await tellOperator(ctx, `Site paused: ${site.name}`, `${site.domain} was put into maintenance mode because its subscription is ${row.status}. Nothing is deleted — decide in Super Admin → Sites whether to keep, suspend or remove it.`)
}

async function reopenSite(ctx: HostingContext, row: HostingSubscription) {
  const { db } = ctx
  const site = await db.query.sites.findFirst({ where: eq(sites.id, row.hostedSiteId!), columns: { status: true, domain: true, name: true } })
  if (!site) return
  const writes = [db.update(hostingSubscriptions).set({ pausedForNonPayment: false }).where(eq(hostingSubscriptions.id, row.id))] as const
  if (site.status === 'maintenance') {
    await db.batch([...writes, db.update(sites).set({ status: 'active', updatedAt: sql`(datetime('now'))` }).where(eq(sites.id, row.hostedSiteId!))])
    clearSiteCache(site.domain)
    await tellOperator(ctx, `Site reopened: ${site.name}`, `${site.domain} is paid up again and was taken out of maintenance mode.`)
  }
  else {
    await db.batch(writes)
  }
}

async function tellPaymentFailing(ctx: HostingContext, row: HostingSubscription) {
  const { db } = ctx
  const site = row.hostedSiteId ? await db.query.sites.findFirst({ where: eq(sites.id, row.hostedSiteId), columns: { domain: true, name: true } }) : null
  const label = site ? `${site.name} (${site.domain})` : row.requestedSiteName
  const owner = await db.query.users.findFirst({ where: eq(users.id, row.ownerUserId), columns: { email: true } })
  if (owner) {
    await sendQuietly(ctx, owner.email, `Payment problem for ${site?.name ?? row.requestedSiteName}`, {
      heading: "Your last payment didn't go through",
      paragraphs: [
        `We couldn't take the payment for ${label}. Your site is still online, and the card will be tried again automatically over the next few days.`,
        "Please check your card details. If payment still can't be taken, the site will be paused (nothing is deleted).",
      ],
      action: { label: 'Update payment details', url: accountsUrl('/account/hosting') },
    })
  }
  await tellOperator(ctx, `Payment failing: ${site?.name ?? row.requestedSiteName}`, `Stripe couldn't take payment for ${label} and is retrying. The site stays up for now.`)
}

async function sendQuietly(ctx: HostingContext, to: string, subject: string, template: Parameters<typeof sendTemplatedEmail>[1]['template']) {
  try {
    await sendTemplatedEmail(ctx.primaryEvent, { to, subject, category: 'billing', template })
  }
  catch (err) {
    console.error('[hosting] Customer email failed:', subject, err)
  }
}

async function tellOperator(ctx: HostingContext, title: string, body: string, pushUrl = '/admin/super/sites') {
  try {
    await notifySiteRole(ctx.primaryEvent, {
      siteId: ctx.primary.id,
      minRole: 'super_admin',
      type: 'system.hosting',
      title,
      body,
      pushUrl,
      sendEmailNotification: true,
      sendPush: true,
    })
  }
  catch (err) {
    console.error('[hosting] Operator notification failed:', title, err)
  }
}

// ── Customer area ────────────────────────────────────────────────────────────

/** A customer's sign-ups with their sites, newest first — the "My hosting" page. */
export async function listCustomerHosting(db: Db, userId: string) {
  const rows = await db.select({
    sub: hostingSubscriptions,
    site: { id: sites.id, name: sites.name, domain: sites.domain, status: sites.status },
    plan: { id: hostingPlans.id, name: hostingPlans.name },
  })
    .from(hostingSubscriptions)
    .leftJoin(sites, eq(sites.id, hostingSubscriptions.hostedSiteId))
    .leftJoin(hostingPlans, eq(hostingPlans.id, hostingSubscriptions.planId))
    .where(and(eq(hostingSubscriptions.ownerUserId, userId), or(ne(hostingSubscriptions.status, 'checkout'), isNotNull(hostingSubscriptions.hostedSiteId))))
    .orderBy(sql`${hostingSubscriptions.createdAt} desc`)
  return rows.map(({ sub, site, plan }) => ({
    id: sub.id,
    status: sub.status,
    interval: sub.interval,
    plan: plan?.id ? plan : null,
    site: site?.id ? site : null,
    requestedSiteName: sub.requestedSiteName,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    pastDueSince: sub.pastDueSince,
    paused: sub.pausedForNonPayment,
  }))
}

/**
 * Called before a site is deleted: ends its hosting subscription now, so the customer
 * isn't charged for a site that's gone. Throws when Stripe can't be reached — better to
 * refuse the deletion than to keep billing for nothing.
 */
export async function cancelHostingForDeletedSite(event: H3Event, siteId: string): Promise<void> {
  const db = useDb(event)
  const rows = await db.select().from(hostingSubscriptions)
    .where(and(eq(hostingSubscriptions.hostedSiteId, siteId), inArray(hostingSubscriptions.status, ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'])))
  if (!rows.length) return
  const primary = await getPrimarySite(event)
  const stripe = primary ? await resolveStripeProvider(eventForSite(event, primary.id)) : null
  for (const row of rows) {
    if (!row.stripeSubscriptionId) continue
    if (!stripe) throw conflict("This site has a hosting subscription, but Stripe isn't set up on the main site to cancel it. Cancel it in Stripe first.")
    try {
      await stripe.cancelSubscriptionNow(row.stripeSubscriptionId)
    }
    catch (err) {
      throw conflict(`Couldn't cancel this site's Stripe subscription (${(err as Error).message}). Cancel it in Stripe first, then delete the site.`)
    }
    await db.update(hostingSubscriptions).set({ status: 'canceled', updatedAt: sql`(datetime('now'))` }).where(eq(hostingSubscriptions.id, row.id))
  }
}
