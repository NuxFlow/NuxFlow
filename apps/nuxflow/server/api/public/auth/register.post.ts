import { z } from 'zod'
import { users, accounts, userSiteRoles } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { nuxflowPasswordHasher } from '../../../utils/pw'
import { useDb } from '../../../utils/db'
import { resolveSetting } from '../../../utils/settings'
import { rateLimit } from '../../../utils/rate-limit'
import { getOrCreateBetterAuth } from '../../../utils/better-auth'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),
  password: z.string().min(8).max(128),
})

export default defineEventHandler(async (event) => {
  // This route creates a user + credential account directly rather than going through
  // Better Auth's own /api/auth/sign-up/email handler (see the comment below on why), which
  // means it never passes through 04.auth-override.ts's per-path rate limiting either — that
  // limiter is keyed by exact request path and only ever sees "/api/auth/sign-up/email".
  // Mirror the same 5/hour-per-IP limit here so this parallel signup door isn't a completely
  // unthrottled way to mass-create accounts or enumerate existing emails via the check below.
  await rateLimit(event, { limit: 5, windowMs: 60 * 60_000, keyPrefix: 'public-register' })

  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const registrationEnabled = await resolveSetting(event, 'auth.allow_public_registration')
  if (registrationEnabled !== 'true') {
    throw forbidden('Public registration is not enabled for this site')
  }

  const db = useDb(event)
  const email = body.email.toLowerCase()

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  })

  // Silently no-op instead of a distinct error: throwing "an account with this email
  // already exists" directly confirms to an unauthenticated caller whether a given email
  // is registered on this site — a standard user-enumeration issue for a public,
  // rate-limited-but-not-blocked endpoint. Returning the exact same { success: true }
  // shape either way means the real account holder learns nothing new (they already know
  // they have an account) while an enumerating attacker learns nothing either.
  if (!existing) {
    // Create user and credential account directly — same approach as the setup wizard.
    // A self-referencing fetch() to Better Auth's sign-up endpoint times out on
    // Cloudflare Workers (error 522) because a Worker cannot await a subrequest to itself.
    const userId = ulid()
    const passwordHash = await nuxflowPasswordHasher.hash(body.password)

    await db.insert(users).values({
      id: userId,
      name: body.name,
      email,
      emailVerified: false,
    })

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

    // Unlike the invite flow (which proves email ownership via a real emailed
    // password-reset link the invitee must click), self-registration has no such proof
    // today — the account is created directly from an unauthenticated form POST with no
    // verification step at all. auth.api.sendVerificationEmail() is a direct in-process
    // call (not a self-fetch), so it doesn't hit the Workers self-fetch timeout that
    // ruled out calling Better Auth's own sign-up endpoint above. Best-effort: a failure
    // here shouldn't fail registration itself, since login isn't blocked on verification
    // (see the comment on emailVerification in better-auth.ts for why).
    try {
      const auth = await getOrCreateBetterAuth(event)
      await auth.api.sendVerificationEmail({ body: { email, callbackURL: '/login?verified=1' } })
    } catch (err) {
      console.error('[register] Failed to send verification email:', err)
    }
  }

  return { success: true }
})
