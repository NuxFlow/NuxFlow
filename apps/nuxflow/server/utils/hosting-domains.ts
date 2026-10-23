import type { H3Event } from 'h3'
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { auditLogs, hostingPlans, hostingSubscriptions, siteDomains, sites, users } from '@nuxflow/db/schema'
import { useDb, type Db } from './db'
import { normalizeDomain } from './domain'
import { resolveStringSetting } from './settings'
import { getAccountsHost } from './accounts-origin'
import { assertWithinPlan, getSitePlan, planMax, type HostingPlan } from './hosting-plans'
import { isHostingPlatform } from './hosting-platform'
import { eventForSite, getPrimarySite } from './site-info'
import { hostingSitesDomain, type HostingContext } from './hosting-billing'
import { sendTemplatedEmail } from './email-template'
import { notifySiteRole } from './notify'
import { CloudflareApiError, createCustomHostname, deleteCustomHostname, DUPLICATE_HOSTNAME_CODE, getCustomHostname, isLive, type SaasConfig } from './cloudflare-saas'
import { domainTaken } from './site-admin'
import { findSite } from './pool-sites'
import { syncSiteDirectory } from './site-directory'
import { POOL_PROTOCOL, assertCompatibleProtocol } from './pool-admin'
import { callPool, poolAdminStub, poolBindings } from './pools'
import { clearSiteCache } from '../middleware/02.multi-site'
import { getClientIp } from './client-ip'

/**
 * Customers' own domains on a hosting platform (Cloudflare for SaaS). A customer connects
 * `www.cafe.co.uk` to their site, points one CNAME at our target (e.g.
 * customers.nuxflow.site), and once Cloudflare reports the hostname and its certificate
 * active they can make it the site's main address. Every other address of the site then
 * redirects to the main one (02.multi-site.ts).
 *
 * The Cloudflare details live on the primary site as server-managed settings, set on
 * Super Admin → Platform: the sites zone's id, an API token for it, and the CNAME target.
 *
 * Cloudflare is always called from here, on the control plane, which holds those details.
 * A site's addresses (`site_domains`) are kept in the database the site lives in — this
 * one, or a member pool's, whose own redirects and the router's directory read them — so
 * every change goes through a DomainStore: local, or the pool's over its binding.
 */

export const SAAS_ZONE_KEY = 'hosting.cf_zone_id'
export const SAAS_TOKEN_KEY = 'hosting.cf_api_token'
export const SAAS_TARGET_KEY = 'hosting.custom_domain_target'

/** A site can have at most this many extra addresses, whatever its plan says. */
export const MAX_DOMAINS_PER_SITE = 10

export type SiteDomain = typeof siteDomains.$inferSelect

/** The CNAME target customers point their domain at (default `customers.<sites domain>`). */
export async function customDomainTarget(primaryEvent: H3Event): Promise<string> {
  const stored = String(await resolveStringSetting(primaryEvent, SAAS_TARGET_KEY) || '').trim().toLowerCase()
  const base = hostingSitesDomain()
  return stored || (base ? `customers.${base}` : '')
}

