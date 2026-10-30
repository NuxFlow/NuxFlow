import type { H3Event } from 'h3'
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import {
  apiKeys, auditLogs, comments, contentItems, contentRevisions, formSubmissions, media,
  sites, subscriptions, userSiteRoles, users,
} from '@nuxflow/db/schema'
import { buildGdprRedactionStatements } from '@nuxflow/db/queries'
import { useDb, type Db } from './db'
import { getConfiguredPaymentProvider } from './payments/resolve'
import { eventForSite } from './site-info'
import { rethrowAsProviderError } from './errors'
import { batchWithAudit, type buildAuditLogInsert } from './audit'
import { callPool, poolBindings } from './pools'
import { POOL_PROTOCOL, assertCompatibleProtocol } from './pool-admin'
import { httpError } from './response'

/**
 * Account-wide actions — deleting an account and downloading its data — over one
 * database: the control plane's, or (on a hosting platform with member pools) each pool's,
 * which the control plane asks over the pool's private binding. Used by
 * DELETE /api/v1/account and GET /api/v1/account/data-export, and by a pool's
 * NuxflowPoolAdmin entrypoint.
 */

// ── Deleting an account ──────────────────────────────────────────────────────────────

/** Domains of the sites where this user is the only admin — they must hand over first. */
export async function soleAdminDomains(db: Db, userId: string): Promise<string[]> {
  const adminSites = await db.select({ siteId: userSiteRoles.siteId, domain: sites.domain })
    .from(userSiteRoles)
    .innerJoin(sites, eq(sites.id, userSiteRoles.siteId))
    .where(and(eq(userSiteRoles.userId, userId), eq(userSiteRoles.role, 'admin')))
  const domains: string[] = []
  for (const s of adminSites) {
    const [other] = await db.select({ n: sql<number>`count(*)` }).from(userSiteRoles).where(and(
      eq(userSiteRoles.siteId, s.siteId),
      ne(userSiteRoles.userId, userId),
      inArray(userSiteRoles.role, ['admin', 'super_admin']),
    ))
    if (!other?.n) domains.push(s.domain)
  }
  return domains
}

/**
 * Cancels the user's paid memberships, each with its own site's payment credentials.
 * Throws if a provider refuses, so the account isn't deleted while still being billed.
 */
export async function cancelActiveSubscriptions(event: H3Event, userId: string): Promise<void> {
  const activeSubs = await useDb(event).select({
    siteId: subscriptions.siteId,
    provider: subscriptions.provider,
    providerSubscriptionId: subscriptions.providerSubscriptionId,
    domain: sites.domain,
  }).from(subscriptions)
    .innerJoin(sites, eq(sites.id, subscriptions.siteId))
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, ['active', 'trialing'])))

  for (const sub of activeSubs) {
    if (sub.providerSubscriptionId.startsWith('free_')) continue // no real provider behind a free-tier row
    try {
      const provider = await getConfiguredPaymentProvider(eventForSite(event, sub.siteId), sub.provider)
      await provider.cancelSubscription(sub.providerSubscriptionId)
    } catch (err) {
      rethrowAsProviderError(err, `cancellation (${sub.domain})`)
    }
  }
}

/** Redacts what the user wrote (GDPR) and deletes the user, cascading the rest. */
export async function eraseUser(db: Db, userId: string, auditInsert: ReturnType<typeof buildAuditLogInsert> = null): Promise<void> {
  await batchWithAudit(db, [...buildGdprRedactionStatements(db, userId), db.delete(users).where(eq(users.id, userId))], auditInsert)
}

/** Asks every pool where the user is a site's only admin. A pool that can't be reached stops the deletion. */
export async function soleAdminDomainsInPools(event: H3Event, userId: string): Promise<string[]> {
  const answers = await Promise.all(poolBindings(event).map(async ({ binding, stub }) => {
    try {
      return (await callPool(stub.accountDeletionCheck({ protocol: POOL_PROTOCOL, userId }), binding)).soleAdminDomains
    } catch (err) {
      console.error(`[account] ${binding} couldn't be checked before deleting an account:`, err)
      throw httpError({ status: 503, message: 'Part of the platform can\'t be reached right now, so your account can\'t be deleted completely. Please try again in a few minutes.' })
    }
  }))
  return answers.flat()
}

/** Cancels and erases the user's data in every pool. Throws on the first pool that can't. */
export async function deleteAccountInPools(event: H3Event, userId: string): Promise<void> {
  for (const { binding, stub } of poolBindings(event)) {
    try {
      await callPool(stub.deleteAccount({ protocol: POOL_PROTOCOL, userId }), binding)
    } catch (err) {
      console.error(`[account] Deleting an account in ${binding} failed:`, err)
      throw httpError({
        status: 502,
        message: `Your account couldn't be removed from every site yet (${err instanceof Error ? err.message : 'a site couldn\'t be reached'}). It still exists — please try again, and the rest will be finished.`,
      })
    }
  }
}

// ── Downloading an account's data ────────────────────────────────────────────────────

const EXPORT_ROW_LIMIT = 2000

