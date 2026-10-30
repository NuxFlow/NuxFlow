import type { H3Event } from 'h3'
import { eq, inArray } from 'drizzle-orm'
import { ulid } from 'ulid'
import { auditLogs, contentTypes, hostingPlans, siteDirectory, sites, userSiteRoles, users } from '@nuxflow/db/schema'
import { useDb } from './db'
import { isMemberPool } from './control-plane'
import { POOL_PROTOCOL, assertCompatibleProtocol } from './pool-admin'
import { callPool, poolAdminStub, poolBindings } from './pools'
import { assertDomainAvailable, knownUserId, updateSiteRecord, type SiteChanges } from './site-admin'
import { seedNewSite, type SiteTemplate } from './site-seeding'
import { deleteSiteCompletely, prepareSiteDeletion, sitePeople, type SitePeople } from './site-deletion'
import { clearHostingPlanCache, refreshSitesAfterPlanChange } from './hosting-plans'
import { pendingInvitationInsert } from './invitations'
import { upsertUserCopy } from './pool-session'
import { findOrCreateLocalAccount, isUnclaimedAccount, type AccountProvisioningStatus } from './user-provisioning'
import { sendSetPasswordEmailForPool, type PoolSignInUser } from './pool-sign-in'
import { syncSiteDirectory } from './site-directory'
import { isServedCopy } from './move-state'
import { sendTemplatedEmail } from './email-template'
import { emailLogTimestamp, lastEmailOutcome, type EmailDeliveryOutcome } from './email'
import { eventForSite, getPrimarySite } from './site-info'
import { clearSiteCache } from './site-resolution'
import { poolBindingName } from '../../shared/lib/pool-id'
import { httpError } from './response'
import { httpErrorStatus } from './errors'

/**
 * Sites in member pools (control-plane.ts), managed from the control plane's Super Admin →
 * Sites: created straight into a pool with an owner, edited, deleted. The control plane
 * decides and asks; the pool does the work in its own D1 over its private
 * NuxflowPoolAdmin binding, with the same code the control plane uses for its own sites
 * (site-admin.ts, site-seeding.ts, site-deletion.ts). Hosting plans are copied to every
 * pool (pushPlansToPools), so a pool site's limits are checked locally, unchanged.
 */

export type HostingPlanRow = typeof hostingPlans.$inferSelect

export interface NewPoolSite {
  id: string
  name: string
  domain: string
  locale: string
  timezone: string
  template: SiteTemplate
  /** Optional: a hosting sign-up's plan (the pool must have it — pushPlansToPools first). */
  hostingPlanId?: string | null
}

// ── The pool's side ──────────────────────────────────────────────────────────────────

/**
 * Creates a ready-to-use site here, seeded like a hosted sign-up's (hosting-billing.ts),
 * with the owner as its admin — or, for an account nobody has proven they own, a pending
 * invitation that becomes the role once they verify the address. Safe to repeat.
 */
