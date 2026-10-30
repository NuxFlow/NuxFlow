import type { H3Event } from 'h3'
import { useDb, type Db } from './db'
import { clearSiteCache } from './site-resolution'
import { deleteStoredMedia, isSiteStorageKey } from './media-providers/storage-delete'
import { writeAuditLog } from './audit'
import { errorMessage } from './errors'
import { conflict } from './response'
import { deleteContentEmbeddings } from './embeddings'
import { cancelHostingForDeletedSite } from './hosting-billing'
import { removeDomainsForDeletedSite } from './hosting-domains'
import { deleteStreamVideo, streamAccountFor, type StreamAccountKind } from './stream'
import { eventForSite } from './site-info'
import { isMemberPool } from './control-plane'
import { callPool, poolBindings } from './pools'
import { assertCompatibleProtocol, POOL_PROTOCOL } from './pool-admin'
import { getCfBindings } from './cf-env'
import { deleteCacheVersion } from './cache-version'
import { getConfiguredPaymentProvider } from './payments/resolve'
import {
  sites, users, userSiteRoles, siteInvitations, hostingSubscriptions, media, contentItems,
  accounts, sessions, passkeys, videoAssets, siteDirectory, subscriptions,
} from '@nuxflow/db/schema'
import { eq, and, ne, or, inArray, isNull, sql } from 'drizzle-orm'

/**
 * Permanently deletes a site and every record scoped to it, including users who
 * have no role on any other site. Callers are responsible for authorization —
 * this performs no permission checks of its own.
 *
 * `actorUserId` is recorded both as a structured console line (survives even
 * when `siteId` is the site currently in request context, since step 4 below
 * deletes that site's own `audit_logs` rows via cascade as part of teardown) and,
 * when the acting request context is scoped to a *different* site than the one
 * being deleted, as a real audit log row that outlives the deletion — written at the
 * end, not the start, so it can record whether any media files failed to delete.
 */
export interface SiteDeletionResult {
  // Storage keys the active media provider failed to delete — the D1 `media` rows are
  // still gone (real FK cascade in step 4 below), but the underlying files may still
  // exist on the provider. Non-empty means an operator needs to check the provider
  // directly; see the note on the deletion loop below for why this can't just retry.
  failedMediaDeletes: string[]
  /** The site's own domains that couldn't be removed from Cloudflare for SaaS. */
  leftoverDomains: string[]
}

/** The people a site had: anyone with a role on it, and anyone only invited to it. */
export interface SitePeople {
  roles: string[]
  invited: string[]
}

/**
 * The primary site (`sites.is_primary`) is the operator's own: it alone inherits the
 * deployment's payment/email env credentials, holds the social-login settings, and
 * receives account-level alerts. Deleting it while tenants remain would silently strip
 * all of that from the platform with nothing to reassign it, so it can only go once it's
 * the last site — counting the sites in member pools, which rely on it just the same. The
 * 409 carries the other sites (`blockingSites`) so the UI can list them.
 */
export async function assertPrimarySiteDeletable(event: H3Event, siteId: string): Promise<void> {
  const db = useDb(event)
  const target = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { isPrimary: true } })
  if (!target?.isPrimary) return
  const others: { id: string; domain: string }[] = await db.query.sites.findMany({ where: ne(sites.id, siteId), columns: { id: true, domain: true } })
  if (!isMemberPool()) {
    // A pool site's main address is its `sites.domain` there; the directory also lists its
    // extra addresses, so take one row per site.
    const poolSites = await db.select({ id: siteDirectory.poolSiteId, domain: sql<string>`min(${siteDirectory.hostname})` })
      .from(siteDirectory).groupBy(siteDirectory.poolSiteId)
    others.push(...poolSites)
  }
  if (others.length > 0) {
    conflict(
      `This is the primary site — delete the other ${others.length} site${others.length === 1 ? '' : 's'} first: ${others.map(s => s.domain).join(', ')}`,
      { blockingSites: others },
    )
  }
}

/**
 * The steps that can refuse a deletion, done before anything is removed, so a refusal
 * leaves the site exactly as it was. A member pool runs this when its control plane asks
 * (`prepareSiteDeletion`), before the control plane cancels hosting or removes domains.
 */