export async function collectUserData(db: Db, userId: string) {
  const [
    siteRoles,
    authoredContent,
    authoredRevisions,
    uploadedMedia,
    authoredComments,
    submissions,
    subs,
    keys,
    logs,
  ] = await Promise.all([
    db.select({
      siteId: userSiteRoles.siteId,
      role: userSiteRoles.role,
      createdAt: userSiteRoles.createdAt,
      siteName: sites.name,
      siteDomain: sites.domain,
    }).from(userSiteRoles)
      .innerJoin(sites, eq(sites.id, userSiteRoles.siteId))
      .where(eq(userSiteRoles.userId, userId)),

    db.select({
      id: contentItems.id, siteId: contentItems.siteId, title: contentItems.title,
      slug: contentItems.slug, status: contentItems.status, createdAt: contentItems.createdAt,
    }).from(contentItems).where(eq(contentItems.authorId, userId)).limit(EXPORT_ROW_LIMIT),

    db.select({
      id: contentRevisions.id, itemId: contentRevisions.itemId, title: contentRevisions.title,
      createdAt: contentRevisions.createdAt,
    }).from(contentRevisions).where(eq(contentRevisions.authorId, userId)).limit(EXPORT_ROW_LIMIT),

    db.select({
      id: media.id, siteId: media.siteId, filename: media.originalName, url: media.url,
      createdAt: media.createdAt,
    }).from(media).where(eq(media.uploadedBy, userId)).limit(EXPORT_ROW_LIMIT),

    db.select({
      id: comments.id, siteId: comments.siteId, itemId: comments.itemId, body: comments.body,
      status: comments.status, createdAt: comments.createdAt,
    }).from(comments).where(eq(comments.authorId, userId)).limit(EXPORT_ROW_LIMIT),

    db.select({
      id: formSubmissions.id, siteId: formSubmissions.siteId, formId: formSubmissions.formId,
      data: formSubmissions.data, createdAt: formSubmissions.createdAt,
    }).from(formSubmissions).where(eq(formSubmissions.userId, userId)).limit(EXPORT_ROW_LIMIT),

    db.select({
      id: subscriptions.id, siteId: subscriptions.siteId, provider: subscriptions.provider,
      status: subscriptions.status, tierId: subscriptions.tierId,
      currentPeriodStart: subscriptions.currentPeriodStart, currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd, createdAt: subscriptions.createdAt,
    }).from(subscriptions).where(eq(subscriptions.userId, userId)),

    db.select({
      id: apiKeys.id, siteId: apiKeys.siteId, name: apiKeys.name, scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt, createdAt: apiKeys.createdAt,
    }).from(apiKeys).where(eq(apiKeys.userId, userId)),

    db.select({
      id: auditLogs.id, siteId: auditLogs.siteId, action: auditLogs.action,
      resource: auditLogs.resource, resourceId: auditLogs.resourceId, createdAt: auditLogs.createdAt,
    }).from(auditLogs).where(eq(auditLogs.userId, userId)).orderBy(desc(auditLogs.createdAt)).limit(EXPORT_ROW_LIMIT),
  ])

  const isTruncated = (rows: unknown[]) => rows.length >= EXPORT_ROW_LIMIT
  return {
    siteRoles,
    authoredContent,
    authoredContentTruncated: isTruncated(authoredContent),
    authoredRevisions,
    authoredRevisionsTruncated: isTruncated(authoredRevisions),
    uploadedMedia,
    uploadedMediaTruncated: isTruncated(uploadedMedia),
    comments: authoredComments,
    commentsTruncated: isTruncated(authoredComments),
    formSubmissions: submissions,
    formSubmissionsTruncated: isTruncated(submissions),
    subscriptions: subs,
    apiKeys: keys,
    auditLog: logs,
    auditLogTruncated: isTruncated(logs),
  }
}

export type UserData = Awaited<ReturnType<typeof collectUserData>>

/** One export from several databases: lists joined, a section truncated anywhere stays flagged. */
export function mergeUserData(parts: UserData[]): UserData {
  const [first, ...rest] = parts
  const merged = structuredClone(first!) as Record<string, unknown>
  for (const part of rest) {
    for (const [key, value] of Object.entries(part)) {
      merged[key] = Array.isArray(value)
        ? [...(merged[key] as unknown[]), ...value]
        : Boolean(merged[key]) || Boolean(value)
    }
  }
  return merged as UserData
}

/** The user's data from every pool, plus the pools that couldn't be reached (so the export says it's incomplete). */
export async function collectUserDataFromPools(event: H3Event, userId: string): Promise<{ parts: UserData[]; unreachable: string[] }> {
  const unreachable: string[] = []
  const parts = await Promise.all(poolBindings(event).map(async ({ binding, stub }) => {
    try {
      return await callPool(stub.exportUserData({ protocol: POOL_PROTOCOL, userId }), binding)
    } catch (err) {
      console.error(`[account] Couldn't export ${binding}'s data for a user:`, err)
      unreachable.push(binding)
      return null
    }
  }))
  return { parts: parts.filter((p): p is UserData => !!p), unreachable }
}

// ── Answers a member pool gives its control plane (NuxflowPoolAdmin) ─────────────────

export async function poolAccountDeletionCheck(event: H3Event, input: { protocol: number; userId: string }): Promise<{ soleAdminDomains: string[] }> {
  assertCompatibleProtocol(input.protocol)
  return { soleAdminDomains: await soleAdminDomains(useDb(event), input.userId) }
}

/**
 * The user's account is being deleted on the control plane: cancel their memberships here
 * and erase their copy and data. Safe to repeat (a user already gone is a no-op).
 */
export async function poolDeleteAccount(event: H3Event, input: { protocol: number; userId: string }): Promise<{ deleted: boolean }> {
  assertCompatibleProtocol(input.protocol)
  const db = useDb(event)
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1)
  if (!user) return { deleted: false }
  await cancelActiveSubscriptions(event, input.userId)
  await eraseUser(db, input.userId)
  return { deleted: true }
}

export async function poolExportUserData(event: H3Event, input: { protocol: number; userId: string }): Promise<UserData> {
  assertCompatibleProtocol(input.protocol)
  return collectUserData(useDb(event), input.userId)
}