export async function poolCreateSite(event: H3Event, input: {
  protocol: number
  site: NewPoolSite
  owner: PoolSignInUser
  ownerStatus: AccountProvisioningStatus
  actorUserId: string | null
}): Promise<{ created: boolean; pending: boolean }> {
  assertCompatibleProtocol(input.protocol)
  if (!isMemberPool()) throw new Error('Only a member pool creates sites for its control plane.')
  const db = useDb(event)
  const { site, owner } = input
  const domain = await assertDomainAvailable(db, site.domain, site.id)

  // The owner's copy first: the seeded homepage and the role point at it.
  await upsertUserCopy(db, owner)
  if (site.hostingPlanId && !(await db.query.hostingPlans.findFirst({ where: eq(hostingPlans.id, site.hostingPlanId), columns: { id: true } }))) {
    throw validationError('That hosting plan isn\'t in this pool yet — send the plans first.')
  }
  const [inserted] = await db.insert(sites).values({
    id: site.id,
    name: site.name,
    domain,
    locale: site.locale,
    timezone: site.timezone,
    status: 'active',
    setupCompleted: true,
    hostingPlanId: site.hostingPlanId ?? null,
  }).onConflictDoNothing().returning({ id: sites.id })
  const [seeded] = await db.select({ id: contentTypes.id }).from(contentTypes).where(eq(contentTypes.siteId, site.id)).limit(1)
  if (!seeded) await seedNewSite(db, { siteId: site.id, siteName: site.name, authorId: owner.id, template: site.template })

  // A staff role in this pool vouches for the account too (the control plane only sees its own sites').
  const claimed = input.ownerStatus !== 'unclaimed' || !(await isUnclaimedAccount(db, owner.id, owner.emailVerified))
  const role = await db.query.userSiteRoles.findFirst({ where: (r, { and }) => and(eq(r.userId, owner.id), eq(r.siteId, site.id)), columns: { id: true } })
  if (!role && claimed) await db.insert(userSiteRoles).values({ id: ulid(), userId: owner.id, siteId: site.id, role: 'admin' }).onConflictDoNothing()
  if (!role && !claimed) await pendingInvitationInsert(db, { siteId: site.id, userId: owner.id, role: 'admin', invitedBy: null })

  if (inserted) {
    await db.insert(auditLogs).values({
      id: ulid(),
      siteId: site.id,
      userId: await knownUserId(db, input.actorUserId),
      action: 'create',
      resource: 'site',
      resourceId: site.id,
      after: { domain, name: site.name, via: 'control_plane', owner: owner.email },
    })
  }
  clearSiteCache(domain)
  return { created: !!inserted, pending: !claimed }
}

export async function poolUpdateSite(event: H3Event, input: { protocol: number; siteId: string; changes: SiteChanges; actorUserId: string | null; quiet?: boolean }): Promise<{ updated: boolean }> {
  assertCompatibleProtocol(input.protocol)
  return { updated: await updateSiteRecord(event, input.siteId, input.changes, input.actorUserId, { quiet: input.quiet }) }
}

export interface SiteSummary {
  id: string
  name: string
  domain: string
  status: string
  hostingPlanId: string | null
}

export async function poolGetSite(event: H3Event, input: { protocol: number; siteId: string }): Promise<SiteSummary | null> {
  assertCompatibleProtocol(input.protocol)
  const [site] = await useDb(event).select({ id: sites.id, name: sites.name, domain: sites.domain, status: sites.status, hostingPlanId: sites.hostingPlanId })
    .from(sites).where(eq(sites.id, input.siteId)).limit(1)
  return site ?? null
}

/**
 * The refusable steps of deleting a pool site (memberships, move state), run before the
 * control plane cancels its hosting or removes its domains. A refusal comes back as a value
 * (as with `siteDomains`) so the operator sees its message and status.
 */
export async function poolPrepareSiteDeletion(event: H3Event, input: { protocol: number; siteId: string }): Promise<PoolPrepareResult> {
  assertCompatibleProtocol(input.protocol)
  const [site] = await useDb(event).select({ id: sites.id }).from(sites).where(eq(sites.id, input.siteId)).limit(1)
  if (!site) return { ok: true, found: false }
  try {
    await prepareSiteDeletion(event, input.siteId)
    return { ok: true, found: true }
  }
  catch (err) {
    const e = err as { message?: string; data?: unknown }
    const status = httpErrorStatus(err)
    if (status !== undefined && status < 500) {
      return { ok: false, error: { statusCode: status, message: e.message ?? 'Refused', ...(e.data !== undefined ? { data: e.data } : {}) } }
    }
    throw err
  }
}

export type PoolPrepareResult =
  | { ok: true; found: boolean }
  | { ok: false; error: { statusCode: number; message: string; data?: unknown } }