export async function prepareSiteDeletion(event: H3Event, siteId: string): Promise<void> {
  const db = useDb(event)
  const [site] = await db.select({ moveState: sites.moveState }).from(sites).where(eq(sites.id, siteId)).limit(1)
  // A copy in the middle of a move — or the old one, left until the move's clean-up — has
  // media rows naming the same files as the live copy. With a shared bucket, deleting it
  // here would delete the live site's files.
  if (site?.moveState) {
    conflict('This copy of the site is part of a move. Let the move finish (or cancel it) in Super Admin → Sites first, then delete the site.')
  }
  await cancelSiteMemberships(event, siteId)
}

/**
 * Ends every paid membership visitors hold on the site, with the site's own payment
 * credentials. The `subscriptions` rows go with the cascade, but the provider would keep
 * charging those people for a site that no longer exists — so this refuses the deletion
 * (409) if a provider can't be reached, as hosting billing does.
 */
async function cancelSiteMemberships(event: H3Event, siteId: string): Promise<void> {
  const db = useDb(event)
  const paid = await db.select({
    id: subscriptions.id,
    provider: subscriptions.provider,
    providerSubscriptionId: subscriptions.providerSubscriptionId,
  }).from(subscriptions).where(and(
    eq(subscriptions.siteId, siteId),
    inArray(subscriptions.status, ['active', 'trialing', 'past_due', 'unpaid']),
  ))
  const siteEvent = eventForSite(event, siteId)
  for (const sub of paid) {
    if (sub.providerSubscriptionId.startsWith('free_')) continue // no real provider behind a free-tier row
    try {
      const provider = await getConfiguredPaymentProvider(siteEvent, sub.provider)
      await provider.cancelSubscriptionNow(sub.providerSubscriptionId)
    }
    catch (err) {
      conflict(`Couldn't cancel a member's ${sub.provider} subscription (${errorMessage(err, String(err))}). The site's members would keep being charged — cancel it with ${sub.provider} first, then delete the site.`)
    }
    // Recorded at once, so a deletion that fails later doesn't ask the provider again.
    await db.update(subscriptions).set({ status: 'cancelled', cancelledAt: sql`(datetime('now'))`, cancelAtPeriodEnd: false })
      .where(and(eq(subscriptions.id, sub.id), eq(subscriptions.siteId, siteId)))
  }
}

