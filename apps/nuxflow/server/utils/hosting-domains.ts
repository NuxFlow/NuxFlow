import type { H3Event } from 'h3'
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { auditLogs, hostingSubscriptions, siteDomains, sites, users } from '@nuxflow/db/schema'
import { useDb, type Db } from './db'
import { normalizeDomain } from './domain'
import { resolveSetting } from './settings'
import { getAccountsHost } from './accounts-origin'
import { assertWithinPlan, getSitePlan, planMax } from './hosting-plans'
import { isHostingPlatform } from './hosting-platform'
import { eventForSite, getPrimarySite } from './site-info'
import { hostingSitesDomain, type HostingContext } from './hosting-billing'
import { sendTemplatedEmail } from './email-template'
import { notifySiteRole } from './notify'
import { CloudflareApiError, createCustomHostname, deleteCustomHostname, DUPLICATE_HOSTNAME_CODE, getCustomHostname, isLive, type SaasConfig } from './cloudflare-saas'
import { clearSiteCache } from '../middleware/02.multi-site'

/**
 * Customers' own domains on a hosting platform (Cloudflare for SaaS). A customer connects
 * `www.cafe.co.uk` to their site, points one CNAME at our target (e.g.
 * customers.nuxflow.site), and once Cloudflare reports the hostname and its certificate
 * active they can make it the site's main address. Every other address of the site then
 * redirects to the main one (02.multi-site.ts).
 *
 * The Cloudflare details live on the primary site as server-managed settings, set on
 * Super Admin → Platform: the sites zone's id, an API token for it, and the CNAME target.
 */

export const SAAS_ZONE_KEY = 'hosting.cf_zone_id'
export const SAAS_TOKEN_KEY = 'hosting.cf_api_token'
export const SAAS_TARGET_KEY = 'hosting.custom_domain_target'

/** A site can have at most this many extra addresses, whatever its plan says. */
export const MAX_DOMAINS_PER_SITE = 10

export type SiteDomain = typeof siteDomains.$inferSelect

/** The CNAME target customers point their domain at (default `customers.<sites domain>`). */
export async function customDomainTarget(primaryEvent: H3Event): Promise<string> {
  const stored = String(await resolveSetting(primaryEvent, SAAS_TARGET_KEY) || '').trim().toLowerCase()
  const base = hostingSitesDomain()
  return stored || (base ? `customers.${base}` : '')
}

/** The Cloudflare details, or null while they aren't set on Super Admin → Platform. */
export async function saasConfig(primaryEvent: H3Event): Promise<SaasConfig | null> {
  const [zoneId, apiToken] = await Promise.all([
    resolveSetting(primaryEvent, SAAS_ZONE_KEY),
    resolveSetting(primaryEvent, SAAS_TOKEN_KEY),
  ])
  return zoneId && apiToken ? { zoneId: String(zoneId).trim(), apiToken: String(apiToken).trim() } : null
}

/**
 * Why `host` (already normalized) can't be connected as a customer's domain, or null.
 * Our own addresses are refused: the sites domain and everything under it, the operator's
 * main site and the sign-in domain.
 */
export function customDomainProblem(host: string | null, own: { sitesDomain: string, protectedHosts: string[] }): string | null {
  if (!host || host === 'localhost' || !host.includes('.')) return 'Enter a domain like www.yourbusiness.co.uk.'
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return 'Enter a domain name, not an IP address.'
  if (host.endsWith('.workers.dev') || host.endsWith('.pages.dev')) return 'Enter a domain you own.'
  const ours = [own.sitesDomain, ...own.protectedHosts].filter(Boolean)
  if (ours.some(o => host === o || host.endsWith(`.${o}`))) return "That's one of our own addresses. Enter a domain you own."
  return null
}

/** The customer's own hosted site behind one of their sign-ups, or a 404. */
export async function ownedHostedSite(db: Db, userId: string, subscriptionId: string) {
  const [row] = await db.select({ subscriptionId: hostingSubscriptions.id, site: { id: sites.id, name: sites.name, domain: sites.domain, hostingPlanId: sites.hostingPlanId } })
    .from(hostingSubscriptions)
    .innerJoin(sites, eq(sites.id, hostingSubscriptions.hostedSiteId))
    .where(and(eq(hostingSubscriptions.id, subscriptionId), eq(hostingSubscriptions.ownerUserId, userId)))
    .limit(1)
  if (!row) throw notFound('Site not found')
  return row.site
}

export async function listSiteDomains(db: Db, siteId: string): Promise<SiteDomain[]> {
  return db.select().from(siteDomains).where(eq(siteDomains.siteId, siteId)).orderBy(asc(siteDomains.createdAt))
}