export async function poolDeleteSite(event: H3Event, input: { protocol: number; siteId: string; actorUserId: string | null }): Promise<{ deleted: boolean; failedMediaDeletes: string[]; leftoverDomains?: string[]; people?: SitePeople }> {
  assertCompatibleProtocol(input.protocol)
  const db = useDb(event)
  const [site] = await db.select({ id: sites.id }).from(sites).where(eq(sites.id, input.siteId)).limit(1)
  if (!site) return { deleted: false, failedMediaDeletes: [] }
  // Who the site had, for the control plane, which holds the real accounts (this pool only
  // erases its copies) and deletes the ones nothing needs any more.
  const people = await sitePeople(db, input.siteId)
  // The operator may never have signed in to this pool, so may have no copy here to name.
  const { failedMediaDeletes, leftoverDomains } = await deleteSiteCompletely(event, input.siteId, await knownUserId(db, input.actorUserId))
  return { deleted: true, failedMediaDeletes, leftoverDomains, people }
}

/**
 * Replaces this pool's copy of the hosting plans with the control plane's. A plan that's
 * gone is taken off its sites here too, as deleting it does on the control plane; sites
 * whose plan changed get fresh caches (a plan's features show in public, cached JSON).
 */
export async function poolSetPlans(event: H3Event, input: { protocol: number; plans: HostingPlanRow[] }): Promise<{ stored: number }> {
  assertCompatibleProtocol(input.protocol)
  if (!isMemberPool()) throw new Error('Only a member pool takes plans from a control plane.')
  const db = useDb(event)
  const before = new Map((await db.select().from(hostingPlans)).map(p => [p.id, JSON.stringify(p)]))
  const incoming = new Map(input.plans.map(p => [p.id, p]))
  const changed: string[] = []

  for (const plan of input.plans) {
    if (before.get(plan.id) === JSON.stringify(plan)) continue
    changed.push(plan.id)
    const { id: _id, ...fields } = plan
    await db.insert(hostingPlans).values(plan).onConflictDoUpdate({ target: hostingPlans.id, set: fields })
  }
  const removed = [...before.keys()].filter(id => !incoming.has(id))
  // Noted before their plan is taken off them, so their caches can be refreshed below.
  const lostPlan = removed.length ? await db.select({ id: sites.id }).from(sites).where(inArray(sites.hostingPlanId, removed)) : []
  if (removed.length) {
    await db.update(sites).set({ hostingPlanId: null }).where(inArray(sites.hostingPlanId, removed))
    await db.delete(hostingPlans).where(inArray(hostingPlans.id, removed))
  }

  clearHostingPlanCache()
  const changedPlan = changed.length ? await db.select({ id: sites.id }).from(sites).where(inArray(sites.hostingPlanId, changed)) : []
  const refresh = [...new Set([...changedPlan, ...lostPlan].map(s => s.id))]
  if (refresh.length) await refreshSitesAfterPlanChange(event, refresh)
  return { stored: input.plans.length }
}

// ── The control plane's side ─────────────────────────────────────────────────────────

/** The pool a site lives in (per the site directory), if any and if it's bound here. */
export async function sitePool(event: H3Event, siteId: string) {
  const [listed] = await useDb(event).select({ poolId: siteDirectory.poolId }).from(siteDirectory)
    .where(eq(siteDirectory.poolSiteId, siteId)).limit(1)
  if (!listed) return null
  const stub = poolAdminStub(event, listed.poolId)
  if (!stub) throw httpError({ status: 503, message: `This site is in pool "${listed.poolId}", which isn't connected to this control panel.` })
  return { poolId: listed.poolId, stub }
}

/** Sends every hosting plan to the pools (all, or just those bindings). Throws on the first that can't take them. */
export async function pushPlansToPools(event: H3Event, onlyBindings?: string[]): Promise<void> {
  const plans = await useDb(event).select().from(hostingPlans)
  for (const { binding, stub } of poolBindings(event)) {
    if (onlyBindings && !onlyBindings.includes(binding)) continue
    await callPool(stub.setPlans({ protocol: POOL_PROTOCOL, plans }), binding)
  }
}