export async function deleteSiteCompletely(event: H3Event, siteId: string, actorUserId: string | null): Promise<SiteDeletionResult> {
  const db = useDb(event)

  await assertPrimarySiteDeletable(event, siteId)
  await prepareSiteDeletion(event, siteId)
  // A site a customer pays for: stop the billing first (refuses if Stripe can't be reached).
  await cancelHostingForDeletedSite(event, siteId)
  // Its own domains are removed from Cloudflare too (best effort: a leftover costs pennies
  // and is reported, so it never blocks the deletion).
  const leftoverDomains = await removeDomainsForDeletedSite(event, siteId)

  console.warn(JSON.stringify({
    event: 'site.delete', siteId, actorUserId, at: new Date().toISOString(),
  }))

  // 1. Delete physical media files from storage. This is the one step here that genuinely
  // can't be a DB-level cascade — the provider (R2, Cloudflare Images) is external
  // storage, not a D1 table, so nothing short of calling its API actually removes the
  // files. Read the rows first (need storageKey), then delete each file; the media *rows*
  // themselves don't need a manual delete here — see step 4 below, which removes them (and
  // every other site-scoped table) via D1's real foreign-key cascade.
  //
  // A failed delete here is a genuine data-retention risk — the whole point of this
  // function is "permanently delete every record for this site," and an uploaded photo
  // can easily be personal data. Each failure is logged with the storage key and returned
  // to the caller so it can surface to whoever triggered the deletion instead of
  // disappearing silently.
  //
  // Files in this Worker's R2 bucket are removed by the prefix sweep in 1b, whichever
  // provider the site uses now (one per file here would also run out of subrequests on a
  // big site). Anything else goes through deleteStoredMedia(), which resolves the provider
  // from the *deleted* site's own settings (not the acting super admin's site — a tenant on
  // its own Cloudflare Images account would otherwise have every delete sent to the wrong
  // storage) and only ever touches keys under that site's own prefix.
  const { r2 } = getCfBindings(event)
  const allMedia = await db.select({ storageKey: media.storageKey, storageProvider: media.storageProvider })
    .from(media).where(eq(media.siteId, siteId))
  const failedMediaDeletes: string[] = []
  for (const file of allMedia) {
    if (r2 && file.storageProvider === 'r2' && isSiteStorageKey(siteId, file.storageKey)) continue
    try {
      if (!(await deleteStoredMedia(event, siteId, file))) failedMediaDeletes.push(file.storageKey)
    }
    catch (err) {
      failedMediaDeletes.push(file.storageKey)
      console.error(JSON.stringify({
        event: 'site.delete.media_failed', siteId, storageKey: file.storageKey,
        error: errorMessage(err, String(err)),
      }))
    }
  }

  // 1b. Everything the site has in R2: media, theme images and received email (raw messages
  // + attachments, under the private prefix) — including files whose rows are long gone or
  // that were left on R2 when the site switched to another provider. Received email is
  // personal data from outside senders, so a failure is surfaced like a media failure.
  if (r2) {
    for (const prefix of siteR2Prefixes(siteId)) {
      try {
        await deleteR2Prefix(r2, prefix)
      }
      catch (err) {
        failedMediaDeletes.push(`${prefix}*`)
        console.error(JSON.stringify({ event: 'site.delete.r2_failed', siteId, prefix, error: errorMessage(err, String(err)) }))
      }
    }
  }

  // 1c. Videos live in Cloudflare Stream — the site's own account or, for a hosted
  // customer, the platform's, which keeps billing for every stored minute. Client films are
  // personal data too, so a failure is surfaced like a media failure.
  const siteVideos = await db.select({ uid: videoAssets.cloudflareStreamId, streamAccount: videoAssets.streamAccount })
    .from(videoAssets).where(eq(videoAssets.siteId, siteId))
  if (siteVideos.length) {
    const siteEvent = eventForSite(event, siteId)
    const streamAccounts = new Map<StreamAccountKind, Awaited<ReturnType<typeof streamAccountFor>>>()
    for (const video of siteVideos) {
      if (!streamAccounts.has(video.streamAccount)) streamAccounts.set(video.streamAccount, await streamAccountFor(siteEvent, video.streamAccount))
      const account = streamAccounts.get(video.streamAccount)
      if (!account || !(await deleteStreamVideo(account, video.uid))) {
        failedMediaDeletes.push(`stream:${video.uid}`)
        console.error(JSON.stringify({ event: 'site.delete.video_failed', siteId, streamId: video.uid, reason: account ? 'stream_refused' : 'no_credentials' }))
      }
    }
  }

  // 2. Everything the site keeps in KV: every published version of every theme's CSS and
  // its demo data, plugin code, its private Stream signing keys and its cache version. The
  // step-4 cascade removes the `themes`/`dynamic_plugins` *rows* but can never touch KV.
  // Best effort — none of it is personal data, so a failure is logged but doesn't block
  // the rest of the deletion.
  try {
    await deleteSiteKv(event, siteId)
  }
  catch (err) {
    console.error(JSON.stringify({ event: 'site.delete.kv_cleanup_failed', siteId, error: errorMessage(err, String(err)) }))
  }

  // 2b. Semantic-search vectors live in Vectorize (namespaced by site), outside D1.
  const siteItemIds = await db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.siteId, siteId))
  await deleteContentEmbeddings(event, siteItemIds.map(r => r.id))

  // 3. Accounts nothing else needs any more. Must be read before step 4, whose cascade
  // removes this site's roles and invitations.
  await deleteUnneededAccounts(event, siteId, await sitePeople(db, siteId))

  // 4. Finally delete the site itself. D1 always enforces foreign keys — it cannot be
  // disabled (see https://developers.cloudflare.com/d1/sql-api/foreign-keys/) — so this
  // one delete real-cascades through every table with an `onDelete: 'cascade'` FK to
  // sites.id (content_items, content_types, taxonomies, site_settings, dynamic_plugins,
  // dynamic_plugin_trust, themes, audit_logs, notifications, api_keys, menus, redirects,
  // comments, forms, membership_tiers, subscriptions, push_subscriptions,
  // ai_generation_jobs, media_folders, video_assets, media, and user_site_roles — see
  // packages/db/src/schema/*.ts for the authoritative list), plus their own further
  // cascades (e.g. content_items -> content_revisions, taxonomies -> taxonomy_terms).
  // There is deliberately no manual per-table batch mirroring that list here — an
  // explicit copy would just be a second, driftable version of what the schema already
  // declares as REFERENCES ... ON DELETE CASCADE, and it would silently go stale exactly
  // like the previous version of this function did (it was missing forms, menus,
  // redirects, comments, membership tiers, subscriptions, push subscriptions, AI
  // generation jobs, media folders, and video assets, among others — those were only ever
  // cleaned up as a side effect of this same real cascade, not because of anything in the
  // old manual batch).
  await db.delete(sites).where(eq(sites.id, siteId))
  clearSiteCache()

  if (event.context.siteId && event.context.siteId !== siteId) {
    await writeAuditLog(event, actorUserId, {
      action: 'delete',
      resource: 'site',
      resourceId: siteId,
      after: failedMediaDeletes.length || leftoverDomains.length ? { failedMediaDeletes, leftoverDomains } : undefined,
    })
  }

  return { failedMediaDeletes, leftoverDomains }
}