/** What the customer sees for each address of their site. */
export function describeDomains(site: { domain: string }, rows: SiteDomain[]) {
  const byHost = new Map(rows.map(r => [r.hostname, r]))
  const main = byHost.get(site.domain)
  return [
    { hostname: site.domain, kind: main?.kind ?? 'platform', main: true, live: true, status: 'active', sslStatus: 'active', errors: [] as string[] },
    ...rows.filter(r => r.hostname !== site.domain).map(r => ({
      hostname: r.hostname,
      kind: r.kind,
      main: false,
      live: r.kind === 'platform' || isLive(r),
      status: r.status,
      sslStatus: r.sslStatus,
      errors: r.verificationErrors ?? [],
    })),
  ]
}

async function ownAddresses(ctx: HostingContext): Promise<{ sitesDomain: string, protectedHosts: string[] }> {
  const accounts = getAccountsHost()
  return {
    sitesDomain: hostingSitesDomain(),
    protectedHosts: [ctx.primary.domain.replace(/^www\./, ''), ...(accounts ? [accounts] : [])],
  }
}

/** Connects a customer's own domain to their site and registers it with Cloudflare. */
export async function addCustomDomain(ctx: HostingContext, siteId: string, input: string): Promise<SiteDomain> {
  const { db } = ctx
  const host = normalizeDomain(input)
  const problem = customDomainProblem(host, await ownAddresses(ctx))
  if (problem) throw validationError(problem)
  const hostname = host!

  const cfg = await saasConfig(ctx.primaryEvent)
  if (!cfg) throw createError({ statusCode: 503, message: "Connecting your own domain isn't available yet. Please contact us." })

  const [count] = await db.select({ n: sql<number>`count(*)` }).from(siteDomains).where(and(eq(siteDomains.siteId, siteId), eq(siteDomains.kind, 'custom')))
  if (Number(count?.n ?? 0) >= MAX_DOMAINS_PER_SITE) throw conflict(`A site can have up to ${MAX_DOMAINS_PER_SITE} of its own domains.`)
  await assertWithinPlan(ctx.primaryEvent, 'domains', 1, siteId)

  const [onSite, onAlias] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.domain, hostname), columns: { id: true } }),
    db.query.siteDomains.findFirst({ where: eq(siteDomains.hostname, hostname), columns: { id: true } }),
  ])
  if (onSite || onAlias) throw conflict('That domain is already connected to a site.')

  let cf
  try {
    cf = await createCustomHostname(cfg, hostname)
  }
  catch (err) {
    if (err instanceof CloudflareApiError && err.codes.includes(DUPLICATE_HOSTNAME_CODE)) throw conflict('That domain is already connected to a site.')
    console.error('[hosting-domains] Cloudflare refused', hostname, err)
    throw createError({ statusCode: 502, message: `Cloudflare couldn't add that domain: ${(err as Error).message}` })
  }

  const row: typeof siteDomains.$inferInsert = {
    id: ulid(),
    siteId,
    hostname,
    kind: 'custom',
    cfCustomHostnameId: cf.id,
    status: cf.status,
    sslStatus: cf.sslStatus,
    verificationErrors: cf.errors,
    lastCheckedAt: new Date().toISOString(),
  }
  try {
    await db.insert(siteDomains).values(row)
  }
  catch (err) {
    // Lost a race with someone adding the same name: don't leave an orphan at Cloudflare.
    await deleteCustomHostname(cfg, cf.id).catch(() => {})
    console.error('[hosting-domains] Insert failed after Cloudflare accepted', hostname, err)
    throw conflict('That domain is already connected to a site.')
  }
  return (await db.query.siteDomains.findFirst({ where: and(eq(siteDomains.id, row.id!), eq(siteDomains.siteId, siteId)) }))!
}

/**
 * Re-reads a custom domain's status from Cloudflare. The first time it's fully live the
 * site's owner is emailed (and the operator notified), once.
 */