/**
 * Has a pool create a site for an owner whose account exists here, then routes its
 * address there — no emails (callers send their own). Used by Super Admin → Sites and by
 * hosting sign-ups (hosting-billing.ts provisionHostedSite).
 */
export async function placeSiteInPool(event: H3Event, input: {
  poolId: string
  site: NewPoolSite
  ownerUserId: string
  ownerStatus: AccountProvisioningStatus
  actorUserId: string | null
}): Promise<{ pending: boolean; owner: PoolSignInUser }> {
  const stub = poolAdminStub(event, input.poolId)
  if (!stub) throw validationError(`There's no pool "${input.poolId}" connected to this control panel.`)
  const [row] = await useDb(event).select({ id: users.id, name: users.name, email: users.email, emailVerified: users.emailVerified, image: users.image })
    .from(users).where(eq(users.id, input.ownerUserId)).limit(1)
  if (!row) throw new Error('The owner\'s account wasn\'t found.')
  const owner = { ...row, image: row.image ?? null }

  // Plans first, so the site can be given one straight away.
  await pushPlansToPools(event, [poolBindingName(input.poolId)])
  const { pending } = await callPool(stub.createSite({
    protocol: POOL_PROTOCOL,
    site: input.site,
    owner,
    ownerStatus: input.ownerStatus,
    actorUserId: input.actorUserId,
  }), `pool ${input.poolId}`)

  // The router sends the new address to the pool from now on (within about a minute).
  await syncSiteDirectory(event)
  return { pending, owner }
}

// ── Any site, wherever it lives (hosting billing) ─────────────────────────────────────

/** A site on this control plane or in a member pool, with the pool it's in (null = here). */
export async function findSite(event: H3Event, siteId: string): Promise<(SiteSummary & { poolId: string | null }) | null> {
  const [local] = await useDb(event).select({ id: sites.id, name: sites.name, domain: sites.domain, status: sites.status, hostingPlanId: sites.hostingPlanId, moveState: sites.moveState })
    .from(sites).where(eq(sites.id, siteId)).limit(1)
  // A copy mid-move that isn't the live one doesn't count: the live one is in a pool.
  if (local && isServedCopy(local.moveState)) return { id: local.id, name: local.name, domain: local.domain, status: local.status, hostingPlanId: local.hostingPlanId, poolId: null }
  const pool = await sitePool(event, siteId)
  if (!pool) return null
  const site = await callPool(pool.stub.getSite({ protocol: POOL_PROTOCOL, siteId }), `pool ${pool.poolId}`)
  return site ? { ...site, poolId: pool.poolId } : null
}

/**
 * Changes a site's status or plan wherever it lives, quietly (no "your site was put into
 * maintenance" notice to its admins — billing emails the owner itself).
 */
export async function changeSite(event: H3Event, site: { id: string; poolId: string | null }, changes: Pick<SiteChanges, 'status' | 'hostingPlanId'>): Promise<void> {
  if (!site.poolId) {
    await updateSiteRecord(event, site.id, changes, null, { quiet: true })
    return
  }
  const stub = poolAdminStub(event, site.poolId)
  if (!stub) throw httpError({ status: 503, message: `Pool "${site.poolId}" isn't connected to this control panel.` })
  if (changes.hostingPlanId) await pushPlansToPools(event, [poolBindingName(site.poolId)])
  await callPool(stub.updateSite({ protocol: POOL_PROTOCOL, siteId: site.id, changes, actorUserId: null, quiet: true }), `pool ${site.poolId}`)
}

export interface CreateInPoolInput {
  poolId: string
  name: string
  domain: string
  locale: string
  timezone: string
  owner: { name: string; email: string }
}

/**
 * Super Admin → Sites → New site, in a pool: makes (or finds) the owner's account here,
 * has the pool create the site, routes its address there, and tells the owner — a
 * set-password email for a new or unproven account, otherwise "your site is ready".
 */
