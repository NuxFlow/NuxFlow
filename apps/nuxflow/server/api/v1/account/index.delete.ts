import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { subscriptions, sites, users, userSiteRoles } from '@nuxflow/db/schema'
import { buildGdprRedactionStatements } from '@nuxflow/db/queries'
import { hasSuperAdminRole } from '../../../utils/permissions'
import { getConfiguredPaymentProvider } from '../../../utils/payments/resolve'
import { eventForSite } from '../../../utils/site-info'
import { getOrCreateBetterAuth } from '../../../utils/better-auth'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { errorMessage, rethrowAsProviderError } from '../../../utils/errors'

// Article 17 (right to erasure) self-service account deletion. `users` is a single
// global account shared across every site in this D1 instance (no siteId column — see
// the multi-site note in CLAUDE.md), so this deletes the account outright rather than
// just this site's membership row — unlike DELETE /api/v1/users/:id (admin-initiated,
// site-scoped, only ever removes a user_site_roles row).
//
// A plain `db.delete(users)` unlinks everything: every FK from another table to
// users.id already declares its own real, D1-enforced cascade behaviour —
// sessions/accounts/passkeys/user_site_roles/api_keys/notifications/
// push_subscriptions/ai_generation_jobs/subscriptions cascade-delete, while
// audit_logs/media/video_assets/content_items/content_revisions/comments/
// form_submissions set their userId/authorId/uploadedBy column to null instead of
// deleting the row — content and media the person created stay in place, correctly
// treated as the *site's* data rather than solely the person's, exactly like
// deleteSiteCompletely()'s media-deletion step only runs when the whole site (not
// just one contributor) is being torn down. See packages/db/src/schema/*.ts for the
// authoritative per-table FK behaviour.
//
// Unlinking the FK is not the same as erasing the personal data it pointed at, though
// — Article 17 requires the *content* gone, not just its attribution. The redaction
// UPDATEs below are built from GDPR_REDACTION_TARGETS (@nuxflow/db/queries, gdpr.ts) —
// the single, tested registry of every table holding free-text content a person typed
// themselves that this FK-cascade would otherwise leave fully intact under a now-null
// authorId/userId. Currently: `comments.body` (redacted to a fixed placeholder per
// comment, preserving thread structure — replies aren't orphaned — the same way
// nulling authorId already does, but erasing what they actually wrote) and
// `formSubmissions.data` (a schema-less JSON blob shaped by each form's own field
// definitions, with no fixed set of "PII fields" to selectively scrub, so the entire
// blob is replaced with a redaction marker rather than picked apart field-by-field).
// See gdpr.ts's own doc comment for why this is a registry rather than hand-picked
// here, and tests/unit/gdpr-redaction.test.ts for how a new table with this same FK
// shape is forced through an explicit redact-or-exempt decision instead of silently
// falling through. These run as UPDATEs in the same batch, before the DELETE below —
// the WHERE clauses need `authorId`/`userId` to still equal this user's id, which the
// DELETE's own cascade would otherwise null out first if it ran before these.
export default defineEventHandler(async (event) => {
  // Account-wide: only from the accounts origin under central sign-in (never with a
  // site-session cookie from some site's own domain — see requireAccountSession).
  const session = await requireAccountSession(event)
  const userId = session.user.id as string
  const db = useDb(event)

  // A super admin's access spans every site in this deployment (hasSuperAdminRole
  // checks "any site", matching requireSuperAdmin elsewhere) — self-deleting here would
  // silently strip that from every one of those sites with no confirmation step,
  // mirroring the existing self-revocation guard on POST/DELETE
  // /api/v1/users/:id/super-admin. Ask them to have another super admin revoke it (or
  // do it themselves from Admin → Users) first, so it's a deliberate, visible action.
  if (await hasSuperAdminRole(db, userId)) {
    throw forbidden('You have super admin access on one or more sites. Have another super admin revoke it (Admin → Users) before deleting your account.')
  }

  // Accounts are global, so this deletion reaches every site the user belongs to — not
  // just the one they're on. Removing the last admin of some other site would leave that
  // site with nobody able to manage it (short of the platform operator stepping in), so
  // block it and name the sites that need another admin first.
  const adminSites = await db.select({ siteId: userSiteRoles.siteId, domain: sites.domain })
    .from(userSiteRoles)
    .innerJoin(sites, eq(sites.id, userSiteRoles.siteId))
    .where(and(eq(userSiteRoles.userId, userId), eq(userSiteRoles.role, 'admin')))
  const soleAdminDomains: string[] = []
  for (const s of adminSites) {
    const [other] = await db.select({ n: sql<number>`count(*)` }).from(userSiteRoles).where(and(
      eq(userSiteRoles.siteId, s.siteId),
      ne(userSiteRoles.userId, userId),
      inArray(userSiteRoles.role, ['admin', 'super_admin']),
    ))
    if (!other?.n) soleAdminDomains.push(s.domain)
  }
  if (soleAdminDomains.length > 0) {
    throw conflict(
      `You are the only admin of ${soleAdminDomains.join(', ')}. Make someone else an admin there before deleting your account.`,
      { domains: soleAdminDomains },
    )
  }

  const activeSubs = await db.select({
    id: subscriptions.id,
    siteId: subscriptions.siteId,
    provider: subscriptions.provider,
    providerSubscriptionId: subscriptions.providerSubscriptionId,
    domain: sites.domain,
  }).from(subscriptions)
    .innerJoin(sites, eq(sites.id, subscriptions.siteId))
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, ['active', 'trialing'])))

  // Users are global, but each site's billing relationship is site-scoped: every
  // subscription is cancelled with the credentials of the site it belongs to (resolved
  // through eventForSite, since resolveSetting() reads the site from the event), so the
  // provider stops charging a customer whose account no longer exists. Any failure aborts
  // the whole deletion before anything is removed, naming the site involved.
  for (const sub of activeSubs) {
    if (sub.providerSubscriptionId.startsWith('free_')) continue // no real provider behind a free-tier row
    try {
      const provider = await getConfiguredPaymentProvider(eventForSite(event, sub.siteId), sub.provider)
      await provider.cancelSubscription(sub.providerSubscriptionId)
    }
    catch (err) {
      rethrowAsProviderError(err, `cancellation (${sub.domain})`)
    }
  }

  // Best-effort — clears the session cookie via Better Auth's own sign-out so the
  // browser doesn't keep presenting a cookie for a session row that's about to be
  // cascade-deleted below. Not fatal: even without this, the next request with the
  // stale cookie simply finds no matching session and is treated as logged out.
  try {
    const auth = await getOrCreateBetterAuth(event)
    const signOutResponse = await auth.api.signOut({ headers: event.headers, asResponse: true })
    const setCookie = typeof signOutResponse.headers.getSetCookie === 'function'
      ? signOutResponse.headers.getSetCookie()
      : signOutResponse.headers.get('set-cookie')
        ? [signOutResponse.headers.get('set-cookie') as string]
        : []
    for (const cookie of setCookie) {
      appendResponseHeader(event, 'set-cookie', cookie)
    }
  }
  catch (err) {
    console.error('[account.delete] Best-effort sign-out failed:', errorMessage(err, String(err)))
  }

  // userId is deliberately NOT passed as the audit row's own userId (unlike every
  // other writeAuditLog call in this codebase, which attributes the action to the
  // actor) — batchWithAudit always runs the audit insert *after* the primary write in
  // the same batch, and the primary write here is deleting this exact user, so a FK
  // reference to their (about-to-be-gone) id would fail the insert outright rather
  // than just going null later like a normal cascade would. Recorded in `before`
  // instead, which has no FK and survives.
  const auditInsert = buildAuditLogInsert(event, null, {
    action: 'delete',
    resource: 'user',
    resourceId: userId,
    before: { email: session.user.email, self: true },
  })

  await batchWithAudit(
    db,
    [...buildGdprRedactionStatements(db, userId), db.delete(users).where(eq(users.id, userId))],
    auditInsert,
  )

  return noContent(event)
})