/** Where a site's files are in R2 (the same prefixes a site move copies, site-move.ts). */
function siteR2Prefixes(siteId: string): string[] {
  return [`${siteId}/`, `_private/${siteId}/`]
}

async function deleteR2Prefix(r2: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined
  do {
    const page = await r2.list({ prefix, cursor, limit: 1000 })
    const keys = page.objects.map(o => o.key)
    if (keys.length) await r2.delete(keys)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}

/**
 * Every KV key a site owns in this Worker's namespace: `theme:<site>:` (each published CSS
 * version — publishing writes a new key and keeps the old — and demo data),
 * `plugin:<site>:` (code), `stream-key:site:<site>:` (its own Stream signing keys; the
 * platform's are shared and stay) and its cache version.
 */
async function deleteSiteKv(event: H3Event, siteId: string): Promise<void> {
  const { kv } = getCfBindings(event)
  if (!kv) return
  for (const prefix of [`theme:${siteId}:`, `plugin:${siteId}:`, `stream-key:site:${siteId}:`]) {
    let cursor: string | undefined
    do {
      const page = await kv.list({ prefix, cursor })
      await Promise.all(page.keys.map(k => kv.delete(k.name)))
      cursor = page.list_complete ? undefined : page.cursor
    } while (cursor)
  }
  await deleteCacheVersion(kv, siteId)
}

/** Who a site has, read before its roles and invitations go with the cascade. */
export async function sitePeople(db: Db, siteId: string): Promise<SitePeople> {
  const [roles, invitations] = await Promise.all([
    db.select({ userId: userSiteRoles.userId }).from(userSiteRoles).where(eq(userSiteRoles.siteId, siteId)),
    db.select({ userId: siteInvitations.userId }).from(siteInvitations).where(eq(siteInvitations.siteId, siteId)),
  ])
  const roleIds = [...new Set(roles.map(r => r.userId))]
  const invited = [...new Set(invitations.map(r => r.userId))].filter(id => !roleIds.includes(id))
  return { roles: roleIds, invited }
}

/**
 * Deletes the accounts of a deleted site's people that nothing else needs. Someone only
 * invited counts only while their address is unverified: the invitation created that
 * account and its owner never set a password, so it was never theirs to keep. A verified
 * account that was merely invited belongs to someone who signed up themselves.
 *
 * Used for this Worker's own sites, and by the control plane after a member pool deletes
 * one of its sites (the pool only erases its copies of the users; the accounts are here).
 */
export async function deleteUnneededAccounts(event: H3Event, siteId: string, people: SitePeople): Promise<void> {
  const db = useDb(event)
  const unclaimedInvited = people.invited.length
    ? (await db.select({ id: users.id }).from(users).where(and(inArray(users.id, people.invited), eq(users.emailVerified, false)))).map(r => r.id)
    : []
  const candidates = [...people.roles, ...unclaimedInvited]
  if (!candidates.length) return
  const keep = await usersStillNeeded(event, candidates, siteId)
  const toDelete = candidates.filter(uid => !keep.has(uid))
  if (!toDelete.length) return
  // users/accounts/sessions/passkeys have no FK to sites.id at all (accounts are global, not
  // per-site — see the multi-site note in CLAUDE.md), so these deletes are genuinely manual
  // — no cascade from the site delete could ever reach them. Batched so the 4 deletes are
  // one atomic round trip.
  await db.batch([
    db.delete(accounts).where(inArray(accounts.userId, toDelete)),
    db.delete(sessions).where(inArray(sessions.userId, toDelete)),
    db.delete(passkeys).where(inArray(passkeys.userId, toDelete)),
    db.delete(users).where(inArray(users.id, toDelete)),
  ])
}

/**
 * Of a deleted site's users, those whose accounts must stay: anyone with a role or a
 * pending invitation on another site, or a hosting subscription for another site (or one
 * still at checkout). This site's own (still-present) rows are excluded explicitly, so the
 * answer doesn't depend on whether the cascade has run yet.
 *
 * Accounts live on the control plane, but its users can belong to sites in member pools
 * too — deleting the account there would lock them out of those sites (and leave a pool
 * site's hosting subscription with nobody to manage it). So the control plane also asks
 * every pool; a pool that can't answer keeps everyone, since a leftover account is
 * harmless and a wrongly deleted one is not. A pool deleting one of its own sites only
 * erases its copies of users, so it checks just itself.
 */
async function usersStillNeeded(event: H3Event, userIds: string[], siteId: string): Promise<Set<string>> {
  const keep = new Set(await usersInUseLocally(useDb(event), userIds, siteId))
  if (isMemberPool()) return keep
  const pending = userIds.filter(id => !keep.has(id))
  if (!pending.length) return keep
  await Promise.all(poolBindings(event).map(async ({ binding, stub }) => {
    try {
      const { inUse } = await callPool(stub.usersInUse({ protocol: POOL_PROTOCOL, userIds: pending }), binding)
      for (const id of inUse) keep.add(id)
    }
    catch (err) {
      console.error(JSON.stringify({ event: 'site.delete.pool_user_check_failed', siteId, pool: binding, error: errorMessage(err, String(err)) }))
      for (const id of pending) keep.add(id)
    }
  }))
  return keep
}

async function usersInUseLocally(db: Db, userIds: string[], exceptSiteId: string | null): Promise<string[]> {
  const [roles, invitations, hosting] = await Promise.all([
    db.select({ userId: userSiteRoles.userId }).from(userSiteRoles).where(and(
      inArray(userSiteRoles.userId, userIds),
      exceptSiteId ? ne(userSiteRoles.siteId, exceptSiteId) : undefined,
    )),
    db.select({ userId: siteInvitations.userId }).from(siteInvitations).where(and(
      inArray(siteInvitations.userId, userIds),
      exceptSiteId ? ne(siteInvitations.siteId, exceptSiteId) : undefined,
    )),
    db.select({ userId: hostingSubscriptions.ownerUserId }).from(hostingSubscriptions).where(and(
      inArray(hostingSubscriptions.ownerUserId, userIds),
      exceptSiteId ? or(isNull(hostingSubscriptions.hostedSiteId), ne(hostingSubscriptions.hostedSiteId, exceptSiteId)) : undefined,
    )),
  ])
  return [...new Set([...roles, ...invitations, ...hosting].map(r => r.userId))]
}

/** A member pool's answer: which of these users still have a role or invitation on any of its sites. */
export async function poolUsersInUse(event: H3Event, input: { protocol: number; userIds: string[] }): Promise<{ inUse: string[] }> {
  assertCompatibleProtocol(input.protocol)
  if (!Array.isArray(input.userIds) || !input.userIds.length) return { inUse: [] }
  return { inUse: await usersInUseLocally(useDb(event), input.userIds.slice(0, 500), null) }
}