export async function refreshCustomDomain(ctx: HostingContext, row: SiteDomain): Promise<SiteDomain> {
  if (row.kind !== 'custom' || !row.cfCustomHostnameId) return row
  const cfg = await saasConfig(ctx.primaryEvent)
  if (!cfg) return row
  const cf = await getCustomHostname(cfg, row.cfCustomHostnameId)
  const update = {
    status: cf.status,
    sslStatus: cf.sslStatus,
    verificationErrors: cf.errors,
    lastCheckedAt: new Date().toISOString(),
    updatedAt: sql`(datetime('now'))`,
  }
  await ctx.db.update(siteDomains).set(update).where(and(eq(siteDomains.id, row.id), eq(siteDomains.siteId, row.siteId)))
  let current: SiteDomain = { ...row, status: cf.status, sslStatus: cf.sslStatus, verificationErrors: cf.errors }

  if (isLive(cf) && !row.liveNotifiedAt) {
    // Claimed with a conditional update so two checks at once tell the owner only once.
    const [claimed] = await ctx.db.update(siteDomains)
      .set({ liveNotifiedAt: new Date().toISOString() })
      .where(and(eq(siteDomains.id, row.id), eq(siteDomains.siteId, row.siteId), sql`${siteDomains.liveNotifiedAt} is null`))
      .returning({ id: siteDomains.id })
    if (claimed) {
      current = { ...current, liveNotifiedAt: new Date().toISOString() }
      await tellDomainLive(ctx, current)
    }
  }
  return current
}

async function tellDomainLive(ctx: HostingContext, row: SiteDomain) {
  const [owner] = await ctx.db.select({ email: users.email, siteName: sites.name })
    .from(hostingSubscriptions)
    .innerJoin(users, eq(users.id, hostingSubscriptions.ownerUserId))
    .innerJoin(sites, eq(sites.id, hostingSubscriptions.hostedSiteId))
    .where(eq(hostingSubscriptions.hostedSiteId, row.siteId))
    .limit(1)
  if (owner) {
    try {
      await sendTemplatedEmail(ctx.primaryEvent, {
        to: owner.email,
        subject: `${row.hostname} is connected`,
        category: 'billing',
        template: {
          heading: 'Your domain is connected',
          paragraphs: [
            `${row.hostname} now reaches ${owner.siteName}, with a secure (https) certificate.`,
            'To use it as your site\'s main address, open My hosting and choose "Make main address". Your old address will keep working and send visitors to the new one.',
          ],
          action: { label: 'Go to My hosting', url: accountsHostingUrl() },
        },
      })
    }
    catch (err) {
      console.error('[hosting-domains] Live email failed:', row.hostname, err)
    }
  }
  try {
    await notifySiteRole(ctx.primaryEvent, {
      siteId: ctx.primary.id,
      minRole: 'super_admin',
      type: 'system.hosting',
      title: `Domain connected: ${row.hostname}`,
      body: `${row.hostname} is live for ${owner?.siteName ?? 'a customer site'}.`,
      pushUrl: '/admin/super/sites',
      sendEmailNotification: false,
      sendPush: true,
    })
  }
  catch (err) {
    console.error('[hosting-domains] Operator notice failed:', row.hostname, err)
  }
}

function accountsHostingUrl(): string {
  const host = getAccountsHost()
  return host ? `https://${host}/account/hosting` : '/account/hosting'
}

/**
 * Makes one of the site's addresses its main one. The previous main address is kept as an
 * extra address (so old links keep working, redirected). A custom domain must be live.
 */
export async function makeMainDomain(ctx: HostingContext, siteId: string, hostname: string): Promise<void> {
  const { db } = ctx
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { id: true, domain: true } })
  if (!site) throw notFound('Site not found')
  if (site.domain === hostname) return
  const row = await db.query.siteDomains.findFirst({ where: and(eq(siteDomains.siteId, siteId), eq(siteDomains.hostname, hostname)) })
  if (!row) throw notFound("That address isn't connected to this site.")
  if (row.kind === 'custom' && !isLive(row)) throw conflict("That domain isn't working yet. Check its DNS record, then try again once it shows as connected.")

  const keepOld = await db.query.siteDomains.findFirst({ where: and(eq(siteDomains.siteId, siteId), eq(siteDomains.hostname, site.domain)), columns: { id: true } })
  const statements = [
    db.update(sites).set({ domain: hostname, updatedAt: sql`(datetime('now'))` }).where(eq(sites.id, siteId)),
    // A platform row becomes the main address itself; a custom one keeps its row for Cloudflare.
    ...(row.kind === 'platform' ? [db.delete(siteDomains).where(and(eq(siteDomains.id, row.id), eq(siteDomains.siteId, siteId)))] : []),
    ...(keepOld ? [] : [db.insert(siteDomains).values({ id: ulid(), siteId, hostname: site.domain, kind: 'platform' as const, status: 'active', sslStatus: 'active' })]),
  ]
  await db.batch(statements as [typeof statements[number], ...typeof statements])
  clearSiteCache()
}