export async function createSiteInPool(event: H3Event, input: CreateInPoolInput, actorUserId: string): Promise<{ id: string; domain: string; pending: boolean; emailDelivery: EmailDeliveryOutcome }> {
  const db = useDb(event)
  const stub = poolAdminStub(event, input.poolId)
  if (!stub) throw validationError(`There's no pool "${input.poolId}" connected to this control panel.`)
  const domain = await assertDomainAvailable(db, input.domain, null)

  const { userId, status } = await findOrCreateLocalAccount(event, { name: input.owner.name, email: input.owner.email })
  const id = ulid()
  const { pending, owner } = await placeSiteInPool(event, {
    poolId: input.poolId,
    site: { id, name: input.name, domain, locale: input.locale, timezone: input.timezone, template: 'landing' },
    ownerUserId: userId,
    ownerStatus: status,
    actorUserId,
  })

  let emailDelivery: EmailDeliveryOutcome
  if (status === 'existing') {
    const primary = await getPrimarySite(event)
    if (!primary) {
      emailDelivery = { sent: false, reason: 'No primary site to send from.' }
    } else {
      const since = emailLogTimestamp()
      const primaryEvent = eventForSite(event, primary.id)
      await sendTemplatedEmail(primaryEvent, {
        to: owner.email,
        subject: `Your site ${input.name} is ready`,
        category: 'invite',
        template: {
          heading: 'Your new site is ready',
          paragraphs: [`Hi ${owner.name},`, `${input.name} is live at ${domain}, and you're its admin. Sign in with your existing account to get started.`],
          action: { label: 'Open your site', url: `https://${domain}/_nuxflow/auth/start?${new URLSearchParams({ return_to: '/admin' })}` },
        },
      }).catch(err => console.error('[pool-sites] "Site ready" email failed:', err))
      emailDelivery = await lastEmailOutcome(primaryEvent, primary.id, owner.email, since)
    }
  } else {
    ({ emailDelivery } = await sendSetPasswordEmailForPool(event, { protocol: POOL_PROTOCOL, poolId: input.poolId, siteId: id, email: owner.email, purpose: 'invite' }))
  }
  return { id, domain, pending, emailDelivery }
}

export interface SiteListing {
  id: string
  name: string
  domain: string
  status: string
  locale?: string
  hostingPlanId: string | null
  createdAt: string
  /** The member pool it lives in, or null for this control plane's own sites. */
  poolId: string | null
  /** Locked while being moved to another pool (site-move-job.ts). */
  moving?: boolean
}

/** Every site: the control plane's own, then each reachable pool's. */
export async function listAllSites(event: H3Event): Promise<{ sites: SiteListing[]; unreachablePools: string[] }> {
  const own = (await useDb(event).query.sites.findMany({ limit: 1000 })).filter(s => isServedCopy(s.moveState))
  const listed: SiteListing[] = own.map(s => ({ id: s.id, name: s.name, domain: s.domain, status: s.status, locale: s.locale ?? undefined, hostingPlanId: s.hostingPlanId ?? null, createdAt: s.createdAt, poolId: null, moving: !!s.moveState }))
  const unreachablePools: string[] = []
  await Promise.all(poolBindings(event).map(async ({ binding, stub }) => {
    try {
      const status = await callPool(stub.status(), binding)
      const poolSites = await callPool(stub.listSites(), binding)
      for (const s of poolSites) {
        listed.push({ id: s.id, name: s.name, domain: s.domain, status: s.status, locale: s.locale, hostingPlanId: s.hostingPlanId ?? null, createdAt: s.createdAt, poolId: status.poolId, moving: !!s.moving })
      }
    } catch (err) {
      console.error(`[pool-sites] Couldn't list ${binding}'s sites:`, err)
      unreachablePools.push(binding)
    }
  }))
  return { sites: listed, unreachablePools }
}