/** The Cloudflare details, or null while they aren't set on Super Admin → Platform. */
export async function saasConfig(primaryEvent: H3Event): Promise<SaasConfig | null> {
  const [zoneId, apiToken] = await Promise.all([
    resolveStringSetting(primaryEvent, SAAS_ZONE_KEY),
    resolveStringSetting(primaryEvent, SAAS_TOKEN_KEY),
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

/** A customer's hosted site, wherever it lives. */
export interface HostedSite {
  id: string
  name: string
  domain: string
  hostingPlanId: string | null
  /** The member pool it lives in, or null for this Worker's own sites. */
  poolId: string | null
}

/** The customer's own hosted site behind one of their sign-ups, or a 404. */
export async function ownedHostedSite(ctx: HostingContext, userId: string, subscriptionId: string): Promise<HostedSite> {
  const [sub] = await ctx.db.select({ siteId: hostingSubscriptions.hostedSiteId })
    .from(hostingSubscriptions)
    .where(and(eq(hostingSubscriptions.id, subscriptionId), eq(hostingSubscriptions.ownerUserId, userId)))
    .limit(1)
  const site = sub?.siteId ? await findSite(ctx.primaryEvent, sub.siteId) : null
  if (!site) throw notFound('Site not found')
  return { id: site.id, name: site.name, domain: site.domain, hostingPlanId: site.hostingPlanId, poolId: site.poolId }
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

// ── Where a site's addresses are kept ────────────────────────────────────────────────

export interface NewCustomDomain {
  id: string
  hostname: string
  cfCustomHostnameId: string
  status: string
  sslStatus: string | null
  verificationErrors: string[]
}

export interface DomainStatus {
  status: string
  sslStatus: string | null
  verificationErrors: string[]
}

export interface DomainStore {
  rows(): Promise<SiteDomain[]>
  /** Throws when the site may not have another domain of its own (the per-site cap, its plan). */
  assertCanAdd(): Promise<void>
  /** Throws a 409 when the name is already connected to a site. */
  insert(row: NewCustomDomain): Promise<SiteDomain>
  setStatus(id: string, status: DomainStatus): Promise<void>
  /** True for the one caller that gets to tell the owner the domain works. */
  claimLiveNotice(id: string): Promise<boolean>
  makeMain(hostname: string): Promise<void>
  remove(hostname: string): Promise<void>
}

/** The addresses of a site in this Worker's database. */
export function localDomainStore(event: H3Event, siteId: string): DomainStore {
  const db = useDb(event)
  return {
    rows: () => listSiteDomains(db, siteId),

    async assertCanAdd() {
      const [count] = await db.select({ n: sql<number>`count(*)` }).from(siteDomains).where(and(eq(siteDomains.siteId, siteId), eq(siteDomains.kind, 'custom')))
      if (Number(count?.n ?? 0) >= MAX_DOMAINS_PER_SITE) throw conflict(`A site can have up to ${MAX_DOMAINS_PER_SITE} of its own domains.`)
      await assertWithinPlan(event, 'domains', 1, siteId)
    },

    async insert(row) {
      try {
        await db.insert(siteDomains).values({ ...row, siteId, kind: 'custom', lastCheckedAt: new Date().toISOString() })
      }
      catch (err) {
        console.error('[hosting-domains] Insert failed', row.hostname, err)
        throw conflict('That domain is already connected to a site.')
      }
      return (await db.query.siteDomains.findFirst({ where: and(eq(siteDomains.id, row.id), eq(siteDomains.siteId, siteId)) }))!
    },

    async setStatus(id, status) {
      await db.update(siteDomains)
        .set({ ...status, lastCheckedAt: new Date().toISOString(), updatedAt: sql`(datetime('now'))` })
        .where(and(eq(siteDomains.id, id), eq(siteDomains.siteId, siteId)))
    },

    async claimLiveNotice(id) {
      // A conditional update, so two checks at once tell the owner only once.
      const [claimed] = await db.update(siteDomains)
        .set({ liveNotifiedAt: new Date().toISOString() })
        .where(and(eq(siteDomains.id, id), eq(siteDomains.siteId, siteId), sql`${siteDomains.liveNotifiedAt} is null`))
        .returning({ id: siteDomains.id })
      return !!claimed
    },

    async makeMain(hostname) {
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
    },

    async remove(hostname) {
      await db.delete(siteDomains).where(and(eq(siteDomains.siteId, siteId), eq(siteDomains.hostname, hostname)))
      clearSiteCache(hostname)
    },
  }
}

export type DomainOp =
  | { op: 'rows' }
  | { op: 'assertCanAdd' }
  | { op: 'insert'; row: NewCustomDomain }
  | { op: 'setStatus'; id: string; status: DomainStatus }
  | { op: 'claimLiveNotice'; id: string }
  | { op: 'makeMain'; hostname: string }
  | { op: 'remove'; hostname: string }

/**
 * A refusal crosses the pool binding as a value: a thrown error arrives as a bare message,
 * and the customer should still see "your plan doesn't include…" as a 403, not a 500.
 */
export type DomainOpResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { statusCode: number; message: string; data?: unknown } }

/** The addresses of a site in a member pool, kept there and changed over its binding. */
function poolDomainStore(event: H3Event, poolId: string, siteId: string): DomainStore {
  const stub = poolAdminStub(event, poolId)
  if (!stub) throw createError({ statusCode: 503, message: `Pool "${poolId}" isn't connected to this control panel.` })
  const call = async <T>(op: DomainOp): Promise<T> => {
    const result = await callPool(stub.siteDomains({ protocol: POOL_PROTOCOL, siteId, op }), `pool ${poolId}`)
    if (!result.ok) throw createError(result.error)
    return result.value as T
  }
  return {
    rows: () => call<SiteDomain[]>({ op: 'rows' }),
    assertCanAdd: () => call<undefined>({ op: 'assertCanAdd' }),
    insert: row => call<SiteDomain>({ op: 'insert', row }),
    setStatus: (id, status) => call<undefined>({ op: 'setStatus', id, status }),
    claimLiveNotice: id => call<boolean>({ op: 'claimLiveNotice', id }),
    makeMain: hostname => call<undefined>({ op: 'makeMain', hostname }),
    remove: hostname => call<undefined>({ op: 'remove', hostname }),
  }
}

export function domainStore(event: H3Event, site: { id: string; poolId: string | null }): DomainStore {
  return site.poolId ? poolDomainStore(event, site.poolId, site.id) : localDomainStore(event, site.id)
}

/** A member pool doing what its control plane asks to one of its sites' addresses. */
export async function poolSiteDomains(event: H3Event, input: { protocol: number; siteId: string; op: DomainOp }): Promise<DomainOpResult> {
  assertCompatibleProtocol(input.protocol)
  const store = localDomainStore(event, input.siteId)
  const { op } = input
  try {
    switch (op.op) {
      case 'rows': return { ok: true, value: await store.rows() }
      case 'assertCanAdd': return { ok: true, value: await store.assertCanAdd() }
      case 'insert': return { ok: true, value: await store.insert(op.row) }
      case 'setStatus': return { ok: true, value: await store.setStatus(op.id, op.status) }
      case 'claimLiveNotice': return { ok: true, value: await store.claimLiveNotice(op.id) }
      case 'makeMain': return { ok: true, value: await store.makeMain(op.hostname) }
      case 'remove': return { ok: true, value: await store.remove(op.hostname) }
      default: throw new Error(`Unknown domain operation: ${(op as { op: string }).op}`)
    }
  }
  catch (err) {
    const e = err as { statusCode?: number; message?: string; data?: unknown }
    if (typeof e?.statusCode === 'number' && e.statusCode < 500) {
      return { ok: false, error: { statusCode: e.statusCode, message: e.message ?? 'Refused', ...(e.data !== undefined ? { data: e.data } : {}) } }
    }
    throw err
  }
}

/** A member pool's custom domains that aren't live yet, for the control plane's hourly check. */
export async function poolPendingDomains(event: H3Event, input: { protocol: number; limit: number }): Promise<PendingDomain[]> {
  assertCompatibleProtocol(input.protocol)
  return pendingCustomDomains(useDb(event), Math.min(200, Math.max(1, Math.floor(input.limit))))
}

export type PendingDomain = SiteDomain & { siteName: string }

async function pendingCustomDomains(db: Db, limit: number): Promise<PendingDomain[]> {
  const rows = await db.select().from(siteDomains)
    .where(and(eq(siteDomains.kind, 'custom'), isNotNull(siteDomains.cfCustomHostnameId), sql`${siteDomains.liveNotifiedAt} is null`))
    .orderBy(sql`coalesce(${siteDomains.lastCheckedAt}, '')`)
    .limit(limit)
  if (!rows.length) return []
  const names = await db.select({ id: sites.id, name: sites.name }).from(sites).where(inArray(sites.id, [...new Set(rows.map(r => r.siteId))]))
  return rows.map(r => ({ ...r, siteName: names.find(n => n.id === r.siteId)?.name ?? 'a customer site' }))
}

/** After a pool site's addresses change, the router learns them now rather than within the hour. */
async function rerouteIfPooled(ctx: HostingContext, site: { poolId: string | null }): Promise<void> {
  if (!site.poolId) return
  try {
    await syncSiteDirectory(ctx.primaryEvent)
  }
  catch (err) {
    console.error('[hosting-domains] Directory sync failed (the hourly sync will catch up):', err)
  }
}

// ── What the customer does ──────────────────────────────────────────────────────────

async function ownAddresses(ctx: HostingContext): Promise<{ sitesDomain: string, protectedHosts: string[] }> {
  const accounts = getAccountsHost()
  return {
    sitesDomain: hostingSitesDomain(),
    protectedHosts: [ctx.primary.domain.replace(/^www\./, ''), ...(accounts ? [accounts] : [])],
  }
}

/** Connects a customer's own domain to their site and registers it with Cloudflare. */
export async function addCustomDomain(ctx: HostingContext, site: HostedSite, input: string): Promise<SiteDomain> {
  const host = normalizeDomain(input)
  const problem = customDomainProblem(host, await ownAddresses(ctx))
  if (problem) throw validationError(problem)
  const hostname = host!

  const cfg = await saasConfig(ctx.primaryEvent)
  if (!cfg) throw createError({ statusCode: 503, message: "Connecting your own domain isn't available yet. Please contact us." })

  const store = domainStore(ctx.primaryEvent, site)
  await store.assertCanAdd()
  // Every site's addresses, including those the router sends to a pool.
  if (await domainTaken(ctx.db, hostname)) throw conflict('That domain is already connected to a site.')

  let cf
  try {
    cf = await createCustomHostname(cfg, hostname)
  }
  catch (err) {
    if (err instanceof CloudflareApiError && err.codes.includes(DUPLICATE_HOSTNAME_CODE)) throw conflict('That domain is already connected to a site.')
    console.error('[hosting-domains] Cloudflare refused', hostname, err)
    throw createError({ statusCode: 502, message: `Cloudflare couldn't add that domain: ${(err as Error).message}` })
  }

  let row: SiteDomain
  try {
    row = await store.insert({ id: ulid(), hostname, cfCustomHostnameId: cf.id, status: cf.status, sslStatus: cf.sslStatus, verificationErrors: cf.errors })
  }
  catch (err) {
    // Lost a race with someone adding the same name (or the pool didn't answer): don't
    // leave an orphan at Cloudflare.
    await deleteCustomHostname(cfg, cf.id).catch(() => {})
    throw err
  }
  await rerouteIfPooled(ctx, site)
  return row
}

/**
 * Re-reads a custom domain's status from Cloudflare. The first time it's fully live the
 * site's owner is emailed (and the operator notified), once.
 */
export async function refreshCustomDomain(ctx: HostingContext, store: DomainStore, row: SiteDomain, siteName: string): Promise<SiteDomain> {
  if (row.kind !== 'custom' || !row.cfCustomHostnameId) return row
  const cfg = await saasConfig(ctx.primaryEvent)
  if (!cfg) return row
  const cf = await getCustomHostname(cfg, row.cfCustomHostnameId)
  const status: DomainStatus = { status: cf.status, sslStatus: cf.sslStatus, verificationErrors: cf.errors }
  await store.setStatus(row.id, status)
  let current: SiteDomain = { ...row, ...status }

  if (isLive(cf) && !row.liveNotifiedAt && await store.claimLiveNotice(row.id)) {
    current = { ...current, liveNotifiedAt: new Date().toISOString() }
    await tellDomainLive(ctx, current, siteName)
  }
  return current
}

async function tellDomainLive(ctx: HostingContext, row: SiteDomain, siteName: string) {
  // The sign-up (and the owner's account) are always here, wherever the site lives.
  const [owner] = await ctx.db.select({ email: users.email })
    .from(hostingSubscriptions)
    .innerJoin(users, eq(users.id, hostingSubscriptions.ownerUserId))
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
            `${row.hostname} now reaches ${siteName}, with a secure (https) certificate.`,
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
      body: `${row.hostname} is live for ${siteName}.`,
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
export async function makeMainDomain(ctx: HostingContext, site: HostedSite, hostname: string): Promise<void> {
  await domainStore(ctx.primaryEvent, site).makeMain(hostname)
}

/** Disconnects an extra address. The main address can't be removed. */
export async function removeSiteDomain(ctx: HostingContext, site: HostedSite, hostname: string): Promise<void> {
  if (site.domain === hostname) throw conflict('This is your main address. Make another address the main one first.')
  const store = domainStore(ctx.primaryEvent, site)
  const row = (await store.rows()).find(r => r.hostname === hostname)
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
  await store.remove(hostname)
  await rerouteIfPooled(ctx, site)
}

/**
 * Before a site is deleted: removes its domains from Cloudflare. Best effort — a domain
 * left at Cloudflare costs at most $0.10 a month and can be removed in the dashboard, so
 * it's logged rather than allowed to block the deletion. A member pool has no Cloudflare
 * details, so its control plane does this for a pool's site, passing the site's rows.
 */
export async function removeDomainsForDeletedSite(event: H3Event, siteId: string, rows?: SiteDomain[]): Promise<string[]> {
  const custom = (rows ?? await useDb(event).select().from(siteDomains)
    .where(and(eq(siteDomains.siteId, siteId), eq(siteDomains.kind, 'custom'), isNotNull(siteDomains.cfCustomHostnameId))))
    .filter(r => r.kind === 'custom' && r.cfCustomHostnameId)
  if (!custom.length) return []
  const primary = await getPrimarySite(event)
  const cfg = primary ? await saasConfig(eventForSite(event, primary.id)) : null
  const left: string[] = []
  for (const row of custom) {
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
 * Before a pool's site is deleted (by the pool, which can't reach Cloudflare): its domains
 * go from Cloudflare. Best effort too — a pool that can't list them doesn't block it.
 */
export async function removePoolSiteDomains(event: H3Event, poolId: string, siteId: string): Promise<void> {
  try {
    await removeDomainsForDeletedSite(event, siteId, await poolDomainStore(event, poolId, siteId).rows())
  }
  catch (err) {
    console.error(JSON.stringify({ event: 'site.delete.custom_domain_failed', siteId, poolId, error: (err as Error).message }))
  }
}

/**
 * Hourly: re-checks custom domains that aren't live yet (at most `limit` per run, oldest
 * check first) — this Worker's and every member pool's — so the owner is told when theirs
 * starts working without having to press "Check now".
 */
export async function checkPendingCustomDomains(event: H3Event, limit = 50): Promise<{ checked: number, live: number }> {
  const db = useDb(event)
  if (!(await isHostingPlatform(db))) return { checked: 0, live: 0 }
  const primary = await getPrimarySite(event)
  if (!primary) return { checked: 0, live: 0 }
  const ctx: HostingContext = { db, primary, primaryEvent: eventForSite(event, primary.id) }
  if (!(await saasConfig(ctx.primaryEvent))) return { checked: 0, live: 0 }

  const pending: { row: PendingDomain; poolId: string | null }[] = (await pendingCustomDomains(db, limit)).map(row => ({ row, poolId: null }))
  for (const { binding, stub } of poolBindings(event)) {
    try {
      const [status, rows] = await Promise.all([
        callPool(stub.status(), binding),
        callPool(stub.pendingDomains({ protocol: POOL_PROTOCOL, limit }), binding),
      ])
      if (status.poolId) pending.push(...rows.map(row => ({ row, poolId: status.poolId })))
    }
    catch (err) {
      console.error(`[hosting-domains] Couldn't get ${binding}'s pending domains:`, err)
    }
  }

  let live = 0
  for (const { row, poolId } of pending) {
    try {
      const after = await refreshCustomDomain(ctx, domainStore(event, { id: row.siteId, poolId }), row, row.siteName)
      if (isLive(after)) live++
    }
    catch (err) {
      console.error('[hosting-domains] Check failed for', row.hostname, err)
    }
  }
  return { checked: pending.length, live }
}

/** The plan a site is on — for a pool's site, read from the plans here (pools hold copies). */
async function hostedSitePlan(db: Db, site: HostedSite): Promise<HostingPlan | null> {
  if (!site.poolId) return getSitePlan(db, site.id)
  if (!site.hostingPlanId) return null
  const [plan] = await db.select().from(hostingPlans).where(eq(hostingPlans.id, site.hostingPlanId)).limit(1)
  return plan ?? null
}

/** Everything the "Your addresses" panel needs for one site. */
export async function domainPanel(ctx: HostingContext, site: HostedSite) {
  const [rows, cfg, target, plan] = await Promise.all([
    domainStore(ctx.primaryEvent, site).rows(),
    saasConfig(ctx.primaryEvent),
    customDomainTarget(ctx.primaryEvent),
    hostedSitePlan(ctx.db, site),
  ])
  return {
    available: !!cfg && !!target,
    target,
    allowed: planMax(plan, 'domains'),
    used: rows.filter(r => r.kind === 'custom').length,
    domains: describeDomains(site, rows),
  }
}

/**
 * Audit row on the customer's site (the accounts origin has no site of its own in
 * context). A pool's site keeps its audit log in the pool, out of reach here, so its row
 * goes on the operator's primary site instead, naming the site and pool.
 */
export async function logDomainChange(ctx: HostingContext, event: H3Event, site: HostedSite, userId: string, action: 'create' | 'update' | 'delete', hostname: string) {
  await ctx.db.insert(auditLogs).values({
    id: ulid(),
    siteId: site.poolId ? ctx.primary.id : site.id,
    userId,
    action,
    resource: 'site_domain',
    resourceId: hostname,
    after: { hostname, ...(site.poolId ? { siteId: site.id, poolId: site.poolId } : {}) },
    ipAddress: getClientIp(event) ?? null,
    userAgent: getHeader(event, 'user-agent') ?? null,
  })
}