/** Disconnects an extra address. The main address can't be removed. */
export async function removeSiteDomain(ctx: HostingContext, siteId: string, hostname: string): Promise<void> {
  const { db } = ctx
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } })
  if (!site) throw notFound('Site not found')
  if (site.domain === hostname) throw conflict('This is your main address. Make another address the main one first.')
  const row = await db.query.siteDomains.findFirst({ where: and(eq(siteDomains.siteId, siteId), eq(siteDomains.hostname, hostname)) })
  if (!row) throw notFound("That address isn't connected to this site.")
  if (row.kind === 'custom' && row.cfCustomHostnameId) {
    const cfg = await saasConfig(ctx.primaryEvent)
    if (!cfg) throw createError({ statusCode: 503, message: "Domains can't be changed right now. Please contact us." })
    try {
      await deleteCustomHostname(cfg, row.cfCustomHostnameId)
    }
    catch (err) {
      throw createError({ statusCode: 502, message: `Cloudflare couldn't remove that domain: ${(err as Error).message}` })
    }
  }
  await db.delete(siteDomains).where(and(eq(siteDomains.id, row.id), eq(siteDomains.siteId, siteId)))
  clearSiteCache(hostname)
}

/**
 * Before a site is deleted: removes its domains from Cloudflare. Best effort — a domain
 * left at Cloudflare costs at most $0.10 a month and can be removed in the dashboard, so
 * it's logged rather than allowed to block the deletion.
 */
export async function removeDomainsForDeletedSite(event: H3Event, siteId: string): Promise<string[]> {
  const db = useDb(event)
  const rows = await db.select().from(siteDomains)
    .where(and(eq(siteDomains.siteId, siteId), eq(siteDomains.kind, 'custom'), isNotNull(siteDomains.cfCustomHostnameId)))
  if (!rows.length) return []
  const primary = await getPrimarySite(event)
  const cfg = primary ? await saasConfig(eventForSite(event, primary.id)) : null
  const left: string[] = []
  for (const row of rows) {
    try {
      if (!cfg) throw new Error('Cloudflare details are not set')
      await deleteCustomHostname(cfg, row.cfCustomHostnameId!)
    }
    catch (err) {
      left.push(row.hostname)
      console.error(JSON.stringify({ event: 'site.delete.custom_domain_failed', siteId, hostname: row.hostname, error: (err as Error).message }))
    }
  }
  return left
}

/**
 * Hourly: re-checks custom domains that aren't live yet (at most `limit` per run, oldest
 * check first), so the owner is told when theirs starts working without having to press
 * "Check now".
 */
export async function checkPendingCustomDomains(event: H3Event, limit = 50): Promise<{ checked: number, live: number }> {
  const db = useDb(event)
  if (!(await isHostingPlatform(db))) return { checked: 0, live: 0 }
  const primary = await getPrimarySite(event)
  if (!primary) return { checked: 0, live: 0 }
  const ctx: HostingContext = { db, primary, primaryEvent: eventForSite(event, primary.id) }
  if (!(await saasConfig(ctx.primaryEvent))) return { checked: 0, live: 0 }

  const pending = await db.select().from(siteDomains)
    .where(and(eq(siteDomains.kind, 'custom'), isNotNull(siteDomains.cfCustomHostnameId), sql`${siteDomains.liveNotifiedAt} is null`))
    .orderBy(sql`coalesce(${siteDomains.lastCheckedAt}, '')`)
    .limit(limit)
  let live = 0
  for (const row of pending) {
    try {
      const after = await refreshCustomDomain(ctx, row)
      if (isLive(after)) live++
    }
    catch (err) {
      console.error('[hosting-domains] Check failed for', row.hostname, err)
    }
  }
  return { checked: pending.length, live }
}

/** Everything the "Your addresses" panel needs for one site. */
export async function domainPanel(ctx: HostingContext, site: { id: string, domain: string }) {
  const [rows, cfg, target, plan] = await Promise.all([
    listSiteDomains(ctx.db, site.id),
    saasConfig(ctx.primaryEvent),
    customDomainTarget(ctx.primaryEvent),
    getSitePlan(ctx.db, site.id),
  ])
  return {
    available: !!cfg && !!target,
    target,
    allowed: planMax(plan, 'domains'),
    used: rows.filter(r => r.kind === 'custom').length,
    domains: describeDomains(site, rows),
  }
}

/** Audit row on the customer's site (the accounts origin has no site of its own in context). */
export async function logDomainChange(event: H3Event, siteId: string, userId: string, action: 'create' | 'update' | 'delete', hostname: string) {
  await useDb(event).insert(auditLogs).values({
    id: ulid(),
    siteId,
    userId,
    action,
    resource: 'site_domain',
    resourceId: hostname,
    after: { hostname },
    ipAddress: getHeader(event, 'cf-connecting-ip') ?? getHeader(event, 'x-forwarded-for') ?? null,
    userAgent: getHeader(event, 'user-agent') ?? null,
  })
}
