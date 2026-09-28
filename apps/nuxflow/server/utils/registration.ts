import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { users, accounts, userSiteRoles } from '@nuxflow/db/schema'
import { useDb } from './db'
import { nuxflowPasswordHasher } from './pw'
import { resolveSetting } from './settings'
import { eventForSite } from './site-info'
import { getOrCreateBetterAuth } from './better-auth'

/** A site's own "Allow public registration" setting (Settings → General). */
export async function isPublicRegistrationOpen(event: H3Event, siteId: string): Promise<boolean> {
  const value = await resolveSetting(eventForSite(event, siteId), 'auth.allow_public_registration')
  return value === 'true' || value === true
}

/**
 * Self-registration for one site: creates the (global) account and makes it a `member`
 * of that site. Used by the accounts origin's register page (central sign-in) and by
 * /api/public/auth/register on a single-site install.
 *
 * An email that already has an account is a silent no-op with the same result shape —
 * saying "that email is taken" would let anyone enumerate registered addresses. Someone
 * who already has an account joins a site by signing in instead (the join option on the
 * accounts origin's /authorize page).
 */
export async function registerAccountForSite(
  event: H3Event,
  siteId: string,
  input: { name: string; email: string; password: string },
): Promise<void> {
  if (!(await isPublicRegistrationOpen(event, siteId))) {
    throw forbidden('Public registration is not enabled for this site')
  }

  const db = useDb(event)
  const email = input.email.toLowerCase()
  const existing = await db.query.users.findFirst({ where: eq(users.email, email), columns: { id: true } })
  if (existing) return

  // Created directly rather than through Better Auth's own /api/auth/sign-up/email: a
  // Worker can't await a subrequest to itself (it times out with a 522), and that endpoint
  // is blocked anyway (04.auth-override.ts) since it ignores per-site registration settings.
  const userId = ulid()
  const passwordHash = await nuxflowPasswordHasher.hash(input.password)
  await db.insert(users).values({ id: userId, name: input.name, email, emailVerified: false })
  await db.insert(accounts).values({
    id: ulid(),
    accountId: userId,
    providerId: 'credential',
    // Must match Better Auth's own createLocalAccountIssuer('credential') —
    // sign-in looks accounts up by (issuer, accountId), not providerId.
    issuer: 'local:credential',
    userId,
    password: passwordHash,
  })
  await db.insert(userSiteRoles)
    .values({ id: ulid(), userId, siteId, role: 'member' })
    .onConflictDoNothing()

  // Self-registration proves nothing about the mailbox, so a verification email follows.
  // Best-effort and not enforced for login (see emailVerification in better-auth.ts). The
  // `site` parameter brands the email and the page it lands on.
  try {
    const auth = await getOrCreateBetterAuth(event)
    await auth.api.sendVerificationEmail({ body: { email, callbackURL: `/login?${new URLSearchParams({ verified: '1', site: siteId })}` } })
  } catch (err) {
    console.error('[register] Failed to send verification email:', err)
  }
}
