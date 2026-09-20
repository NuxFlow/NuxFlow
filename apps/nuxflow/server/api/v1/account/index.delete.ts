import { and, eq, inArray } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { subscriptions, sites, users, comments, formSubmissions } from '@nuxflow/db/schema'
import { hasSuperAdminRole } from '../../../utils/permissions'
import { getConfiguredPaymentProvider } from '../../../utils/payments/resolve'
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
// — Article 17 requires the *content* gone, not just its attribution. Two tables hold
// free-text content the person themselves typed, which the FK-based cascade above
// would otherwise leave fully intact under a now-null authorId/userId:
// - `comments.body` — redacted to a fixed placeholder for every comment authored by
//   this user (see below), preserving thread structure (replies aren't orphaned) the
//   same way nulling authorId already does, but erasing what they actually wrote.
// - `formSubmissions.data` — a schema-less JSON blob shaped by each form's own field
//   definitions (name/email/phone/message, or something else entirely — there's no
//   fixed set of "PII fields" to selectively scrub). Every submission this user made
//   (identified via the real `formSubmissions.userId` FK, not a heuristic like an
//   email-text match) gets its entire `data` blob replaced with a redaction marker
//   rather than picked apart field-by-field, since that's the only reliable way to
//   guarantee nothing personal survives in a shape NuxFlow can't introspect.
// Both run as UPDATEs in the same batch, before the DELETE below — the WHERE clauses
// need `authorId`/`userId` to still equal this user's id, which the DELETE's own
// cascade would otherwise null out first if it ran before these.
export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const userId = session.user.id as string
  const siteId = event.context.siteId as string | null
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

  const activeSubs = await db.select({
    id: subscriptions.id,
    siteId: subscriptions.siteId,
    provider: subscriptions.provider,
    providerSubscriptionId: subscriptions.providerSubscriptionId,
    domain: sites.domain,
  }).from(subscriptions)
    .innerJoin(sites, eq(sites.id, subscriptions.siteId))
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, ['active', 'trialing'])))

  // Users are global, but each site's billing relationship is site-scoped — this
  // request only has settings/credentials for the *current* site's payment provider
  // (resolveSetting() reads event.context.siteId), so a subscription on a different
  // site can't be cancelled from here. Rather than silently deleting the account and
  // orphaning that billing relationship (the provider would keep charging a customer
  // whose NuxFlow account no longer exists to manage it), block and name the sites
  // that need it cancelled there first.
  const otherSiteSubs = activeSubs.filter(s => s.siteId !== siteId)
  if (otherSiteSubs.length > 0) {
    throw conflict(
      `Cancel your active subscription on ${otherSiteSubs.map(s => s.domain).join(', ')} before deleting your account.`,
      { domains: otherSiteSubs.map(s => s.domain) },
    )
  }

  for (const sub of activeSubs) {
    if (sub.providerSubscriptionId.startsWith('free_')) continue // no real provider behind a free-tier row
    try {
      const provider = await getConfiguredPaymentProvider(event, sub.provider)
      await provider.cancelSubscription(sub.providerSubscriptionId)
    }
    catch (err) {
      rethrowAsProviderError(err, 'cancellation')
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

  const redactCommentsStmt = db.update(comments)
    .set({ body: '[deleted]' })
    .where(eq(comments.authorId, userId))

  const redactFormSubmissionsStmt = db.update(formSubmissions)
    .set({ data: { redacted: true, redactedAt: new Date().toISOString() } })
    .where(eq(formSubmissions.userId, userId))

  await batchWithAudit(
    db,
    [redactCommentsStmt, redactFormSubmissionsStmt, db.delete(users).where(eq(users.id, userId))],
    auditInsert,
  )

  return noContent(event)
})
